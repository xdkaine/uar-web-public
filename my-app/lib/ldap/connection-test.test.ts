import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ClientInstance: {
    search: vi.fn(),
    bind: vi.fn(),
    unbind: vi.fn(),
  },
  getConfigValue: vi.fn(),
  getRequiredSecretValue: vi.fn(),
  sanitizeLdapError: vi.fn((error: unknown) => (error instanceof Error ? error.message : 'sanitized')),
}));

vi.mock('ldapts', () => ({
  Client: class {
    search = mocks.ClientInstance.search;
    bind = mocks.ClientInstance.bind;
    unbind = mocks.ClientInstance.unbind;
  },
}));

vi.mock('@/lib/config/resolver', () => ({
  getConfigValue: mocks.getConfigValue,
  getRequiredSecretValue: mocks.getRequiredSecretValue,
}));

vi.mock('@/lib/logger', () => ({
  appLogger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
  ldapLogger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { testDirectoryBindAccount, testDirectoryConnection } from './connection-test';

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.LDAP_ALLOW_INVALID_CERTS;
  delete process.env.LDAP_CA_CERT_BASE64;
  mocks.ClientInstance.unbind.mockResolvedValue(undefined);
});

describe('testDirectoryConnection', () => {
  it('rejects URLs that are not valid ldaps endpoints without connecting', async () => {
    const result = await testDirectoryConnection('ldap://insecure.example.test');

    expect(result.ok).toBe(false);
    expect(result.error).toContain('ldaps://');
    expect(mocks.ClientInstance.search).not.toHaveBeenCalled();
  });

  it('reads the rootDSE and reports server identity on success', async () => {
    mocks.ClientInstance.search.mockResolvedValue({
      searchEntries: [
        { dnsHostName: 'dc1.sdc.cpp', rootDomainNamingContext: 'DC=sdc,DC=cpp' },
      ],
    });

    const result = await testDirectoryConnection('ldaps://dc1.sdc.cpp:636');

    expect(result.ok).toBe(true);
    expect(result.tlsVerified).toBe(true);
    expect(result.dnsHostName).toBe('dc1.sdc.cpp');
    expect(result.namingContext).toBe('DC=sdc,DC=cpp');
    expect(typeof result.latencyMs).toBe('number');
    expect(mocks.ClientInstance.bind).not.toHaveBeenCalled();
    expect(mocks.ClientInstance.unbind).toHaveBeenCalled();
  });

  it('reports a sanitized error when the endpoint is unreachable', async () => {
    mocks.ClientInstance.search.mockRejectedValue(new Error('connect ECONNREFUSED'));

    const result = await testDirectoryConnection('ldaps://dc-down.sdc.cpp');

    expect(result.ok).toBe(false);
    expect(result.error).toContain('ECONNREFUSED');
    expect(mocks.ClientInstance.unbind).toHaveBeenCalled();
  });
});

describe('testDirectoryBindAccount', () => {
  it('fails fast when the bind account is not configured', async () => {
    mocks.getConfigValue.mockResolvedValue('');

    const result = await testDirectoryBindAccount({ url: 'ldaps://dc1.sdc.cpp' });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('not configured');
    expect(mocks.ClientInstance.bind).not.toHaveBeenCalled();
  });

  it('proves bind AND read access against the configured search base', async () => {
    mocks.getConfigValue.mockImplementation(async (key: string) => {
      if (key === 'ldap.url') return 'ldaps://primary.sdc.cpp';
      if (key === 'ldap.bindDn') return 'CN=uar-bind,OU=Service Accounts,DC=sdc,DC=cpp';
      if (key === 'ldap.searchBase') return 'OU=People,DC=sdc,DC=cpp';
      return '';
    });
    mocks.getRequiredSecretValue.mockResolvedValue('bind-secret');
    mocks.ClientInstance.bind.mockResolvedValue(undefined);
    mocks.ClientInstance.search.mockResolvedValue({ searchEntries: [{ dn: 'CN=x,OU=People,DC=sdc,DC=cpp' }] });

    const result = await testDirectoryBindAccount();

    expect(result.url).toBe('ldaps://primary.sdc.cpp');
    expect(result.bindOk).toBe(true);
    expect(result.searchOk).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.searchedBase).toBe('OU=People,DC=sdc,DC=cpp');
  });

  it('distinguishes a bind failure from a search failure', async () => {
    mocks.getConfigValue.mockImplementation(async (key: string) => {
      if (key === 'ldap.url') return 'ldaps://primary.sdc.cpp';
      if (key === 'ldap.bindDn') return 'CN=uar-bind,DC=sdc,DC=cpp';
      if (key === 'ldap.searchBase') return 'DC=sdc,DC=cpp';
      return '';
    });
    mocks.getRequiredSecretValue.mockResolvedValue('wrong-secret');
    mocks.ClientInstance.bind.mockRejectedValue(new Error('data 52e'));

    const bindFailure = await testDirectoryBindAccount({ url: 'ldaps://primary.sdc.cpp' });
    expect(bindFailure.bindOk).toBe(false);
    expect(bindFailure.error).toContain('52e');

    mocks.ClientInstance.bind.mockResolvedValue(undefined);
    mocks.ClientInstance.search.mockRejectedValue(new Error('No Such Object'));
    const searchFailure = await testDirectoryBindAccount({ url: 'ldaps://primary.sdc.cpp' });
    expect(searchFailure.bindOk).toBe(true);
    expect(searchFailure.searchOk).toBe(false);
  });

  it('reports partial success when the bind works but no search base is configured', async () => {
    mocks.getConfigValue.mockImplementation(async (key: string) => {
      if (key === 'ldap.url') return 'ldaps://primary.sdc.cpp';
      if (key === 'ldap.bindDn') return 'CN=uar-bind,DC=sdc,DC=cpp';
      if (key === 'ldap.searchBase') return '';
      return '';
    });
    mocks.getRequiredSecretValue.mockResolvedValue('bind-secret');
    mocks.ClientInstance.bind.mockResolvedValue(undefined);

    const result = await testDirectoryBindAccount();

    expect(result.ok).toBe(true);
    expect(result.bindOk).toBe(true);
    expect(result.searchOk).toBe(false);
    expect(result.error).toContain('searchBase');
  });
});
