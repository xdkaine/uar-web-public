import { describe, expect, it } from 'vitest';
import { RedisAdapter } from './adapter';
import {
  destroySessionByClientSid,
  parseBackchannelBody,
  verifyClientCredentials,
} from './backchannel';

function basicHeader(id: string, secret: string): string {
  return `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`;
}

describe('verifyClientCredentials', () => {
  it('accepts matching client credentials', () => {
    expect(
      verifyClientCredentials(basicHeader('uar-portal', 's3cret'), 'uar-portal', 's3cret')
    ).toBe(true);
  });

  it('rejects a wrong secret without timing leaks on length', () => {
    expect(
      verifyClientCredentials(basicHeader('uar-portal', 'wrong'), 'uar-portal', 's3cret')
    ).toBe(false);
  });

  it('rejects a wrong client id', () => {
    expect(
      verifyClientCredentials(basicHeader('other', 's3cret'), 'uar-portal', 's3cret')
    ).toBe(false);
  });

  it('rejects missing or malformed headers', () => {
    expect(verifyClientCredentials(undefined, 'uar-portal', 's3cret')).toBe(false);
    expect(verifyClientCredentials('Bearer abc', 'uar-portal', 's3cret')).toBe(false);
    expect(verifyClientCredentials('Basic!!!', 'uar-portal', 's3cret')).toBe(false);
  });

  it('rejects base64 payloads without a colon separator', () => {
    const noColon = Buffer.from('noseparator').toString('base64');
    expect(verifyClientCredentials(`Basic ${noColon}`, 'uar-portal', 's3cret')).toBe(false);
  });
});

describe('parseBackchannelBody', () => {
  it('accepts a well-formed sid', () => {
    expect(parseBackchannelBody({ sid: 'abcDEF123-_456' })).toEqual({ sid: 'abcDEF123-_456' });
  });

  it('trims surrounding whitespace', () => {
    expect(parseBackchannelBody({ sid: '  sid-value  ' })).toEqual({ sid: 'sid-value' });
  });

  it('rejects missing or non-string sids', () => {
    expect(parseBackchannelBody({})).toBeNull();
    expect(parseBackchannelBody({ sid: 42 as unknown as string })).toBeNull();
  });

  it('rejects sids with control or url-breaking characters', () => {
    expect(parseBackchannelBody({ sid: 'bad/sid' })).toBeNull();
    expect(parseBackchannelBody({ sid: '../../etc' })).toBeNull();
    expect(parseBackchannelBody({ sid: '' })).toBeNull();
  });
});

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

describe('destroySessionByClientSid', () => {
  class ScannableRedis extends MemoryRedis {
    async *scanIterator(opts: { MATCH: string; COUNT: number }): AsyncIterable<string> {
      for (const key of this.store.keys()) {
        yield key;
      }
      void opts;
    }
  }

  const sessionPayload = (clientId: string, sid: string, jti: string): string =>
    JSON.stringify({
      jti,
      kind: 'Session',
      uid: `internal-uid-${jti}`,
      accountId: 'someone',
      authorizations: { [clientId]: { sid, grantId: 'g' } },
    });

  it('destroys the session whose per-client sid matches the ID-token claim', async () => {
    const redis = new ScannableRedis();
    redis.set('oidc:Session:uid:internal-uid-jti-1', 'jti-1');
    redis.set(
      'oidc:Session:jti-1',
      sessionPayload('uar-portal', 'client-facing-sid', 'jti-1')
    );
    let destroyed: string | undefined;
    const adapter = { destroy: async (id: string) => { destroyed = id; } };

    const result = await destroySessionByClientSid(redis, 'client-facing-sid', 'uar-portal', adapter);

    expect(result).toBe(true);
    expect(destroyed).toBe('jti-1');
  });

  it('does not match other clients or other sessions', async () => {
    const redis = new ScannableRedis();
    redis.set('oidc:Session:jti-1', sessionPayload('other-app', 'client-facing-sid', 'jti-1'));
    redis.set('oidc:Session:jti-2', sessionPayload('uar-portal', 'different-sid', 'jti-2'));
    let destroyed: string | undefined;
    const negativeAdapter = { destroy: async () => { throw new Error('must not be called'); } };
    const positiveAdapter = { destroy: async (id: string) => { destroyed = id; } };

    expect(
      await destroySessionByClientSid(redis, 'client-facing-sid', 'uar-portal', negativeAdapter)
    ).toBe(false);
    expect(destroyed).toBeUndefined();

    expect(
      await destroySessionByClientSid(redis, 'different-sid', 'uar-portal', positiveAdapter)
    ).toBe(true);
    expect(destroyed).toBe('jti-2');
  });

  it('skips secondary indexes and unreadable payloads', async () => {
    const redis = new ScannableRedis();
    redis.set('oidc:Session:uid:client-facing-sid', 'decoy-jti');
    redis.set('oidc:Session:userCode:ABCDEF', 'decoy-jti');
    redis.set('oidc:Session:not-json', '{oops');
    const adapter = { destroy: async () => { throw new Error('must not be called'); } };

    expect(await destroySessionByClientSid(redis, 'client-facing-sid', 'uar-portal', adapter)).toBe(false);
  });

  it('reports false when the redis client cannot scan', async () => {
    const redis = new MemoryRedis();
    await redis.set('oidc:Session:jti-1', sessionPayload('uar-portal', 's1', 'jti-1'));
    const adapter = { destroy: async () => { throw new Error('must not be called'); } };

    expect(await destroySessionByClientSid(redis as never, 's1', 'uar-portal', adapter)).toBe(false);
  });

  it('round-trips against the real RedisAdapter destroy semantics', async () => {
    const redis = new ScannableRedis();
    const adapter = new RedisAdapter('Session', redis);
    await adapter.upsert(
      'jti-live',
      {
        jti: 'jti-live',
        kind: 'Session',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
        uid: 'internal-uid-live',
        authorizations: { 'uar-portal': { sid: 'token-sid-live' } },
      },
      3600
    );

    const destroyedFlag = await destroySessionByClientSid(
      redis, 'token-sid-live', 'uar-portal', adapter
    );

    expect(destroyedFlag).toBe(true);
    // Both the primary record and the internal uid index must be gone.
    expect(await adapter.find('jti-live')).toBeUndefined();
    expect(await adapter.findByUid('internal-uid-live')).toBeUndefined();
  });
});
