import { describe, expect, it } from 'vitest';
import Provider from 'oidc-provider';
import {
  buildProviderOptions,
  claimsKey,
  parseCachedClaims,
  type CachedAccountClaims,
} from './provider-options';
import type { AuthConfig } from './config';

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

function depsWithCached(raw: string | null) {
  return {
    redis: { get: async () => raw },
    createAdapter: () => {
      throw new Error('not expected in tests');
    },
  };
}

async function claimsFor(raw: string | null): Promise<Record<string, unknown>> {
  const options = buildProviderOptions(configFixture(), depsWithCached(raw));
  const findAccount = options.findAccount as (ctx: unknown, id: string) => Promise<{
    accountId: string;
    claims: () => Promise<Record<string, unknown>>;
  }>;
  const account = await findAccount({}, 'alice');
  return account.claims();
}

async function claimsForProviderSessionExpiry(expiresAt: number): Promise<Record<string, unknown>> {
  const options = buildProviderOptions(configFixture(), depsWithCached(null));
  const findAccount = options.findAccount as (ctx: unknown, id: string, token?: unknown) => Promise<{
    claims: () => Promise<Record<string, unknown>>;
  }>;
  const findByUid = async (uid: string) => uid === 'session-uid'
    ? { exp: expiresAt, accountId: 'alice' }
    : undefined;
  const account = await findAccount(
    { oidc: { provider: { Session: { findByUid } } } },
    'alice',
    { sessionUid: 'session-uid' },
  );
  return account.claims();
}

describe('widened claims contract (ADR-0012 amendment)', () => {
  it('defines the groups scope and the name claim behind profile', () => {
    const options = buildProviderOptions(configFixture(), depsWithCached(null));
    const claims = options.claims as Record<string, string[]>;
    expect(claims.groups).toEqual(['groups']);
    expect(claims.profile).toContain('name');
    expect(claims.profile).toContain('preferred_username');
    expect(claims.email).toEqual(['email']);
    expect(claims.amr).toEqual(['amr']);
    expect(claims.openid).toContain('provider_session_expires_at');
    // Roles stay out of the contract.
    expect(JSON.stringify(claims)).not.toContain('roles');
  });

  it('retains code-bound AD authority in an OpenID-only ID token mask', async () => {
    const config = configFixture();
    const options = buildProviderOptions(config, depsWithCached(null));
    // Exercise the real library mask used by the authorization-code grant
    // when conformIdTokenClaims and userinfo are enabled (the defaults).
    delete options.adapter;
    const provider = new Provider(config.issuer, options) as unknown as {
      Client: { find(id: string): Promise<unknown> };
      IdToken: new (claims: Record<string, unknown>, options: { client: unknown }) => {
        scope: string;
        payload(): Promise<Record<string, unknown>>;
      };
    };
    const client = await provider.Client.find(config.clientId);
    for (const amr of [['ad'], ['ad', 'pwd_changed'], undefined]) {
      const token = new provider.IdToken({ sub: 'alice', amr }, { client });
      token.scope = 'openid';
      const payload = await token.payload();
      expect(payload.amr).toEqual(amr);
    }
  });

  it('carries the signed provider-session expiry in the OpenID claims', async () => {
    const claims = await claimsForProviderSessionExpiry(1_800_000_000);
    expect(claims.provider_session_expires_at).toBe(1_800_000_000);
  });

  it('omits expiry when the authorization code session belongs to another account', async () => {
    const options = buildProviderOptions(configFixture(), depsWithCached(null));
    const findAccount = options.findAccount as (ctx: unknown, id: string, token?: unknown) => Promise<{
      claims: () => Promise<Record<string, unknown>>;
    }>;
    const account = await findAccount(
      { oidc: { provider: { Session: { findByUid: async () => ({ exp: 1_800_000_000, accountId: 'mallory' }) } } } },
      'alice',
      { sessionUid: 'session-uid' },
    );

    expect((await account.claims()).provider_session_expires_at).toBeUndefined();
  });

  it('emits cached displayName, real mail, and group CNs when present', async () => {
    const cached: CachedAccountClaims = {
      name: 'Alice Anderson',
      email: 'alice@ad.example.test',
      groups: ['proxmox-admins', 'uar-staff'],
    };
    const claims = await claimsFor(JSON.stringify(cached));
    expect(claims.name).toBe('Alice Anderson');
    expect(claims.email).toBe('alice@ad.example.test');
    expect(claims.groups).toEqual(['proxmox-admins', 'uar-staff']);
    expect(claims.amr).toBeUndefined();
    expect(claims.pwd_changed).toBeUndefined();
    expect(claims.preferred_username).toBe('alice');
  });

  it('does not accept authentication evidence from the account profile cache', async () => {
    const claims = await claimsFor(JSON.stringify({ amr: ['local_break_glass'], pwd_changed: true }));
    expect(claims.amr).toBeUndefined();
    expect(claims.pwd_changed).toBeUndefined();
  });

  it('falls back to the synthesized email and omits name/groups without a cache', async () => {
    const claims = await claimsFor(null);
    expect(claims.name).toBeUndefined();
    expect(claims.groups).toBeUndefined();
    expect(claims.pwd_changed).toBeUndefined();
    expect(claims.email).toBe('alice@example.test');
  });

  it('tolerates a corrupted cache without dropping the subject', async () => {
    const claims = await claimsFor('{not-json');
    expect(claims.sub).toBe('alice');
    expect(claims.email).toBe('alice@example.test');
  });

  it('parseCachedClaims drops non-string group entries', () => {
    const parsed = parseCachedClaims(
      JSON.stringify({ amr: ['ad'], groups: ['ok', 42, null], name: '', pwd_changed: 'yes' })
    );
    expect(parsed.groups).toEqual(['ok']);
    expect(parsed.name).toBeUndefined();
    expect('amr' in parsed).toBe(false);
    expect('pwd_changed' in parsed).toBe(false);
  });

  it('scopes claim cache keys per account', () => {
    expect(claimsKey('Alice@Example.com')).toBe('authsvc:claims:alice@example.com');
  });
});

describe('provider client + cookie security pins', () => {
  it('pins the bootstrap client to RS256 ID-token signing', () => {
    const options = buildProviderOptions(configFixture(), depsWithCached(null));
    const clients = options.clients as Array<Record<string, unknown>>;
    expect(clients[0].id_token_signed_response_alg).toBe('RS256');
  });

  it('pins provider cookies Secure from the https issuer scheme', () => {
    const options = buildProviderOptions(configFixture(), depsWithCached(null));
    const cookies = options.cookies as { long: { secure?: boolean }; short: { secure?: boolean } };
    expect(cookies.long.secure).toBe(true);
    expect(cookies.short.secure).toBe(true);

    // Plain-http issuers (local dev) must not get Secure cookies that the
    // browser would drop.
    const devOptions = buildProviderOptions(
      { ...configFixture(), issuer: 'http://auth.local.test' },
      depsWithCached(null)
    );
    const devCookies = devOptions.cookies as {
      long: { secure?: boolean };
      short: { secure?: boolean };
    };
    expect(devCookies.long.secure).toBe(false);
    expect(devCookies.short.secure).toBe(false);
  });
});
