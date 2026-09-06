'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { runRelease, LOCK_SQL, HELD_SQL } = require('./run-release.cjs');
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
