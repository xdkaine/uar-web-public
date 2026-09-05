import { describe, expect, it } from 'vitest';
import {
  bindPendingPasswordChange,
  boundPendingChangeAccount,
  clearPendingPasswordChange,
  isBoundChangeRequest,
} from './interaction-state';

function fakeRedis() {
  const store = new Map<string, string>();
  return {
    store,
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async set(key: string, value: string, options?: { EX?: number }) {
      store.set(key, value);
      return { ttl: options?.EX ?? null };
    },
    async del(...keys: string[]) {
      let removed = 0;
      for (const key of keys) if (store.delete(key)) removed += 1;
      return removed;
    },
  };
}

describe('pending password-change binding', () => {
  it('binds an account to a uid and reads it back normalized', async () => {
    const redis = fakeRedis();
    await bindPendingPasswordChange(redis, 'uid-1', 'Alice@Example.COM ');
    expect(await boundPendingChangeAccount(redis, 'uid-1')).toBe('alice@example.com');
  });

  it('sets an expiry on the binding record', async () => {
    const redis = fakeRedis();
    let captured: { EX?: number } | undefined;
    redis.set = async (key: string, value: string, options?: { EX?: number }) => {
      captured = options;
      redis.store.set(key, value);
      return 'OK';
    };
    await bindPendingPasswordChange(redis, 'uid-1', 'alice');
    expect(captured?.EX).toBe(15 * 60);
  });

  it('refuses to bind empty uids or usernames', async () => {
    const redis = fakeRedis();
    await bindPendingPasswordChange(redis, '', 'alice');
    await bindPendingPasswordChange(redis, 'uid-1', '   ');
    expect(redis.store.size).toBe(0);
  });

  it('returns null for unbound or unreadable bindings', async () => {
    const redis = fakeRedis();
    expect(await boundPendingChangeAccount(redis, 'missing')).toBeNull();
    expect(await boundPendingChangeAccount(redis, '')).toBeNull();

    const broken = fakeRedis();
    broken.get = async () => {
      throw new Error('redis down');
    };
    expect(await boundPendingChangeAccount(broken, 'uid-1')).toBeNull();
  });

  it('clears the binding after use', async () => {
    const redis = fakeRedis();
    await bindPendingPasswordChange(redis, 'uid-1', 'alice');
    await clearPendingPasswordChange(redis, 'uid-1');
    expect(await boundPendingChangeAccount(redis, 'uid-1')).toBeNull();
  });
});

describe('isBoundChangeRequest', () => {
  it('accepts only the exact bound account (case/whitespace tolerant)', () => {
    expect(isBoundChangeRequest('alice', 'alice')).toBe(true);
    expect(isBoundChangeRequest('alice', ' Alice ')).toBe(true);
    expect(isBoundChangeRequest(null, 'alice')).toBe(false);
    expect(isBoundChangeRequest('alice', 'bob')).toBe(false);
    expect(isBoundChangeRequest('alice', '')).toBe(false);
  });

  it('never matches when the binding is missing', () => {
    // An unbound uid fails closed even for an empty submission.
    expect(isBoundChangeRequest(null, '')).toBe(false);
  });
});
