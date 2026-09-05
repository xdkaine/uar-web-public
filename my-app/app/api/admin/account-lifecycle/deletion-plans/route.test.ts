import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  cloneReadOnly: vi.fn(),
  searchLDAPUser: vi.fn(),
  protect: vi.fn(),
  moduleEnabled: vi.fn(),
  planFindUnique: vi.fn(),
  planFindMany: vi.fn(),
  planCreate: vi.fn(),
  planUpdate: vi.fn(),
  requestFindMany: vi.fn(),
  batchItemFindUnique: vi.fn(),
  batchItemFindFirst: vi.fn(),
  batchItemFindMany: vi.fn(),
  vpnFindUnique: vi.fn(),
  statusFindFirst: vi.fn(),
  sessionCount: vi.fn(),
  logoutFindMany: vi.fn(),
  audit: vi.fn(),
}));

vi.mock('@/lib/adminAuth', () => ({ checkAdminAuthWithRateLimit: mocks.auth }));
vi.mock('@/lib/clone-safety', () => ({ isProductionCloneReadOnly: mocks.cloneReadOnly }));
vi.mock('@/lib/ldap', () => ({ searchLDAPUser: mocks.searchLDAPUser }));
vi.mock('@/lib/lifecycle-protection', () => ({ assertLifecycleAccountNotProtected: mocks.protect }));
vi.mock('@/lib/modules/core', () => ({ isModuleEnabledStrict: mocks.moduleEnabled }));
vi.mock('@/lib/audit-log', () => ({
  AuditActions: { CREATE_LIFECYCLE_BATCH: 'create_lifecycle_batch' },
  AuditCategories: { LIFECYCLE: 'lifecycle' },
  getIpAddress: vi.fn(() => '127.0.0.1'),
  getUserAgent: vi.fn(() => 'vitest'),
  logAuditAction: mocks.audit,
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    accountLifecycleBatch: { findUnique: mocks.planFindUnique, findMany: mocks.planFindMany, create: mocks.planCreate, update: mocks.planUpdate },
    accessRequest: { findMany: mocks.requestFindMany },
    batchAccountItem: { findUnique: mocks.batchItemFindUnique, findFirst: mocks.batchItemFindFirst, findMany: mocks.batchItemFindMany },
    vPNAccount: { findUnique: mocks.vpnFindUnique },
    vPNAccountStatusLog: { findFirst: mocks.statusFindFirst },
    session: { count: mocks.sessionCount },
    providerLogoutTask: { findMany: mocks.logoutFindMany },
  },
}));

import { GET, POST } from './route';

function request(body: Record<string, unknown>) {
  return new NextRequest('https://example.test/api/admin/account-lifecycle/deletion-plans', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function baseBody(overrides: Record<string, unknown> = {}) {
  return {
    action: 'delete_ad',
    targets: [{ accountRef: 'ad:service1', directoryUsername: 'service1' }],
    reason: 'Retire obsolete lab service account.',
    reference: 'CHG-1042',
    irreversibleAcknowledgement: true,
    destructiveAcknowledgement: 'DELETE 1 ACCOUNT / 1 RECORD',
    idempotencyKey: 'plan-key-1234567890',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({
    admin: {
      username: 'operator1',
      permissions: new Set(['lifecycle.manage', 'lifecycle.delete', 'lifecycle.override', 'lifecycle.delete_unmanaged', 'users.manage']),
    },
    response: null,
  });
  mocks.cloneReadOnly.mockReturnValue(false);
  mocks.searchLDAPUser.mockImplementation(async (username: string) => ({
    objectName: `CN=${username},OU=Service Accounts,DC=example,DC=test`,
    attributes: [
      { type: 'sAMAccountName', values: [username] },
      { type: 'userAccountControl', values: ['514'] },
      { type: 'objectGUID', values: [`guid-${username}`] },
    ],
  }));
  mocks.protect.mockResolvedValue(undefined);
  mocks.moduleEnabled.mockResolvedValue(true);
  mocks.planFindUnique.mockResolvedValue(null);
  mocks.planFindMany.mockResolvedValue([]);
  mocks.requestFindMany.mockResolvedValue([]);
  mocks.batchItemFindUnique.mockResolvedValue(null);
  mocks.batchItemFindFirst.mockResolvedValue(null);
  mocks.batchItemFindMany.mockResolvedValue([]);
  mocks.sessionCount.mockResolvedValue(0);
  mocks.logoutFindMany.mockResolvedValue([]);
  mocks.planCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'plan-1', ...data }));
  mocks.planUpdate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'plan-1', ...data }));
  mocks.audit.mockResolvedValue(undefined);
});

describe('GET reviewed lifecycle deletion plans', () => {
  it('finds old unfinished work even behind more than 50 newer terminal plans', async () => {
    mocks.auth.mockResolvedValue({ admin: { username: 'operator1', permissions: new Set(['lifecycle.read']) }, response: null });
    const rows = [
      ...Array.from({ length: 51 }, (_, index) => ({ id: `new-${index}`, status: 'completed', _count: { actions: 1 } })),
      { id: 'old-zero-child', status: 'processing', _count: { actions: 0 } },
    ];
    mocks.planFindMany.mockImplementation(async ({ where, take }) => rows
      .filter(row => !where.status || where.status.in.includes(row.status)).slice(0, take));
    const response = await GET(new NextRequest('https://example.test/api/admin/account-lifecycle/deletion-plans?unfinished=true&limit=50'));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ plans: [{ id: 'old-zero-child', recordedActions: 0 }] });
    expect(mocks.planFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { policyVersion: 'reviewed-lifecycle-deletion-plan-v1', status: { in: ['processing', 'reconciliation_required'] } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 50,
    }));
  });

  it('lists the plan aggregate even when no child actions were admitted', async () => {
    mocks.auth.mockResolvedValue({
      admin: { username: 'operator1', permissions: new Set(['lifecycle.read']) },
      response: null,
    });
    mocks.planFindMany.mockResolvedValue([{
      id: 'plan-zero-child',
      description: 'Retire obsolete lab service accounts.',
      status: 'processing',
      totalTargets: 4,
      totalActions: 4,
      completedActions: 0,
      failedActions: 0,
      resultSummary: null,
      _count: { actions: 0 },
    }]);

    const response = await GET(new NextRequest('https://example.test/api/admin/account-lifecycle/deletion-plans?limit=10'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      plans: [expect.objectContaining({ id: 'plan-zero-child', totalTargets: 4, totalActions: 4 })],
    });
    expect(mocks.planFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { policyVersion: 'reviewed-lifecycle-deletion-plan-v1' },
      take: 10,
    }));
  });

  it('requires lifecycle read access', async () => {
    mocks.auth.mockResolvedValue({ admin: { username: 'operator1', permissions: new Set() }, response: null });

    const response = await GET(new NextRequest('https://example.test/api/admin/account-lifecycle/deletion-plans'));

    expect(response.status).toBe(403);
    expect(mocks.planFindMany).not.toHaveBeenCalled();
  });
});

describe('POST reviewed lifecycle deletion plan', () => {
  it('binds confirmation to the exact account and record counts before directory reads', async () => {
    const response = await POST(request(baseBody({ destructiveAcknowledgement: 'DELETE 1 ACCOUNT' })));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'CONFIRMATION_MISMATCH' });
    expect(mocks.searchLDAPUser).not.toHaveBeenCalled();
  });

  it('requires the default-unmapped unmanaged deletion privilege', async () => {
    mocks.auth.mockResolvedValue({
      admin: { username: 'operator1', permissions: new Set(['lifecycle.manage', 'lifecycle.delete', 'lifecycle.override', 'users.manage']) },
      response: null,
    });

    const response = await POST(request(baseBody()));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: 'MISSING_UNMANAGED_DELETE_PERMISSION' });
    expect(mocks.planCreate).not.toHaveBeenCalled();
  });

  it('rejects duplicate immutable directory targets hidden behind different inventory references', async () => {
    const response = await POST(request(baseBody({
      targets: [
        { accountRef: 'ad:service1:first', directoryUsername: 'service1' },
        { accountRef: 'ad:service1:second', directoryUsername: 'service1' },
      ],
      destructiveAcknowledgement: 'DELETE 2 ACCOUNTS / 2 RECORDS',
    })));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'DUPLICATE_RECORD_TARGET' });
    expect(mocks.planCreate).not.toHaveBeenCalled();
  });

  it('creates a server-owned unmanaged plan without an access request', async () => {
    const response = await POST(request(baseBody()));
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.plan.manifest).toEqual([expect.objectContaining({
      key: 'ad:service1',
      operationMode: 'directory_override',
      requestId: null,
      directory: expect.objectContaining({ username: 'service1', objectGuid: 'guid-service1' }),
    })]);
    expect(mocks.planCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      batchType: 'permanent_delete',
      totalTargets: 1,
      totalActions: 1,
      policyVersion: 'reviewed-lifecycle-deletion-plan-v1',
      confirmedBy: 'operator1',
      authorizationEvidence: expect.objectContaining({
        directoryDeletionMethod: 'same-connection-final-preflight-immutable-guid-v1',
      }),
    }) });
  });

  it.each(['processing', 'reconciliation_required'])('blocks an unmanaged plan when a %s batch claim exists', async (status) => {
    mocks.batchItemFindMany.mockResolvedValue([{
      id: 'batch-item-1', batchId: 'batch-run-1', lifecycleOwnerKind: 'batch_item', accessRequestId: null,
      accountType: 'AD', status, adAccountStatus: 'disabled', ldapUsername: 'service1',
    }]);

    const response = await POST(request(baseBody({ sourceBatchId: 'batch-run-1' })));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'BATCH_DELETE_NOT_READY' });
    expect(mocks.planCreate).not.toHaveBeenCalled();
    expect(mocks.batchItemFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: { in: ['processing', 'completed', 'reconciliation_required'] } }),
    }));
  });

  it('rejects a request and standalone batch ownership collision before creating a plan', async () => {
    mocks.requestFindMany.mockResolvedValue([{
      id: 'request-1', status: 'approved', provisioningState: 'completed', adAccountStatus: 'disabled',
    }]);
    mocks.batchItemFindMany.mockResolvedValue([{
      id: 'batch-item-1', batchId: 'batch-run-1', lifecycleOwnerKind: 'batch_item', accessRequestId: null,
      accountType: 'AD', status: 'completed', adAccountStatus: 'disabled', ldapUsername: 'service1',
    }]);

    const response = await POST(request(baseBody({
      targets: [{ accountRef: 'ad:service1', directoryUsername: 'service1', requestId: 'request-1' }],
    })));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'REQUEST_BATCH_OWNERSHIP_CONFLICT' });
    expect(mocks.planCreate).not.toHaveBeenCalled();
  });

  it('keeps a legacy request owner in the governed lane without requiring synthetic batch ownership', async () => {
    mocks.requestFindMany.mockResolvedValue([{
      id: 'request-1', status: 'approved', provisioningState: 'completed', adAccountStatus: 'disabled',
    }]);

    const response = await POST(request(baseBody({
      targets: [{ accountRef: 'ad:service1', directoryUsername: 'service1', requestId: 'request-1' }],
    })));
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.plan.manifest).toEqual([expect.objectContaining({
      operationMode: 'governed', requestId: 'request-1', sourceBatchItemId: null,
    })]);
  });

  it('rejects a governed deletion when one request has divergent AD aliases', async () => {
    mocks.requestFindMany.mockResolvedValue([{
      id: 'request-1', status: 'approved', provisioningState: 'completed', adAccountStatus: 'disabled',
      ldapUsername: 'service1', linkedAdUsername: 'reused-service1',
    }]);

    const response = await POST(request(baseBody({
      targets: [{ accountRef: 'ad:service1', directoryUsername: 'service1', requestId: 'request-1' }],
    })));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'ACCESS_REQUEST_DIRECTORY_IDENTITY_CONFLICT' });
    expect(mocks.planCreate).not.toHaveBeenCalled();
  });

  it.each(['processing', 'completed', 'legacy'])('validates a %s explicit VPN batch owner using the existing VPN execution lane', async (status) => {
    mocks.auth.mockResolvedValue({
      admin: {
        username: 'operator1',
        permissions: new Set(['lifecycle.manage', 'vpn.delete', 'vpn.manage']),
      },
      response: null,
    });
    mocks.vpnFindUnique.mockResolvedValue({
      id: 'vpn-1', username: 'vpn-service1', status: 'revoked', revokedAt: new Date(), revokedBy: 'operator1',
      revokedReason: 'Retired service.', accessRequestId: status === 'legacy' ? 'request-legacy' : null, batchAccountItemId: 'batch-vpn-1', batchId: 'batch-run-1',
    });
    mocks.statusFindFirst.mockResolvedValue({ newStatus: 'revoked' });
    mocks.batchItemFindMany.mockResolvedValue([{
      id: 'batch-vpn-1', batchId: 'batch-run-1', lifecycleOwnerKind: 'batch_item', accessRequestId: null,
      accountType: 'VPN', status, vpnUsername: 'vpn-service1',
    }]);
    if (status === 'legacy') {
      mocks.batchItemFindMany.mockResolvedValue([]);
      mocks.batchItemFindUnique.mockResolvedValue({
        id: 'batch-vpn-1', batchId: 'batch-run-1', lifecycleOwnerKind: 'access_request_legacy',
        accessRequestId: 'request-legacy', accountType: 'AD', status: 'completed', vpnUsername: null,
      });
    }

    const response = await POST(request(baseBody({
      action: 'delete_vpn_record',
      targets: [{
        accountRef: 'vpn:vpn-service1',
        vpnUsername: 'vpn-service1',
        vpnRecordId: 'vpn-1',
        sourceBatchId: 'batch-run-1',
        ...(status === 'legacy' ? { requestId: 'request-legacy' } : {}),
      }],
    })));

    if (status !== 'processing') {
      expect(response.status).toBe(201);
      expect((await response.json()).plan.manifest).toEqual([expect.objectContaining({
        operationMode: 'governed', requestId: status === 'legacy' ? 'request-legacy' : null, sourceBatchId: 'batch-run-1', sourceBatchItemId: 'batch-vpn-1',
      })]);
    } else {
      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({ code: 'BATCH_DELETE_NOT_READY' });
      expect(mocks.planCreate).not.toHaveBeenCalled();
    }
  });

  it('replays the same reviewed manifest for the same operator and input', async () => {
    const body = baseBody();
    mocks.planFindUnique.mockResolvedValue({
      id: 'plan-1',
      requestedBy: 'operator1',
      totalActions: 1,
      authorizationEvidence: {
        inputFingerprint: 'placeholder',
        manifest: [{ key: 'ad:service1', operationMode: 'directory_override', requestId: null, directory: { username: 'service1' }, vpn: null }],
      },
    });
    const firstPass = await POST(request(body));
    expect(firstPass.status).toBe(409);

    mocks.planFindUnique.mockResolvedValue(null);
    await POST(request(body));
    const auditedEvidence = mocks.planUpdate.mock.calls[0][0].data.authorizationEvidence;
    mocks.planFindUnique.mockResolvedValue({
      id: 'plan-1',
      requestedBy: 'operator1',
      totalActions: 1,
      authorizationEvidence: auditedEvidence,
    });
    const replay = await POST(request(body));
    const replayData = await replay.json();

    expect(replay.status).toBe(200);
    expect(replayData.replayed).toBe(true);
    expect(replayData.plan.manifest).toEqual(auditedEvidence.manifest);
    expect(mocks.searchLDAPUser).toHaveBeenCalledTimes(1);
  });

  it('requires a new review instead of replaying an AD-containing legacy plan', async () => {
    const body = baseBody({ idempotencyKey: 'legacy-plan-key-1234567890' });
    await POST(request(body));
    const created = mocks.planCreate.mock.calls[0][0].data;
    mocks.planFindUnique.mockResolvedValue({
      id: 'plan-legacy',
      requestedBy: 'operator1',
      authorizationEvidence: { ...created.authorizationEvidence, directoryDeletionMethod: undefined },
    });

    const response = await POST(request(body));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'DELETION_PLAN_REVIEW_REFRESH_REQUIRED' });
  });

  it('replays the winning plan when concurrent confirmation hits the idempotency constraint', async () => {
    const body = baseBody();
    await POST(request(body));
    const createdData = mocks.planCreate.mock.calls[0][0].data;
    const concurrentPlan = { id: 'plan-concurrent', ...createdData };
    mocks.planFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(concurrentPlan);
    mocks.planCreate.mockRejectedValueOnce(Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }));

    const response = await POST(request(body));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.replayed).toBe(true);
    expect(data.plan.id).toBe('plan-1');
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ targetId: 'plan-concurrent' }));
  });

  it('creates a multi-account governed plan for independently ready requests from different creation batches', async () => {
    mocks.requestFindMany.mockImplementation(async ({ where }: { where: { OR: Array<{ ldapUsername?: { equals?: string } }> } }) => {
      const username = where.OR[0].ldapUsername?.equals;
      return [{
        id: `request-${username}`,
        status: 'approved',
        provisioningState: 'completed',
        adAccountStatus: 'disabled',
      }];
    });
    mocks.batchItemFindUnique.mockImplementation(async ({ where }: { where: { accessRequestId: string } }) => ({
      id: `item-${where.accessRequestId}`,
      batchId: where.accessRequestId.endsWith('service1') ? 'creation-a' : 'creation-b',
    }));
    const targets = ['service1', 'service2'].map((username) => ({
      accountRef: `ad:${username}`,
      directoryUsername: username,
      requestId: `request-${username}`,
    }));

    const response = await POST(request(baseBody({
      targets,
      destructiveAcknowledgement: 'DELETE 2 ACCOUNTS / 2 RECORDS',
    })));

    const data = await response.json();
    expect(response.status).toBe(201);
    expect(data.plan.manifest).toEqual([
      expect.objectContaining({ key: 'ad:service1', requestId: 'request-service1', sourceBatchId: 'creation-a' }),
      expect.objectContaining({ key: 'ad:service2', requestId: 'request-service2', sourceBatchId: 'creation-b' }),
    ]);
    expect(mocks.planCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      totalTargets: 2,
      totalActions: 2,
      sourceBatchId: null,
    }) });
  });

  it('rejects a combined batch AD/VPN target before a plan or child can be created', async () => {
    const auth = await mocks.auth();
    auth.admin.permissions.add('vpn.delete');
    auth.admin.permissions.add('vpn.manage');
    mocks.batchItemFindMany.mockResolvedValue([{
      id: 'ad-item', batchId: 'run', lifecycleOwnerKind: 'batch_item', accessRequestId: null,
      accountType: 'AD', status: 'completed', adAccountStatus: 'disabled', ldapUsername: 'service1',
      targetDirectoryDn: 'CN=service1,OU=Service Accounts,DC=example,DC=test', targetDirectoryObjectGuid: 'guid-service1',
    }]);
    const response = await POST(request(baseBody({
      action: 'delete_both_records', destructiveAcknowledgement: 'DELETE 1 ACCOUNT / 2 RECORDS',
      targets: [{ accountRef: 'ad:service1', directoryUsername: 'service1', sourceBatchId: 'run', vpnUsername: 'vpn-service1', vpnRecordId: 'vpn-1' }],
    })));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'BATCH_SEPARATE_SYSTEMS_REQUIRED' });
    expect(mocks.planCreate).not.toHaveBeenCalled();
    expect(mocks.vpnFindUnique).not.toHaveBeenCalled();
  });

  it('creates one reviewed plan for multiple disabled AD accounts owned by the same batch run', async () => {
    mocks.batchItemFindMany.mockImplementation(async ({ where }: { where: { ldapUsername: { equals: string } } }) => [{
      id: `item-${where.ldapUsername.equals}`,
      batchId: 'creation-batch-1',
      lifecycleOwnerKind: 'batch_item',
      accessRequestId: null,
      accountType: 'AD',
      status: 'completed',
      adAccountStatus: 'disabled',
      ldapUsername: where.ldapUsername.equals,
      targetDirectoryDn: `CN=${where.ldapUsername.equals},OU=Service Accounts,DC=example,DC=test`,
      targetDirectoryObjectGuid: `guid-${where.ldapUsername.equals}`,
      batch: { id: 'creation-batch-1', description: 'Workshop identities' },
    }]);
    const targets = ['service1', 'service2'].map((username) => ({
      accountRef: `ad:${username}`,
      directoryUsername: username,
      sourceBatchId: 'creation-batch-1',
    }));

    const response = await POST(request(baseBody({
      targets,
      destructiveAcknowledgement: 'DELETE 2 ACCOUNTS / 2 RECORDS',
    })));
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.plan.manifest).toEqual([
      expect.objectContaining({ operationMode: 'batch_governed', sourceBatchId: 'creation-batch-1', sourceBatchItemId: 'item-service1', requestId: null }),
      expect.objectContaining({ operationMode: 'batch_governed', sourceBatchId: 'creation-batch-1', sourceBatchItemId: 'item-service2', requestId: null }),
    ]);
  });
  function crossBatchTargets(action: 'delete_ad' | 'delete_vpn_record', failure?: string) {
    mocks.auth.mockResolvedValue({ admin: { username: 'operator1', permissions: new Set([
      'lifecycle.manage', 'lifecycle.delete', 'users.manage', 'vpn.manage', 'vpn.delete',
    ]) }, response: null });
    const items = ['service1', 'service2'].map((username) => ({
      id: `item-${username}`, batchId: `batch-${username}`, lifecycleOwnerKind: 'batch_item', accessRequestId: null,
      accountType: action === 'delete_ad' ? 'AD' : 'VPN', status: username === 'service2' && failure === 'processing' ? 'processing' : 'completed',
      adAccountStatus: 'disabled', ldapUsername: username, vpnUsername: username,
      targetDirectoryDn: `CN=${username},OU=Service Accounts,DC=example,DC=test`,
      targetDirectoryObjectGuid: username === 'service2' && failure === 'replaced_ad' ? 'replaced-guid' : `guid-${username}`,
    }));
    mocks.batchItemFindMany.mockImplementation(async ({ where }) => items.filter((item) =>
      item.ldapUsername === (where.ldapUsername?.equals ?? where.OR[0].vpnUsername.equals)));
    mocks.batchItemFindUnique.mockImplementation(async ({ where }) => items.find((item) => item.id === where.id) ?? null);
    mocks.vpnFindUnique.mockImplementation(async ({ where }) => {
      const username = where.id.replace('vpn-', '');
      return { id: where.id, username, batchId: `batch-${username}`, batchAccountItemId: `item-${username}`, accessRequestId: null,
        status: username === 'service2' && failure === 'active_vpn' ? 'active' : 'revoked', revokedAt: new Date(), revokedBy: 'operator1', revokedReason: 'Retired.' };
    });
    mocks.statusFindFirst.mockResolvedValue({ newStatus: 'revoked' });
    return items.map((item) => ({ accountRef: `${action === 'delete_ad' ? 'ad' : 'vpn'}:${item.ldapUsername}`,
      directoryUsername: item.ldapUsername, vpnUsername: item.vpnUsername, vpnRecordId: `vpn-${item.vpnUsername}`,
      sourceBatchId: item.ldapUsername === 'service2' && failure === 'wrong_batch' ? 'wrong-batch' : item.batchId,
    }));
  }

  it.each(['delete_ad', 'delete_vpn_record'] as const)('creates %s across creation batches with per-target provenance', async (action) => {
    const targets = crossBatchTargets(action);
    const response = await POST(request(baseBody({ action, targets, destructiveAcknowledgement: 'DELETE 2 ACCOUNTS / 2 RECORDS' })));
    expect(response.status).toBe(201);
    const data = await response.json();
    expect(data.plan.manifest).toEqual(targets.map((target) => expect.objectContaining({
      key: target.accountRef, requestId: null, sourceBatchId: target.sourceBatchId, sourceBatchItemId: `item-${target.directoryUsername}`,
      operationMode: action === 'delete_ad' ? 'batch_governed' : 'governed',
    })));
    expect(mocks.planCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ sourceBatchId: null, totalTargets: 2, totalActions: 2 }) });
  });

  it.each([
    ['delete_ad', 'processing'], ['delete_ad', 'replaced_ad'], ['delete_ad', 'wrong_batch'],
    ['delete_vpn_record', 'processing'], ['delete_vpn_record', 'active_vpn'], ['delete_vpn_record', 'wrong_batch'],
  ] as const)('blocks %s when the second batch target has %s', async (action, failure) => {
    const targets = crossBatchTargets(action, failure);
    const response = await POST(request(baseBody({ action, targets, destructiveAcknowledgement: 'DELETE 2 ACCOUNTS / 2 RECORDS' })));
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe(failure === 'active_vpn' ? 'VPN_DELETE_NOT_READY' : 'BATCH_DELETE_NOT_READY');
    expect(mocks.planCreate).not.toHaveBeenCalled();
  });

});
