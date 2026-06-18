import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const client = {
    bind: vi.fn(),
    add: vi.fn(),
    modify: vi.fn(),
    del: vi.fn(),
    unbind: vi.fn(),
  };

  return {
    client,
    createLDAPClient: vi.fn(() => client),
    searchLDAPUser: vi.fn(),
  };
});

vi.mock('ldapts', () => ({
  Attribute: class Attribute {
    type: string;
    values: string[];

    constructor(input: { type: string; values: string[] }) {
      this.type = input.type;
      this.values = input.values;
    }
  },
  Change: class Change {
    operation: string;
    modification: { type: string; values: string[] };

    constructor(input: {
      operation: string;
      modification: { type: string; values: string[] };
    }) {
      this.operation = input.operation;
      this.modification = input.modification;
    }
  },
}));

vi.mock('../env-validator', () => ({
  getRequiredEnv: (name: string) => ({
    LDAP_BIND_DN: 'CN=bind,DC=example,DC=test',
    LDAP_BIND_PASSWORD: 'secret',
    LDAP_SEARCH_BASE: 'OU=Users,DC=example,DC=test',
    LDAP_DOMAIN: 'example.test',
    LDAP_GROUP2ADD: 'CN=Default,OU=Groups,DC=example,DC=test',
    LDAP_KAMINO_INTERNAL_GROUP: 'CN=Internal,OU=Groups,DC=example,DC=test',
    LDAP_KAMINO_EXTERNAL_GROUP: 'CN=External,OU=Groups,DC=example,DC=test',
  })[name],
}));

vi.mock('../logger', () => ({
  ldapLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('./client', () => ({
  createLDAPClient: mocks.createLDAPClient,
}));

vi.mock('./user-search', () => ({
  searchLDAPUser: mocks.searchLDAPUser,
}));

vi.mock('./utils', () => ({
  withTimeout: <T>(operation: Promise<T>) => operation,
  sanitizeLdapError: (error: unknown) => error,
  escapeLDAPDN: (value: string) => value,
  formatRequestDescription: (requestId?: string) => `UAR | Request ID: ${requestId || 'UNKNOWN'}`,
  descriptionMatchesRequestTag: () => true,
  LDAP_TIMEOUT: 100,
  parseLDAPDate: (value: string) => value,
}));

import { createLDAPUser, enableLDAPUser } from './user-crud';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.client.bind.mockResolvedValue(undefined);
  mocks.client.add.mockResolvedValue(undefined);
  mocks.client.modify.mockResolvedValue(undefined);
  mocks.client.del.mockResolvedValue(undefined);
  mocks.client.unbind.mockResolvedValue(undefined);
  mocks.searchLDAPUser.mockResolvedValue({
    objectName: 'CN=fixture,OU=Users,DC=example,DC=test',
    attributes: [],
  });
});

describe('LDAP user account-control policy', () => {
  it('enables an account without the password-never-expires flag', async () => {
    await enableLDAPUser('fixture');

    const [, change] = mocks.client.modify.mock.calls[0];
    const userAccountControl = Number(change.modification.values[0]);

    expect(change.modification.type).toBe('userAccountControl');
    expect(userAccountControl).toBe(512);
    expect(userAccountControl & 0x10000).toBe(0);
  });

  it('creates a new account in the disabled state', async () => {
    await createLDAPUser(
      'fixture',
      'fixture@example.test',
      'Fixture User',
      false,
      'request-1'
    );

    const [, entry] = mocks.client.add.mock.calls[0];
    expect(entry.userAccountControl).toBe('514');
  });
});
