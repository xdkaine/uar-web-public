import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const tx = {
    accountLifecycleAction: { create: vi.fn() },
    accountLifecycleHistory: { create: vi.fn() },
  };
  return {
    tx,
    checkAdminAuthWithRateLimit: vi.fn(),
    getLDAPGroupMembers: vi.fn(),
    getLDAPGroupAncestorDNs: vi.fn(),
    searchLDAPGroups: vi.fn(),
    searchLDAPUser: vi.fn(),
    searchLDAPUsers: vi.fn(),
    processLifecycleAction: vi.fn(),
    createLifecycleGroupAction: vi.fn(),
    privilegeFindMany: vi.fn(),
    getConfigValue: vi.fn(),
    cloneReadOnly: vi.fn(),
    logAuditAction: vi.fn(),
    transaction: vi.fn(),
  };
});

vi.mock('@/lib/adminAuth', () => ({
  checkAdminAuthWithRateLimit: mocks.checkAdminAuthWithRateLimit,
}));
vi.mock('@/lib/ldap', () => ({
  getLDAPGroupMembers: mocks.getLDAPGroupMembers,
  getLDAPGroupAncestorDNs: mocks.getLDAPGroupAncestorDNs,
  searchLDAPGroups: mocks.searchLDAPGroups,
  searchLDAPUser: mocks.searchLDAPUser,
  searchLDAPUsers: mocks.searchLDAPUsers,
}));
vi.mock('@/lib/lifecycle-processor', () => ({
  processLifecycleAction: mocks.processLifecycleAction,
}));
vi.mock('@/lib/lifecycle-group-action', () => ({
  createLifecycleGroupAction: mocks.createLifecycleGroupAction,
}));
vi.mock('@/lib/config/resolver', () => ({ getConfigValue: mocks.getConfigValue }));
vi.mock('@/lib/clone-safety', () => ({ isProductionCloneReadOnly: mocks.cloneReadOnly }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    privilegeAssignment: { findMany: mocks.privilegeFindMany },
    $transaction: mocks.transaction,
  },
}));
vi.mock('@/lib/audit-log', () => ({
  AuditActions: {
    ADD_GROUP_MEMBER: 'add_group_member',
    REMOVE_GROUP_MEMBER: 'remove_group_member',
  },
  AuditCategories: { GROUP: 'group' },
  getIpAddress: vi.fn(() => '127.0.0.1'),
  getUserAgent: vi.fn(() => 'vitest'),
  logAuditAction: mocks.logAuditAction,
}));

import { DELETE, GET, POST } from './route';

const params = { params: Promise.resolve({ groupName: 'Research%20Users' }) };

function request(method: 'GET' | 'POST' | 'DELETE', body?: Record<string, unknown>) {
  return new NextRequest('https://example.test/api/admin/groups/Research%20Users/members', {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify({ groupDn: 'CN=Research Users,OU=Groups,DC=example,DC=test', ...body }) : undefined,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkAdminAuthWithRateLimit.mockResolvedValue({
    admin: {
      username: 'operator1',
      permissions: new Set(['users.read', 'users.manage', 'lifecycle.manage']),
    },
    response: null,
  });
  mocks.searchLDAPGroups.mockResolvedValue([
    {
      name: 'Research Users',
      dn: 'CN=Research Users,OU=Groups,DC=example,DC=test',
      description: '',
      objectGuid: 'guid-research-users',
    },
  ]);
  mocks.searchLDAPUser.mockResolvedValue({
    objectName: 'CN=person1,OU=Users,DC=example,DC=test',
    attributes: [{ type: 'objectGUID', values: ['guid-person1'] }],
  });
  mocks.searchLDAPUsers.mockResolvedValue([]);
  mocks.getLDAPGroupMembers.mockResolvedValue([{ username: 'person1' }]);
  mocks.getLDAPGroupAncestorDNs.mockResolvedValue([]);
  mocks.getConfigValue.mockResolvedValue([]);
  mocks.privilegeFindMany.mockResolvedValue([]);
  mocks.cloneReadOnly.mockReturnValue(false);
  mocks.tx.accountLifecycleAction.create.mockResolvedValue({ id: 'action-1' });
  mocks.createLifecycleGroupAction.mockResolvedValue({
    action: { id: 'action-1', status: 'queued', errorMessage: null },
    replayed: false,
  });
  mocks.transaction.mockImplementation(async (callback: (tx: typeof mocks.tx) => Promise<unknown>) => callback(mocks.tx));
  mocks.processLifecycleAction.mockResolvedValue({ success: true, actionId: 'action-1', message: 'Completed' });
});

describe('group membership lifecycle route', () => {
  it('keeps member inventory readable without mutation permissions', async () => {
    mocks.checkAdminAuthWithRateLimit.mockResolvedValue({
      admin: { username: 'viewer', permissions: new Set(['users.read']) },
      response: null,
    });

    const response = await GET(request('GET'), params);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      members: [{ username: 'person1' }],
      mutation: { allowed: false, readOnly: false, protected: false },
    });
  });

  it('requires both user and lifecycle mutation permissions', async () => {
    mocks.checkAdminAuthWithRateLimit.mockResolvedValue({
      admin: { username: 'viewer', permissions: new Set(['users.read']) },
      response: null,
    });

    const response = await POST(request('POST', { username: 'person1', reason: 'Join research team', idempotencyKey: 'group-action-key-0001' }), params);

    expect(response.status).toBe(403);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('requires an operator reason before queueing a mutation', async () => {
    const response = await POST(request('POST', { username: 'person1' }), params);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: 'Reason is required' });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('queues and processes group changes as governed lifecycle operations', async () => {
    const response = await POST(request('POST', { username: 'person1', reason: 'Join research team', idempotencyKey: 'group-action-key-0001' }), params);

    expect(response.status).toBe(200);
    expect(mocks.createLifecycleGroupAction).toHaveBeenCalledWith(expect.objectContaining({
        actionType: 'add_group_member',
        username: 'person1',
        groupDn: 'CN=Research Users,OU=Groups,DC=example,DC=test',
        reason: 'Join research team',
        idempotencyKey: 'group-action-key-0001',
    }));
    expect(mocks.processLifecycleAction).toHaveBeenCalledWith('action-1');
    expect(mocks.logAuditAction).toHaveBeenCalledWith(expect.objectContaining({
      relatedLifecycleActionId: 'action-1',
      outcome: 'success',
    }));
  });

  it('records the canonical username returned by the exact directory identity lookup', async () => {
    mocks.searchLDAPUser.mockResolvedValue({
      objectName: 'CN=person1,OU=Users,DC=example,DC=test',
      attributes: [
        { type: 'objectGUID', values: ['guid-person1'] },
        { type: 'sAMAccountName', values: ['person1'] },
      ],
    });

    const response = await POST(request('POST', {
      username: 'Person One',
      reason: 'Join research team',
      idempotencyKey: 'group-action-key-name-0001',
    }), params);

    expect(response.status).toBe(200);
    expect(mocks.createLifecycleGroupAction).toHaveBeenCalledWith(expect.objectContaining({
      username: 'person1',
    }));
  });

  it('records the canonical username when removing a member by display name', async () => {
    mocks.searchLDAPUser.mockResolvedValue({
      objectName: 'CN=person1,OU=Users,DC=example,DC=test',
      attributes: [
        { type: 'objectGUID', values: ['guid-person1'] },
        { type: 'sAMAccountName', values: ['person1'] },
      ],
    });

    const response = await DELETE(request('DELETE', {
      username: 'Person One',
      reason: 'Remove research access',
      idempotencyKey: 'group-action-key-remove-name-0001',
    }), params);

    expect(response.status).toBe(200);
    expect(mocks.createLifecycleGroupAction).toHaveBeenCalledWith(expect.objectContaining({
      actionType: 'remove_from_group',
      username: 'person1',
    }));
    expect(mocks.logAuditAction).toHaveBeenCalledWith(expect.objectContaining({
      targetId: 'person1',
      details: expect.objectContaining({ requestedUser: 'Person One' }),
    }));
  });

  it('rejects a stale or mismatched selected group DN', async () => {
    const response = await POST(request('POST', {
      username: 'person1',
      groupDn: 'CN=Research Users,OU=Other,DC=example,DC=test',
      reason: 'Join research team',
      idempotencyKey: 'group-action-key-wrong-dn-0001',
    }), params);

    expect(response.status).toBe(409);
    expect(mocks.createLifecycleGroupAction).not.toHaveBeenCalled();
  });

  it('resumes a replayed action that was persisted but is still queued', async () => {
    mocks.createLifecycleGroupAction.mockResolvedValue({
      action: { id: 'action-queued', status: 'queued', errorMessage: null },
      replayed: true,
    });

    const response = await POST(request('POST', {
      username: 'person1',
      reason: 'Join research team',
      idempotencyKey: 'group-action-key-replay-0001',
    }), params);

    expect(response.status).toBe(200);
    expect(mocks.processLifecycleAction).toHaveBeenCalledWith('action-queued');
  });

  it('blocks privilege-bearing groups', async () => {
    mocks.privilegeFindMany.mockResolvedValue([
      { adGroupDns: ['CN=Research Users,OU=Groups,DC=example,DC=test'] },
    ]);

    const response = await DELETE(request('DELETE', { username: 'person1', reason: 'Remove access', idempotencyKey: 'group-action-key-0002' }), params);

    expect(response.status).toBe(409);
    expect(mocks.createLifecycleGroupAction).not.toHaveBeenCalled();
  });

  it('describes clone safety before the operator attempts a mutation', async () => {
    mocks.cloneReadOnly.mockReturnValue(true);

    const response = await GET(request('GET'), params);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      mutation: {
        allowed: false,
        readOnly: true,
        readOnlyReason: expect.stringContaining('production-clone'),
      },
    });
  });

  it('keeps clone containment and protected-group reasons distinct', async () => {
    mocks.cloneReadOnly.mockReturnValue(true);
    mocks.privilegeFindMany.mockResolvedValue([
      { adGroupDns: ['CN=Research Users,OU=Groups,DC=example,DC=test'] },
    ]);

    const response = await GET(request('GET'), params);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      mutation: {
        allowed: false,
        readOnly: true,
        protected: true,
        readOnlyReason: expect.stringContaining('production-clone'),
        protectionReason: expect.stringContaining('Administrative and privilege-bearing groups'),
      },
    });
  });

  it('does not expose raw directory errors from membership reads', async () => {
    mocks.getLDAPGroupMembers.mockRejectedValue(new Error('bind failed for CN=secret,DC=internal'));

    const response = await GET(request('GET'), params);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data).toEqual({ error: 'Failed to fetch group members' });
    expect(JSON.stringify(data)).not.toContain('CN=secret');
  });
});
