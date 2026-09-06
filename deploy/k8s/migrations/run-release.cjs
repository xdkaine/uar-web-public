'use strict';

const { spawn } = require('node:child_process');
const { createRequire } = require('node:module');
const { setTimeout: delay } = require('node:timers/promises');
const LOCK_SQL = "SELECT pg_advisory_lock(hashtextextended('uar-dev-release-migrations', 0))";
const HELD_SQL = "SELECT EXISTS (SELECT 1 FROM pg_locks WHERE pid = pg_backend_pid() AND locktype = 'advisory' AND granted AND classid = ((hashtextextended('uar-dev-release-migrations', 0) >> 32) & 4294967295)::oid AND objid = (hashtextextended('uar-dev-release-migrations', 0) & 4294967295)::oid AND objsubid = 1) AS held";

async function connectInitially({ createClient, signal, maxElapsedMs = 30000, maxAttempts = 10, retryDelayMs = 3000, now = Date.now, sleep = delay }) {
  const deadline = now() + maxElapsedMs;
  const retryable = new Set(['ECONNREFUSED', 'ETIMEDOUT', 'EHOSTUNREACH', 'EAI_AGAIN']);
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (signal?.aborted) throw new Error('Migration connection aborted');
    const remaining = deadline - now();
    if (remaining <= 0) throw new Error('Migration connection retry budget exhausted');
    const connectionTimeoutMillis = Math.min(3000, remaining);
    const client = createClient({ connectionTimeoutMillis });
    // A failed initial connection owns no lease and has executed no SQL.
    // Consume connection error events while connect() supplies the rejection.
    const initialError = () => {};
    client.on('error', initialError);
    let timer;
    let stop;
    try {
      const bounded = new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error('Initial connection timed out'), { code: 'ETIMEDOUT' })), connectionTimeoutMillis);
        stop = () => reject(new Error('Migration connection aborted'));
        signal?.addEventListener('abort', stop, { once: true });
        if (signal?.aborted) stop();
      });
      await Promise.race([client.connect(), bounded]);
      if (signal?.aborted) throw new Error('Migration connection aborted');
      return client;
    } catch (error) {
      await client.end().catch(() => {});
      if (signal?.aborted || !retryable.has(error.code) || attempt === maxAttempts || now() >= deadline) throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', stop);
      client.removeListener('error', initialError);
    }
    await sleep(Math.min(retryDelayMs, Math.max(0, deadline - now())), undefined, { signal });
  }
  throw new Error('Migration connection retry budget exhausted');
}

function runChild(command, args, { env, signal }) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error('Migration lease unavailable'));
    const child = spawn(command, args, { env, stdio: 'inherit', detached: true });
    let killTimer;
    const kill = () => {
      // Prisma can spawn an engine. Terminate the entire process group before
      // releasing the connection that owns the whole-release advisory lock.
      try { process.kill(-child.pid, 'SIGTERM'); } catch {}
      killTimer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 3000);
      killTimer.unref();
    };
    signal.addEventListener('abort', kill, { once: true });
    child.once('error', (error) => {
      signal.removeEventListener('abort', kill);
      clearTimeout(killTimer);
      reject(error);
    });
    child.once('close', (code) => {
      signal.removeEventListener('abort', kill);
      clearTimeout(killTimer);
      if (signal.aborted || code !== 0) reject(new Error('Migration command failed'));
      else resolve();
    });
  });
}

async function runRelease({ db, connected = false, run = runChild, env = process.env, log = console.log, signal, heartbeatMs = 1000 }) {
  const abort = new AbortController();
  let leaseLost = false;
  let finished = false;
  let timer;
  let pingInFlight = false;
  const loseLease = () => { if (!finished) { leaseLost = true; abort.abort(); } };
  const stop = () => abort.abort();
  signal?.addEventListener('abort', stop, { once: true });
  if (signal?.aborted) stop();
  db.on('error', loseLease);
  db.on('end', loseLease);
  const assertLease = async () => {
    if (leaseLost || abort.signal.aborted) throw new Error('Migration lease unavailable');
    const result = await db.query(HELD_SQL);
    if (result.rows[0]?.held !== true) { loseLease(); throw new Error('Migration lease unavailable'); }
    if (leaseLost || abort.signal.aborted) throw new Error('Migration lease unavailable');
  };
  try {
    if (abort.signal.aborted) throw new Error('Migration lease unavailable');
    if (!connected) await db.connect();
    if (abort.signal.aborted) throw new Error('Migration lease unavailable');
    await db.query("SET statement_timeout = '12min'");
    await db.query(LOCK_SQL);
    await db.query("SET statement_timeout = '5s'");
    await assertLease();
    timer = setInterval(async () => {
      if (pingInFlight || abort.signal.aborted) return;
      pingInFlight = true;
      try { await assertLease(); } catch { loseLease(); }
      finally { pingInFlight = false; }
    }, heartbeatMs);
    timer.unref();
    const migrationEnv = { ...env };
    for (const key of ['PGUSER', 'PGPASSWORD', 'PORTAL_DATABASE_PASSWORD', 'AUTH_DATABASE_PASSWORD', 'MIGRATION_DATABASE_PASSWORD']) delete migrationEnv[key];
    const steps = [
      ['bootstrap database roles', 'psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-f', '/release/bootstrap-roles.sql'], env],
      ['apply portal migrations', '/app/node_modules/.bin/prisma', ['migrate', 'deploy', '--config', '/app/prisma.config.ts'], migrationEnv],
      ['apply and verify runtime grants', 'sh', ['/opt/uar/database-role-separation/apply.sh'], env],
    ];
    for (const [label, command, args, childEnv] of steps) {
      await assertLease();
      log(`Release migration: ${label}`);
      await run(command, args, { env: childEnv, signal: abort.signal });
      await assertLease();
    }
    log('Release migration completed and runtime grants verified.');
  } finally {
    finished = true;
    clearInterval(timer);
    abort.abort();
    signal?.removeEventListener('abort', stop);
    // Closing this connection releases the advisory lock only after the active
    // child has exited. Connection loss aborts child work and never starts the
    // next step; interrupted Prisma migrations require operator reconciliation.
    await db.end().catch(() => {});
  }
}

async function main() {
  for (const key of ['PGHOST', 'PGDATABASE', 'PGUSER', 'PGPASSWORD', 'DATABASE_URL', 'PORTAL_DATABASE_PASSWORD', 'AUTH_DATABASE_PASSWORD', 'MIGRATION_DATABASE_PASSWORD']) {
    if (!process.env[key]) throw new Error('Required migration configuration missing');
  }
  if (process.env.PGHOST !== 'postgres.uar-dev.svc.cluster.local') throw new Error('Migration target must be the isolated dev database');
  const target = new URL(process.env.DATABASE_URL);
  if (target.hostname !== process.env.PGHOST || target.username !== 'uar_migration' || target.pathname !== `/${process.env.PGDATABASE}` || target.searchParams.get('sslmode') !== 'require' || target.searchParams.get('sslrootcert') !== '/etc/uar/database-tls/ca.crt') {
    throw new Error('Migration URL does not satisfy the isolated dev contract');
  }
  const runtimeRequire = createRequire('/app/package.json');
  const { Client } = runtimeRequire('pg');
  const fs = require('node:fs');
  const options = { host: process.env.PGHOST, port: 5432, database: process.env.PGDATABASE, user: process.env.PGUSER, password: process.env.PGPASSWORD, ssl: { rejectUnauthorized: true, ca: fs.readFileSync('/etc/uar/database-tls/ca.crt', 'utf8') }, keepAlive: true, keepAliveInitialDelayMillis: 1000 };
  const signal = new AbortController();
  process.once('SIGTERM', () => signal.abort());
  process.once('SIGINT', () => signal.abort());
  const client = await connectInitially({ createClient: (timing) => new Client({ ...options, ...timing }), signal: signal.signal });
  await runRelease({ db: client, connected: true, signal: signal.signal });
}
if (require.main === module) main().catch(() => { console.error('Release migration failed. No subsequent migration or rollout step was authorized by this job. Inspect the failed step and reconcile database state before retrying.'); process.exitCode = 1; });
module.exports = { runRelease, runChild, connectInitially, LOCK_SQL, HELD_SQL };
