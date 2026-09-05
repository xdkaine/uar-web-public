import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  directorySyncRunCreate: vi.fn(),
  directorySyncRunUpdate: vi.fn(),
  directorySyncRunFindFirst: vi.fn(),
  directorySyncRunUpdateMany: vi.fn(),
  allowedGroupFindMany: vi.fn(),
  allowedGroupUpdate: vi.fn(),
  snapshotDeleteMany: vi.fn(),
  snapshotCreateMany: vi.fn(),
  transaction: vi.fn(),
  queryRaw: vi.fn(),
  leaseUpdateMany: vi.fn(),
  leaseDeleteMany: vi.fn(),
  getLDAPGroupMembers: vi.fn(),
  appLoggerError: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    directorySyncRun: {
      create: mocks.directorySyncRunCreate,
      update: mocks.directorySyncRunUpdate,
      findFirst: mocks.directorySyncRunFindFirst,
      updateMany: mocks.directorySyncRunUpdateMany,
    },
    allowedTicketSubjectGroup: {
      findMany: mocks.allowedGroupFindMany,
      update: mocks.allowedGroupUpdate,
    },
    directoryGroupMemberSnapshot: {
      deleteMany: mocks.snapshotDeleteMany,
      createMany: mocks.snapshotCreateMany,
    },
    $transaction: mocks.transaction,
    $queryRaw: mocks.queryRaw,
    operationalLease: {
      updateMany: mocks.leaseUpdateMany,
      deleteMany: mocks.leaseDeleteMany,
    },
  },
}));

vi.mock('@/lib/ldap', () => ({
  getLDAPGroupMembers: mocks.getLDAPGroupMembers,
}));

vi.mock('@/lib/logger', () => ({
  appLogger: {
    error: mocks.appLoggerError,
  },
}));

import { runDirectoryGroupSync } from './directory-sync';

function member(username: string, email: string | null) {
  return {
    dn: `CN=${username},DC=cpp,DC=edu`,
    username,
    displayName: username,
    email,
    accountEnabled: true,
    memberOf: [],
  };
}

describe('runDirectoryGroupSync', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.directorySyncRunCreate.mockResolvedValue({ id: 'run-1' });
    mocks.directorySyncRunUpdate.mockResolvedValue({});
    mocks.directorySyncRunFindFirst.mockResolvedValue(null);
    mocks.directorySyncRunUpdateMany.mockResolvedValue({ count: 0 });
    mocks.allowedGroupFindMany.mockResolvedValue([]);
    mocks.snapshotDeleteMany.mockResolvedValue({ count: 0 });
    mocks.snapshotCreateMany.mockResolvedValue({ count: 0 });
    mocks.allowedGroupUpdate.mockResolvedValue({});
    mocks.transaction.mockImplementation(async (operations) => operations);
    mocks.queryRaw.mockResolvedValue([{ owner: 'lease-owner' }]);
    mocks.leaseUpdateMany.mockResolvedValue({ count: 1 });
    mocks.leaseDeleteMany.mockResolvedValue({ count: 1 });
  });

  it('refuses to start while another run is active', async () => {
    mocks.directorySyncRunFindFirst.mockResolvedValue({
      id: 'run-0',
      status: 'running',
      startedAt: new Date(),
    });

    await expect(runDirectoryGroupSync({ triggeredBy: 'cron' })).rejects.toThrow(
      /already running/
    );
    expect(mocks.directorySyncRunCreate).not.toHaveBeenCalled();
    expect(mocks.leaseDeleteMany).toHaveBeenCalled();
  });

  it('uses the database lease to reject a concurrent start across app instances', async () => {
    let releaseMembers: ((members: ReturnType<typeof member>[]) => void) | undefined;
    mocks.allowedGroupFindMany.mockResolvedValue([{ dn: 'CN=A,DC=cpp,DC=edu', name: 'A' }]);
    mocks.getLDAPGroupMembers.mockImplementation(() => new Promise((resolve) => {
      releaseMembers = resolve;
    }));
    mocks.queryRaw
      .mockResolvedValueOnce([{ owner: 'first-owner' }])
      .mockResolvedValueOnce([]);

    const firstRun = runDirectoryGroupSync({ triggeredBy: 'scheduler' });
    await vi.waitFor(() => expect(mocks.getLDAPGroupMembers).toHaveBeenCalledTimes(1));

    await expect(runDirectoryGroupSync({ triggeredBy: 'admin-user' })).rejects.toThrow(
      /already running/
    );
    expect(mocks.directorySyncRunCreate).toHaveBeenCalledTimes(1);

    releaseMembers?.([]);
    await firstRun;
  });

  it('aborts before snapshot writes when ownership expires during one slow group read', async () => {
    vi.useFakeTimers();
    let releaseMembers: ((members: ReturnType<typeof member>[]) => void) | undefined;
    let markLdapStarted: (() => void) | undefined;
    const ldapStarted = new Promise<void>((resolve) => {
      markLdapStarted = resolve;
    });
    mocks.allowedGroupFindMany.mockResolvedValue([{ dn: 'CN=Large,DC=cpp,DC=edu', name: 'Large' }]);
    mocks.getLDAPGroupMembers.mockImplementation(() => {
      markLdapStarted?.();
      return new Promise((resolve) => {
        releaseMembers = resolve;
      });
    });
    mocks.leaseUpdateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    const run = runDirectoryGroupSync({ triggeredBy: 'scheduler' });
    await ldapStarted;
    await vi.advanceTimersByTimeAsync(4 * 60 * 1000);
    releaseMembers?.([member('alice', 'alice@cpp.edu')]);

    await expect(run).rejects.toThrow(/lease was lost/);
    expect(mocks.snapshotDeleteMany).not.toHaveBeenCalled();
    expect(mocks.snapshotCreateMany).not.toHaveBeenCalled();
  });

  it('marks abandoned stale runs failed before checking for active runs', async () => {
    await runDirectoryGroupSync({ triggeredBy: 'cron' });

    expect(mocks.directorySyncRunUpdateMany).toHaveBeenCalledWith({
      where: {
        status: 'running',
        startedAt: { lt: expect.any(Date) },
      },
      data: expect.objectContaining({ status: 'failed' }),
    });
  });

  it('records success and replaces snapshots for every active group', async () => {
    mocks.allowedGroupFindMany.mockResolvedValue([
      { dn: 'CN=A,DC=cpp,DC=edu', name: 'A' },
      { dn: 'CN=B,DC=cpp,DC=edu', name: 'B' },
    ]);
    mocks.getLDAPGroupMembers.mockImplementation(async (dn: string) =>
      dn.startsWith('CN=A')
        ? [member('alice', 'alice@cpp.edu'), member('bob', null)]
        : [member('carol', 'carol@cpp.edu')]
    );

    const outcome = await runDirectoryGroupSync({ triggeredBy: 'cron' });

    expect(outcome.status).toBe('success');
    expect(outcome.groupsProcessed).toBe(2);
    expect(outcome.membersCaptured).toBe(3);
    expect(outcome.errors).toEqual([]);
    expect(mocks.snapshotDeleteMany).toHaveBeenCalledTimes(2);
    expect(mocks.snapshotCreateMany).toHaveBeenCalledTimes(2);
    expect(mocks.allowedGroupUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { dn: 'CN=B,DC=cpp,DC=edu' },
        data: expect.objectContaining({ lastSyncStatus: 'success' }),
      })
    );
    // Null emails are stored as null, not dropped - the snapshot mirrors AD.
    const aCall = mocks.snapshotCreateMany.mock.calls.find(
      (call: unknown[]) =>
        (call[0] as { data: Array<{ groupDn: string }> }).data[0].groupDn.startsWith('CN=A')
    );
    expect((aCall?.[0] as { data: unknown[] }).data).toEqual(
      expect.arrayContaining([expect.objectContaining({ username: 'bob', email: null })])
    );
  });

  it('records partial failure per group and keeps prior snapshots for failed groups', async () => {
    mocks.allowedGroupFindMany.mockResolvedValue([
      { dn: 'CN=A,DC=cpp,DC=edu', name: 'A' },
      { dn: 'CN=BROKEN,DC=cpp,DC=edu', name: 'Broken' },
    ]);
    mocks.getLDAPGroupMembers.mockImplementation(async (dn: string) => {
      if (dn.includes('BROKEN')) throw new Error('LDAP timeout');
      return [member('alice', 'alice@cpp.edu')];
    });

    const outcome = await runDirectoryGroupSync({ triggeredBy: 'admin-user' });

    expect(outcome.status).toBe('partial_failure');
    expect(outcome.errors).toEqual([
      { groupDn: 'CN=BROKEN,DC=cpp,DC=edu', error: 'LDAP timeout' },
    ]);
    expect(mocks.allowedGroupUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { dn: 'CN=BROKEN,DC=cpp,DC=edu' },
        data: { lastSyncStatus: 'failed' },
      })
    );
    // No delete/create for the failed group.
    expect(mocks.snapshotDeleteMany).toHaveBeenCalledTimes(1);
    expect(mocks.snapshotCreateMany).toHaveBeenCalledTimes(1);
    expect(mocks.directorySyncRunUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'partial_failure',
          errors: { items: [{ groupDn: 'CN=BROKEN,DC=cpp,DC=edu', error: 'LDAP timeout' }] },
        }),
      })
    );
  });

  it('marks the run failed when every group fails', async () => {
    mocks.allowedGroupFindMany.mockResolvedValue([{ dn: 'CN=X,DC=cpp,DC=edu', name: 'X' }]);
    mocks.getLDAPGroupMembers.mockRejectedValue(new Error('bind denied'));

    const outcome = await runDirectoryGroupSync({ triggeredBy: 'cron' });

    expect(outcome.status).toBe('failed');
    expect(outcome.membersCaptured).toBe(0);
  });

  it('succeeds trivially when no active groups are configured', async () => {
    mocks.allowedGroupFindMany.mockResolvedValue([]);

    const outcome = await runDirectoryGroupSync({ triggeredBy: 'cron' });

    expect(outcome.status).toBe('success');
    expect(outcome.groupsProcessed).toBe(0);
    expect(mocks.getLDAPGroupMembers).not.toHaveBeenCalled();
  });
});
