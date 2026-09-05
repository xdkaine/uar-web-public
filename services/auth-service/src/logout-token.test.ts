import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPublicKey, verify as rsaVerify } from 'node:crypto';
import {
  BACKCHANNEL_LOGOUT_EVENT,
  DELIVERY_TIMEOUT_MS,
  mintBackchannelLogoutToken,
  pushBackchannelLogouts,
  type FetchLike,
} from './logout-token';
import { resolveProviderKeys } from './jwks';

const keys = resolveProviderKeys({});
const signing = keys.logout;
const originalCloneMode = process.env.PORTAL_CLONE_READ_ONLY;

function decodeJwt(token: string): { header: Record<string, unknown>; payload: Record<string, unknown> } {
  const [headerPart, payloadPart] = token.split('.');
  return {
    header: JSON.parse(Buffer.from(headerPart ?? '', 'base64url').toString('utf8')),
    payload: JSON.parse(Buffer.from(payloadPart ?? '', 'base64url').toString('utf8')),
  };
}

function verifySignature(token: string): boolean {
  const [headerPart, payloadPart, signaturePart] = token.split('.');
  const key = keys.jwks.keys[0] as { n?: unknown; e?: unknown };
  const publicJwk = createPublicKey({
    key: { kty: 'RSA', n: String(key.n), e: String(key.e) },
    format: 'jwk',
  });
  return rsaVerify(
    'RSA-SHA256',
    Buffer.from(`${headerPart}.${payloadPart}`, 'ascii'),
    publicJwk,
    Buffer.from(signaturePart ?? '', 'base64url')
  );
}

/** Capturing fetch double returning a fixed status (or throwing). */
function stubFetch(
  behavior: (url: string, init: Record<string, unknown>) => number | never
): { calls: Array<{ url: string; init: Record<string, unknown> }>; impl: FetchLike } {
  const calls: Array<{ url: string; init: Record<string, unknown> }> = [];
  const impl = (async (url: string, init: Parameters<FetchLike>[1]) => {
    calls.push({ url, init });
    const status = behavior(url, init);
    return { status };
  }) as FetchLike;
  return { calls, impl };
}

afterEach(() => {
  vi.restoreAllMocks();
  if (originalCloneMode === undefined) delete process.env.PORTAL_CLONE_READ_ONLY;
  else process.env.PORTAL_CLONE_READ_ONLY = originalCloneMode;
});

describe('mintBackchannelLogoutToken', () => {
  it('carries exactly the spec claims, RS256-signed with the shared provider key', () => {
    const before = Math.floor(Date.now() / 1000);
    const token = mintBackchannelLogoutToken(
      signing,
      { issuer: 'https://auth.example.test', clientId: 'uar-portal', sid: 'provider-sid-01' }
    );

    expect(verifySignature(token)).toBe(true);
    const { header, payload } = decodeJwt(token);
    expect(header).toEqual({ alg: 'RS256', typ: 'JWT', kid: signing.kid });

    expect(Object.keys(payload).sort()).toEqual([
      'aud', 'events', 'exp', 'iat', 'iss', 'jti', 'sid',
    ]);
    expect(payload.iss).toBe('https://auth.example.test');
    // aud is the TARGET client id.
    expect(payload.aud).toBe('uar-portal');
    expect(payload.iat).toBeGreaterThanOrEqual(before);
    expect((payload.exp as number) - (payload.iat as number)).toBe(120);
    expect(typeof payload.jti).toBe('string');
    expect(payload.events).toEqual({ [BACKCHANNEL_LOGOUT_EVENT]: {} });
    expect(payload.sid).toBe('provider-sid-01');
  });

  it('includes sub only when known and NEVER a nonce', () => {
    const withSubject = decodeJwt(
      mintBackchannelLogoutToken(signing, {
        issuer: 'https://auth.example.test',
        clientId: 'app',
        sid: 'sid-value-0001',
        subject: 'alice',
      })
    ).payload;
    expect(withSubject.sub).toBe('alice');
    expect(withSubject.nonce).toBeUndefined();

    const withoutSubject = decodeJwt(
      mintBackchannelLogoutToken(signing, {
        issuer: 'https://auth.example.test',
        clientId: 'app',
        sid: 'sid-value-0002',
        subject: null,
      })
    ).payload;
    expect(Object.keys(withoutSubject)).not.toContain('sub');
    expect(withoutSubject.nonce).toBeUndefined();
  });

  it('mints distinct jti values for every token', () => {
    const first = decodeJwt(
      mintBackchannelLogoutToken(signing, { issuer: 'i', clientId: 'c', sid: 's1value' })
    ).payload.jti;
    const second = decodeJwt(
      mintBackchannelLogoutToken(signing, { issuer: 'i', clientId: 'c', sid: 's1value' })
    ).payload.jti;
    expect(first).not.toBe(second);
  });
});

describe('deliverLogoutToken via pushBackchannelLogouts', () => {
  const base = {
    pairs: [{ clientId: 'uar-portal', sid: 'provider-sid-01', subject: 'alice' }],
    issuer: 'https://auth.example.test',
    signing,
    resolveUri: async () => 'https://portal.example/api/auth/oidc/backchannel-logout',
  };

  it('POSTs application/x-www-form-urlencoded logout_token=<jwt>', async () => {
    const { calls, impl } = stubFetch(() => 200);
    const deliveries = await pushBackchannelLogouts({ ...base, fetchImpl: impl });

    expect(deliveries).toEqual([{ clientId: 'uar-portal', outcome: 'delivered', status: 200 }]);
    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.url).toBe('https://portal.example/api/auth/oidc/backchannel-logout');
    const init = call?.init as { method: string; headers: Record<string, string>; body: string };
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    const params = new URLSearchParams(init.body);
    expect(params.get('logout_token')).toMatch(/^eyJ/);
    expect([...params.keys()]).toEqual(['logout_token']);
    expect((init.signal as AbortSignal).aborted).toBe(false);
  }, 10000);

  it('suppresses every outbound back-channel request in production-clone mode', async () => {
    process.env.PORTAL_CLONE_READ_ONLY = 'true';
    const { calls, impl } = stubFetch(() => 200);
    const resolveUri = vi.fn(base.resolveUri);

    await expect(pushBackchannelLogouts({ ...base, resolveUri, fetchImpl: impl })).resolves.toEqual([
      { clientId: 'uar-portal', outcome: 'unreachable' },
    ]);
    expect(resolveUri).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it('classifies 2xx as delivered and any 4xx-5xx as rejected with its status', async () => {
    const delivered = await pushBackchannelLogouts({
      ...base,
      fetchImpl: stubFetch(() => 204).impl,
    });
    expect(delivered[0]).toEqual({ clientId: 'uar-portal', outcome: 'delivered', status: 204 });

    for (const status of [400, 401, 404, 500, 503]) {
      const rejected = await pushBackchannelLogouts({
        ...base,
        fetchImpl: stubFetch(() => status).impl,
      });
      expect(rejected[0]).toEqual({ clientId: 'uar-portal', outcome: 'rejected', status });
    }
  }, 10000);

  it('classifies network errors and timeouts as unreachable', async () => {
    const timeoutSignal: FetchLike = async (_url, init) => {
      expect(init.signal.aborted).toBe(false);
      throw new Error('The operation was aborted due to timeout');
    };
    const result = await pushBackchannelLogouts({ ...base, fetchImpl: timeoutSignal });
    expect(result).toEqual([{ clientId: 'uar-portal', outcome: 'unreachable' }]);

    const networkError: FetchLike = async () => {
      throw new Error('ECONNREFUSED');
    };
    expect(
      (await pushBackchannelLogouts({ ...base, fetchImpl: networkError }))[0]
    ).toMatchObject({ outcome: 'unreachable' });

    // The ~5s delivery budget is enforced per request via AbortSignal.timeout.
    const seen = { signal: null as unknown };
    const probe: FetchLike = async (_url, init) => {
      seen.signal = init.signal;
      return { status: 200 };
    };
    await pushBackchannelLogouts({ ...base, fetchImpl: probe });
    expect(seen.signal).toBeInstanceOf(AbortSignal);
    expect(DELIVERY_TIMEOUT_MS).toBe(5000);
  }, 10000);

  it('skips sid-less pairs, dedupes repeats, and reports unknown RPs unreachable', async () => {
    const seenUris: string[] = [];
    const deliveries = await pushBackchannelLogouts({
      pairs: [
        { clientId: 'known-app', sid: 'sid-known-001', subject: 'alice' },
        { clientId: 'known-app', sid: 'sid-known-001', subject: 'alice' },
        { clientId: 'ghost-app', sid: 'sid-ghost-001', subject: null },
        { clientId: 'no-uri-app', sid: null, subject: 'bob' },
      ],
      issuer: 'https://auth.example.test',
      signing,
      resolveUri: async (clientId) => {
        if (clientId === 'no-uri-app') return undefined;
        seenUris.push(clientId);
        return `https://${clientId}.example/logout`;
      },
      fetchImpl: stubFetch((url) => (url.includes('ghost-app') ? 500 : 200)).impl,
    });

    expect(deliveries.sort((a, b) => a.clientId.localeCompare(b.clientId))).toEqual([
      { clientId: 'ghost-app', outcome: 'rejected', status: 500 },
      { clientId: 'known-app', outcome: 'delivered', status: 200 },
    ]);
    expect(seenUris.filter((id) => id === 'known-app')).toHaveLength(1);
  }, 10000);
});
