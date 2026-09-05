import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  checkSupportAuth: vi.fn(),
  isGroupJoinWorkflowAvailable: vi.fn(),
  snapshotFindMany: vi.fn(),
  groupFindMany: vi.fn(),
}));

vi.mock('@/lib/support-auth', () => ({ checkSupportAuth: mocks.checkSupportAuth }));
vi.mock('@/lib/support/group-join-workflow', () => ({
  isGroupJoinWorkflowAvailable: mocks.isGroupJoinWorkflowAvailable,
}));
vi.mock('@/lib/support/assignee-access', () => ({
  getSnapshotMemberGroupDnsForUser: (...args: unknown[]) =>
    mocks.snapshotFindMany(...args),
  excludeMemberGroups: <T extends { dn: string }>(groups: T[], dns: string[]) => {
    const memberships = new Set(dns.map((dn) => dn.toLowerCase()));
    return groups.filter((group) => !memberships.has(group.dn.toLowerCase()));
  },
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    allowedTicketSubjectGroup: { findMany: mocks.groupFindMany },
  },
}));

import { GET } from './route';

const GROUP_A = { dn: 'CN=Analysts,OU=Groups,DC=sdc,DC=cpp', name: 'Analysts' };
const GROUP_B = { dn: 'CN=Helpdesk,OU=Groups,DC=sdc,DC=cpp', name: 'Helpdesk' };

const GROUP_A_ENRICHED = {
  ...GROUP_A,
  containerName: 'Analysts',
  displayName: 'Analysts',
  path: ['sdc.cpp', 'Groups'],
};
const GROUP_B_ENRICHED = {
  ...GROUP_B,
  containerName: 'Helpdesk',
  displayName: 'Helpdesk',
  path: ['sdc.cpp', 'Groups'],
};

function supportContext(username: string) {
  return {
    auth: { username, isAdmin: false },
    response: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkSupportAuth.mockResolvedValue(supportContext('jdoe'));
  mocks.isGroupJoinWorkflowAvailable.mockResolvedValue(true);
});

describe('GET /api/support/tickets/allowed-groups', () => {
  it('returns only groups where the requester appears in membership snapshots', async () => {
    mocks.snapshotFindMany.mockResolvedValue([
      GROUP_A.dn,
      'CN=Disabled,OU=Groups,DC=sdc,DC=cpp',
    ]);
    mocks.groupFindMany.mockImplementation(async ({ where }) => {
      if (where.canBeRequestedFor) return [GROUP_A, GROUP_B];
      return [GROUP_B];
    });

    const response = await GET();
    const payload = await response.json();

    expect(payload.groups).toEqual([GROUP_A_ENRICHED]);
    expect(payload.joinableGroups).toEqual([GROUP_B_ENRICHED]);
    expect(payload.groupJoinWorkflowAvailable).toBe(true);
  });

  it('keeps joinable groups when the requester is not already a member', async () => {
    mocks.snapshotFindMany.mockResolvedValue([]);
    mocks.groupFindMany.mockImplementation(async ({ where }) => {
      if (where.canBeRequestedFor) return [GROUP_A];
      return [GROUP_B];
    });

    const response = await GET();
    const payload = await response.json();

    expect(payload.groups).toEqual([]);
    expect(payload.joinableGroups).toEqual([GROUP_B_ENRICHED]);
  });

  it('matches snapshot DNs case-insensitively', async () => {
    mocks.snapshotFindMany.mockResolvedValue([GROUP_A.dn.toUpperCase()]);
    mocks.groupFindMany.mockImplementation(async ({ where }) => {
      if (where.canBeRequestedFor) return [GROUP_A];
      return [];
    });

    const response = await GET();
    const payload = await response.json();

    expect(payload.groups).toEqual([GROUP_A_ENRICHED]);
  });
});
