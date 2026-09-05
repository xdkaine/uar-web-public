import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Attribute, BerReader, BerWriter, SearchEntry, type SearchOptions } from 'ldapts';

const mocks = vi.hoisted(() => {
  const environment: Record<string, string> = {
    LDAP_URL: 'ldaps://ldap.example.test',
    LDAP_BIND_DN: 'CN=bind,DC=example,DC=test',
    LDAP_BIND_PASSWORD: 'secret',
    LDAP_SEARCH_BASE: 'OU=Users,DC=example,DC=test',
    LDAP_ADMIN_GROUPS: 'CN=Domain Admins,CN=Users,DC=example,DC=test',
  };
  const client = {
    bind: vi.fn(),
    search: vi.fn(),
    unbind: vi.fn(),
  };

  return {
    environment,
    client,
    createLDAPClient: vi.fn(() => client),
    ldapError: vi.fn(),
  };
});

vi.mock('../env-validator', () => ({
  getRequiredEnv: (name: string) => mocks.environment[name],
}));

vi.mock('../config/resolver', () => ({
  // Mirror ADR-0005 environment-fallback behavior against the fixture env:
  // JSON arrays parse as lists; anything else is a single value.
  getConfigValue: async (key: string) => {
    if (key === 'ldap.adminGroups') {
      const raw = mocks.environment.LDAP_ADMIN_GROUPS || '';
      if (!raw) return [];
      return raw.trim().startsWith('[')
        ? (JSON.parse(raw) as string[])
        : [raw.trim()];
    }
    const mapped = key
      .replace('ldap.', 'LDAP_')
      .replace('searchBase', 'SEARCH_BASE')
      .toUpperCase();
    return mocks.environment[mapped];
  },
  getRequiredSecretValue: async (key: string) => {
    if (key === 'ldap.bindPassword') {
      return mocks.environment.LDAP_BIND_PASSWORD;
    }
    throw new Error('unexpected secret key in test: ' + key);
  },
}));

vi.mock('../logger', () => ({
  ldapLogger: {
    error: mocks.ldapError,
  },
}));

vi.mock('./client', () => ({
  createLDAPClient: mocks.createLDAPClient,
}));

vi.mock('./utils', () => ({
  withTimeout: <T>(operation: Promise<T>) => operation,
  sanitizeLdapError: (error: unknown) => error,
  escapeLDAPFilter: (value: string) => value,
  escapeLDAPDN: (value: string) => value,
  LDAP_TIMEOUT: 100,
  parseLDAPDate: (value: string) => value,
}));

import { isUserDomainAdmin, listUsersInOU, searchLDAPUser, searchLDAPUserByObjectGuid, searchLDAPUsers } from './user-search';

describe('binary GUID identity capture', () => {
  it('preserves immutable binary GUID evidence in directory inventory', async () => {
    const guid = Buffer.from('0123456789abcdef');
    mocks.client.search.mockResolvedValue({ searchEntries: [{ dn: 'CN=fixture', sAMAccountName: 'fixture', objectGUID: guid }] });
    const [user] = await listUsersInOU();
    expect(user.objectGuid).toBe(guid.toString('base64'));
    expect(mocks.client.search).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ explicitBufferAttributes: ['objectGUID'] }));
  });
  it.each(['username', 'guid'])('preserves valid-UTF8 GUID bytes in the %s lookup', async (lookup) => {
    vi.clearAllMocks();
    const guid = Buffer.from('0123456789abcdef');
    const writer = new BerWriter();
    new Attribute({ type: 'objectGUID', values: [guid] }).write(writer);
    const attribute = new Attribute();
    attribute.parse(new BerReader(writer.buffer));
    const entry = new SearchEntry({ messageId: 1, name: 'CN=fixture,DC=example,DC=test', attributes: [attribute] });
    expect(typeof entry.toObject(['objectGUID'], []).objectGUID).toBe('string');
    mocks.client.search.mockImplementation(async (base: string, options: SearchOptions) => {
      if (base === '') return { searchEntries: [{ defaultNamingContext: 'DC=example,DC=test' }] };
      expect(options.explicitBufferAttributes).toContain('objectGUID');
      return { searchEntries: [entry.toObject(options.attributes ?? [], options.explicitBufferAttributes ?? [])] };
    });
    const result = lookup === 'username' ? await searchLDAPUser('fixture') : await searchLDAPUserByObjectGuid(guid.toString('base64'));
    expect(result?.attributes).toContainEqual({ type: 'objectGUID', values: [guid.toString('base64')] });
  });
});

function returnMemberships(memberOf: string[]) {
  mocks.client.search.mockResolvedValue({
    searchEntries: [
      {
        dn: 'CN=Fixture User,OU=Users,DC=example,DC=test',
        sAMAccountName: 'fixture.user',
        memberOf,
        userAccountControl: '512',
      },
    ],
  });
}

describe('isUserDomainAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.environment.LDAP_ADMIN_GROUPS =
      'CN=Domain Admins,CN=Users,DC=example,DC=test';
    mocks.client.bind.mockResolvedValue(undefined);
    mocks.client.unbind.mockResolvedValue(undefined);
  });

  it('does not grant access to a group sharing only parent DN components', async () => {
    returnMemberships([
      'CN=Faculty,CN=Users,DC=example,DC=test',
    ]);

    await expect(isUserDomainAdmin('fixture.user')).resolves.toBe(false);
  });

  it('does not grant access to a similarly named group', async () => {
    returnMemberships([
      'CN=Domain Admins Backup,CN=Users,DC=example,DC=test',
    ]);

    await expect(isUserDomainAdmin('fixture.user')).resolves.toBe(false);
  });

  it('grants access for an exact DN across LDAP case differences', async () => {
    returnMemberships([
      'cn=domain admins,cn=users,dc=EXAMPLE,dc=TEST',
    ]);

    await expect(isUserDomainAdmin('fixture.user')).resolves.toBe(true);
  });

  it('supports multiple complete admin DNs in JSON configuration', async () => {
    mocks.environment.LDAP_ADMIN_GROUPS = JSON.stringify([
      'CN=Portal Administrators,OU=Groups,DC=example,DC=test',
      'CN=Domain Admins,CN=Users,DC=example,DC=test',
    ]);
    returnMemberships([
      'CN=Portal Administrators,OU=Groups,DC=example,DC=test',
    ]);

    await expect(isUserDomainAdmin('fixture.user')).resolves.toBe(true);
  });

  it('fails closed when the directory account is disabled', async () => {
    returnMemberships(['CN=Domain Admins,CN=Users,DC=example,DC=test']);
    mocks.client.search.mockResolvedValueOnce({
      searchEntries: [{
        dn: 'CN=Fixture User,OU=Users,DC=example,DC=test',
        sAMAccountName: 'fixture.user',
        memberOf: ['CN=Domain Admins,CN=Users,DC=example,DC=test'],
        userAccountControl: '514',
      }],
    });

    await expect(isUserDomainAdmin('fixture.user')).resolves.toBe(false);
  });

  it('fails closed when the administrator group configuration is ambiguous', async () => {
    mocks.environment.LDAP_ADMIN_GROUPS =
      'CN=Domain Admins,CN=Administrators,CN=Schema Admins';
    returnMemberships([
      'CN=Domain Admins,OU=Groups,DC=example,DC=test',
    ]);

    await expect(isUserDomainAdmin('fixture.user')).resolves.toBe(false);
    expect(mocks.ldapError).toHaveBeenCalled();
  });
});

describe('searchLDAPUsers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.client.bind.mockResolvedValue(undefined);
    mocks.client.unbind.mockResolvedValue(undefined);
  });

  it('searches by name or username and returns only enabled canonical accounts', async () => {
    mocks.client.search.mockResolvedValue({
      searchEntries: [
        {
          dn: 'CN=Alex Chen,OU=Users,DC=example,DC=test',
          sAMAccountName: 'alex.chen',
          displayName: 'Alex Chen',
          userAccountControl: '512',
        },
        {
          dn: 'CN=Alex Disabled,OU=Users,DC=example,DC=test',
          sAMAccountName: 'alex.disabled',
          displayName: 'Alex Disabled',
          userAccountControl: '514',
        },
      ],
    });

    await expect(searchLDAPUsers('alex', 6)).resolves.toEqual([
      { username: 'alex.chen', displayName: 'Alex Chen' },
    ]);
    expect(mocks.client.search).toHaveBeenCalledWith(
      'OU=Users,DC=example,DC=test',
      expect.objectContaining({
        filter: expect.stringContaining('(displayName=alex*)'),
        sizeLimit: 12,
      })
    );
  });

  it('does not query the directory for a search shorter than three characters', async () => {
    await expect(searchLDAPUsers('al', 6)).resolves.toEqual([]);
    expect(mocks.client.bind).not.toHaveBeenCalled();
    expect(mocks.client.search).not.toHaveBeenCalled();
  });
});

describe('searchLDAPUserByObjectGuid', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.client.bind.mockResolvedValue(undefined);
    mocks.client.unbind.mockResolvedValue(undefined);
  });

  it('uses the RootDSE domain naming context instead of the configured user OU', async () => {
    const guid = Buffer.from('directory-object-1').toString('base64');
    mocks.client.search
      .mockResolvedValueOnce({ searchEntries: [{ defaultNamingContext: 'DC=example,DC=test' }] })
      .mockResolvedValueOnce({ searchEntries: [] });

    await expect(searchLDAPUserByObjectGuid(guid)).resolves.toBeNull();

    expect(mocks.client.search).toHaveBeenNthCalledWith(1, '', expect.objectContaining({
      scope: 'base',
      attributes: ['defaultNamingContext'],
    }));
    expect(mocks.client.search).toHaveBeenNthCalledWith(2, 'DC=example,DC=test', expect.objectContaining({
      scope: 'sub',
      filter: expect.stringContaining('(objectGUID='),
    }));
  });
});
