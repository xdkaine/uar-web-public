import { describe, expect, it } from 'vitest';
import { RedisAdapter } from './adapter';

interface StoredValue {
  value: string;
  ttl?: number;
  ttlMs?: number;
}

class MemoryRedis {
  readonly store = new Map<string, StoredValue>();

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    return entry ? entry.value : null;
  }

  async set(
    key: string,
    value: string,
    options?: { EX?: number; PX?: number; NX?: boolean }
  ): Promise<unknown> {
    if (options?.NX && this.store.has(key)) return null;
    this.store.set(key, { value, ttl: options?.EX, ttlMs: options?.PX });
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

  async eval(
    script: string,
    options: { keys: string[]; arguments: string[] }
  ): Promise<unknown> {
    const [lockKey, targetKey] = options.keys;
    const [token, value] = options.arguments;
    if (this.store.get(lockKey)?.value !== token) {
      return script.includes('return -1') ? -1 : 0;
    }
    if (script.includes("redis.call('pexpire'")) {
      const entry = this.store.get(lockKey);
      if (entry) entry.ttlMs = Number(value);
      return 1;
    }
    if (targetKey && script.includes("redis.call('set'")) {
      this.store.set(targetKey, { value });
      return 1;
    }
    if (targetKey) return this.del(targetKey);
    return this.del(lockKey);
  }
}

function payload(overrides: Record<string, unknown> = {}): Parameters<RedisAdapter['upsert']>[1] {
  return {
    jti: 'session-1',
    kind: 'Session',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...overrides,
  } as Parameters<RedisAdapter['upsert']>[1];
}

describe('RedisAdapter', () => {
  it('indexes sessions by uid so findByUid resolves the payload', async () => {
    const redis = new MemoryRedis();
    const adapter = new RedisAdapter('Session', redis);
    await adapter.upsert('session-1', payload({ uid: 'uid-abc' }), 3600);

    const found = await adapter.findByUid('uid-abc');
    expect(found?.jti).toBe('session-1');
  });

  it('shares the primary TTL with the uid index', async () => {
    const redis = new MemoryRedis();
    const adapter = new RedisAdapter('Session', redis);
    await adapter.upsert('session-1', payload({ uid: 'uid-abc' }), 3600);

    expect(redis.store.get('oidc:Session:session-1')?.ttl).toBe(3600);
    expect(redis.store.get('oidc:Session:uid:uid-abc')?.ttl).toBe(3600);
  });

  it('removes the uid index when the session is destroyed', async () => {
    const redis = new MemoryRedis();
    const adapter = new RedisAdapter('Session', redis);
    await adapter.upsert('session-1', payload({ uid: 'uid-abc' }), 3600);

    await adapter.destroy('session-1');

    expect(await adapter.find('session-1')).toBeUndefined();
    expect(await adapter.findByUid('uid-abc')).toBeUndefined();
  });

  it('does not write a uid index for payloads without one', async () => {
    const redis = new MemoryRedis();
    const adapter = new RedisAdapter('Interaction', redis);
    await adapter.upsert('interaction-1', payload({ kind: 'Interaction', jti: 'interaction-1' }), 600);

    expect([...redis.store.keys()].filter((key) => key.includes(':uid:'))).toEqual([]);
  });

  it('serializes a client mutation across adapters with an expiring Redis lock', async () => {
    const redis = new MemoryRedis();
    const firstAdapter = new RedisAdapter('Client', redis);
    const secondAdapter = new RedisAdapter('Client', redis);
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let signalFirst!: () => void;
    const firstStarted = new Promise<void>((resolve) => { signalFirst = resolve; });

    const first = firstAdapter.withLock('acme-app', async () => {
      events.push('first-start');
      signalFirst();
      await firstGate;
      events.push('first-end');
    });
    await firstStarted;
    const second = secondAdapter.withLock('acme-app', async () => {
      events.push('second-start');
    });

    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(events).toEqual(['first-start']);
    expect(redis.store.get('oidc:lock:Client:acme-app')?.ttlMs).toBe(120_000);

    releaseFirst();
    await Promise.all([first, second]);
    expect(events).toEqual(['first-start', 'first-end', 'second-start']);
    expect(redis.store.has('oidc:lock:Client:acme-app')).toBe(false);
  });

  it('fences an expired owner after another process takes over the lease', async () => {
    const redis = new MemoryRedis();
    const firstAdapter = new RedisAdapter('Client', redis, { renewEveryMs: 100_000 });
    const secondAdapter = new RedisAdapter('Client', redis, { renewEveryMs: 100_000 });
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let signalFirst!: () => void;
    const firstStarted = new Promise<void>((resolve) => { signalFirst = resolve; });

    const staleOwner = firstAdapter.withLock('acme-app', async () => {
      signalFirst();
      await firstGate;
      await firstAdapter.upsert('acme-app', payload({ marker: 'stale' }), 0);
    });
    await firstStarted;

    // Simulate lease expiry, then let another process acquire the same lock
    // and publish the newer durable state.
    await redis.del('oidc:lock:Client:acme-app');
    await secondAdapter.withLock('acme-app', async () => {
      await secondAdapter.upsert('acme-app', payload({ marker: 'current' }), 0);
    });

    releaseFirst();
    await expect(staleOwner).rejects.toThrow('Client mutation lock was lost');
    expect((await secondAdapter.find('acme-app'))?.marker).toBe('current');
  });
});
