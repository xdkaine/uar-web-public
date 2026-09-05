import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Attribute, BerReader, BerWriter, SearchEntry, type SearchOptions } from 'ldapts';

const mocks = vi.hoisted(() => {
  const client = {
    bind: vi.fn(),
    add: vi.fn(),
    modify: vi.fn(),
    del: vi.fn(),
    search: vi.fn(),
    unbind: vi.fn(),
  };

  return {
    client,
    createLDAPClient: vi.fn(() => client),
    searchLDAPUser: vi.fn(),
    getLDAPDefaultNamingContext: vi.fn(),
  };
});

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

vi.mock('../config/resolver', () => ({
  getConfigValue: async (key: string) => ({
    'ldap.url': 'ldaps://ldap.example.test',
    'ldap.searchBase': 'OU=Users,DC=example,DC=test',
    'ldap.groupSearchBase': '',
    'ldap.bindDn': 'CN=bind,DC=example,DC=test',
    'ldap.domain': 'example.test',
    'ldap.adminGroups': [],
    'ldap.kaminoInternalGroup': 'CN=Internal,OU=Groups,DC=example,DC=test',
    'ldap.kaminoExternalGroup': 'CN=External,OU=Groups,DC=example,DC=test',
    'ldap.group2Add': 'CN=Default,OU=Groups,DC=example,DC=test',
  }[key]),
  getRequiredSecretValue: async (key: string) =>
    key === 'ldap.bindPassword' ? 'secret' : Promise.reject(new Error(`unexpected secret ${key}`)),
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
  getLDAPDefaultNamingContext: mocks.getLDAPDefaultNamingContext,
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

import { createLDAPUser, deleteConfirmedDisabledLDAPUser, disableConfirmedLDAPUser, disableLDAPUser, enableConfirmedLDAPUser, enableLDAPUser } from './user-crud';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.client.search.mockReset();
  mocks.client.del.mockReset();
  mocks.client.bind.mockResolvedValue(undefined);
  mocks.client.add.mockResolvedValue(undefined);
  mocks.client.modify.mockResolvedValue(undefined);
  mocks.client.del.mockResolvedValue(undefined);
  mocks.client.search.mockResolvedValue({ searchEntries: [] });
  mocks.client.unbind.mockResolvedValue(undefined);
  mocks.getLDAPDefaultNamingContext.mockResolvedValue('DC=example,DC=test');
  mocks.searchLDAPUser.mockResolvedValue({
    objectName: 'CN=fixture,OU=Users,DC=example,DC=test',
    attributes: [{ type: 'userAccountControl', values: ['66050'] }],
  });
});

describe('confirmed disabled LDAP deletion', () => {
  const sid = (...subAuthorities: number[]) => {
    const bytes = Buffer.alloc(8 + (subAuthorities.length * 4));
    bytes[0] = 1;
    bytes[1] = subAuthorities.length;
    bytes[7] = 5;
    subAuthorities.forEach((value, index) => bytes.writeUInt32LE(value, 8 + (index * 4)));
    return bytes;
  };
  const objectGuidBytes = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
  const objectGuid = objectGuidBytes.toString('base64');
  const identity = { dn: 'CN=fixture,OU=Users,DC=example,DC=test', objectGuid };
  const guidTarget = '<GUID=33221100-5544-7766-8899-aabbccddeeff>';
  const reviewedEntry = { dn: identity.dn, sAMAccountName: 'fixture', userAccountControl: '514', objectGUID: objectGuidBytes };

  it('uses the immutable GUID without unsupported critical controls on Active Directory', async () => {
    mocks.client.search.mockResolvedValueOnce({ searchEntries: [reviewedEntry] })
      .mockResolvedValueOnce({ searchEntries: [reviewedEntry] });
    mocks.client.del.mockImplementationOnce(async (_target, control) => {
      if (control) throw Object.assign(new Error('UnavailableCriticalExtension'), { code: 12 });
    });
    await expect(deleteConfirmedDisabledLDAPUser('fixture', identity, vi.fn(), vi.fn()))
      .resolves.toMatchObject({ objectGuid });
    expect(mocks.client.del).toHaveBeenCalledWith(guidTarget);
  });

  it('preserves valid-UTF8 binary GUIDs in both same-connection reads', async () => {
    const guid = Buffer.from('0123456789abcdef');
    const writer = new BerWriter();
    new Attribute({ type: 'objectGUID', values: [guid] }).write(writer);
    const parsed = new Attribute();
    parsed.parse(new BerReader(writer.buffer));
    const entry = new SearchEntry({ messageId: 1, name: identity.dn, attributes: [parsed] });
    expect(typeof entry.toObject(['objectGUID'], []).objectGUID).toBe('string');
    const read = async (_base: string, options: SearchOptions) => ({ searchEntries: [{
      ...entry.toObject(options.attributes ?? [], options.explicitBufferAttributes ?? []),
      sAMAccountName: 'fixture',
      userAccountControl: '514',
    }] });
    mocks.client.search.mockImplementationOnce(read).mockImplementationOnce(read);
    await expect(deleteConfirmedDisabledLDAPUser('fixture', { ...identity, objectGuid: guid.toString('base64') }, vi.fn(), vi.fn()))
      .resolves.toMatchObject({ objectGuid: guid.toString('base64') });
    expect(mocks.client.del).toHaveBeenCalledWith('<GUID=33323130-3534-3736-3839-616263646566>');
  });

  it('preserves binary SIDs that ldapts otherwise decodes as UTF-8 during deletion checks', async () => {
    const wireEntry = (dn: string, values: Record<string, string | Buffer>) => {
      const attributes = Object.entries(values).map(([type, value]) => {
        const writer = new BerWriter();
        new Attribute({ type, values: [value] as string[] | Buffer[] }).write(writer);
        const parsed = new Attribute();
        parsed.parse(new BerReader(writer.buffer));
        return parsed;
      });
      return new SearchEntry({ messageId: 1, name: dn, attributes });
    };
    const userSid = sid(21, 11, 22, 33, 1104);
    const administratorSid = sid(32, 544);
    const administratorDn = 'CN=Renamed Admins,CN=Builtin,DC=example,DC=test';
    const administratorEntry = wireEntry(administratorDn, { objectSid: administratorSid });
    // Reproduce the real library behavior, rather than mocking all SIDs as Buffers.
    expect(typeof administratorEntry.toObject(['objectSid'], []).objectSid).toBe('string');
    const userEntry = wireEntry(identity.dn, { objectSid: userSid });
    mocks.client.search
      .mockImplementationOnce(async (_base: string, options: SearchOptions) => ({
        searchEntries: [{
          ...userEntry.toObject(options.attributes ?? [], options.explicitBufferAttributes ?? []),
          sAMAccountName: 'fixture',
          userAccountControl: '514',
          objectGUID: objectGuidBytes,
        }],
      }))
      .mockImplementationOnce(async (_base: string, options: SearchOptions) => {
        const entries = [
          wireEntry('CN=Domain Admins,CN=Users,DC=example,DC=test', { objectSid: sid(21, 11, 22, 33, 512) }),
          administratorEntry,
        ];
        return {
          searchEntries: entries.map((entry) => entry.toObject(options.attributes ?? [], options.explicitBufferAttributes ?? [])),
        };
      })
      .mockResolvedValueOnce({ searchEntries: [reviewedEntry] });

    const onDeleteStart = vi.fn();
    await expect(deleteConfirmedDisabledLDAPUser('fixture', identity, onDeleteStart, vi.fn().mockResolvedValue({
      protectedGroupDns: [],
      protectedPrimaryGroupRids: ['544', '512'],
    }))).resolves.toMatchObject({ username: 'fixture' });
    const groupSearch = mocks.client.search.mock.calls[1];
    expect(groupSearch[0]).toBe('DC=example,DC=test');
    expect(String(groupSearch[1].filter)).toContain('objectSid=\\01\\05');
    const assertion = String(mocks.client.search.mock.calls[2][1].filter);
    expect(assertion).toContain(`memberOf:1.2.840.113556.1.4.1941:=${administratorDn}`);
    expect(assertion).toContain('(!(primaryGroupID=544))');
    expect(onDeleteStart).toHaveBeenCalledOnce();
  });

  it('deletes only after same-connection identity and disabled-state checks and proves GUID absence', async () => {
    mocks.client.search
      .mockResolvedValueOnce({
        searchEntries: [{
          dn: identity.dn,
          sAMAccountName: 'fixture',
          userAccountControl: '514',
          objectGUID: objectGuidBytes,
          objectSid: sid(21, 111, 222, 333, 1104),
        }],
      })
      .mockResolvedValueOnce({ searchEntries: [reviewedEntry] })
      .mockResolvedValueOnce({ searchEntries: [] });
    const onDeleteStart = vi.fn();
    const assertPreDeleteAllowed = vi.fn().mockResolvedValue(undefined);

    await expect(deleteConfirmedDisabledLDAPUser('fixture', identity, onDeleteStart, assertPreDeleteAllowed)).resolves.toMatchObject({
      dn: identity.dn,
      objectGuid,
      username: 'fixture',
      userAccountControl: 514,
    });

    expect(onDeleteStart).toHaveBeenCalledTimes(1);
    expect(assertPreDeleteAllowed).toHaveBeenCalledWith(expect.objectContaining({ objectName: identity.dn }));
    expect(mocks.client.del).toHaveBeenCalledWith(guidTarget);
    expect(mocks.client.search).toHaveBeenNthCalledWith(1, identity.dn, expect.objectContaining({ scope: 'base' }));
    expect(mocks.client.search).toHaveBeenNthCalledWith(2, guidTarget, expect.objectContaining({ scope: 'base' }));
    expect(mocks.client.search).toHaveBeenNthCalledWith(3, 'DC=example,DC=test', expect.objectContaining({
      filter: expect.stringContaining('(objectGUID='),
      scope: 'sub',
    }));
  });

  it('awaits the durable boundary checkpoint before calling LDAP delete', async () => {
    let releaseCheckpoint!: () => void;
    let checkpointStarted!: () => void;
    const checkpointEntered = new Promise<void>((resolve) => { checkpointStarted = resolve; });
    const checkpointPending = new Promise<void>((resolve) => { releaseCheckpoint = resolve; });
    mocks.client.search
      .mockResolvedValueOnce({ searchEntries: [reviewedEntry] })
      .mockResolvedValueOnce({
        searchEntries: [{
          dn: identity.dn,
          sAMAccountName: 'fixture',
          userAccountControl: '514',
          objectGUID: objectGuidBytes,
        }],
      })
      .mockResolvedValueOnce({ searchEntries: [] });
    const onDeleteStart = vi.fn(async () => {
      checkpointStarted();
      await checkpointPending;
    });

    const deletion = deleteConfirmedDisabledLDAPUser(
      'fixture',
      identity,
      onDeleteStart,
      vi.fn().mockResolvedValue(undefined)
    );
    await checkpointEntered;

    expect(mocks.client.del).not.toHaveBeenCalled();

    releaseCheckpoint();
    await expect(deletion).resolves.toMatchObject({ objectGuid, username: 'fixture' });
    expect(mocks.client.del).toHaveBeenCalledTimes(1);
  });

  it('blocks an enabled account before the irreversible call', async () => {
    mocks.client.search.mockResolvedValueOnce({
      searchEntries: [{
        dn: identity.dn,
        sAMAccountName: 'fixture',
        userAccountControl: '512',
        objectGUID: objectGuidBytes,
      }],
    });
    const onDeleteStart = vi.fn();

    await expect(deleteConfirmedDisabledLDAPUser('fixture', identity, onDeleteStart, vi.fn().mockResolvedValue(undefined)))
      .rejects.toThrow('is enabled');
    expect(onDeleteStart).not.toHaveBeenCalled();
    expect(mocks.client.del).not.toHaveBeenCalled();
  });

  it('treats an absent pre-delete object as reconciliation instead of idempotent success', async () => {
    mocks.client.search.mockResolvedValueOnce({ searchEntries: [] });
    const onDeleteStart = vi.fn();

    await expect(deleteConfirmedDisabledLDAPUser('fixture', identity, onDeleteStart, vi.fn().mockResolvedValue(undefined)))
      .rejects.toThrow('was absent before deletion');
    expect(onDeleteStart).not.toHaveBeenCalled();
    expect(mocks.client.del).not.toHaveBeenCalled();
  });

  it('fails closed when deletion readback still finds the captured GUID', async () => {
    mocks.client.search
      .mockResolvedValueOnce({
        searchEntries: [{
          dn: identity.dn,
          sAMAccountName: 'fixture',
          userAccountControl: '514',
          objectGUID: objectGuidBytes,
        }],
      })
      .mockResolvedValueOnce({ searchEntries: [reviewedEntry] })
      .mockResolvedValueOnce({ searchEntries: [{ objectGUID: objectGuidBytes }] });

    await expect(deleteConfirmedDisabledLDAPUser('fixture', identity, vi.fn(), vi.fn().mockResolvedValue(undefined)))
      .rejects.toThrow('still finds the deleted object GUID');
    expect(mocks.client.del).toHaveBeenCalledTimes(1);
  });

  it('rechecks protected-account policy on the bound pre-delete entry', async () => {
    mocks.client.search.mockResolvedValueOnce({
      searchEntries: [{
        dn: identity.dn,
        sAMAccountName: 'fixture',
        userAccountControl: '514',
        objectGUID: objectGuidBytes,
        adminCount: '1',
      }],
    });
    const assertPreDeleteAllowed = vi.fn().mockRejectedValue(new Error('protected account'));

    await expect(deleteConfirmedDisabledLDAPUser('fixture', identity, vi.fn(), assertPreDeleteAllowed))
      .rejects.toThrow('protected account');
    expect(mocks.client.del).not.toHaveBeenCalled();
  });

  it('blocks before deletion when the final protected-account filter no longer matches', async () => {
    mocks.client.search
      .mockResolvedValueOnce({
        searchEntries: [{
          dn: identity.dn,
          sAMAccountName: 'fixture',
          userAccountControl: '514',
          objectGUID: objectGuidBytes,
        }],
      })
      .mockResolvedValueOnce({
        searchEntries: [
          {
            dn: 'CN=Domain Admins,CN=Users,DC=example,DC=test',
            objectSid: sid(21, 111, 222, 333, 512),
            adminCount: '1',
          },
          {
            dn: 'CN=Renamed Tier Zero,CN=Builtin,DC=example,DC=test',
            objectSid: sid(32, 544),
            adminCount: '0',
          },
        ],
      });
    mocks.client.search.mockImplementationOnce(async (_dn, options) => {
      const assertion = String(options.filter);
      expect(assertion).toContain('(!(adminCount=1))');
      expect(assertion).toContain('(!(primaryGroupID=512))');
      expect(assertion).toContain('(!(isCriticalSystemObject=TRUE))');
      expect(assertion).toContain('memberOf:1.2.840.113556.1.4.1941:=CN=Privilege,OU=Groups,DC=example,DC=test');
      expect(assertion).toContain('memberOf:1.2.840.113556.1.4.1941:=CN=Renamed Tier Zero,CN=Builtin,DC=example,DC=test');
      return { searchEntries: [] };
    });
    const onDeleteStart = vi.fn();
    await expect(deleteConfirmedDisabledLDAPUser(
      'fixture',
      identity,
      onDeleteStart,
      vi.fn().mockResolvedValue({
        protectedGroupDns: ['CN=Privilege,OU=Groups,DC=example,DC=test'],
        protectedPrimaryGroupRids: ['512', '544'],
      })
    )).rejects.toThrow('failed final disabled-account protection checks');
    expect(onDeleteStart).not.toHaveBeenCalled();
    expect(mocks.client.del).not.toHaveBeenCalled();
  });

  it.each([
    { dn: 'CN=replacement,OU=Users,DC=example,DC=test' },
    { sAMAccountName: 'replacement' },
    { objectGUID: Buffer.alloc(16, 1) },
    { userAccountControl: '512' },
  ])('rejects final directory identity or state drift: %j', async (changed) => {
    mocks.client.search.mockResolvedValueOnce({ searchEntries: [reviewedEntry] })
      .mockResolvedValueOnce({ searchEntries: [{ ...reviewedEntry, ...changed }] });
    const onDeleteStart = vi.fn();
    await expect(deleteConfirmedDisabledLDAPUser('fixture', identity, onDeleteStart, vi.fn()))
      .rejects.toThrow('failed final disabled-account protection checks');
    expect(onDeleteStart).not.toHaveBeenCalled();
    expect(mocks.client.del).not.toHaveBeenCalled();
  });

  it('never falls back to a reused DN after the final read', async () => {
    mocks.client.search.mockResolvedValueOnce({ searchEntries: [reviewedEntry] })
      .mockResolvedValueOnce({ searchEntries: [reviewedEntry] });
    const directory = new Map([[identity.dn, objectGuid], [guidTarget, objectGuid]]);
    mocks.client.del.mockImplementationOnce(async (target) => {
      expect(directory.get(target)).toBe(objectGuid);
      directory.delete(target);
    });
    await deleteConfirmedDisabledLDAPUser('fixture', identity, () => {
      directory.set(identity.dn, 'replacement-guid');
    }, vi.fn());
    expect(directory.get(identity.dn)).toBe('replacement-guid');
    expect(mocks.client.del).toHaveBeenCalledWith(guidTarget);
  });

  it('blocks malformed GUID evidence before the irreversible boundary', async () => {
    const malformedGuid = Buffer.from('short').toString('base64');
    mocks.client.search.mockResolvedValueOnce({ searchEntries: [{ ...reviewedEntry, objectGUID: Buffer.from('short') }] });
    const onDeleteStart = vi.fn();
    await expect(deleteConfirmedDisabledLDAPUser('fixture', { ...identity, objectGuid: malformedGuid }, onDeleteStart, vi.fn()))
      .rejects.toThrow('not valid binary GUID evidence');
    expect(onDeleteStart).not.toHaveBeenCalled();
    expect(mocks.client.del).not.toHaveBeenCalled();
  });

  it('fails closed when a protected group RID resolves ambiguously', async () => {
    mocks.client.search
      .mockResolvedValueOnce({
        searchEntries: [{
          dn: identity.dn,
          sAMAccountName: 'fixture',
          userAccountControl: '514',
          objectGUID: objectGuidBytes,
          objectSid: sid(21, 111, 222, 333, 1104),
        }],
      })
      .mockResolvedValueOnce({
        searchEntries: [
          { dn: 'CN=Protected A,CN=Users,DC=example,DC=test', objectSid: sid(21, 111, 222, 333, 526) },
          { dn: 'CN=Protected B,CN=Users,DC=example,DC=test', objectSid: sid(21, 444, 555, 666, 526) },
        ],
      });

    await expect(deleteConfirmedDisabledLDAPUser(
      'fixture',
      identity,
      vi.fn(),
      vi.fn().mockResolvedValue({
        protectedGroupDns: [],
        protectedPrimaryGroupRids: ['526'],
      })
    )).rejects.toThrow('ambiguous protected group identity for RID 526');
    expect(mocks.client.del).not.toHaveBeenCalled();
  });

  it('fails closed when a mandatory protected group RID is not visible', async () => {
    mocks.client.search
      .mockResolvedValueOnce({
        searchEntries: [{
          dn: identity.dn,
          sAMAccountName: 'fixture',
          userAccountControl: '514',
          objectGUID: objectGuidBytes,
          objectSid: sid(21, 111, 222, 333, 1104),
        }],
      })
      .mockResolvedValueOnce({ searchEntries: [] });

    await expect(deleteConfirmedDisabledLDAPUser(
      'fixture',
      identity,
      vi.fn(),
      vi.fn().mockResolvedValue({
        protectedGroupDns: [],
        protectedPrimaryGroupRids: ['544'],
      })
    )).rejects.toThrow('Mandatory protected group RID 544 did not resolve exactly once');
    expect(mocks.client.del).not.toHaveBeenCalled();
  });
});

describe('LDAP user account-control policy', () => {
  it('enables an account while preserving unrelated account-control flags', async () => {
    await enableLDAPUser('fixture');

    const [, change] = mocks.client.modify.mock.calls[0];
    const userAccountControl = Number(change.modification.values[0]);

    expect(change.modification.type).toBe('userAccountControl');
    expect(userAccountControl).toBe(66048);
    expect(userAccountControl & 0x10000).toBe(0x10000);
    expect(userAccountControl & 0x2).toBe(0);
  });

  it('disables an account while preserving unrelated account-control flags', async () => {
    mocks.searchLDAPUser.mockResolvedValue({
      objectName: 'CN=fixture,OU=Users,DC=example,DC=test',
      attributes: [{ type: 'userAccountControl', values: ['66048'] }],
    });

    await disableLDAPUser('fixture');

    const [, change] = mocks.client.modify.mock.calls[0];
    const userAccountControl = Number(change.modification.values[0]);
    expect(userAccountControl).toBe(66050);
    expect(userAccountControl & 0x10000).toBe(0x10000);
    expect(userAccountControl & 0x2).toBe(0x2);
  });

  it('targets a governed disable by the reviewed AD object GUID without an unsupported assertion control', async () => {
    const objectGuid = 'MyIRAFVEd2aImaq7zN3u/w==';
    mocks.searchLDAPUser.mockResolvedValue({
      objectName: 'CN=fixture,OU=Users,DC=example,DC=test',
      attributes: [
        { type: 'sAMAccountName', values: ['fixture'] },
        { type: 'objectGUID', values: [objectGuid] },
        { type: 'userAccountControl', values: ['66048'] },
      ],
    });

    await disableConfirmedLDAPUser('fixture', {
      dn: 'CN=fixture,OU=Users,DC=example,DC=test',
      objectGuid,
    });

    expect(mocks.client.modify).toHaveBeenCalledTimes(1);
    const [dn, change, control] = mocks.client.modify.mock.calls[0];
    expect(dn).toBe('<GUID=00112233-4455-6677-8899-aabbccddeeff>');
    expect(change.modification.values[0]).toBe('66050');
    expect(control).toBeUndefined();
  });

  it('targets a governed enable by the reviewed AD object GUID', async () => {
    const objectGuid = 'MyIRAFVEd2aImaq7zN3u/w==';
    mocks.searchLDAPUser.mockResolvedValue({
      objectName: 'CN=fixture,OU=Users,DC=example,DC=test',
      attributes: [
        { type: 'sAMAccountName', values: ['fixture'] },
        { type: 'objectGUID', values: [objectGuid] },
        { type: 'userAccountControl', values: ['66050'] },
      ],
    });

    await enableConfirmedLDAPUser('fixture', {
      dn: 'CN=fixture,OU=Users,DC=example,DC=test',
      objectGuid,
    });

    const [dn, change] = mocks.client.modify.mock.calls[0];
    expect(dn).toBe('<GUID=00112233-4455-6677-8899-aabbccddeeff>');
    expect(change.modification.values[0]).toBe('66048');
  });

  it('blocks a governed enable when the username and DN were reused by another GUID', async () => {
    mocks.searchLDAPUser.mockResolvedValue({
      objectName: 'CN=fixture,OU=Users,DC=example,DC=test',
      attributes: [
        { type: 'sAMAccountName', values: ['fixture'] },
        { type: 'objectGUID', values: ['EREiIjMzRERVVWZmd3eIiA=='] },
        { type: 'userAccountControl', values: ['514'] },
      ],
    });

    await expect(enableConfirmedLDAPUser('fixture', {
      dn: 'CN=fixture,OU=Users,DC=example,DC=test',
      objectGuid: 'MyIRAFVEd2aImaq7zN3u/w==',
    })).rejects.toThrow('no longer matches the reviewed directory object');
    expect(mocks.client.modify).not.toHaveBeenCalled();
  });

  it('blocks a governed disable when the captured object GUID is not 16 bytes', async () => {
    const malformedObjectGuid = 'Z3VpZA==';
    mocks.searchLDAPUser.mockResolvedValue({
      objectName: 'CN=fixture,OU=Users,DC=example,DC=test',
      attributes: [
        { type: 'sAMAccountName', values: ['fixture'] },
        { type: 'objectGUID', values: [malformedObjectGuid] },
        { type: 'userAccountControl', values: ['66048'] },
      ],
    });

    await expect(disableConfirmedLDAPUser('fixture', {
      dn: 'CN=fixture,OU=Users,DC=example,DC=test',
      objectGuid: malformedObjectGuid,
    })).rejects.toThrow('not valid binary GUID evidence');
    expect(mocks.client.modify).not.toHaveBeenCalled();
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
    expect(mocks.client.modify.mock.calls.map(([, change]) => change.modification.type))
      .not.toContain('extensionAttribute15');
  });
});
