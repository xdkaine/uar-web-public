import { describe, expect, it } from 'vitest';
import { RedisAdapter } from './adapter';
import {
  attachLoginContext,
  captureLoginContext,
  destroySessionBySid,
  destroySessionsForClient,
  destroySessionsForUser,
  isValidDeviceId,
  listActiveSessions,
} from './session-store';

interface MemoryEntry {
  value: string;
  ttl?: number;
}

class MemoryRedis {
  readonly store = new Map<string, MemoryEntry>();

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    return entry ? entry.value : null;
  }

  async set(key: string, value: string, options?: { EX?: number }): Promise<unknown> {
    this.store.set(key, { value, ttl: options?.EX });
    return 'OK';
  }

  async expire(key: string, seconds: number): Promise<unknown> {
    const entry = this.store.get(key);
    if (entry) entry.ttl = seconds;
    return 1;
  }

  async del(...keys: string[]): Promise<unknown> {
    let removed = 0;
    for (const key of keys) {
      if (this.store.delete(key)) removed += 1;
    }
    return removed;
  }
}

/** Honors the MATCH prefix so sidecar/authsvc keys stay invisible to scans, like real Redis. */
class ScannableRedis extends MemoryRedis {
  async *scanIterator(opts: { MATCH: string; COUNT: number }): AsyncIterable<string> {
    const prefix = opts.MATCH.replace(/\*$/, '');
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) yield key;
    }
  }
}

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

function sessionPayload(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    jti: 'jti-1',
    kind: 'Session',
    uid: 'uid-1',
    accountId: 'alice',
    loginTs: nowSeconds() - 120,
    iat: nowSeconds() - 120,
    exp: nowSeconds() + 3600,
    authorizations: { 'uar-portal': { sid: 'client-sid-1', grantId: 'g1' } },
    ...overrides,
  });
}

describe('isValidDeviceId', () => {
  it('accepts opaque token-shaped ids', () => {
    expect(isValidDeviceId('d1a2b3c4-2f')).toBe(true);
    expect(isValidDeviceId('A'.repeat(64))).toBe(true);
  });

  it('rejects free-form text, control characters, and wrong lengths', () => {
    expect(isValidDeviceId('short')).toBe(false);
    expect(isValidDeviceId('<script>alert(1)</script>')).toBe(false);
    expect(isValidDeviceId('has space inside-pad')).toBe(false);
    expect(isValidDeviceId(`${'A'.repeat(129)}`)).toBe(false);
    expect(isValidDeviceId(42)).toBe(false);
    expect(isValidDeviceId(undefined)).toBe(false);
  });
});

describe('captureLoginContext + attachLoginContext', () => {
  it('binds a fresh sign-in context to the first save of its session', async () => {
    const redis = new ScannableRedis();
    await captureLoginContext(redis, 'Alice', {
      clientId: 'acme-app',
      ip: '10.0.0.9',
      userAgent: 'Mozilla/5.0 TestBrowser',
      deviceId: 'ddeadbeef-12',
      deviceCookieId: '0f0f0f0f-1111-2222-3333-444455556666',
    });

    await attachLoginContext(redis as never, 'alice', 'jti-A', 3600);

    const raw = await redis.get('authsvc:sessmeta:jti-A');
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw as string);
    expect(parsed.clientId).toBe('acme-app');
    expect(parsed.deviceCookieId).toBe('0f0f0f0f-1111-2222-3333-444455556666');
    // Stash is consumed exactly once.
    expect(await redis.get('authsvc:lastlogin:alice')).toBeNull();

    // Later saves of the same session must not overwrite or re-attach.
    await captureLoginContext(redis, 'alice', { clientId: 'other-app', ip: '10.9.9.9' });
    await attachLoginContext(redis as never, 'alice', 'jti-A', 3600);
    const again = JSON.parse((await redis.get('authsvc:sessmeta:jti-A')) as string);
    expect(again.clientId).toBe('acme-app');
    // The unconsumed newer stash remains pending for the NEXT login.
    expect(await redis.get('authsvc:lastlogin:alice')).toBeTruthy();
  });

  it('drops stale contexts instead of misattributing old sessions', async () => {
    const redis = new ScannableRedis();
    await captureLoginContext(redis, 'bob', { ip: '10.0.0.2' });
    // Backdate beyond the 600s freshness window.
    const stash = JSON.parse((await redis.get('authsvc:lastlogin:bob')) as string);
    stash.ts = nowSeconds() - 3600;
    await redis.set('authsvc:lastlogin:bob', JSON.stringify(stash));

    await attachLoginContext(redis as never, 'bob', 'jti-B', 3600);

    expect(await redis.get('authsvc:sessmeta:jti-B')).toBeNull();
    expect(await redis.get('authsvc:lastlogin:bob')).toBeNull();
  });

  it('never throws when the stash is missing or corrupt', async () => {
    const redis = new ScannableRedis();
    await redis.set('authsvc:lastlogin:carol', '{oops');
    await expect(
      attachLoginContext(redis as never, 'carol', 'jti-C', 3600)
    ).resolves.toBeUndefined();
    await expect(
      attachLoginContext(redis as never, 'dave', 'jti-D', 3600)
    ).resolves.toBeUndefined();
  });

  it('keeps simultaneous sign-ins for the same account correlated by interaction uid', async () => {
    const redis = new ScannableRedis();
    await captureLoginContext(redis, 'alice', { clientId: 'portal', ip: '10.0.0.1' }, 'uid-first');
    await captureLoginContext(redis, 'alice', { clientId: 'wiki', ip: '10.0.0.2' }, 'uid-second');

    // Attach out of order, as oidc-provider may persist concurrent sessions.
    await attachLoginContext(redis as never, 'alice', 'jti-second', 3600, 'uid-second');
    await attachLoginContext(redis as never, 'alice', 'jti-first', 3600, 'uid-first');

    expect(JSON.parse((await redis.get('authsvc:sessmeta:jti-first')) as string)).toMatchObject({
      clientId: 'portal',
      ip: '10.0.0.1',
    });
    expect(JSON.parse((await redis.get('authsvc:sessmeta:jti-second')) as string)).toMatchObject({
      clientId: 'wiki',
      ip: '10.0.0.2',
    });
  });
});

describe('listActiveSessions', () => {
  it('enumerates live sessions with joined context and aggregates', async () => {
    const redis = new ScannableRedis();
    redis.set('oidc:Session:jti-1', sessionPayload());
    redis.set(
      'oidc:Session:jti-2',
      sessionPayload({
        jti: 'jti-2',
        uid: 'uid-2',
        accountId: 'Bob',
        authorizations: {
          'uar-portal': { sid: 's2' },
          'acme-app': { sid: 's3' },
        },
      })
    );
    redis.set('authsvc:sessmeta:jti-1', JSON.stringify({ clientId: 'uar-portal', ip: '10.0.0.9' }));
    redis.set('authsvc:sessmeta:jti-2', JSON.stringify({ clientId: 'acme-app', deviceCookieId: 'aaaaaaaa-1111-2222-3333-444455556666', deviceId: 'v2-client-submitted-digest' }));
    // Noise that real Redis would not match but the stub filters defensively.
    redis.set('oidc:Session:uid:uid-1', 'jti-1');
    redis.set('oidc:Session:not-json', '{bad');

    const { sessions, aggregates } = await listActiveSessions(redis as never);

    expect(sessions).toHaveLength(2);
    const alice = sessions.find((s) => s.accountId === 'alice');
    expect(alice?.clients).toEqual(['uar-portal']);
    expect(alice?.context?.ip).toBe('10.0.0.9');
    const bob = sessions.find((s) => s.accountId === 'bob');
    expect(bob?.context?.deviceCookieId).toMatch(/^v1-/);
    expect(bob?.context?.deviceId).toMatch(/^v1-/);
    expect(bob?.context?.deviceId).not.toContain('client-submitted');

    expect(aggregates.totalSessions).toBe(2);
    expect(aggregates.distinctUsers).toBe(2);
    expect(aggregates.distinctDevices).toBe(1);
    // jti-2 holds authorizations for BOTH apps.
    expect(aggregates.perClient).toEqual([
      { clientId: 'uar-portal', sessions: 2 },
      { clientId: 'acme-app', sessions: 1 },
    ]);
  });

  it('hides expired-but-unreaped records and empty stores report zeros', async () => {
    const redis = new ScannableRedis();
    redis.set(
      'oidc:Session:jti-old',
      sessionPayload({ jti: 'jti-old', exp: nowSeconds() - 10 })
    );
    const live = await listActiveSessions(redis as never);
    expect(live.sessions).toHaveLength(0);
    expect(live.aggregates.totalSessions).toBe(0);

    const blind = await listActiveSessions(new MemoryRedis() as never);
    expect(blind.sessions).toEqual([]);
    expect(blind.aggregates.perClient).toEqual([]);
  });
});

describe('destroy scopes', () => {
  it('destroys one session by sid and refuses non-session payloads', async () => {
    const redis = new ScannableRedis();
    const adapter = new RedisAdapter('Session', redis);
    await adapter.upsert('jti-live', JSON.parse(sessionPayload({ jti: 'jti-live', uid: 'uid-live' })), 3600);

    expect(await destroySessionBySid(redis as never, adapter, 'jti-live')).toEqual({
      destroyed: 1,
      failed: 0,
      authorizations: [{ clientId: 'uar-portal', sid: 'client-sid-1', subject: 'alice' }],
    });
    expect(await adapter.find('jti-live')).toBeUndefined();
    expect(await redis.get('authsvc:sessmeta:jti-live')).toBeNull();
    expect(await destroySessionBySid(redis as never, adapter, 'jti-missing')).toEqual({
      destroyed: 0,
      failed: 0,
      authorizations: [],
    });
    expect(await destroySessionBySid(redis as never, adapter, '../etc')).toEqual({
      destroyed: 0,
      failed: 0,
      authorizations: [],
    });

    redis.set('oidc:Session:grant-x', '{"kind":"Grant","jti":"grant-x"}');
    expect(await destroySessionBySid(redis as never, adapter, 'grant-x')).toEqual({
      destroyed: 0,
      failed: 0,
      authorizations: [],
    });
  });

  it('counts a failing destroy as failed instead of throwing past the audit trail', async () => {
    const redis = new ScannableRedis();
    redis.set('oidc:Session:f1f1f1f1', sessionPayload({ jti: 'f1f1f1f1', uid: 'uf1f1f1f1' }));

    const outcome = await destroySessionBySid(redis as never, {
      destroy: async () => {
        throw new Error('redis unavailable');
      },
    }, 'f1f1f1f1');

    expect(outcome).toEqual({ destroyed: 0, failed: 1, authorizations: [] });
    // The record itself is untouched when the destroy fails.
    expect(await redis.get('oidc:Session:f1f1f1f1')).toBeTruthy();
  });

  it('signs a user out everywhere, matching account case-insensitively', async () => {
    const redis = new ScannableRedis();
    redis.set('oidc:Session:a1', sessionPayload({ jti: 'a1', uid: 'u1', accountId: 'Alice' }));
    redis.set('oidc:Session:a2', sessionPayload({ jti: 'a2', uid: 'u2', accountId: 'alice', exp: nowSeconds() + 60 }));
    redis.set('oidc:Session:b1', sessionPayload({ jti: 'b1', uid: 'u3', accountId: 'bob' }));

    const destroyed: string[] = [];
    const outcome = await destroySessionsForUser(
      redis as never,
      { destroy: async (id) => void destroyed.push(id) },
      ' ALICE '
    );

    expect(outcome).toEqual({
      destroyed: 2,
      failed: 0,
      authorizations: [
        { clientId: 'uar-portal', sid: 'client-sid-1', subject: 'Alice' },
        { clientId: 'uar-portal', sid: 'client-sid-1', subject: 'alice' },
      ],
    });
    expect(destroyed.sort()).toEqual(['a1', 'a2']);
    expect(await redis.get('oidc:Session:b1')).toBeTruthy();
  });

  it('signs out every session authorized for one app only, tolerating per-item failures', async () => {
    const redis = new ScannableRedis();
    redis.set(
      'oidc:Session:x1',
      sessionPayload({
        jti: 'x1',
        uid: 'ux1',
        authorizations: { 'acme-app': { sid: 'sx' }, 'uar-portal': { sid: 'sp' } },
      })
    );
    redis.set(
      'oidc:Session:x2',
      sessionPayload({
        jti: 'x2',
        uid: 'ux2',
        authorizations: { 'acme-app': { sid: 'sx2' } },
      })
    );
    redis.set('oidc:Session:y1', sessionPayload({ jti: 'y1', uid: 'uy1' }));

    let failures = 0;
    const outcome = await destroySessionsForClient(redis as never, {
      destroy: async (id) => {
        if (id === 'x2') {
          failures += 1;
          throw new Error('redis unavailable mid-sweep');
        }
        await redis.del(`oidc:Session:${id}`);
      },
    }, 'acme-app');

    expect(outcome).toEqual({
      destroyed: 1,
      failed: 1,
      // Only the TARGET app's authorization is reported for client sweeps.
      authorizations: [{ clientId: 'acme-app', sid: 'sx', subject: 'alice' }],
    });
    expect(failures).toBe(1);
    expect(await redis.get('oidc:Session:x1')).toBeNull();
    // x2 survives its failed destroy; unrelated y1 is untouched.
    expect(await redis.get('oidc:Session:x2')).toBeTruthy();
    expect(await redis.get('oidc:Session:y1')).toBeTruthy();
    // The surviving session keeps its sidecar.
    redis.set('authsvc:sessmeta:y1', '{}');
    expect(await redis.get('authsvc:sessmeta:y1')).toBe('{}');
  });

  it('captures authorizations without a resolvable sid as null pairs', async () => {
    const redis = new ScannableRedis();
    redis.set(
      'oidc:Session:jti-n1aa',
      sessionPayload({
        jti: 'jti-n1aa',
        uid: 'un1',
        authorizations: {
          'uar-portal': { grantId: 'g9' },
          'acme-app': { sid: 'sid-acme-n1' },
        },
      })
    );

    const outcome = await destroySessionBySid(redis as never, {
      destroy: async () => undefined,
    }, 'jti-n1aa');

    expect(outcome.authorizations).toEqual([
      { clientId: 'acme-app', sid: 'sid-acme-n1', subject: 'alice' },
      { clientId: 'uar-portal', sid: null, subject: 'alice' },
    ]);
  });
});
