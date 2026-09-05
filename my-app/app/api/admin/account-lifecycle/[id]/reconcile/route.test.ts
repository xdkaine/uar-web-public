import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const tx = {
    $queryRaw: vi.fn(),
    accountLifecycleAction: { findUnique: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() },
    accountLifecycleHistory: { create: vi.fn() },
    accessRequest: { findUnique: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    batchAccountItem: { findUnique: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    vPNAccount: { findUnique: vi.fn() },
    vPNAccountStatusLog: { findFirst: vi.fn() },
    vPNAccountActivityLog: { findFirst: vi.fn() },
    auditLog: { findFirst: vi.fn() },
    session: { count: vi.fn() },
    providerLogoutTask: { findMany: vi.fn() },
    aDAccountActivityLog: { findFirst: vi.fn(), create: vi.fn() },
    requestComment: { findFirst: vi.fn(), create: vi.fn() },
    accountLifecycleBatch: { findUnique: vi.fn(), update: vi.fn() },
  };
  return {
    tx,
    checkAdminAuthWithRateLimit: vi.fn(),
    actionFindUnique: vi.fn(),
    sessionCount: vi.fn(),
    providerTaskFindMany: vi.fn(),
    accessRequestFindUnique: vi.fn(),
    transaction: vi.fn(),
    searchLDAPUserByObjectGuid: vi.fn(),
    assertLifecycleAccountNotProtected: vi.fn(),
    logAuditAction: vi.fn(),
    appLoggerError: vi.fn(),
  };
});

vi.mock('@/lib/adminAuth', () => ({
  checkAdminAuthWithRateLimit: mocks.checkAdminAuthWithRateLimit,
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    accountLifecycleAction: { findUnique: mocks.actionFindUnique },
    session: { count: mocks.sessionCount },
    providerLogoutTask: { findMany: mocks.providerTaskFindMany },
    accessRequest: { findUnique: mocks.accessRequestFindUnique },
    $transaction: mocks.transaction,
  },
}));
vi.mock('@/lib/ldap', () => ({
  searchLDAPUserByObjectGuid: mocks.searchLDAPUserByObjectGuid,
}));
vi.mock('@/lib/lifecycle-protection', () => ({
  assertLifecycleAccountNotProtected: mocks.assertLifecycleAccountNotProtected,
}));
vi.mock('@/lib/audit-log', () => ({
  AuditActions: { DELETE_VPN_ACCOUNT: 'delete_vpn_account' },
  AuditCategories: { LIFECYCLE: 'lifecycle' },
  getIpAddress: vi.fn(() => '127.0.0.1'),
  getUserAgent: vi.fn(() => 'vitest'),
  logAuditAction: mocks.logAuditAction,
}));
vi.mock('@/lib/logger', () => ({
  appLogger: { error: mocks.appLoggerError },
}));

import { POST } from './route';

function deletionAction() {
  return {
    id: 'action-delete-1',
    status: 'reconciliation_required',
    actionType: 'delete_ad',
    operationMode: 'governed',
    targetAccountType: 'AD',
    targetUsername: 'person1',
    targetDirectoryDn: 'CN=person1,OU=Users,DC=example,DC=test',
    targetDirectoryObjectGuid: 'Z3VpZC1wZXJzb24x',
    relatedRequestId: 'request-1',
    requestedBy: 'operator1',
    reason: 'Permanent removal approved',
    notes: null,
    resultSnapshot: null,
    completedAt: new Date(),
    batchId: null,
  };
}

function vpnDeletionAction() {
  return {
    id: 'action-vpn-delete-1',
    status: 'reconciliation_required',
    actionType: 'delete_vpn_record',
    operationMode: 'governed',
    targetAccountType: 'VPN',
    targetUsername: 'vpnuser',
    targetUserId: 'vpn-1',
    relatedRequestId: null,
    requestedBy: 'operator1',
    reason: 'Expired service record cleanup',
    notes: null,
    preflightSnapshot: {
      vpnAccountId: 'vpn-1',
      username: 'vpnuser',
      status: 'revoked',
      revokedAt: '2026-08-30T20:00:00.000Z',
      revokedBy: 'admin0',
      revokedReason: 'Expired access',
      latestStatusLogId: 'vpn-status-1',
      accessRequestId: null,
    },
    resultSnapshot: null,
    completedAt: new Date(),
    batchId: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  const action = deletionAction();
  mocks.checkAdminAuthWithRateLimit.mockResolvedValue({
    admin: {
      username: 'admin1',
      permissions: new Set(['lifecycle.manage', 'lifecycle.delete', 'users.manage', 'vpn.manage', 'vpn.delete']),
      roles: new Set(),
      viaLegacyAdminFallback: false,
    },
    response: null,
  });
  mocks.actionFindUnique.mockResolvedValue(action);
  mocks.sessionCount.mockResolvedValue(0);
  mocks.providerTaskFindMany.mockResolvedValue([]);
  mocks.accessRequestFindUnique.mockResolvedValue({ id: 'request-1' });
  mocks.searchLDAPUserByObjectGuid.mockResolvedValue(null);
  mocks.tx.accountLifecycleAction.findUnique.mockResolvedValue(action);
  mocks.tx.accountLifecycleAction.updateMany.mockResolvedValue({ count: 1 });
  mocks.tx.$queryRaw.mockResolvedValue([{ lock_acquired: 'locked' }]);
  mocks.tx.session.count.mockResolvedValue(0);
  mocks.tx.providerLogoutTask.findMany.mockResolvedValue([]);
  const accessRequest = {
    id: 'request-1', name: 'Person One', email: 'person1@example.test',
    status: 'approved', provisioningState: null,
    ldapUsername: 'person1', linkedAdUsername: null,
    adAccountStatus: 'disabled', version: 7, createdAt: new Date(),
  };
  mocks.tx.accessRequest.findUnique.mockResolvedValue(accessRequest);
  mocks.tx.accessRequest.findMany.mockResolvedValue([accessRequest]);
  mocks.tx.accessRequest.updateMany.mockResolvedValue({ count: 1 });
  mocks.tx.batchAccountItem.findUnique.mockResolvedValue(null);
  mocks.tx.batchAccountItem.findMany.mockResolvedValue([]);
  mocks.tx.batchAccountItem.updateMany.mockResolvedValue({ count: 1 });
  mocks.tx.aDAccountActivityLog.findFirst.mockResolvedValue(null);
  mocks.tx.requestComment.findFirst.mockResolvedValue(null);
  mocks.tx.accountLifecycleBatch.findUnique.mockResolvedValue(null);
  mocks.transaction.mockImplementation(async (callback: (tx: typeof mocks.tx) => Promise<unknown>) => callback(mocks.tx));
});

describe('POST delete_vpn_record reconciliation', () => {
  it('refuses to certify completion while the live VPN record and credential remain', async () => {
    const action = vpnDeletionAction();
    mocks.actionFindUnique.mockResolvedValue(action);
    mocks.tx.accountLifecycleAction.findUnique.mockResolvedValue(action);
    mocks.tx.vPNAccount.findUnique.mockResolvedValue({
      id: 'vpn-1', username: 'vpnuser', status: 'revoked', accessRequestId: null,
      revokedAt: new Date('2026-08-30T20:00:00.000Z'), revokedBy: 'admin0', revokedReason: 'Expired access',
    });

    const response = await POST(new NextRequest('https://example.test/api/admin/account-lifecycle/action-vpn-delete-1/reconcile', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ outcome: 'confirmed_completed', evidence: 'Verified the retained database state at 10:42 UTC.' }),
    }), { params: Promise.resolve({ id: 'action-vpn-delete-1' }) });

    expect(response.status).toBe(409);
    expect(mocks.tx.accountLifecycleAction.updateMany).not.toHaveBeenCalled();
  });

  it('marks an expired delete failed only when the surviving revoked record matches the snapshot', async () => {
    const action = vpnDeletionAction();
    mocks.actionFindUnique.mockResolvedValue(action);
    mocks.tx.accountLifecycleAction.findUnique.mockResolvedValue(action);
    mocks.tx.vPNAccount.findUnique.mockResolvedValue({
      id: 'vpn-1', username: 'vpnuser', status: 'revoked', accessRequestId: null,
      revokedAt: new Date('2026-08-30T20:00:00.000Z'), revokedBy: 'admin0', revokedReason: 'Expired access',
    });
    mocks.tx.vPNAccountStatusLog.findFirst.mockResolvedValue({ id: 'vpn-status-1', newStatus: 'revoked' });

    const response = await POST(new NextRequest('https://example.test/api/admin/account-lifecycle/action-vpn-delete-1/reconcile', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ outcome: 'confirmed_not_completed', evidence: 'Verified the live revoked VPN row remains in PostgreSQL.' }),
    }), { params: Promise.resolve({ id: 'action-vpn-delete-1' }) });

    expect(response.status).toBe(200);
    expect(mocks.tx.accountLifecycleAction.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'failed' }),
    }));
  });
});

describe('POST batch-governed AD reconciliation', () => {
  it('projects a confirmed disable onto the exact batch item after checking the live object', async () => {
    const action = {
      ...deletionAction(),
      id: 'action-batch-disable-1',
      actionType: 'disable_ad',
      operationMode: 'batch_governed',
      relatedRequestId: null,
      relatedBatchAccountItemId: 'batch-item-1',
      preflightSnapshot: { batchItemVersion: 2, enabled: true },
    };
    const batchItem = {
      id: 'batch-item-1', batchId: 'creation-batch-1', lifecycleOwnerKind: 'batch_item',
      accessRequestId: null, accountType: 'AD', status: 'completed', ldapUsername: 'person1',
      version: 2, adAccountStatus: 'active',
      targetDirectoryDn: action.targetDirectoryDn,
      targetDirectoryObjectGuid: action.targetDirectoryObjectGuid,
    };
    mocks.actionFindUnique.mockResolvedValue(action);
    mocks.tx.accountLifecycleAction.findUnique.mockResolvedValue(action);
    mocks.tx.accessRequest.findMany.mockResolvedValue([]);
    mocks.tx.batchAccountItem.findUnique.mockResolvedValue(batchItem);
    mocks.tx.batchAccountItem.findMany.mockResolvedValue([{ id: 'batch-item-1' }]);
    mocks.searchLDAPUserByObjectGuid.mockResolvedValue({
      objectName: action.targetDirectoryDn,
      attributes: [
        { type: 'sAMAccountName', values: ['person1'] },
        { type: 'userAccountControl', values: ['514'] },
        { type: 'objectGUID', values: [action.targetDirectoryObjectGuid] },
      ],
    });

    const response = await POST(new NextRequest('https://example.test/api/admin/account-lifecycle/action-batch-disable-1/reconcile', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ outcome: 'confirmed_completed', evidence: 'Verified the bound object is disabled and sessions are settled.' }),
    }), { params: Promise.resolve({ id: 'action-batch-disable-1' }) });

    expect(response.status).toBe(200);
    expect(mocks.tx.batchAccountItem.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'batch-item-1', version: 2, adAccountStatus: 'active' },
      data: expect.objectContaining({ adAccountStatus: 'disabled', version: { increment: 1 } }),
    }));
    expect(mocks.tx.accountLifecycleAction.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'completed' }),
    }));
  });

  it('refuses batch reconciliation when a processing claim competes with the selected completed item', async () => {
    const action = {
      ...deletionAction(), id: 'action-batch-disable-1', actionType: 'disable_ad', operationMode: 'batch_governed',
      relatedRequestId: null, relatedBatchAccountItemId: 'batch-item-1', preflightSnapshot: { batchItemVersion: 2, enabled: true },
    };
    const batchItem = {
      id: 'batch-item-1', batchId: 'creation-batch-1', lifecycleOwnerKind: 'batch_item', accessRequestId: null,
      accountType: 'AD', status: 'completed', ldapUsername: 'person1', version: 2, adAccountStatus: 'active',
      targetDirectoryDn: action.targetDirectoryDn, targetDirectoryObjectGuid: action.targetDirectoryObjectGuid,
    };
    mocks.actionFindUnique.mockResolvedValue(action);
    mocks.tx.accountLifecycleAction.findUnique.mockResolvedValue(action);
    mocks.tx.accessRequest.findMany.mockResolvedValue([]);
    mocks.tx.batchAccountItem.findUnique.mockResolvedValue(batchItem);
    mocks.tx.batchAccountItem.findMany.mockResolvedValue([{ id: 'batch-item-1' }, { id: 'batch-item-processing' }]);

    const response = await POST(new NextRequest('https://example.test/api/admin/account-lifecycle/action-batch-disable-1/reconcile', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ outcome: 'confirmed_completed', evidence: 'Reviewed the batch claim set before reconciling.' }),
    }), { params: Promise.resolve({ id: 'action-batch-disable-1' }) });

    expect(response.status).toBe(409);
    expect(mocks.tx.batchAccountItem.updateMany).not.toHaveBeenCalled();
    expect(mocks.tx.batchAccountItem.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: { in: ['processing', 'completed', 'reconciliation_required'] },
        OR: expect.arrayContaining([
          { id: 'batch-item-1' },
          { adAccountStatus: null },
          { adAccountStatus: { not: 'deleted' } },
        ]),
      }),
    }));
  });
});

describe('POST delete_ad reconciliation', () => {
  it('reconciles an unmanaged deletion without inventing a request projection', async () => {
    const action = {
      ...deletionAction(),
      operationMode: 'directory_override',
      relatedRequestId: null,
      batchId: 'plan-1',
    };
    mocks.checkAdminAuthWithRateLimit.mockResolvedValue({
      admin: {
        username: 'admin1',
        permissions: new Set(['lifecycle.manage', 'lifecycle.delete', 'lifecycle.override', 'lifecycle.delete_unmanaged', 'users.manage']),
        roles: new Set(),
        viaLegacyAdminFallback: false,
      },
      response: null,
    });
    mocks.actionFindUnique.mockResolvedValue(action);
    mocks.tx.accountLifecycleAction.findUnique.mockResolvedValue(action);
    mocks.tx.accessRequest.findMany.mockResolvedValue([]);
    mocks.tx.accountLifecycleAction.findMany.mockResolvedValue([{ status: 'completed' }]);
    mocks.tx.accountLifecycleBatch.findUnique.mockResolvedValue({
      totalActions: 2,
      policyVersion: 'reviewed-lifecycle-deletion-plan-v1',
      completedAt: null,
      resultSummary: { finalizationRequested: true },
    });

    const response = await POST(new NextRequest('https://example.test/api/admin/account-lifecycle/action-delete-1/reconcile', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ outcome: 'confirmed_completed', evidence: 'The captured object GUID is absent from the directory.' }),
    }), { params: Promise.resolve({ id: 'action-delete-1' }) });

    expect(response.status).toBe(200);
    expect(mocks.tx.accessRequest.updateMany).not.toHaveBeenCalled();
    expect(mocks.tx.aDAccountActivityLog.create).not.toHaveBeenCalled();
    expect(mocks.tx.requestComment.create).not.toHaveBeenCalled();
    expect(mocks.tx.accountLifecycleBatch.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'partial', completedActions: 1, failedActions: 0 }),
    }));
  });

  it('reconciles the captured unmanaged GUID without projecting onto a later portal owner', async () => {
    const action = { ...deletionAction(), operationMode: 'directory_override', relatedRequestId: null };
    mocks.checkAdminAuthWithRateLimit.mockResolvedValue({
      admin: {
        username: 'admin1',
        permissions: new Set(['lifecycle.manage', 'lifecycle.delete', 'lifecycle.override', 'lifecycle.delete_unmanaged', 'users.manage']),
        roles: new Set(),
        viaLegacyAdminFallback: false,
      },
      response: null,
    });
    mocks.actionFindUnique.mockResolvedValue(action);
    mocks.tx.accountLifecycleAction.findUnique.mockResolvedValue(action);
    mocks.tx.accessRequest.findMany.mockResolvedValue([{ id: 'new-owner' }]);
    mocks.tx.session.count.mockResolvedValue(1);
    mocks.tx.providerLogoutTask.findMany.mockResolvedValue([{ status: 'pending' }]);

    const response = await POST(new NextRequest('https://example.test/api/admin/account-lifecycle/action-delete-1/reconcile', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ outcome: 'confirmed_completed', evidence: 'The captured object GUID is absent from the directory.' }),
    }), { params: Promise.resolve({ id: 'action-delete-1' }) });

    expect(response.status).toBe(200);
    expect(mocks.searchLDAPUserByObjectGuid).toHaveBeenCalledWith('Z3VpZC1wZXJzb24x');
    expect(mocks.tx.accessRequest.updateMany).not.toHaveBeenCalled();
    expect(mocks.tx.accountLifecycleAction.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'completed',
        resultSnapshot: expect.objectContaining({
          safetyChecks: expect.objectContaining({
            ownershipDriftObservedAtReconciliation: true,
            supersedingOwnerSessionStateNotAppliedToCapturedGuid: true,
            observedUsernameSessionCount: 1,
            observedIncompleteProviderLogoutCount: 1,
          }),
        }),
      }),
    }));
  });

  it('refuses to make an unmanaged delete retryable when a portal request now owns the username', async () => {
    const action = { ...deletionAction(), operationMode: 'directory_override', relatedRequestId: null };
    mocks.checkAdminAuthWithRateLimit.mockResolvedValue({
      admin: {
        username: 'admin1',
        permissions: new Set(['lifecycle.manage', 'lifecycle.delete', 'lifecycle.override', 'lifecycle.delete_unmanaged', 'users.manage']),
        roles: new Set(),
        viaLegacyAdminFallback: false,
      },
      response: null,
    });
    mocks.actionFindUnique.mockResolvedValue(action);
    mocks.tx.accountLifecycleAction.findUnique.mockResolvedValue(action);
    mocks.tx.accessRequest.findMany.mockResolvedValue([{ id: 'new-owner' }]);

    const response = await POST(new NextRequest('https://example.test/api/admin/account-lifecycle/action-delete-1/reconcile', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ outcome: 'confirmed_not_completed', evidence: 'The captured object GUID still exists in Active Directory.' }),
    }), { params: Promise.resolve({ id: 'action-delete-1' }) });

    expect(response.status).toBe(409);
    expect(mocks.searchLDAPUserByObjectGuid).not.toHaveBeenCalled();
    expect(mocks.tx.accountLifecycleAction.updateMany).not.toHaveBeenCalled();
  });

  it('objectively confirms GUID absence and idempotently projects deletion state', async () => {
    const response = await POST(new NextRequest('https://example.test/api/admin/account-lifecycle/action-delete-1/reconcile', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ outcome: 'confirmed_completed', evidence: 'Verified against Active Directory at 10:42 UTC.' }),
    }), { params: Promise.resolve({ id: 'action-delete-1' }) });

    expect(response.status).toBe(200);
    expect(mocks.searchLDAPUserByObjectGuid).toHaveBeenCalledWith('Z3VpZC1wZXJzb24x');
    expect(mocks.tx.accessRequest.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'request-1',
        version: 7,
        status: 'approved',
        provisioningState: null,
        adAccountStatus: 'disabled',
        OR: [
          { ldapUsername: { equals: 'person1', mode: 'insensitive' } },
          { linkedAdUsername: { equals: 'person1', mode: 'insensitive' } },
        ],
      },
      data: { adAccountStatus: 'deleted', version: { increment: 1 } },
    });
    expect(mocks.tx.aDAccountActivityLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ actionType: 'deleted', lifecycleActionId: 'action-delete-1' }),
    }));
    expect(mocks.tx.requestComment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: 'ad_account_deleted' }),
    }));
    expect(mocks.tx.accountLifecycleAction.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'completed',
        resultSnapshot: expect.objectContaining({
          stage: 'reconciled_delete_confirmed',
          safetyChecks: expect.objectContaining({ objectiveGuidAbsenceConfirmed: true }),
        }),
      }),
    }));
  });

  it.each(['confirmed_completed', 'confirmed_not_completed'])('blocks %s when request AD aliases diverged during uncertainty', async (outcome) => {
    mocks.tx.accessRequest.findUnique.mockResolvedValue({
      id: 'request-1', name: 'Person One', email: 'person1@example.test', status: 'approved',
      provisioningState: null, ldapUsername: 'person1', linkedAdUsername: 'renamed-person',
      adAccountStatus: 'disabled', version: 7, createdAt: new Date(),
    });
    const response = await POST(new NextRequest('https://example.test/api/admin/account-lifecycle/action-delete-1/reconcile', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ outcome, evidence: 'Reviewed captured GUID while ownership changed.' }),
    }), { params: Promise.resolve({ id: 'action-delete-1' }) });

    expect(response.status).toBe(409);
    expect(mocks.tx.accessRequest.updateMany).not.toHaveBeenCalled();
    expect(mocks.tx.accountLifecycleAction.updateMany).not.toHaveBeenCalled();
    expect(mocks.searchLDAPUserByObjectGuid).not.toHaveBeenCalled();
  });

  it('refuses to certify completion while the captured GUID still exists', async () => {
    mocks.searchLDAPUserByObjectGuid.mockResolvedValue({
      objectName: 'CN=person1,OU=Users,DC=example,DC=test',
      attributes: [
        { type: 'sAMAccountName', values: ['person1'] },
        { type: 'userAccountControl', values: ['514'] },
        { type: 'objectGUID', values: ['Z3VpZC1wZXJzb24x'] },
      ],
    });

    const response = await POST(new NextRequest('https://example.test/api/admin/account-lifecycle/action-delete-1/reconcile', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ outcome: 'confirmed_completed', evidence: 'Operator believes the account was removed.' }),
    }), { params: Promise.resolve({ id: 'action-delete-1' }) });

    expect(response.status).toBe(409);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.tx.accountLifecycleAction.updateMany).not.toHaveBeenCalled();
  });

  it('does not overwrite a later portal restore while certifying GUID absence', async () => {
    mocks.tx.accessRequest.findUnique.mockResolvedValue({
      id: 'request-1', name: 'Person One', email: 'person1@example.test',
      status: 'approved', provisioningState: null,
      ldapUsername: 'person1', linkedAdUsername: null,
      adAccountStatus: 'active', version: 8, createdAt: new Date(),
    });

    const response = await POST(new NextRequest('https://example.test/api/admin/account-lifecycle/action-delete-1/reconcile', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ outcome: 'confirmed_completed', evidence: 'GUID is absent but portal state changed.' }),
    }), { params: Promise.resolve({ id: 'action-delete-1' }) });

    expect(response.status).toBe(409);
    expect(mocks.tx.accessRequest.updateMany).not.toHaveBeenCalled();
  });

  it('refuses to certify a deletion after the request was rebound to another username', async () => {
    mocks.tx.accessRequest.findUnique.mockResolvedValue({
      id: 'request-1', name: 'Person One', email: 'person1@example.test',
      status: 'approved', provisioningState: null,
      ldapUsername: 'replacement-user', linkedAdUsername: null,
      adAccountStatus: 'disabled', version: 8, createdAt: new Date(),
    });

    const response = await POST(new NextRequest('https://example.test/api/admin/account-lifecycle/action-delete-1/reconcile', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ outcome: 'confirmed_completed', evidence: 'GUID is absent but request ownership changed.' }),
    }), { params: Promise.resolve({ id: 'action-delete-1' }) });

    expect(response.status).toBe(409);
    expect(mocks.searchLDAPUserByObjectGuid).not.toHaveBeenCalled();
    expect(mocks.tx.accessRequest.updateMany).not.toHaveBeenCalled();
  });

  it('prefers the current approved owner over a historical offboarded request', async () => {
    const currentOwner = await mocks.tx.accessRequest.findUnique();
    const historicalOwner = {
      ...currentOwner,
      id: 'request-old',
      status: 'offboarded',
      adAccountStatus: 'deleted',
    };
    mocks.tx.accessRequest.findMany.mockImplementation(async ({ where }: {
      where: { status?: { in?: string[]; notIn?: string[] } | string };
    }) => {
      if (typeof where.status === 'object' && where.status.in) return [currentOwner, historicalOwner];
      if (typeof where.status === 'object' && where.status.notIn) return [currentOwner];
      return [historicalOwner];
    });

    const response = await POST(new NextRequest('https://example.test/api/admin/account-lifecycle/action-delete-1/reconcile', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ outcome: 'confirmed_completed', evidence: 'Verified against Active Directory at 10:42 UTC.' }),
    }), { params: Promise.resolve({ id: 'action-delete-1' }) });

    expect(response.status).toBe(200);
    expect(mocks.tx.accessRequest.findMany).toHaveBeenCalledTimes(1);
  });

  it('rejects reconciliation when a second active non-ready request claims the username', async () => {
    const currentOwner = await mocks.tx.accessRequest.findUnique();
    mocks.tx.accessRequest.findMany.mockResolvedValue([
      currentOwner,
      { ...currentOwner, id: 'request-2', provisioningState: 'reconciliation_required' },
    ]);

    const response = await POST(new NextRequest('https://example.test/api/admin/account-lifecycle/action-delete-1/reconcile', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ outcome: 'confirmed_completed', evidence: 'Verified against Active Directory at 10:42 UTC.' }),
    }), { params: Promise.resolve({ id: 'action-delete-1' }) });

    expect(response.status).toBe(409);
    expect(mocks.searchLDAPUserByObjectGuid).not.toHaveBeenCalled();
  });

  it('durably records objective evidence when deletion is confirmed not completed', async () => {
    mocks.searchLDAPUserByObjectGuid.mockResolvedValue({
      objectName: 'CN=person1,OU=Users,DC=example,DC=test',
      attributes: [
        { type: 'sAMAccountName', values: ['person1'] },
        { type: 'userAccountControl', values: ['514'] },
        { type: 'objectGUID', values: ['Z3VpZC1wZXJzb24x'] },
      ],
    });

    const response = await POST(new NextRequest('https://example.test/api/admin/account-lifecycle/action-delete-1/reconcile', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ outcome: 'confirmed_not_completed', evidence: 'The captured GUID remains at the confirmed disabled identity.' }),
    }), { params: Promise.resolve({ id: 'action-delete-1' }) });

    expect(response.status).toBe(200);
    expect(mocks.tx.accountLifecycleAction.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'failed',
        resultSnapshot: expect.objectContaining({
          stage: 'reconciled_delete_not_completed',
          safetyChecks: expect.objectContaining({
            capturedGuidPresentAtExpectedIdentity: true,
            survivingObjectDisabled: true,
          }),
        }),
      }),
    }));
  });

  it('version-checks an already-deleted portal projection before completing reconciliation', async () => {
    const deletedRequest = {
      id: 'request-1', name: 'Person One', email: 'person1@example.test',
      status: 'approved', provisioningState: null,
      ldapUsername: 'person1', linkedAdUsername: null,
      adAccountStatus: 'deleted', version: 8, createdAt: new Date(),
    };
    mocks.tx.accessRequest.findUnique.mockResolvedValue(deletedRequest);
    mocks.tx.accessRequest.findMany.mockResolvedValue([deletedRequest]);

    const response = await POST(new NextRequest('https://example.test/api/admin/account-lifecycle/action-delete-1/reconcile', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ outcome: 'confirmed_completed', evidence: 'Verified against Active Directory at 10:42 UTC.' }),
    }), { params: Promise.resolve({ id: 'action-delete-1' }) });

    expect(response.status).toBe(200);
    expect(mocks.tx.accessRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'request-1', adAccountStatus: 'deleted', version: 8 }),
      data: { version: 8 },
    }));
  });

  it('detects concurrent drift of an already-deleted portal projection', async () => {
    const deletedRequest = {
      id: 'request-1', name: 'Person One', email: 'person1@example.test',
      status: 'approved', provisioningState: null,
      ldapUsername: 'person1', linkedAdUsername: null,
      adAccountStatus: 'deleted', version: 8, createdAt: new Date(),
    };
    mocks.tx.accessRequest.findUnique.mockResolvedValue(deletedRequest);
    mocks.tx.accessRequest.findMany.mockResolvedValue([deletedRequest]);
    mocks.tx.accessRequest.updateMany.mockResolvedValueOnce({ count: 0 });

    const response = await POST(new NextRequest('https://example.test/api/admin/account-lifecycle/action-delete-1/reconcile', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ outcome: 'confirmed_completed', evidence: 'Verified against Active Directory at 10:42 UTC.' }),
    }), { params: Promise.resolve({ id: 'action-delete-1' }) });

    expect(response.status).toBe(409);
    expect(mocks.tx.accountLifecycleAction.updateMany).not.toHaveBeenCalled();
  });

  it('does not make a restored GUID retryable while the portal request remains deleted', async () => {
    const deletedRequest = {
      id: 'request-1', name: 'Person One', email: 'person1@example.test',
      status: 'approved', provisioningState: null,
      ldapUsername: 'person1', linkedAdUsername: null,
      adAccountStatus: 'deleted', version: 8, createdAt: new Date(),
    };
    mocks.tx.accessRequest.findUnique.mockResolvedValue(deletedRequest);
    mocks.tx.accessRequest.findMany.mockResolvedValue([deletedRequest]);
    mocks.searchLDAPUserByObjectGuid.mockResolvedValue({
      objectName: 'CN=person1,OU=Users,DC=example,DC=test',
      attributes: [
        { type: 'sAMAccountName', values: ['person1'] },
        { type: 'userAccountControl', values: ['514'] },
        { type: 'objectGUID', values: ['Z3VpZC1wZXJzb24x'] },
      ],
    });

    const response = await POST(new NextRequest('https://example.test/api/admin/account-lifecycle/action-delete-1/reconcile', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ outcome: 'confirmed_not_completed', evidence: 'The captured GUID exists after a directory restore.' }),
    }), { params: Promise.resolve({ id: 'action-delete-1' }) });

    expect(response.status).toBe(409);
    expect(mocks.tx.accountLifecycleAction.updateMany).not.toHaveBeenCalled();
  });

  it('does not certify an unreadable directory account-control state as disabled', async () => {
    mocks.searchLDAPUserByObjectGuid.mockResolvedValue({
      objectName: 'CN=person1,OU=Users,DC=example,DC=test',
      attributes: [
        { type: 'sAMAccountName', values: ['person1'] },
        { type: 'userAccountControl', values: ['not-a-number'] },
        { type: 'objectGUID', values: ['Z3VpZC1wZXJzb24x'] },
      ],
    });

    const response = await POST(new NextRequest('https://example.test/api/admin/account-lifecycle/action-delete-1/reconcile', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ outcome: 'confirmed_not_completed', evidence: 'The captured GUID exists but account-control is unreadable.' }),
    }), { params: Promise.resolve({ id: 'action-delete-1' }) });

    expect(response.status).toBe(409);
    expect(mocks.assertLifecycleAccountNotProtected).not.toHaveBeenCalled();
    expect(mocks.tx.accessRequest.updateMany).not.toHaveBeenCalled();
  });

  it('returns the committed reconciliation when secondary audit emission fails', async () => {
    const auditFailure = new Error('audit sink unavailable');
    mocks.logAuditAction.mockRejectedValueOnce(auditFailure);

    const response = await POST(new NextRequest('https://example.test/api/admin/account-lifecycle/action-delete-1/reconcile', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ outcome: 'confirmed_completed', evidence: 'Verified against Active Directory at 10:42 UTC.' }),
    }), { params: Promise.resolve({ id: 'action-delete-1' }) });

    expect(response.status).toBe(200);
    expect(mocks.appLoggerError).toHaveBeenCalledWith(
      'Deletion reconciliation audit emission failed after transactional finalization',
      auditFailure,
      { actionId: 'action-delete-1' }
    );
  });
});
