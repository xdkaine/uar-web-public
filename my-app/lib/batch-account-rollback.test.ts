import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  searchLDAPUser: vi.fn(),
  deleteLDAPUser: vi.fn(),
}));

vi.mock('@/lib/ldap', () => mocks);

import { rollbackBatchAccounts } from './batch-account-rollback';

function ldapUser(description = 'UAR | Request ID: batch-1', userAccountControl = '514') {
  return {
    objectName: 'CN=alice,OU=Users,DC=example,DC=test',
    attributes: [
      { type: 'description', values: [description] },
      { type: 'userAccountControl', values: [userAccountControl] },
      { type: 'objectGUID', values: ['guid-alice'] },
    ],
  };
}

describe('rollbackBatchAccounts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.deleteLDAPUser.mockResolvedValue(true);
  });

  it('deletes only a disabled account with the exact batch ownership tag', async () => {
    mocks.searchLDAPUser.mockResolvedValue(ldapUser());

    const result = await rollbackBatchAccounts(['alice'], 'batch-1');

    expect(mocks.deleteLDAPUser).toHaveBeenCalledWith('alice', 'batch-1', false);
    expect(result.items).toEqual([{ username: 'alice', outcome: 'deleted', resolved: true }]);
  });

  it('uses captured DN and object GUID instead of LDAP metadata for tracked batch items', async () => {
    mocks.searchLDAPUser.mockResolvedValue(ldapUser('unrelated operational description'));

    const result = await rollbackBatchAccounts([{
      username: 'alice',
      accessRequestId: 'request-1',
      targetDirectoryDn: 'CN=alice,OU=Users,DC=example,DC=test',
      targetDirectoryObjectGuid: 'guid-alice',
    }], 'batch-1');

    expect(mocks.deleteLDAPUser).toHaveBeenCalledWith(
      'alice',
      'request-1',
      false,
      {
        dn: 'CN=alice,OU=Users,DC=example,DC=test',
        objectGuid: 'guid-alice',
      }
    );
    expect(result.successful).toEqual(['alice']);
  });

  it('blocks rollback when immutable directory identity has changed', async () => {
    mocks.searchLDAPUser.mockResolvedValue(ldapUser());

    const result = await rollbackBatchAccounts([{
      username: 'alice',
      accessRequestId: 'request-1',
      targetDirectoryDn: 'CN=alice,OU=Users,DC=example,DC=test',
      targetDirectoryObjectGuid: 'replacement-guid',
    }], 'batch-1');

    expect(mocks.deleteLDAPUser).not.toHaveBeenCalled();
    expect(result.failed[0]).toMatchObject({
      username: 'alice',
      outcome: 'ownership_mismatch',
    });
  });

  it.each([
    ['ownership_mismatch', ldapUser('UAR | Request ID: another-batch'), 'Legacy account does not have the exact batch creation correlation'],
    ['ownership_mismatch', ldapUser('UAR | Request ID: batch-1 trailing-data'), 'Legacy account does not have the exact batch creation correlation'],
    ['account_enabled', ldapUser('UAR | Request ID: batch-1', '512'), 'Account is enabled and requires manual reconciliation'],
    ['account_state_unknown', ldapUser('UAR | Request ID: batch-1', ''), 'Account enabled state is missing or invalid'],
    ['account_state_unknown', ldapUser('UAR | Request ID: batch-1', 'invalid'), 'Account enabled state is missing or invalid'],
  ])('does not mutate an account when the outcome is %s', async (outcome, user, error) => {
    mocks.searchLDAPUser.mockResolvedValue(user);

    const result = await rollbackBatchAccounts(['alice'], 'batch-1');

    expect(mocks.deleteLDAPUser).not.toHaveBeenCalled();
    expect(result.failed).toEqual([{ username: 'alice', outcome, error }]);
  });

  it('leaves directory lookup failures unresolved without mutation', async () => {
    mocks.searchLDAPUser.mockRejectedValue(new Error('directory unavailable'));

    const result = await rollbackBatchAccounts(['alice'], 'batch-1');

    expect(mocks.deleteLDAPUser).not.toHaveBeenCalled();
    expect(result.failed[0]).toMatchObject({ username: 'alice', outcome: 'lookup_failed' });
  });

  it('does not convert a deletion failure into disable or expiration mutations', async () => {
    mocks.searchLDAPUser.mockResolvedValue(ldapUser());
    mocks.deleteLDAPUser.mockRejectedValue(new Error('delete failed'));

    const result = await rollbackBatchAccounts(['alice'], 'batch-1');

    expect(result.failed[0]).toMatchObject({ username: 'alice', outcome: 'delete_failed' });
  });

  it('treats an already absent account as resolved', async () => {
    mocks.searchLDAPUser.mockResolvedValue(null);

    const result = await rollbackBatchAccounts(['alice'], 'batch-1');

    expect(result.successful).toEqual(['alice']);
    expect(result.items[0].outcome).toBe('already_absent');
  });
});
