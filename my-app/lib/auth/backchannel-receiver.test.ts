import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';
import type { JsonWebKey } from 'node:crypto';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  appLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  resetBackchannelJwksCache,
  validateBackchannelLogoutToken,
} from './backchannel-receiver';

const ISSUER = 'https://auth.example.test';
const CLIENT_ID = 'uar-portal';
const KID = 'auth-service-key-1';
const BACKCHANNEL_EVENT = 'http://schemas.openid.net/event/backchannel-logout';

const provider = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const attacker = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });

function publicJwk(): JsonWebKey {
  return {
    ...(provider.publicKey.export({ format: 'jwk' }) as JsonWebKey),
    kid: KID,
    alg: 'RS256',
    use: 'sig',
  };
}

function b64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function signLogoutToken(
  claims: Record<string, unknown>,
  options: {
    signingKey?: crypto.KeyObject;
    header?: Record<string, unknown>;
  } = {}
): string {
  const header = { alg: 'RS256', kid: KID, ...options.header };
  const signingKey = options.signingKey ?? provider.privateKey;
  const signingInput = `${b64url(header)}.${b64url(claims)}`;
  const signature = crypto
    .sign('RSA-SHA256', Buffer.from(signingInput), signingKey)
    .toString('base64url');
  return `${signingInput}.${signature}`;
}

function baseClaims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: ISSUER,
    aud: CLIENT_ID,
    iat: Math.floor(Date.now() / 1000),
    jti: 'logout-jti',
    events: { [BACKCHANNEL_EVENT]: {} },
    sid: 'provider-session-1',
    ...overrides,
  };
}

function serveDiscoveryAndJwks(keys: JsonWebKey[] = [publicJwk()]): void {
  mocks.fetch.mockImplementation(async (url: string | URL) => {
    const target = String(url);
    if (target === `${ISSUER}/.well-known/openid-configuration`) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ issuer: ISSUER, jwks_uri: `${ISSUER}/jwks` }),
      };
    }
    if (target === `${ISSUER}/jwks`) {
      return { ok: true, status: 200, json: async () => ({ keys }) };
    }
    throw new Error(`unexpected fetch: ${target}`);
  });
}

function setEnv(): void {
  process.env.AUTH_MODE = 'oidc';
  process.env.AUTH_ISSUER = ISSUER;
  process.env.AUTH_CLIENT_ID = CLIENT_ID;
  process.env.AUTH_CLIENT_SECRET = 'test-secret';
  delete process.env.OIDC_INTERNAL_ISSUER_URL;
}

beforeEach(() => {
  vi.clearAllMocks();
  setEnv();
  resetBackchannelJwksCache();
  serveDiscoveryAndJwks();
  vi.stubGlobal('fetch', mocks.fetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('validateBackchannelLogoutToken', () => {
  it('accepts a well-formed logout token and returns its sid', async () => {
    await expect(
      validateBackchannelLogoutToken(signLogoutToken(baseClaims()))
    ).resolves.toEqual({ sid: 'provider-session-1' });
  });

  it('rejects a token signed by a key that is not in the JWKS (bad signature)', async () => {
    const forged = signLogoutToken(baseClaims(), { signingKey: attacker.privateKey });
    await expect(validateBackchannelLogoutToken(forged)).resolves.toBeNull();
  });

  it('rejects a wrong audience', async () => {
    await expect(
      validateBackchannelLogoutToken(signLogoutToken(baseClaims({ aud: 'other-client' })))
    ).resolves.toBeNull();
  });

  it('rejects an audience list that does not include this client', async () => {
    await expect(
      validateBackchannelLogoutToken(signLogoutToken(baseClaims({ aud: ['a', 'b'] })))
    ).resolves.toBeNull();
  });

  it('rejects a wrong issuer', async () => {
    await expect(
      validateBackchannelLogoutToken(
        signLogoutToken(baseClaims({ iss: 'https://evil.example.test' }))
      )
    ).resolves.toBeNull();
  });

  it('rejects a missing events claim', async () => {
    const claims = baseClaims();
    delete claims.events;
    await expect(validateBackchannelLogoutToken(signLogoutToken(claims))).resolves.toBeNull();
  });

  it('rejects events without the back-channel logout member', async () => {
    await expect(
      validateBackchannelLogoutToken(
        signLogoutToken(baseClaims({ events: { 'http://other.event': {} } }))
      )
    ).resolves.toBeNull();
  });

  it('rejects a token carrying a nonce claim', async () => {
    await expect(
      validateBackchannelLogoutToken(signLogoutToken(baseClaims({ nonce: 'id-token-nonce' })))
    ).resolves.toBeNull();
  });

  it('rejects a far-future iat', async () => {
    await expect(
      validateBackchannelLogoutToken(
        signLogoutToken(baseClaims({ iat: Math.floor(Date.now() / 1000) + 3600 }))
      )
    ).resolves.toBeNull();
  });

  it('tolerates a small future iat within clock skew', async () => {
    await expect(
      validateBackchannelLogoutToken(
        signLogoutToken(baseClaims({ iat: Math.floor(Date.now() / 1000) + 60 }))
      )
    ).resolves.toEqual({ sid: 'provider-session-1' });
  });

  it('rejects a missing or empty sid', async () => {
    const withoutSid = baseClaims();
    delete withoutSid.sid;
    await expect(validateBackchannelLogoutToken(signLogoutToken(withoutSid))).resolves.toBeNull();
    await expect(
      validateBackchannelLogoutToken(signLogoutToken(baseClaims({ sid: '' })))
    ).resolves.toBeNull();
  });

  it('tolerates replayed tokens (same jti) - dedupe is sid revocation semantics', async () => {
    const token = signLogoutToken(baseClaims());

    await expect(validateBackchannelLogoutToken(token)).resolves.toEqual({
      sid: 'provider-session-1',
    });
    await expect(validateBackchannelLogoutToken(token)).resolves.toEqual({
      sid: 'provider-session-1',
    });

    // Discovery + JWKS fetched once; the cached keys serve replays.
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  it('rejects non-RS256 algorithms before touching the network', async () => {
    await expect(
      validateBackchannelLogoutToken(
        signLogoutToken(baseClaims(), { header: { alg: 'none' }, signingKey: attacker.privateKey })
      )
    ).resolves.toBeNull();
    expect(mocks.fetch).not.toHaveBeenCalled();

    await expect(
      validateBackchannelLogoutToken(signLogoutToken(baseClaims(), { header: { alg: 'HS256' } }))
    ).resolves.toBeNull();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['empty string', ''],
    ['no signature segment', 'aaa.bbb.'],
    ['two segments only', 'aaa.bbb'],
    ['garbage payload', `eyJhbGciOiJSUzI1NiJ9.not-base64-json!.c2ln`],
  ])('treats %s as invalid JWT input', async (_label, token) => {
    await expect(validateBackchannelLogoutToken(token)).resolves.toBeNull();
  });

  it('returns null when OIDC is not configured', async () => {
    delete process.env.AUTH_ISSUER;
    await expect(
      validateBackchannelLogoutToken(signLogoutToken(baseClaims()))
    ).resolves.toBeNull();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('returns null when discovery or JWKS fetch fails', async () => {
    mocks.fetch.mockRejectedValue(new Error('connect ECONNREFUSED'));
    await expect(
      validateBackchannelLogoutToken(signLogoutToken(baseClaims()))
    ).resolves.toBeNull();
  });

  it('rewrites the jwks_uri onto the internal issuer base when configured', async () => {
    process.env.OIDC_INTERNAL_ISSUER_URL = 'http://auth-service:3003';
    // The stub above serves the external URLs; re-stub for internal paths so
    // the rewrite-aware calls resolve.
    mocks.fetch.mockImplementation(async (url: string | URL) => {
      const target = String(url);
      if (target === 'http://auth-service:3003/.well-known/openid-configuration') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            issuer: ISSUER,
            jwks_uri: `${ISSUER}/jwks`,
          }),
        };
      }
      if (target === 'http://auth-service:3003/jwks') {
        return { ok: true, status: 200, json: async () => ({ keys: [publicJwk()] }) };
      }
      throw new Error(`unexpected fetch: ${target}`);
    });

    await expect(
      validateBackchannelLogoutToken(signLogoutToken(baseClaims()))
    ).resolves.toEqual({ sid: 'provider-session-1' });

    const calledUrls = mocks.fetch.mock.calls.map((call) => String(call[0]));
    expect(calledUrls).toContain('http://auth-service:3003/.well-known/openid-configuration');
    expect(calledUrls).toContain('http://auth-service:3003/jwks');
  });

  it('refreshes the JWKS once when the kid is unknown, then succeeds after rotation', async () => {
    const rotatedJwk = (): JsonWebKey => ({
      ...(attacker.publicKey.export({ format: 'jwk' }) as JsonWebKey),
      kid: 'rotated-key-2',
      alg: 'RS256',
      use: 'sig',
    });

    let jwksCalls = 0;
    mocks.fetch.mockImplementation(async (url: string | URL) => {
      const target = String(url);
      if (target === `${ISSUER}/.well-known/openid-configuration`) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ issuer: ISSUER, jwks_uri: `${ISSUER}/jwks` }),
        };
      }
      if (target === `${ISSUER}/jwks`) {
        jwksCalls += 1;
        // Calls 1-2 serve the pre-rotation key set; call 3 (the forced
        // refresh during the SECOND validation) carries the rotated key.
        const keys = jwksCalls < 3 ? [publicJwk()] : [publicJwk(), rotatedJwk()];
        return { ok: true, status: 200, json: async () => ({ keys }) };
      }
      throw new Error(`unexpected fetch: ${target}`);
    });

    const rotatedToken = signLogoutToken(baseClaims(), {
      signingKey: attacker.privateKey,
      header: { alg: 'RS256', kid: 'rotated-key-2' },
    });
    await expect(validateBackchannelLogoutToken(rotatedToken)).resolves.toBeNull();
    await expect(validateBackchannelLogoutToken(rotatedToken)).resolves.toEqual({
      sid: 'provider-session-1',
    });
    expect(jwksCalls).toBe(3);
  });
});
