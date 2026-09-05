import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findConfigRows: vi.fn().mockResolvedValue([]),
  clientOptions: vi.fn(),
  client: {
    startTLS: vi.fn().mockResolvedValue(undefined),
    bind: vi.fn().mockResolvedValue(undefined),
    modify: vi.fn().mockResolvedValue(undefined),
    unbind: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/lib/prisma', () => ({
  prisma: { systemConfigEntry: { findMany: mocks.findConfigRows } },
}));

vi.mock('ldapts', () => ({
  Client: vi.fn(function Client(options: unknown) {
    mocks.clientOptions(options);
    return mocks.client;
  }),
  Attribute: vi.fn(function Attribute(options: unknown) {
    return options;
  }),
  Change: vi.fn(function Change(options: unknown) {
    return options;
  }),
}));

import { validateEnvironment } from '../env-validator';
import { createLDAPClient, getLDAPTLSOptions } from './client';
import { changeLDAPUserPassword } from './password';
import { clearConfigCache } from '../config/resolver';

const VALID_ENV: Record<string, string> = {
  DATABASE_URL: 'postgresql://user:password@database:5432/app?sslmode=require',
  SMTP_HOST: 'smtp.example.test',
  SMTP_PORT: '587',
  SMTP_USER: 'mailer',
  SMTP_PASSWORD: 'mailer-password',
  EMAIL_FROM: 'no-reply@example.test',
  ADMIN_EMAIL: 'admin@example.test',
  LDAP_URL: 'ldaps://directory.example.test:636',
  LDAP_BIND_DN: 'CN=service,DC=example,DC=test',
  LDAP_BIND_PASSWORD: 'directory-password',
  LDAP_SEARCH_BASE: 'DC=example,DC=test',
  LDAP_DOMAIN: 'example.test',
  LDAP_ADMIN_GROUPS: 'CN=Portal Admins,OU=Groups,DC=example,DC=test',
  LDAP_GROUP2ADD: 'CN=Portal Users,OU=Groups,DC=example,DC=test',
  LDAP_KAMINO_INTERNAL_GROUP: 'CN=Internal,OU=Groups,DC=example,DC=test',
  LDAP_KAMINO_EXTERNAL_GROUP: 'CN=External,OU=Groups,DC=example,DC=test',
  LDAP_GROUPSEARCH: 'OU=Groups,DC=example,DC=test',
  NEXT_PUBLIC_APP_URL: 'https://portal.example.test',
  NEXTAUTH_SECRET: 'nextauth-secret-with-at-least-32-characters',
  ENCRYPTION_SECRET: 'encryption-secret-with-at-least-32-characters',
  ENCRYPTION_SALT: '0123456789abcdef0123456789abcdef',
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'site-key',
  TURNSTILE_SECRET_KEY: 'secret-key',
  MONITOR_PROBE_SHARED_SECRET: 'monitor-probe-secret-with-at-least-32-characters',
};

const VALID_CA_CERTIFICATE = `-----BEGIN CERTIFICATE-----
MIICrzCCAZegAwIBAgIJAOY2ejT7HS9eMA0GCSqGSIb3DQEBCwUAMBcxFTATBgNVBAMTDExEQVAg
VGVzdCBDQTAeFw0yNjA4MDEyMTQxMTZaFw0yNjA5MDEyMTQxMTZaMBcxFTATBgNVBAMTDExEQVAg
VGVzdCBDQTCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBALJTK+IrRFuwQC95gSZu6JZf
gPbMpMN9au8uESlglHX5D8VC4JTC/c4GWvmaGe+nUXL2MG++ByxRUlHYhKJKlY0kftAw8se0ekc6
YIDZHoBDu2RaEXSE8zVljnwK3viQddz1rNw2JGLA2ma/+Qug6MBlT3PwgCPCbem5kWc9Zz/3Z3lR
YUPlrjNzhSJumr2IBVFp8S7ous6BMwo9R3QnWOl2e5QLN6FM2lPzFM1wi0njRs8QFJCM7TmipbQ8
OJJYAnRU6DRKBTSS1on3eF554yQX3Qdh/WDdDxRaL/QJaTb73iSEKrKZY81IJKH8oc7Kb67O2DQp
uyqp+ijMkZrWcl0CAwEAATANBgkqhkiG9w0BAQsFAAOCAQEAPK1ILuhSwihhTcPR6VjSmnhdreZf
4FMvJHpV8RriYy1rCA1TNix9JrohUXEA/nvQhQyMvjhIgSZVZSCzSevkI4mzddBiKidV57VqbEDo
vA92FKpOv+YbYzy7MC7k6xc+Ddby5b5FmoovmaxJEmZ1kdeGMY4ES2UqQ5oZWsylb1tcPkJlty0H
TGjiCHB5S1ODwxs689TPvBjRmc8olUuGtNAE+JFVASzE7lRI6L5hk2eEw6TpNnpD3ukseLKmfzpB
e3sNX5W+J13K8/rZdwZdNa/5Z4g1DFg+qnr/2NJlr8q31xgH1dz+72ze0o5XVDWO8r1S668Rl8oq
wgvXRue3fA==
-----END CERTIFICATE-----`;

describe('LDAP certificate validation', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findConfigRows.mockResolvedValue([]);
    clearConfigCache();
    Object.assign(process.env, VALID_ENV);
    delete process.env.LDAP_ALLOW_INVALID_CERTS;
    delete process.env.LDAP_CA_CERT_BASE64;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('keeps certificate verification enabled by default', async () => {
    await createLDAPClient();

    expect(mocks.clientOptions).toHaveBeenCalledWith({
      url: VALID_ENV.LDAP_URL,
      tlsOptions: { rejectUnauthorized: true },
    });
    expect(getLDAPTLSOptions()).toEqual({ rejectUnauthorized: true });
  });

  it('disables certificate verification only under the explicit lab override', async () => {
    process.env.LDAP_ALLOW_INVALID_CERTS = 'true';

    await createLDAPClient();

    expect(mocks.clientOptions).toHaveBeenCalledWith({
      url: VALID_ENV.LDAP_URL,
      tlsOptions: { rejectUnauthorized: false },
    });
    expect(getLDAPTLSOptions()).toEqual({ rejectUnauthorized: false });
  });

  it('accepts the lab certificate override in environment validation', () => {
    process.env.LDAP_ALLOW_INVALID_CERTS = 'true';

    expect(() => validateEnvironment()).not.toThrow();
  });

  it('rejects values outside true/false in LDAP_ALLOW_INVALID_CERTS', () => {
    process.env.LDAP_ALLOW_INVALID_CERTS = 'yes';

    expect(() => validateEnvironment()).toThrow(
      'LDAP_ALLOW_INVALID_CERTS must be either true or false'
    );
  });

  it('verifies certificates in the password reset LDAPS workflow', async () => {
    await changeLDAPUserPassword(
      'alice',
      'Correct Horse Battery Staple!',
      'CN=alice,OU=Users,DC=example,DC=test'
    );

    expect(mocks.clientOptions).toHaveBeenCalledWith({
      url: VALID_ENV.LDAP_URL,
      tlsOptions: { rejectUnauthorized: true },
    });
    expect(mocks.client.startTLS).not.toHaveBeenCalled();
    expect(mocks.client.modify).toHaveBeenCalledOnce();
  });

  it('rejects plaintext LDAP before a password workflow can bind', async () => {
    process.env.LDAP_URL = 'ldap://directory.example.test:389';

    await expect(changeLDAPUserPassword(
      'alice',
      'Correct Horse Battery Staple!',
      'CN=alice,OU=Users,DC=example,DC=test'
    )).rejects.toThrow('LDAP_URL must use ldaps:// transport');

    expect(mocks.clientOptions).not.toHaveBeenCalled();
    expect(mocks.client.bind).not.toHaveBeenCalled();
    expect(mocks.client.modify).not.toHaveBeenCalled();
  });

  it('accepts a trusted LDAPS configuration with verification enabled', () => {
    process.env.LDAP_ALLOW_INVALID_CERTS = 'false';

    expect(() => validateEnvironment()).not.toThrow();
  });

  it('uses a configured private CA without weakening certificate verification', async () => {
    process.env.LDAP_CA_CERT_BASE64 = Buffer.from(VALID_CA_CERTIFICATE).toString('base64');

    await createLDAPClient();

    expect(mocks.clientOptions).toHaveBeenCalledWith({
      url: VALID_ENV.LDAP_URL,
      tlsOptions: { rejectUnauthorized: true, ca: VALID_CA_CERTIFICATE },
    });
  });

  it.each([
    ['malformed base64', 'not-base64!'],
    ['non-certificate PEM', Buffer.from('not a certificate').toString('base64')],
  ])('rejects %s in LDAP_CA_CERT_BASE64', async (_label, value) => {
    process.env.LDAP_CA_CERT_BASE64 = value;

    expect(() => validateEnvironment()).toThrow('CRITICAL: LDAP_CA_CERT_BASE64');
    await expect(createLDAPClient()).rejects.toThrow('LDAP_CA_CERT_BASE64');
  });
});
