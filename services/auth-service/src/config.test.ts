import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from './config';

const BASE_ENV: Record<string, string> = {
  AUTH_ISSUER: 'https://auth.example.test',
  DATABASE_URL: 'postgres://db.invalid:5432/db',
  AUTH_COOKIE_KEYS: 'cookie-key-one-with-more-than-32-characters,cookie-key-two-with-more-than-32-characters',
  OIDC_CLIENT_SECRET: 'oidc-client-secret-with-more-than-32-characters',
  LDAP_DOMAIN: 'ad.example.test',
  LDAP_SEARCH_BASE: 'DC=ad,DC=example,DC=test',
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'site',
  TURNSTILE_SECRET_KEY: 'turnstile-secret',
};

const MANAGED = [
  'AUTH_ISSUER',
  'DATABASE_URL',
  'AUTH_COOKIE_KEYS',
  'OIDC_CLIENT_SECRET',
  'LDAP_DOMAIN',
  'LDAP_URL',
  'LDAP_SEARCH_BASE',
  'NEXT_PUBLIC_TURNSTILE_SITE_KEY',
  'TURNSTILE_SECRET_KEY',
  'LDAP_ALLOW_INVALID_CERTS',
  'LDAP_ALLOW_INSECURE_TRANSPORT',
  'AUTH_TRUST_PROXY_HEADERS',
  'AUTH_LOGIN_WINDOW_MS',
  'AUTH_LOGIN_MAX_ATTEMPTS',
  'AUTH_ACCOUNT_LOCK_WINDOW_MS',
  'AUTH_ACCOUNT_LOCK_MAX_ATTEMPTS',
  'AUTH_DEVICE_RISK_MODE',
  'AUTH_DEVICE_EVIDENCE_KEY',
  'AUTH_DEVICE_EVIDENCE_PREVIOUS_KEYS',
  'NODE_ENV',
  'AUTH_JWKS',
];

function withEnv(overrides: Record<string, string | undefined>): void {
  for (const [name, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

describe('loadConfig transport + key policy gates', () => {
  afterEach(() => {
    for (const name of MANAGED) delete process.env[name];
  });

  function baseEnv(): Record<string, string | undefined> {
    return { ...BASE_ENV, LDAP_URL: 'ldaps://dc01.ad.example.test:636' };
  }

  it('loads cleanly with an ldaps:// URL and defaults both flags OFF', () => {
    withEnv(baseEnv());
    const config = loadConfig();
    expect(config.ldapUrl).toBe('ldaps://dc01.ad.example.test:636');
    expect(config.trustProxyHeaders).toBe(false);
    expect(config.allowInsecureTransport).toBe(false);
  });

  it.each(['ldap://', 'LDAP://', '', 'http://dc.ad.example.test'])(
    'refuses to boot on non-ldaps LDAP_URL (%s)',
    (scheme) => {
      withEnv({ ...baseEnv(), LDAP_URL: `${scheme}dc01.ad.example.test` });
      expect(() => loadConfig()).toThrow(/LDAP_URL must start with ldaps:\/\/|Missing required/);
    }
  );

  it.each(['1', 'true', 'TRUE', 'Yes', 'yes'])(
    'allows insecure transport when LDAP_ALLOW_INSECURE_TRANSPORT=%s',
    (value) => {
      withEnv({ ...baseEnv(), LDAP_URL: 'ldap://dc01.ad.example.test', LDAP_ALLOW_INSECURE_TRANSPORT: value });
      expect(loadConfig().allowInsecureTransport).toBe(true);
    }
  );

  it.each(['0', 'false', 'no', 'off', ''])('stays strict on falsy escape-hatch values (%s)', (value) => {
    withEnv({ ...baseEnv(), LDAP_URL: 'ldap://dc01.ad.example.test', LDAP_ALLOW_INSECURE_TRANSPORT: value });
    expect(() => loadConfig()).toThrow(/ldaps:/);
  });

  it('parses AUTH_TRUST_PROXY_HEADERS with the same truthiness rules', () => {
    withEnv(baseEnv());
    process.env.AUTH_TRUST_PROXY_HEADERS = 'YES';
    expect(loadConfig().trustProxyHeaders).toBe(true);
    delete process.env.AUTH_TRUST_PROXY_HEADERS;
    expect(loadConfig().trustProxyHeaders).toBe(false);
    process.env.AUTH_TRUST_PROXY_HEADERS = '0';
    expect(loadConfig().trustProxyHeaders).toBe(false);
    delete process.env.AUTH_TRUST_PROXY_HEADERS;
  });

  it('enforces the portal-aligned login and account lock bounds', () => {
    withEnv({
      ...baseEnv(),
      AUTH_LOGIN_WINDOW_MS: '60000',
      AUTH_LOGIN_MAX_ATTEMPTS: '20',
      AUTH_ACCOUNT_LOCK_WINDOW_MS: '900000',
      AUTH_ACCOUNT_LOCK_MAX_ATTEMPTS: '5',
    });
    expect(loadConfig()).toMatchObject({
      loginWindowMs: 60000,
      loginMaxAttempts: 20,
      accountLockWindowMs: 900000,
      accountLockMaxAttempts: 5,
    });

    process.env.AUTH_ACCOUNT_LOCK_MAX_ATTEMPTS = 'abc';
    expect(() => loadConfig()).toThrow(/AUTH_ACCOUNT_LOCK_MAX_ATTEMPTS must be an integer/);
    process.env.AUTH_ACCOUNT_LOCK_MAX_ATTEMPTS = '0';
    expect(() => loadConfig()).toThrow(/AUTH_ACCOUNT_LOCK_MAX_ATTEMPTS must be an integer/);
    process.env.AUTH_ACCOUNT_LOCK_MAX_ATTEMPTS = '5';
    process.env.AUTH_LOGIN_WINDOW_MS = '999';
    expect(() => loadConfig()).toThrow(/AUTH_LOGIN_WINDOW_MS must be an integer/);
  });

  it('keeps device evidence off by default and requires a dedicated HMAC key in shadow mode', () => {
    withEnv(baseEnv());
    expect(loadConfig().deviceRiskMode).toBe('off');

    process.env.AUTH_DEVICE_RISK_MODE = 'shadow';
    expect(() => loadConfig()).toThrow(/AUTH_DEVICE_EVIDENCE_KEY/);
    process.env.AUTH_DEVICE_EVIDENCE_KEY = 'device-evidence-key-at-least-32-characters';
    expect(loadConfig().deviceRiskMode).toBe('shadow');

    process.env.AUTH_DEVICE_EVIDENCE_PREVIOUS_KEYS = 'previous-device-evidence-key-at-least-32-characters';
    expect(loadConfig().deviceEvidencePreviousKeys).toHaveLength(1);
    process.env.AUTH_DEVICE_EVIDENCE_PREVIOUS_KEYS = 'too-short';
    expect(() => loadConfig()).toThrow(/PREVIOUS_KEYS/);

    delete process.env.AUTH_DEVICE_EVIDENCE_PREVIOUS_KEYS;
    process.env.AUTH_DEVICE_RISK_MODE = 'enforce';
    expect(() => loadConfig()).toThrow(/enforcement is not enabled/);
  });

  it('fails closed in production without AUTH_JWKS', () => {
    withEnv({ ...baseEnv(), NODE_ENV: 'production' });
    delete process.env.AUTH_JWKS;
    expect(() => loadConfig()).toThrow('AUTH_JWKS is required in production');

    // A configured key set satisfies the startup gate.
    process.env.AUTH_JWKS = '{"keys":[]}';
    expect(() => loadConfig()).not.toThrow();

    // Non-production processes may use ephemeral signing keys.
    delete process.env.AUTH_JWKS;
    process.env.NODE_ENV = 'development';
    expect(() => loadConfig()).not.toThrow();
  });

  it.each(['AUTH_COOKIE_KEYS', 'OIDC_CLIENT_SECRET'])(
    'rejects a known %s placeholder in production',
    (name) => {
      withEnv({
        ...baseEnv(),
        NODE_ENV: 'production',
        AUTH_JWKS: '{"keys":[]}',
        [name]: 'replace_with_a_public_example_secret',
      });
      expect(() => loadConfig()).toThrow(/placeholder/);
    }
  );
});
