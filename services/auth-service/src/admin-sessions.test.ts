import { describe, expect, it } from 'vitest';
import {
  ADMIN_SESSION_PREFIX,
  ADMIN_SESSION_TTL_SECONDS,
  isAdminSessionId,
  isAdminSessionLive,
  mintAdminSessionRecord,
  revokeAdminSession,
} from './admin-sessions';

function fakeRedis() {
  const store = new Map<string, string>();
  const ttls = new Map<string, number>();
  return {
    store,
    ttls,
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async set(key: string, value: string, options?: { EX?: number }) {
      store.set(key, value);
      if (options?.EX) ttls.set(key, options.EX);
      return 'OK';
    },
    async del(...keys: string[]) {
      let removed = 0;
      for (const key of keys) if (store.delete(key)) removed += 1;
      return removed;
    },
  };
}

describe('admin console session records', () => {
  it('mints a tracked id with a TTL matching the cookie Max-Age', async () => {
    const redis = fakeRedis();

    const id = await mintAdminSessionRecord(redis);

    expect(isAdminSessionId(id)).toBe(true);
    expect(redis.store.get(`${ADMIN_SESSION_PREFIX}${id}`)).toBe('1');
    expect(redis.ttls.get(`${ADMIN_SESSION_PREFIX}${id}`)).toBe(ADMIN_SESSION_TTL_SECONDS);
    expect(ADMIN_SESSION_TTL_SECONDS).toBe(8 * 60 * 60);
  });

  it('verifies liveness only for live identifiers', async () => {
    const redis = fakeRedis();
    const id = await mintAdminSessionRecord(redis);

    expect(await isAdminSessionLive(redis, id)).toBe(true);
    expect(await isAdminSessionLive(redis, 'nonexistent-session-id-xyz')).toBe(false);
    expect(await isAdminSessionLive(redis, '')).toBe(false);
    expect(await isAdminSessionLive(redis, 'bad/id!')).toBe(false);
  });

  it('revokes exactly one identifier without touching siblings', async () => {
    const redis = fakeRedis();
    const target = await mintAdminSessionRecord(redis);
    const other = await mintAdminSessionRecord(redis);

    expect(await revokeAdminSession(redis, target)).toBe(true);

    expect(await isAdminSessionLive(redis, target)).toBe(false);
    expect(await isAdminSessionLive(redis, other)).toBe(true);
    expect(await revokeAdminSession(redis, target)).toBe(false);
  });

  it('expires with the record: absent means dead (TTL semantics)', async () => {
    const redis = fakeRedis();
    const id = await mintAdminSessionRecord(redis);

    redis.store.delete(`${ADMIN_SESSION_PREFIX}${id}`);

    expect(await isAdminSessionLive(redis, id)).toBe(false);
  });

  it('fails closed when the session store errors', async () => {
    const broken = {
      async get() {
        throw new Error('redis down');
      },
      async set() {
        throw new Error('redis down');
      },
      async del() {
        throw new Error('redis down');
      },
    };
    await expect(mintAdminSessionRecord(broken)).rejects.toThrow('redis down');
    expect(await isAdminSessionLive(broken, 'aaaaaaaaaaaaaaaaaaaa')).toBe(false);
    expect(await revokeAdminSession(broken, 'aaaaaaaaaaaaaaaaaaaa')).toBe(false);
  });
});
