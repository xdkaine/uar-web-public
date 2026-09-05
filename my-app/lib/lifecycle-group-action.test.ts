import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const tx = {
    accountLifecycleAction: { findUnique: vi.fn(), create: vi.fn() },
    accountLifecycleHistory: { create: vi.fn() },
    flowArtifact: { findFirst: vi.fn(), create: vi.fn() },
  };
  return {
    tx,
    actionFindUnique: vi.fn(),
    transaction: vi.fn(),
    getLDAPGroupIdentity: vi.fn(),
    searchLDAPUser: vi.fn(),
    assertLifecycleGroupNotProtected: vi.fn(),
  };
});

vi.mock('@/lib/prisma', () => ({
  prisma: {
    accountLifecycleAction: { findUnique: mocks.actionFindUnique },
    $transaction: mocks.transaction,
  },
}));
vi.mock('@/lib/ldap', () => ({
  getLDAPGroupIdentity: mocks.getLDAPGroupIdentity,
  searchLDAPUser: mocks.searchLDAPUser,
}));
vi.mock('@/lib/lifecycle-protection', () => ({
  assertLifecycleGroupNotProtected: mocks.assertLifecycleGroupNotProtected,
}));

import { createLifecycleGroupAction, createLifecycleGroupActions } from './lifecycle-group-action';

function input(groupDn = 'CN=Research,OU=Groups,DC=example,DC=test') {
  return {
    actionType: 'add_group_member' as const,
    username: 'person1',
    groupDn,
    groupName: 'Research',
    reason: 'Approved access',
    requestedBy: 'operator1',
    relatedTicketId: 'ticket-1',
    idempotencyKey: `group-action:${groupDn}`,
    flowArtifact: { runId: 'run-1', nodeId: 'node-1' },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.actionFindUnique.mockResolvedValue(null);
  mocks.tx.accountLifecycleAction.findUnique.mockResolvedValue(null);
  mocks.tx.accountLifecycleAction.create.mockImplementation(async ({ data }) => ({
    id: `action-${String(data.targetGroupDn).split(',')[0]}`,
    ...data,
    errorMessage: null,
  }));
  mocks.tx.flowArtifact.findFirst.mockResolvedValue(null);
  mocks.transaction.mockImplementation(async (callback) => callback(mocks.tx));
  mocks.getLDAPGroupIdentity.mockImplementation(async (groupDn: string) => ({
    dn: groupDn,
    objectGuid: `guid-${groupDn}`,
  }));
  mocks.searchLDAPUser.mockResolvedValue({
    objectName: 'CN=person1,OU=Users,DC=example,DC=test',
    attributes: [{ type: 'objectGUID', values: ['guid-person1'] }],
  });
  mocks.assertLifecycleGroupNotProtected.mockResolvedValue(undefined);
});

describe('lifecycle group action authoring', () => {
  it('binds immutable identities and creates action, history, and artifact atomically', async () => {
    const result = await createLifecycleGroupAction(input());

    expect(result.replayed).toBe(false);
    expect(mocks.tx.accountLifecycleAction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        targetDirectoryDn: 'CN=person1,OU=Users,DC=example,DC=test',
        targetDirectoryObjectGuid: 'guid-person1',
        targetGroupObjectGuid: 'guid-CN=Research,OU=Groups,DC=example,DC=test',
      }),
    });
    expect(mocks.tx.accountLifecycleHistory.create).toHaveBeenCalledTimes(1);
    expect(mocks.tx.flowArtifact.create).toHaveBeenCalledTimes(1);
  });

  it('prepares every target before opening the transaction so a second-target policy failure writes nothing', async () => {
    const blockedDn = 'CN=Blocked,OU=Groups,DC=example,DC=test';
    mocks.assertLifecycleGroupNotProtected.mockImplementation(async (groupDn: string) => {
      if (groupDn === blockedDn) throw new Error('protected group');
    });

    await expect(createLifecycleGroupActions([input(), input(blockedDn)]))
      .rejects.toThrow('protected group');

    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.tx.accountLifecycleAction.create).not.toHaveBeenCalled();
    expect(mocks.tx.flowArtifact.create).not.toHaveBeenCalled();
  });

  it('rejects an idempotency replay owned by different intent', async () => {
    mocks.actionFindUnique.mockResolvedValue({
      actionType: 'add_group_member',
      targetUsername: 'someone-else',
      targetGroupDn: input().groupDn,
      reason: 'Different reason',
      requestedBy: 'operator2',
      relatedTicketId: 'ticket-2',
    });

    await expect(createLifecycleGroupAction(input()))
      .rejects.toThrow('Idempotency key is already bound');
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
