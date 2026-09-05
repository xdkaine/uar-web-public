import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthConfig } from './config';
import {
  checkAccountLockout,
  checkEndpointRateLimit,
  checkLoginRateLimit,
  endpointRateKey,
  recordAccountAuthFailure,
  resetAccountFailures,
  verifyTurnstile,
} from './turnstile';

function lockConfig(overrides: Partial<AuthConfig> = {}): AuthConfig {
  return {
    accountLockWindowMs: 60_000,
    accountLockMaxAttempts: 3,
    ...overrides,
  } as AuthConfig;
}

/**
 * Fake implementing the SAME semantics as the atomic fixed-window Lua
 * script: INCR, then EXPIRE only when the counter starts at 1. The TTL
 * bookkeeping is simulated with a key set so expiry-once stays assertable.
 */
function makeEval(base: ReturnType<typeof fakeRedis>) {
  const ttlKeys = new Set<string>();
  const expireCalls: Array<{ key: string; seconds: number }> = [];
  const evalFn = async (
    _script: string,
    options: { keys: string[]; arguments: string[] }
  ): Promise<number> => {
    const key = options.keys[0];
    const seconds = Number.parseInt(options.arguments[0], 10);
    const next = (Number.parseInt(base.store.get(key) ?? '0', 10) || 0) + 1;
    base.store.set(key, String(next));
    if (!ttlKeys.has(key)) {
      ttlKeys.add(key);
      expireCalls.push({ key, seconds });
    }
    return next;
  };
  return { eval: evalFn, ttlKeys, expireCalls };
}

interface FakeRedis {
  store: Map<string, string>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { EX?: number }): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
}

function fakeRedis(): FakeRedis & ReturnType<typeof makeEval> {
  const base: FakeRedis = {
    store: new Map<string, string>(),
    async get(key) {
      return base.store.get(key) ?? null;
    },
    async set(key, value, options) {
      base.store.set(key, value);
      void options;
      return 'OK';
    },
    async del(...keys) {
      let removed = 0;
      for (const key of keys) {
        if (base.store.delete(key)) removed += 1;
      }
      return removed;
    },
    async incr(key) {
      const next = (Number.parseInt(base.store.get(key) ?? '0', 10) || 0) + 1;
      base.store.set(key, String(next));
      return next;
    },
    async expire() {
      return 1;
    },
  };
  return { ...base, ...makeEval(base) };
}

describe('per-account lockout', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('stays unlocked below the threshold and engages after it', async () => {
    const redis = fakeRedis();
    const config = lockConfig();
    expect(await checkAccountLockout(redis, config, 'alice')).toBe(false);
    await recordAccountAuthFailure(redis, config, 'alice');
    await recordAccountAuthFailure(redis, config, 'alice');
    expect(await checkAccountLockout(redis, config, 'alice')).toBe(false);
    await recordAccountAuthFailure(redis, config, 'alice');
    // threshold reached: further attempts are denied
    expect(await checkAccountLockout(redis, config, 'alice')).toBe(true);
  });

  it('releases after the window passes', async () => {
    vi.useFakeTimers();
    const now = new Date('2026-01-01T00:00:00Z');
    vi.setSystemTime(now);
    const redis = fakeRedis();
    const config = lockConfig({ accountLockWindowMs: 60_000 });
    for (let i = 0; i < 5; i += 1) {
      await recordAccountAuthFailure(redis, config, 'alice');
    }
    expect(await checkAccountLockout(redis, config, 'alice')).toBe(true);
    vi.setSystemTime(new Date(now.getTime() + 61_000));
    expect(await checkAccountLockout(redis, config, 'alice')).toBe(false);
  });

  it('a success resets the counter', async () => {
    const redis = fakeRedis();
    const config = lockConfig();
    for (let i = 0; i < 5; i += 1) {
      await recordAccountAuthFailure(redis, config, 'alice');
    }
    expect(await checkAccountLockout(redis, config, 'alice')).toBe(true);
    await resetAccountFailures(redis, config, 'alice');
    expect(await checkAccountLockout(redis, config, 'alice')).toBe(false);
  });

  it('counts accounts independently and normalizes case', async () => {
    const redis = fakeRedis();
    const config = lockConfig();
    for (let i = 0; i < 5; i += 1) {
      await recordAccountAuthFailure(redis, config, 'Alice');
    }
    expect(await checkAccountLockout(redis, config, 'ALICE')).toBe(true);
    expect(await checkAccountLockout(redis, config, 'bob')).toBe(false);
  });

  it('fails open when Redis reads break (IP limiter still guards)', async () => {
    const redis = fakeRedis();
    redis.get = async () => {
      throw new Error('redis down');
    };
    expect(await checkAccountLockout(redis, lockConfig(), 'alice')).toBe(false);
  });
});

describe('verifyTurnstile', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  interface CapturedCall {
    url: string;
    body: URLSearchParams | undefined;
  }

  function stubFetch(
    response: { ok: boolean; success?: boolean } | 'network-error'
  ): Array<CapturedCall> {
    const calls: Array<CapturedCall> = [];
    vi.stubGlobal(
      'fetch',
      async (url: string | URL, init?: { body?: unknown }): Promise<unknown> => {
        calls.push({
          url: String(url),
          body: init?.body instanceof URLSearchParams ? init.body : undefined,
        });
        if (response === 'network-error') throw new Error('dns resolution failed');
        return { ok: response.ok, json: async () => ({ success: response.success }) };
      }
    );
    return calls;
  }

  it('passes only on a verified token', async () => {
    const calls = stubFetch({ ok: true, success: true });
    await expect(verifyTurnstile(lockConfig({ turnstileSecretKey: 'svc-secret' }), 'token-abc', '10.0.0.5')).resolves.toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    expect(calls[0]?.body?.get('secret')).toBe('svc-secret');
    expect(calls[0]?.body?.get('response')).toBe('token-abc');
    expect(calls[0]?.body?.get('remoteip')).toBe('10.0.0.5');
  });

  it('rejects Cloudflare success:false verdicts', async () => {
    stubFetch({ ok: true, success: false });
    await expect(verifyTurnstile(lockConfig({ turnstileSecretKey: 'svc-secret' }), 'token-abc', null)).resolves.toBe(false);
  });

  it('fails closed when the verifier is unreachable', async () => {
    stubFetch('network-error');
    await expect(verifyTurnstile(lockConfig({ turnstileSecretKey: 'svc-secret' }), 'token-abc', null)).resolves.toBe(false);
  });

  it('fails closed on non-ok HTTP responses without trusting the body', async () => {
    stubFetch({ ok: false, success: true });
    await expect(verifyTurnstile(lockConfig({ turnstileSecretKey: 'svc-secret' }), 'token-abc', null)).resolves.toBe(false);
  });

  it('fails closed when the secret is unconfigured, before any network call', async () => {
    const calls = stubFetch({ ok: true, success: true });
    await expect(verifyTurnstile(lockConfig({ turnstileSecretKey: '' }), 'token-abc', null)).resolves.toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('fails closed on an empty token without contacting the verifier', async () => {
    const calls = stubFetch({ ok: true, success: true });
    await expect(verifyTurnstile(lockConfig({ turnstileSecretKey: 'svc-secret' }), '', null)).resolves.toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('omits remoteip when no client IP can be determined', async () => {
    const calls = stubFetch({ ok: true, success: true });
    await verifyTurnstile(lockConfig({ turnstileSecretKey: 'svc-secret' }), 'tok', null);
    expect(calls[0]?.body?.has('remoteip')).toBe(false);
  });
});

describe('checkLoginRateLimit', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows attempts under the threshold and blocks at it', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-01T12:00:00Z'));
    const redis = fakeRedis();
    const cfg = lockConfig({ loginWindowMs: 900000, loginMaxAttempts: 3 });
    const bucket = Math.floor(Date.now() / 900000);

    for (let i = 1; i <= 3; i += 1) {
      await expect(checkLoginRateLimit(redis, cfg, '10.1.1.9')).resolves.toEqual({ allowed: true });
    }
    // Fixed window keyed by IP + time bucket.
    expect(redis.store.get(`authrl:login:10.1.1.9:${bucket}`)).toBe('3');
    await expect(checkLoginRateLimit(redis, cfg, '10.1.1.9')).resolves.toEqual({ allowed: false });
    expect(redis.store.get(`authrl:login:10.1.1.9:${bucket}`)).toBe('4');

    // A different IP has its own bucket.
    await expect(checkLoginRateLimit(redis, cfg, '10.1.1.8')).resolves.toEqual({ allowed: true });
  });

  it('sets the expiry atomically once per window, slightly beyond the window itself', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-01T12:00:00Z'));
    const redis = fakeRedis();
    const cfg = lockConfig({ loginWindowMs: 60000, loginMaxAttempts: 20 });
    const bucket = Math.floor(Date.now() / 60000);

    await checkLoginRateLimit(redis, cfg, '10.2.2.2');
    await checkLoginRateLimit(redis, cfg, '10.2.2.2');

    // Counter+TTL are one atomic script call: exactly one EXPIRE ever fires.
    expect(redis.expireCalls).toHaveLength(1);
    expect(redis.expireCalls[0]).toEqual({
      key: `authrl:login:10.2.2.2:${bucket}`,
      seconds: 61,
    });
  });
});

describe('checkEndpointRateLimit', () => {
  it('allows under the limit and denies at it', async () => {
    const redis = fakeRedis();
    const key = endpointRateKey('test-scope', '10.9.9.9', 60_000);
    for (let i = 0; i < 5; i += 1) {
      await expect(checkEndpointRateLimit(redis, key, 5, 60)).resolves.toEqual({ allowed: true });
    }
    await expect(checkEndpointRateLimit(redis, key, 5, 60)).resolves.toEqual({ allowed: false });
  });

  it('sets the TTL exactly once for the window (atomic counter+TTL)', async () => {
    const redis = fakeRedis();
    const key = endpointRateKey('test-scope', '10.9.9.8', 60_000);
    for (let i = 0; i < 7; i += 1) {
      await checkEndpointRateLimit(redis, key, 120, 90);
    }
    expect(redis.expireCalls).toEqual([{ key, seconds: 90 }]);
  });

  it('throws on Redis errors so callers fail closed with 503', async () => {
    const redis = fakeRedis();
    redis.eval = async () => {
      throw new Error('redis down');
    };
    await expect(
      checkEndpointRateLimit(redis, endpointRateKey('s', 'ip', 60_000), 5, 60)
    ).rejects.toThrow('redis down');
  });

  it('scopes keys per endpoint scope and identifier', () => {
    const a = endpointRateKey('backchannel-logout', '10.0.0.1', 60_000);
    const b = endpointRateKey('internal-clients', '10.0.0.1', 60_000);
    expect(a).not.toBe(b);
    expect(a).toContain('backchannel-logout');
    expect(b).toContain('internal-clients');
  });
});
