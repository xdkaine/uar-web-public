import { afterAll, describe, expect, it } from 'vitest';
import { createPublicKey, generateKeyPairSync } from 'node:crypto';
import { AUTH_JWKS_ENV, resolveProviderKeys, sharedProviderKeys } from './jwks';

const savedEnv = process.env[AUTH_JWKS_ENV];

afterAll(() => {
  if (savedEnv === undefined) delete process.env[AUTH_JWKS_ENV];
  else process.env[AUTH_JWKS_ENV] = savedEnv;
});

function envWithJwk(jwk: Record<string, unknown>): NodeJS.ProcessEnv {
  return { [AUTH_JWKS_ENV]: JSON.stringify({ keys: [jwk] }) };
}

/** Minimal RSA JWK fixture (2048-bit) with private material, generated once. */
const fixture = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'jwk' },
  privateKeyEncoding: { type: 'pkcs8', format: 'jwk' },
});

describe('resolveProviderKeys', () => {
  it('uses AUTH_JWKS verbatim and keeps its configured kid', () => {
    const resolved = resolveProviderKeys(
      envWithJwk({
        kty: 'RSA',
        kid: 'fixed-kid',
        use: 'sig',
        alg: 'RS256',
        ...fixture.publicKey,
        ...fixture.privateKey,
      })
    );

    expect(resolved.jwks.keys).toHaveLength(1);
    expect(resolved.logout.kid).toBe('fixed-kid');
    expect(resolved.logout.privateKey.asymmetricKeyType).toBe('rsa');
  });

  it('derives an RFC 7638 thumbprint kid when none is configured', () => {
    const resolved = resolveProviderKeys(
      envWithJwk({ kty: 'RSA', n: String(fixture.publicKey.n), e: String(fixture.publicKey.e), d: fixture.privateKey.d, p: fixture.privateKey.p, q: fixture.privateKey.q, dp: fixture.privateKey.dp, dq: fixture.privateKey.dq, qi: fixture.privateKey.qi })
    );
    expect(resolved.logout.kid).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(resolved.jwks.keys[0]).toMatchObject({ kid: resolved.logout.kid });
  });

  it.each([
    ['not json at all'],
    ['{"keys":[]}'],
    ['{"keys":[{"kty":"RSA","n":"abc","e":"AQAB"}]}'],
    ['{"keys":[{"kty":"oct","k":"x"}]}'],
  ])('fails closed on unusable AUTH_JWKS payload %s', (raw) => {
    expect(() =>
      resolveProviderKeys({ [AUTH_JWKS_ENV]: raw })
    ).toThrow(AUTH_JWKS_ENV);
  });

  it('generates a per-boot ephemeral RSA keypair when AUTH_JWKS is absent', () => {
    const resolved = resolveProviderKeys({});
    const key = resolved.jwks.keys[0];
    expect(key).toMatchObject({ kty: 'RSA', use: 'sig', alg: 'RS256' });
    // Private material is handed to the provider so IT can sign; the
    // published JWKS endpoint strips it server-side.
    expect(key.d).toBeTruthy();
    expect(key.n).toBeTypeOf('string');
    // The signing key object verifies against its own public half.
    const publicJwk = createPublicKey({
      key: { kty: 'RSA', n: key.n, e: key.e },
      format: 'jwk',
    });
    expect(publicJwk.asymmetricKeyType).toBe('rsa');
    expect(resolved.logout.kid).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('fails closed without AUTH_JWKS in production', () => {
    expect(() => resolveProviderKeys({ NODE_ENV: 'production' })).toThrow(
      'AUTH_JWKS is required in production'
    );
  });
});

describe('sharedProviderKeys', () => {
  it('resolves exactly once per process so every consumer shares one keypair', () => {
    const first = sharedProviderKeys();
    const second = sharedProviderKeys();
    expect(second).toBe(first);
    expect(first.jwks.keys).toEqual(second.jwks.keys);
  });
});
