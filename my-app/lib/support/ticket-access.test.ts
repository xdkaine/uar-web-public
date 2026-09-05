import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  snapshotFindFirst: vi.fn(),
  groupFindUnique: vi.fn(),
  searchLDAPUser: vi.fn(),
  isMemberOfAdminGroup: vi.fn(),
  resolveAssigneeAccess: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    allowedTicketSubjectGroup: {
      findUnique: mocks.groupFindUnique,
    },
    directoryGroupMemberSnapshot: {
      findFirst: mocks.snapshotFindFirst,
    },
  },
}));

vi.mock('@/lib/ldap/user-search', () => ({
  searchLDAPUser: mocks.searchLDAPUser,
}));

vi.mock('@/lib/ldap/admin-groups', () => ({
  isMemberOfAdminGroup: mocks.isMemberOfAdminGroup,
}));

vi.mock('@/lib/support/assignee-access', () => ({
  resolveAssigneeAccess: mocks.resolveAssigneeAccess,
  ASSIGNEE_SNAPSHOT_MAX_AGE_MS: 24 * 60 * 60 * 1000,
}));

import {
  resolveTicketMutationAccess,
  resolveTicketViewAccess,
} from './ticket-access';

const TICKET = {
  id: 'ticket-1',
  username: 'creator',
  requestedForGroupDn: 'CN=Team,DC=test',
};

function fresh() {
  return new Date(Date.now() - 60 * 1000);
}

function stale() {
  return new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
}

describe('resolveTicketViewAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.snapshotFindFirst.mockResolvedValue(null);
    mocks.groupFindUnique.mockResolvedValue({ dn: TICKET.requestedForGroupDn, lastSyncedAt: fresh() });
    mocks.searchLDAPUser.mockResolvedValue(null);
    mocks.isMemberOfAdminGroup.mockReturnValue(false);
    mocks.resolveAssigneeAccess.mockResolvedValue({ isAssignee: false, via: [] });
  });

  it('grants owner and admin before any directory work', async () => {
    expect(await resolveTicketViewAccess(TICKET, { username: 'creator', isAdmin: false })).toBe('owner');
    expect(await resolveTicketViewAccess(TICKET, { username: 'someone', isAdmin: true })).toBe('admin');
    expect(mocks.snapshotFindFirst).not.toHaveBeenCalled();
  });

  it('keeps internal automation tickets admin-only', async () => {
    const internalTicket = { ...TICKET, internalOnly: true };

    expect(
      await resolveTicketViewAccess(internalTicket, { username: 'creator', isAdmin: false })
    ).toBeNull();
    expect(
      await resolveTicketViewAccess(internalTicket, { username: 'someone', isAdmin: true })
    ).toBe('admin');
    expect(mocks.snapshotFindFirst).not.toHaveBeenCalled();
    expect(mocks.resolveAssigneeAccess).not.toHaveBeenCalled();
  });

  it('grants group_member from a fresh requested-for snapshot', async () => {
    mocks.snapshotFindFirst.mockResolvedValue({ accountEnabled: true });
    const access = await resolveTicketViewAccess(TICKET, { username: 'member', isAdmin: false });
    expect(access).toBe('group_member');
    expect(mocks.searchLDAPUser).not.toHaveBeenCalled();
  });

  it('falls back to a live check when the snapshot is stale and fails closed on errors', async () => {
    mocks.groupFindUnique.mockResolvedValue({ dn: TICKET.requestedForGroupDn, lastSyncedAt: stale() });
    mocks.isMemberOfAdminGroup.mockReturnValue(true);

    mocks.searchLDAPUser.mockResolvedValue({
      objectName: 'dn',
      attributes: [
        { type: 'memberOf', values: ['CN=Team,DC=test'] },
        { type: 'userAccountControl', values: ['512'] },
      ],
    });
    expect(await resolveTicketViewAccess(TICKET, { username: 'member', isAdmin: false })).toBe(
      'group_member'
    );

    mocks.searchLDAPUser.mockRejectedValue(new Error('dc down'));
    expect(await resolveTicketViewAccess(TICKET, { username: 'member', isAdmin: false })).toBeNull();
  });

  it('fails closed when a stale requested-for member is disabled in AD', async () => {
    mocks.groupFindUnique.mockResolvedValue({ dn: TICKET.requestedForGroupDn, lastSyncedAt: stale() });
    mocks.snapshotFindFirst.mockResolvedValue({ accountEnabled: true });
    mocks.searchLDAPUser.mockResolvedValue({
      objectName: 'dn',
      attributes: [
        { type: 'memberOf', values: ['CN=Team,DC=test'] },
        { type: 'userAccountControl', values: ['514'] },
      ],
    });
    mocks.isMemberOfAdminGroup.mockReturnValue(true);

    await expect(
      resolveTicketViewAccess(TICKET, { username: 'member', isAdmin: false })
    ).resolves.toBeNull();
  });

  it('denies disabled accounts even with a fresh snapshot', async () => {
    mocks.snapshotFindFirst.mockResolvedValue({ accountEnabled: false });
    const access = await resolveTicketViewAccess(TICKET, { username: 'member', isAdmin: false });
    expect(access).toBeNull();
  });

  it('grants assignees without any requested-for membership', async () => {
    const noGroupTicket = { ...TICKET, requestedForGroupDn: null };
    mocks.resolveAssigneeAccess.mockResolvedValue({ isAssignee: true, via: ['CN=X'] });
    expect(await resolveTicketViewAccess(noGroupTicket, { username: 'member', isAdmin: false })).toBe(
      'assignee'
    );
  });
});

describe('resolveTicketMutationAccess', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      mocks.resolveAssigneeAccess.mockResolvedValue({ isAssignee: false, via: [] });
      mocks.snapshotFindFirst.mockResolvedValue(null);
      mocks.groupFindUnique.mockResolvedValue({ dn: TICKET.requestedForGroupDn, lastSyncedAt: fresh() });
    });

  it('never grants requested-for group members mutation rights', async () => {
    mocks.snapshotFindFirst.mockResolvedValue({ accountEnabled: true });
    const access = await resolveTicketMutationAccess(TICKET, { username: 'member', isAdmin: false });
    expect(access).toBeNull();
  });

  it('still grants owner, admin, and assignees', async () => {
    expect(await resolveTicketMutationAccess(TICKET, { username: 'creator', isAdmin: false })).toBe('owner');
    expect(await resolveTicketMutationAccess(TICKET, { username: 'x', isAdmin: true })).toBe('admin');
    mocks.resolveAssigneeAccess.mockResolvedValue({ isAssignee: true, via: ['CN=X'] });
    expect(await resolveTicketMutationAccess(TICKET, { username: 'assignee', isAdmin: false })).toBe(
      'assignee'
    );
  });

  it('keeps internal automation tickets immutable outside the admin role', async () => {
    const internalTicket = { ...TICKET, internalOnly: true };

    expect(
      await resolveTicketMutationAccess(internalTicket, { username: 'creator', isAdmin: false })
    ).toBeNull();
    expect(
      await resolveTicketMutationAccess(internalTicket, { username: 'x', isAdmin: true })
    ).toBe('admin');
    expect(mocks.resolveAssigneeAccess).not.toHaveBeenCalled();
  });
});
