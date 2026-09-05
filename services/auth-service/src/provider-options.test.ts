import { describe, expect, it } from 'vitest';
import type { AuthConfig } from './config';
import { buildProviderOptions, claimsKey } from './provider-options';

function configFixture(): AuthConfig {
  return {
    issuer: 'https://auth.example.test',
    port: 3003,
    databaseUrl: 'postgres://unused',
    redisUrl: 'redis://unused',
    cookieKeys: ['k1'],
    clientId: 'uar-portal',
    clientSecret: 's3cret',
    redirectUris: ['http://localhost:3002/api/auth/oidc/callback'],
    postLogoutRedirects: ['http://localhost:3002'],
    backchannelLogoutUri: 'http://localhost:3002/api/auth/oidc/backchannel-logout',
    ldapDomain: 'example.test',
    ldapUrl: 'ldaps://dc.example.test:636',
    ldapSearchBase: 'DC=example,DC=test',
    ldapBindDn: '',
    ldapBindPassword: '',
    allowInvalidCertificates: false,
    turnstileSiteKey: 'site',
    turnstileSecretKey: 'secret',
    loginWindowMs: 900_000,
    loginMaxAttempts: 20,
    accountLockWindowMs: 900_000,
    accountLockMaxAttempts: 5,
    internalBrandingToken: '',
    adminUsernames: [],
    adminGroups: [],
  } as AuthConfig;
}

const deps = {
  redis: { get: async () => null },
  createAdapter: () => {
    throw new Error('not expected in tests');
  },
};

describe('buildProviderOptions', () => {
  it('pins PKCE as required for EVERY client (dependency upgrades cannot silently disable it)', () => {
    const options = buildProviderOptions(configFixture(), deps);
    const pkce = options.pkce as { required?: unknown } | undefined;
    expect(pkce).toBeDefined();
    expect(typeof pkce?.required).toBe('function');
    // Applies to arbitrary clients: public, confidential, and the bootstrap
    // confidential client alike.
    const required = pkce?.required as (...args: unknown[]) => boolean;
    expect(required()).toBe(true);
    expect(required({ client_id: 'uar-portal', token_endpoint_auth_method: 'client_secret_basic' })).toBe(true);
    expect(required({ client_id: 'public-app' })).toBe(true);
  });

  it('keeps devInteractions disabled and backchannel logout metadata intact', () => {
    const options = buildProviderOptions(configFixture(), deps);
    const features = options.features as Record<string, { enabled: boolean }>;
    expect(features.devInteractions.enabled).toBe(false);
    expect(features.backchannelLogout.enabled).toBe(true);
    const clients = options.clients as Array<Record<string, unknown>>;
    expect(clients[0]?.backchannel_logout_session_required).toBe(true);
    expect(clients[0]?.client_id).toBe('uar-portal');
  });

  it('requires a fresh login when a legacy provider session has no AD authority evidence', async () => {
    const options = buildProviderOptions(configFixture(), deps);
    const interactions = options.interactions as {
      policy: Array<{
        name: string;
        checks: Array<{
          reason: string;
          check: (ctx: unknown) => boolean | Promise<boolean>;
        }>;
      }>;
    };
    const authorityCheck = interactions.policy
      .find((prompt) => prompt.name === 'login')
      ?.checks.find((check) => check.reason === 'missing_authentication_authority');

    expect(authorityCheck).toBeDefined();
    await expect(Promise.resolve(authorityCheck?.check({
      oidc: { session: { accountId: 'alice' } },
    }))).resolves.toBe(true);
    await expect(Promise.resolve(authorityCheck?.check({
      oidc: { session: { accountId: 'alice', amr: [] } },
    }))).resolves.toBe(true);
  });

  it('keeps a current AD-authenticated provider session eligible for SSO', async () => {
    const options = buildProviderOptions(configFixture(), deps);
    const interactions = options.interactions as {
      policy: Array<{
        name: string;
        checks: Array<{
          reason: string;
          check: (ctx: unknown) => boolean | Promise<boolean>;
        }>;
      }>;
    };
    const authorityCheck = interactions.policy
      .find((prompt) => prompt.name === 'login')
      ?.checks.find((check) => check.reason === 'missing_authentication_authority');

    expect(authorityCheck).toBeDefined();
    await expect(Promise.resolve(authorityCheck?.check({
      oidc: { session: { accountId: 'alice', amr: ['ad'] } },
    }))).resolves.toBe(false);
    await expect(Promise.resolve(authorityCheck?.check({
      oidc: { session: { accountId: 'alice', amr: ['ad', 'pwd_changed'] } },
    }))).resolves.toBe(false);
  });

  it('installs the shared signing JWK Set so logout tokens reuse the provider keys', () => {
    const jwks = { keys: [{ kty: 'RSA', kid: 'shared-kid', n: 'n-value', e: 'AQAB' }] };
    const withKeys = buildProviderOptions(configFixture(), deps, jwks);
    expect(withKeys.jwks).toBe(jwks);
    // Absent injection keeps the provider's own default keystore path.
    expect('jwks' in buildProviderOptions(configFixture(), deps)).toBe(false);
  });

  it('resolves session TTL through the per-client registry resolver', async () => {
    process.env.AUTH_SESSION_TTL_UNKNOWN_APP = '900';
    const options = buildProviderOptions(configFixture(), deps);
    const ttl = options.ttl as {
      Session: (ctx: unknown, token: unknown) => number;
    };
    expect(ttl.Session({ oidc: { client: { clientId: 'unknown-app' } } }, {})).toBe(900);
    expect(ttl.Session({}, {})).toBe(8 * 60 * 60);
    delete process.env.AUTH_SESSION_TTL_UNKNOWN_APP;
  });

  it('scopes claim cache keys per account', async () => {
    expect(claimsKey('Alice@Example.com')).toBe('authsvc:claims:alice@example.com');
  });
});
