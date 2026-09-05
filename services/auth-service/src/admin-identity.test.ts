import { describe, expect, it } from 'vitest';
import { buildIdentityConfiguration } from './admin-identity';
import type { AuthConfig } from './config';

function config(overrides: Partial<AuthConfig> = {}): AuthConfig {
  return {
    issuer: 'https://auth.example.test',
    port: 3003,
    databaseUrl: 'postgres://not-returned',
    redisUrl: 'redis://not-returned',
    cookieKeys: ['not-returned'],
    clientId: 'uar-portal',
    clientSecret: 'not-returned',
    redirectUris: ['https://portal.example.test/callback'],
    backchannelLogoutUri: 'https://portal.example.test/backchannel-logout',
    postLogoutRedirects: ['https://portal.example.test'],
    ldapDomain: 'ad.example.test',
    ldapUrl: 'ldaps://bind-user:bind-password@dc01.ad.example.test:636/private',
    ldapSearchBase: 'OU=People,DC=ad,DC=example,DC=test',
    ldapBindDn: 'CN=svc-auth,OU=Service Accounts,DC=example,DC=test',
    ldapBindPassword: 'not-returned',
    allowInvalidCertificates: false,
    allowInsecureTransport: false,
    turnstileSiteKey: 'site',
    turnstileSecretKey: 'not-returned',
    trustProxyHeaders: true,
    deviceRiskMode: 'shadow',
    deviceEvidenceKey: 'not-returned',
    deviceEvidencePreviousKeys: [],
    loginWindowMs: 900_000,
    loginMaxAttempts: 20,
    accountLockWindowMs: 900_000,
    accountLockMaxAttempts: 5,
    internalBrandingToken: 'not-returned',
    adminUsernames: ['admin'],
    adminGroups: ['CN=Identity Admins,OU=Groups,DC=example,DC=test'],
    ...overrides,
  };
}

describe('identity configuration summary', () => {
  it('describes Active Directory precedence and IdP policy without secrets', () => {
    const summary = buildIdentityConfiguration(
      config(),
      { now: new Date('2026-08-31T12:00:00.000Z'), recoveryAccountCount: 2 }
    );

    expect(summary.source).toMatchObject({
      name: 'Active Directory',
      role: 'primary',
      endpoint: 'ldaps://dc01.ad.example.test:636',
      transport: 'LDAPS',
      certificateVerification: 'required',
      directorySearch: 'configured',
      managedBy: 'deployment',
    });
    expect(summary.recovery).toMatchObject({
      activation: 'explicit Auth Manager sign-in only',
      oidcEligible: false,
      accountCount: 2,
    });
    expect(summary.federation).toMatchObject({
      flow: 'Authorization code + PKCE',
      signingAlgorithm: 'RS256',
      roleClaimsIncluded: false,
    });
    expect(summary.administration.directoryVerification).toBe('every protected request');

    const serialized = JSON.stringify(summary);
    for (const secret of [
      'bind-user',
      'bind-password',
      'not-returned',
      'svc-auth',
      'postgres://',
      'redis://',
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('makes degraded transport and sign-in-only directory access explicit', () => {
    const summary = buildIdentityConfiguration(config({
      ldapUrl: 'ldap://dc01.ad.example.test:389',
      ldapBindDn: '',
      ldapBindPassword: '',
      allowInvalidCertificates: true,
      allowInsecureTransport: true,
      trustProxyHeaders: false,
      deviceRiskMode: 'off',
    }));

    expect(summary.source.transport).toBe('LDAP');
    expect(summary.source.certificateVerification).toBe('not applicable');
    expect(summary.source.directorySearch).toBe('sign-in only');
    expect(summary.safeguards.trustedProxyHeaders).toBe(false);
    expect(summary.safeguards.deviceEvidence).toBe('off');
  });

  it('marks a disabled certificate check only for encrypted LDAPS transport', () => {
    const summary = buildIdentityConfiguration(config({
      ldapUrl: 'ldaps://dc01.ad.example.test:636',
      allowInvalidCertificates: true,
    }));

    expect(summary.source.transport).toBe('LDAPS');
    expect(summary.source.certificateVerification).toBe('disabled');
    expect(summary.recovery.accountCount).toBeNull();
  });
});
