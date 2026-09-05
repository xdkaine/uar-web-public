import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  configRow: vi.fn(),
  settings: vi.fn(),
  localCount: vi.fn(),
  ldapUrl: vi.fn(),
  ldapSecret: vi.fn(),
  oidcConfig: vi.fn(),
  legacyMethods: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    systemConfigEntry: { findUnique: mocks.configRow },
    systemSettings: { findFirst: mocks.settings },
    localAccount: { count: mocks.localCount },
  },
}));
vi.mock('@/lib/config/resolver', () => ({
  getConfigValue: mocks.ldapUrl,
  getRequiredSecretValue: mocks.ldapSecret,
}));
vi.mock('@/lib/auth/oidc', () => ({ getOidcRuntimeConfig: mocks.oidcConfig }));
vi.mock('@/lib/auth/alternate-signin', () => ({ getOidcSignInMethods: mocks.legacyMethods }));

import {
  getPortalSignInPolicy,
  validatePortalSignInPolicy,
  validateUsablePortalSignInPolicy,
} from './sign-in-policy';

const allMethods = {
  version: 1,
  methods: {
    oidc: { enabled: true, displayName: 'Cal Poly SOC Auth', description: 'Use the SOC identity service.' },
    nativeAd: { enabled: true },
    local: { enabled: true },
  },
};

describe('portal sign-in policy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.configRow.mockResolvedValue(null);
    mocks.settings.mockResolvedValue({ authMode: null });
    mocks.localCount.mockResolvedValue(1);
    mocks.ldapUrl.mockImplementation(async (key: string) => ({
      'ldap.url': 'ldaps://dc.example.test',
      'ldap.domain': 'example.test',
      'ldap.bindDn': 'CN=portal-bind,DC=example,DC=test',
      'ldap.searchBase': 'DC=example,DC=test',
    }[key] ?? ''));
    mocks.ldapSecret.mockResolvedValue('configured-bind-password');
    mocks.oidcConfig.mockReturnValue({
      issuer: 'https://auth.example.test',
      clientId: 'portal',
      clientSecret: 'configured',
      redirectUri: 'https://portal.example.test/api/auth/oidc/callback',
    });
    mocks.legacyMethods.mockReturnValue(['oidc']);
    process.env.AUTH_MODE = 'oidc';
  });

  it('rejects zero enabled methods and control characters in configurable copy', () => {
    expect(() => validatePortalSignInPolicy({
      ...allMethods,
      methods: {
        ...allMethods.methods,
        oidc: { ...allMethods.methods.oidc, enabled: false },
        nativeAd: { enabled: false },
        local: { enabled: false },
      },
    })).toThrow('Enable at least one');
    expect(() => validatePortalSignInPolicy({
      ...allMethods,
      methods: { ...allMethods.methods, oidc: { ...allMethods.methods.oidc, displayName: 'Bad\nname' } },
    })).toThrow('control characters');
  });

  it.each([
    [true, false, false],
    [false, true, false],
    [false, false, true],
    [true, true, false],
    [true, false, true],
    [false, true, true],
    [true, true, true],
  ])('accepts the enabled-method combination oidc=%s ad=%s local=%s', (oidc, nativeAd, local) => {
    expect(validatePortalSignInPolicy({
      version: 1,
      methods: {
        oidc: {
          enabled: oidc,
          displayName: 'Configured auth service',
          description: 'Use the configured identity provider.',
        },
        nativeAd: { enabled: nativeAd },
        local: { enabled: local },
      },
    }).methods).toMatchObject({
      oidc: { enabled: oidc },
      nativeAd: { enabled: nativeAd },
      local: { enabled: local },
    });
  });

  it('requires every enabled method to be ready before saving', async () => {
    mocks.localCount.mockResolvedValue(0);
    await expect(validateUsablePortalSignInPolicy(allMethods)).rejects.toThrow('local break-glass account');
    mocks.localCount.mockResolvedValue(1);
    mocks.ldapUrl.mockResolvedValue('');
    await expect(validateUsablePortalSignInPolicy(allMethods)).rejects.toThrow('LDAPS URL');
    mocks.ldapUrl.mockImplementation(async (key: string) => ({
      'ldap.url': 'ldaps://dc.example.test',
      'ldap.domain': 'example.test',
      'ldap.bindDn': 'CN=portal-bind,DC=example,DC=test',
      'ldap.searchBase': 'DC=example,DC=test',
    }[key] ?? ''));
    mocks.oidcConfig.mockReturnValue(null);
    await expect(validateUsablePortalSignInPolicy(allMethods)).rejects.toThrow('AUTH_ISSUER');
  });

  it.each(['ldap.url', 'ldap.domain', 'ldap.bindDn', 'ldap.searchBase'])('rejects direct AD when %s is missing', async (missingKey) => {
    mocks.ldapUrl.mockImplementation(async (key: string) => {
      if (key === missingKey) return '';
      return ({
        'ldap.url': 'ldaps://dc.example.test',
        'ldap.domain': 'example.test',
        'ldap.bindDn': 'CN=portal-bind,DC=example,DC=test',
        'ldap.searchBase': 'DC=example,DC=test',
      }[key] ?? '');
    });

    await expect(validateUsablePortalSignInPolicy(allMethods)).rejects.toThrow('bind password');
  });

  it('rejects direct AD when the bind password is missing', async () => {
    mocks.ldapSecret.mockRejectedValue(new Error('missing secret'));

    await expect(validateUsablePortalSignInPolicy(allMethods)).rejects.toThrow('bind password');
  });

  it('treats a stored policy as authoritative over legacy mode and alternates', async () => {
    mocks.configRow.mockResolvedValue({
      updatedAt: new Date('2026-09-05T12:00:00.000Z'),
      value: {
        ...allMethods,
        methods: {
          oidc: { ...allMethods.methods.oidc, enabled: false },
          nativeAd: { enabled: false },
          local: { enabled: true },
        },
      },
    });
    mocks.settings.mockResolvedValue({ authMode: 'oidc' });
    mocks.legacyMethods.mockReturnValue(['oidc', 'native_ad']);

    const resolved = await getPortalSignInPolicy();
    expect(resolved.source).toBe('database');
    expect(resolved.revision).toBe('2026-09-05T12:00:00.000Z');
    expect(resolved.methods.map((method) => [method.id, method.enabled])).toEqual([
      ['oidc', false], ['native_ad', false], ['local_break_glass', true],
    ]);
  });

  it('fails closed when policy storage cannot be read', async () => {
    mocks.configRow.mockRejectedValue(new Error('database unavailable'));

    await expect(getPortalSignInPolicy()).rejects.toThrow('database unavailable');
    expect(mocks.settings).not.toHaveBeenCalled();
    expect(mocks.legacyMethods).not.toHaveBeenCalled();
  });

  it.each([
    ['oidc', ['oidc']],
    ['native', ['native_ad']],
    ['local', ['local_break_glass']],
  ] as const)('maps legacy %s mode only when no policy exists', async (mode, enabledIds) => {
    mocks.settings.mockResolvedValue({ authMode: mode });
    mocks.legacyMethods.mockReturnValue(['oidc']);
    const resolved = await getPortalSignInPolicy();
    expect(resolved.source).toBe('legacy');
    expect(resolved.methods.filter((method) => method.enabled).map((method) => method.id)).toEqual(enabledIds);
  });
});
