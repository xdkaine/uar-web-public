'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { runRelease, connectInitially, LOCK_SQL, HELD_SQL } = require('./run-release.cjs');
function database() {
  const db = new EventEmitter();
  db.calls = [];
  db.held = true;
  db.connect = async () => { db.calls.push('connect'); };
  db.query = async (sql) => { db.calls.push(sql); return { rows: [{ held: db.held }] }; };
  db.end = async () => { db.calls.push('end'); };
  return db;
}
test('holds one database lease across ordered migrations and grants and removes admin credentials from Prisma', async () => {
  const db = database(); const commands = [];
  await runRelease({ db, log() {}, env: { DATABASE_URL: 'migration-url', PGUSER: 'admin', PGPASSWORD: 'admin-password', PORTAL_DATABASE_PASSWORD: 'portal' }, run: async (cmd, args, options) => {
    assert.ok(db.calls.includes(LOCK_SQL)); assert.notEqual(db.calls.at(-1), 'end');
    commands.push([cmd, args]);
    if (cmd.endsWith('prisma')) { assert.equal(options.env.PGPASSWORD, undefined); assert.equal(options.env.PGUSER, undefined); assert.equal(options.env.DATABASE_URL, 'migration-url'); }
  }});
  assert.deepEqual(commands.map(c => c[0]), ['psql', '/app/node_modules/.bin/prisma', 'sh']);
  assert.equal(commands[1][1].at(-1), '/app/prisma.config.ts');
  assert.equal(commands[2][1].at(-1), '/opt/uar/database-role-separation/apply.sh');
  assert.ok(commands.every(([, args]) => args.every(arg => !arg.includes('/app/auth-migration'))));
  assert.equal(db.calls.filter(c => c === LOCK_SQL).length, 1);
  assert.equal(db.calls.at(-1), 'end');
});
test('failed portal migration aborts grants', async () => {
  const db = database(); let calls = 0;
  await assert.rejects(runRelease({ db, log() {}, run: async () => { if (++calls === 2) throw Error('failed'); } }));
  assert.equal(calls, 2); assert.equal(db.calls.at(-1), 'end');
});
test('connection loss cancels active child, waits for it, and prevents later steps', async () => {
  const db = database(); let calls = 0; let childExited = false;
  const end = db.end; db.end = async () => { assert.ok(childExited); await end(); };
  await assert.rejects(runRelease({ db, log() {}, run: async (command, args, { signal }) => {
    calls++;
    await new Promise((resolve) => {
      signal.addEventListener('abort', () => { setImmediate(() => { childExited = true; resolve(); }); }, { once: true });
      db.emit('error', Error('connection lost'));
    });
  }}));
  assert.equal(calls, 1); assert.equal(db.calls.at(-1), 'end');
});
test('lease no longer held on the same connection prevents mutation', async () => {
  const db = database(); db.held = false; let calls = 0;
  await assert.rejects(runRelease({ db, log() {}, run: async () => { calls++; } }));
  assert.equal(calls, 0); assert.ok(db.calls.includes(HELD_SQL));
});
test('heartbeat detects lost advisory ownership during a command', async () => {
  const db = database(); let calls = 0;
  await assert.rejects(runRelease({ db, log() {}, heartbeatMs: 5, run: async (command, args, { signal }) => {
    calls++; db.held = false;
    await new Promise((resolve) => { const fallback = setTimeout(resolve, 1000); signal.addEventListener('abort', () => { clearTimeout(fallback); resolve(); }, { once: true }); });
  }}));
  assert.equal(calls, 1);
});

test('transient initial connection failures use fresh clients then run migrations once', async () => {
  const clients = []; let clock = 0;
  const db = await connectInitially({
    now: () => clock, sleep: async (ms) => { clock += ms; },
    createClient: ({ connectionTimeoutMillis }) => {
      assert.ok(connectionTimeoutMillis <= 3000);
      const client = database(); const index = clients.length; clients.push(client);
      client.connect = async () => { client.calls.push('connect'); if (index < 2) throw Object.assign(new Error('not ready'), { code: 'ECONNREFUSED' }); };
      return client;
    },
  });
  assert.equal(clients.length, 3);
  assert.deepEqual(clients[0].calls, ['connect', 'end']);
  assert.deepEqual(clients[1].calls, ['connect', 'end']);
  let migrations = 0;
  await runRelease({ db, connected: true, log() {}, run: async () => { migrations++; } });
  assert.equal(migrations, 3);
  assert.equal(db.calls.filter(call => call === 'connect').length, 1);
  assert.equal(db.calls.filter(call => call === LOCK_SQL).length, 1);
});

test('authentication and TLS failures are never retried', async () => {
  for (const code of ['28P01', '28000', 'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT']) {
    let attempts = 0; const db = database();
    db.connect = async () => { throw Object.assign(new Error('denied'), { code }); };
    await assert.rejects(connectInitially({ createClient: () => { attempts++; return db; }, sleep: async () => assert.fail('must not retry') }));
    assert.equal(attempts, 1); assert.deepEqual(db.calls, ['end']);
  }
});

test('initial connection attempts are exhausted without any SQL or migration work', async () => {
  const clients = []; let clock = 0;
  await assert.rejects(connectInitially({ now: () => clock, sleep: async ms => { clock += ms; }, createClient: () => {
    const db = database(); clients.push(db);
    db.connect = async () => { throw Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }); };
    return db;
  }}));
  assert.equal(clients.length, 10);
  assert.ok(clock <= 30000);
  assert.ok(clients.every(db => db.calls.length === 1 && db.calls[0] === 'end'));
});

test('elapsed retry budget prevents another attempt', async () => {
  let attempts = 0; let clock = 0;
  await assert.rejects(connectInitially({ maxElapsedMs: 20, now: () => clock, sleep: async ms => { clock += ms; }, createClient: () => {
    attempts++; const db = database();
    db.connect = async () => { throw Object.assign(new Error('refused'), { code: 'EHOSTUNREACH' }); };
    return db;
  }}));
  assert.equal(attempts, 1); assert.equal(clock, 20);
});

test('aborting an initial connection closes it and starts no later attempt', async () => {
  const controller = new AbortController(); let attempts = 0; const db = database();
  db.connect = () => new Promise(() => {});
  const pending = connectInitially({ signal: controller.signal, createClient: () => { attempts++; return db; } });
  controller.abort();
  await assert.rejects(pending);
  assert.equal(attempts, 1); assert.deepEqual(db.calls, ['end']);
});

test('migration failure after initial connection succeeds never reconnects or replays work', async () => {
  let attempts = 0; let steps = 0; const client = database();
  const db = await connectInitially({ createClient: () => { attempts++; return client; } });
  await assert.rejects(runRelease({ db, connected: true, log() {}, run: async () => { steps++; throw Object.assign(new Error('connection failed during SQL'), { code: 'ECONNREFUSED' }); } }));
  assert.equal(attempts, 1); assert.equal(steps, 1);
  assert.equal(db.calls.filter(call => call === LOCK_SQL).length, 1);
});
