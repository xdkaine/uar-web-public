import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assignmentFindMany: vi.fn(),
  groupFindMany: vi.fn(),
  snapshotFindMany: vi.fn(),
  searchLDAPUser: vi.fn(),
  isMemberOfAdminGroup: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    supportTicketAssignment: {
      findMany: mocks.assignmentFindMany,
    },
    allowedTicketSubjectGroup: {
      findMany: mocks.groupFindMany,
    },
    directoryGroupMemberSnapshot: {
      findMany: mocks.snapshotFindMany,
    },
  },
}));

vi.mock('@/lib/ldap/user-search', () => ({
  searchLDAPUser: mocks.searchLDAPUser,
}));

vi.mock('@/lib/ldap/admin-groups', () => ({
  isMemberOfAdminGroup: mocks.isMemberOfAdminGroup,
}));

vi.mock('@/lib/logger', () => ({
  ldapLogger: { warn: vi.fn() },
}));

import {
  resolveAssigneeAccess,
  getFreshAssigneeGroupDnsForUser,
  ASSIGNEE_SNAPSHOT_MAX_AGE_MS,
  excludeMemberGroups,
} from './assignee-access';

const GROUP_DN = 'CN=Ticket Team,OU=Groups,DC=cpp,DC=edu';
const OTHER_DN = 'CN=Other Team,OU=Groups,DC=cpp,DC=edu';

describe('excludeMemberGroups', () => {
  it('removes existing memberships case-insensitively from join choices', () => {
    const choices = [{ dn: GROUP_DN, name: 'Ticket Team' }, { dn: OTHER_DN, name: 'Other Team' }];

    expect(excludeMemberGroups(choices, [GROUP_DN.toLowerCase()])).toEqual([
      { dn: OTHER_DN, name: 'Other Team' },
    ]);
  });
});

function freshDate() {
  return new Date(Date.now() - 60 * 1000);
}

describe('resolveAssigneeAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assignmentFindMany.mockResolvedValue([]);
    mocks.groupFindMany.mockResolvedValue([]);
    mocks.snapshotFindMany.mockResolvedValue([]);
    mocks.searchLDAPUser.mockResolvedValue(null);
    mocks.isMemberOfAdminGroup.mockReturnValue(false);
  });

  it('denies when the ticket has no active assignments', async () => {
    const access = await resolveAssigneeAccess('ticket-1', 'alice');
    expect(access).toEqual({ isAssignee: false, via: [] });
    expect(mocks.snapshotFindMany).not.toHaveBeenCalled();
  });

  it('grants direct user assignments by exact username only', async () => {
    mocks.assignmentFindMany.mockResolvedValue([
      { targetType: 'user', targetUsername: 'alice', targetGroupDn: null },
    ]);

    const alice = await resolveAssigneeAccess('ticket-1', 'alice');
    const bob = await resolveAssigneeAccess('ticket-1', 'bob');

    expect(alice.isAssignee).toBe(true);
    expect(alice.via).toEqual(['alice']);
    expect(bob.isAssignee).toBe(false);
  });

  it('grants membership through a fresh snapshot', async () => {
    mocks.assignmentFindMany.mockResolvedValue([
      { targetType: 'directory_group', targetUsername: null, targetGroupDn: GROUP_DN },
    ]);
    mocks.groupFindMany.mockResolvedValue([{ dn: GROUP_DN, lastSyncedAt: freshDate() }]);
    mocks.snapshotFindMany.mockResolvedValue([
      { groupDn: GROUP_DN, accountEnabled: true },
    ]);

    const access = await resolveAssigneeAccess('ticket-1', 'alice');

    expect(access.isAssignee).toBe(true);
    expect(access.via).toEqual([GROUP_DN]);
    expect(mocks.searchLDAPUser).not.toHaveBeenCalled();
  });

  it('denies disabled accounts recorded in a fresh snapshot without live lookup', async () => {
    mocks.assignmentFindMany.mockResolvedValue([
      { targetType: 'directory_group', targetUsername: null, targetGroupDn: GROUP_DN },
    ]);
    mocks.groupFindMany.mockResolvedValue([{ dn: GROUP_DN, lastSyncedAt: freshDate() }]);
    mocks.snapshotFindMany.mockResolvedValue([
      { groupDn: GROUP_DN, accountEnabled: false },
    ]);

    const access = await resolveAssigneeAccess('ticket-1', 'alice');

    expect(access.isAssignee).toBe(false);
    expect(mocks.searchLDAPUser).not.toHaveBeenCalled();
  });

  it('falls back to live verification when the snapshot is stale and grants on match', async () => {
    const stale = new Date(Date.now() - ASSIGNEE_SNAPSHOT_MAX_AGE_MS - 60_000);
    mocks.assignmentFindMany.mockResolvedValue([
      { targetType: 'directory_group', targetUsername: null, targetGroupDn: GROUP_DN },
    ]);
    mocks.groupFindMany.mockResolvedValue([{ dn: GROUP_DN, lastSyncedAt: stale }]);
    mocks.snapshotFindMany.mockResolvedValue([
      { groupDn: GROUP_DN, accountEnabled: true },
    ]);
    mocks.searchLDAPUser.mockResolvedValue({
      attributes: [
        { type: 'memberOf', values: [GROUP_DN] },
        { type: 'userAccountControl', values: ['512'] },
      ],
    });
    mocks.isMemberOfAdminGroup.mockReturnValue(true);

    const access = await resolveAssigneeAccess('ticket-1', 'alice');

    expect(access.isAssignee).toBe(true);
    expect(access.via).toEqual([GROUP_DN]);
    expect(mocks.searchLDAPUser).toHaveBeenCalledWith('alice');
  });

  it('fails closed when stale live membership belongs to a disabled account', async () => {
    const stale = new Date(Date.now() - ASSIGNEE_SNAPSHOT_MAX_AGE_MS - 60_000);
    mocks.assignmentFindMany.mockResolvedValue([
      { targetType: 'directory_group', targetUsername: null, targetGroupDn: GROUP_DN },
    ]);
    mocks.groupFindMany.mockResolvedValue([{ dn: GROUP_DN, lastSyncedAt: stale }]);
    mocks.snapshotFindMany.mockResolvedValue([]);
    mocks.searchLDAPUser.mockResolvedValue({
      attributes: [
        { type: 'memberOf', values: [GROUP_DN] },
        { type: 'userAccountControl', values: ['514'] },
      ],
    });
    mocks.isMemberOfAdminGroup.mockReturnValue(true);

    await expect(resolveAssigneeAccess('ticket-1', 'alice')).resolves.toEqual({
      isAssignee: false,
      via: [],
    });
  });

  it('live-checks every stale assigned group even when no old member row exists', async () => {
    const stale = new Date(Date.now() - ASSIGNEE_SNAPSHOT_MAX_AGE_MS - 60_000);
    mocks.assignmentFindMany.mockResolvedValue([
      { targetType: 'directory_group', targetUsername: null, targetGroupDn: GROUP_DN },
    ]);
    mocks.groupFindMany.mockResolvedValue([{ dn: GROUP_DN, lastSyncedAt: stale }]);
    mocks.snapshotFindMany.mockResolvedValue([]);
    mocks.searchLDAPUser.mockResolvedValue({
      attributes: [
        { type: 'memberOf', values: [GROUP_DN] },
        { type: 'userAccountControl', values: ['512'] },
      ],
    });
    mocks.isMemberOfAdminGroup.mockReturnValue(true);

    await expect(resolveAssigneeAccess('ticket-1', 'alice')).resolves.toEqual({
      isAssignee: true,
      via: [GROUP_DN],
    });
  });

  it('fails closed for unknown account state in a fresh snapshot', async () => {
    mocks.assignmentFindMany.mockResolvedValue([
      { targetType: 'directory_group', targetUsername: null, targetGroupDn: GROUP_DN },
    ]);
    mocks.groupFindMany.mockResolvedValue([{ dn: GROUP_DN, lastSyncedAt: freshDate() }]);
    mocks.snapshotFindMany.mockResolvedValue([{ groupDn: GROUP_DN, accountEnabled: null }]);

    await expect(resolveAssigneeAccess('ticket-1', 'alice')).resolves.toEqual({
      isAssignee: false,
      via: [],
    });
  });

  it('fails closed when live verification errors for a stale snapshot', async () => {
    const stale = new Date(Date.now() - ASSIGNEE_SNAPSHOT_MAX_AGE_MS - 60_000);
    mocks.assignmentFindMany.mockResolvedValue([
      { targetType: 'directory_group', targetUsername: null, targetGroupDn: GROUP_DN },
    ]);
    mocks.groupFindMany.mockResolvedValue([{ dn: GROUP_DN, lastSyncedAt: stale }]);
    mocks.snapshotFindMany.mockResolvedValue([
      { groupDn: GROUP_DN, accountEnabled: true },
    ]);
    mocks.searchLDAPUser.mockRejectedValue(new Error('directory unreachable'));

    const access = await resolveAssigneeAccess('ticket-1', 'alice');

    expect(access.isAssignee).toBe(false);
  });

  it('does not consult LDAP when a fresh snapshot shows no membership', async () => {
    mocks.assignmentFindMany.mockResolvedValue([
      { targetType: 'directory_group', targetUsername: null, targetGroupDn: GROUP_DN },
    ]);
    mocks.groupFindMany.mockResolvedValue([{ dn: GROUP_DN, lastSyncedAt: freshDate() }]);
    mocks.snapshotFindMany.mockResolvedValue([]);

    const access = await resolveAssigneeAccess('ticket-1', 'alice');

    expect(access.isAssignee).toBe(false);
    expect(mocks.searchLDAPUser).not.toHaveBeenCalled();
  });

  it('grants when any of several groups matches freshly', async () => {
    mocks.assignmentFindMany.mockResolvedValue([
      { targetType: 'directory_group', targetUsername: null, targetGroupDn: GROUP_DN },
      { targetType: 'directory_group', targetUsername: null, targetGroupDn: OTHER_DN },
    ]);
    mocks.groupFindMany.mockResolvedValue([
      { dn: GROUP_DN, lastSyncedAt: freshDate() },
      { dn: OTHER_DN, lastSyncedAt: freshDate() },
    ]);
    mocks.snapshotFindMany.mockResolvedValue([
      { groupDn: OTHER_DN, accountEnabled: true },
    ]);

    const access = await resolveAssigneeAccess('ticket-1', 'alice');

    expect(access.isAssignee).toBe(true);
    expect(access.via).toEqual([OTHER_DN]);
  });
});

describe('getFreshAssigneeGroupDnsForUser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.snapshotFindMany.mockResolvedValue([]);
    mocks.groupFindMany.mockResolvedValue([]);
  });

  it('returns only active groups with fresh snapshots and enabled accounts', async () => {
    const stale = new Date(Date.now() - ASSIGNEE_SNAPSHOT_MAX_AGE_MS - 60_000);
    mocks.snapshotFindMany.mockResolvedValue([
      { groupDn: GROUP_DN, accountEnabled: true },
      { groupDn: OTHER_DN, accountEnabled: true },
      { groupDn: 'CN=Disabled,DC=cpp,DC=edu', accountEnabled: false },
    ]);
    mocks.groupFindMany.mockResolvedValue([
      { dn: GROUP_DN, lastSyncedAt: freshDate() },
      { dn: OTHER_DN, lastSyncedAt: stale },
    ]);

    const dns = await getFreshAssigneeGroupDnsForUser('alice');

    expect(dns).toEqual([GROUP_DN]);
  });

  it('returns empty quickly when the user appears in no snapshots', async () => {
    const dns = await getFreshAssigneeGroupDnsForUser('ghost');
    expect(dns).toEqual([]);
    expect(mocks.groupFindMany).not.toHaveBeenCalled();
  });
});
