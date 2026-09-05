vi.mock('@/lib/account-display-names', () => ({ resolveAccountDisplayNames: vi.fn().mockResolvedValue(new Map()), findAccountUsernamesByName: vi.fn().mockResolvedValue([]) }));
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  checkAdminAuthWithRateLimit: vi.fn(),
  findMany: vi.fn(),
  count: vi.fn(),
  groupBy: vi.fn(),
  logAuditAction: vi.fn(),
  accessFindFirst: vi.fn(),
  accessFindMany: vi.fn(),
  lifecycleCreate: vi.fn(),
  lifecycleFindUnique: vi.fn(),
  lifecycleFindFirst: vi.fn(),
  planFindUnique: vi.fn(),
  planChildFindMany: vi.fn(),
  historyCreate: vi.fn(),
  processLifecycleAction: vi.fn(),
  moduleEnabled: vi.fn(),
  searchLDAPUser: vi.fn(),
  assertLifecycleAccountNotProtected: vi.fn(),
  accessFindUnique: vi.fn(),
  batchItemFindFirst: vi.fn(),
  batchItemFindMany: vi.fn(),
  batchItemFindUnique: vi.fn(),
  vpnFindUnique: vi.fn(),
  vpnFindMany: vi.fn(),
  vpnStatusFindFirst: vi.fn(),
  lockQuery: vi.fn(),
  cloneReadOnly: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('@/lib/adminAuth', () => ({
  checkAdminAuthWithRateLimit: mocks.checkAdminAuthWithRateLimit,
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    accountLifecycleAction: {
      findMany: mocks.findMany,
      count: mocks.count,
      groupBy: mocks.groupBy,
      create: mocks.lifecycleCreate,
      findUnique: mocks.lifecycleFindUnique,
      findFirst: mocks.lifecycleFindFirst,
    },
    accessRequest: {
      findUnique: mocks.accessFindUnique,
      findFirst: mocks.accessFindFirst,
      findMany: mocks.accessFindMany,
    },
    batchAccountItem: {
      findFirst: mocks.batchItemFindFirst,
      findMany: mocks.batchItemFindMany,
      findUnique: mocks.batchItemFindUnique,
    },
    vPNAccount: {
      findUnique: mocks.vpnFindUnique,
      findMany: mocks.vpnFindMany,
    },
    vPNAccountStatusLog: {
      findFirst: mocks.vpnStatusFindFirst,
    },
    accountLifecycleHistory: {
      create: mocks.historyCreate,
    },
    accountLifecycleBatch: {
      findUnique: mocks.planFindUnique,
    },
    $transaction: mocks.transaction,
  },
}));

vi.mock('@/lib/lifecycle-processor', () => ({
  processLifecycleAction: mocks.processLifecycleAction,
}));
vi.mock('@/lib/modules/core', () => ({ isModuleEnabled: mocks.moduleEnabled, isModuleEnabledStrict: mocks.moduleEnabled }));
vi.mock('@/lib/ldap', () => ({
  searchLDAPUser: mocks.searchLDAPUser,
}));
vi.mock('@/lib/lifecycle-protection', () => ({
  assertLifecycleAccountNotProtected: mocks.assertLifecycleAccountNotProtected,
}));
vi.mock('@/lib/clone-safety', () => ({ isProductionCloneReadOnly: mocks.cloneReadOnly }));

vi.mock('@/lib/audit-log', () => ({
  AuditActions: { CREATE_LIFECYCLE_ACTION: 'create_lifecycle_action' },
  AuditCategories: { USER: 'user' },
  getIpAddress: vi.fn(() => '127.0.0.1'),
  getUserAgent: vi.fn(() => 'vitest'),
  logAuditAction: mocks.logAuditAction,
}));

import { GET, POST } from './route';

function reviewedAdPlan(overrides: Record<string, unknown> = {}) {
  return {
    id: 'deletion-plan-1',
    status: 'processing',
    policyVersion: 'reviewed-lifecycle-deletion-plan-v1',
    requestedBy: 'admin1',
    confirmedAt: new Date('2026-09-04T18:00:00.000Z'),
    expiresAt: new Date('2099-09-04T18:15:00.000Z'),
    selectionDigest: 'selection-digest-1',
    description: 'Account owner confirmed permanent removal',
    relatedTicketId: 'INC-1042',
    notes: null,
    authorizationEvidence: {
      auditRecordedAt: '2026-09-04T18:00:01.000Z',
      action: 'delete_ad',
      directoryDeletionMethod: 'same-connection-final-preflight-immutable-guid-v1',
      targetCount: 1,
      recordCount: 1,
      typedAcknowledgement: 'DELETE 1 ACCOUNT / 1 RECORD',
      manifest: [{
        key: 'ad:person1',
        operationMode: 'governed',
        requestId: 'request-1',
        directory: {
          username: 'person1',
          dn: 'CN=person1,OU=Users,DC=example,DC=test',
          objectGuid: 'guid-person1',
        },
        vpn: null,
      }],
      children: [{ ordinal: 0, targetKey: 'ad:person1', actionType: 'delete_ad' }],
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkAdminAuthWithRateLimit.mockResolvedValue({
    admin: {
      username: 'admin1',
      permissions: new Set(['lifecycle.read', 'lifecycle.manage', 'lifecycle.delete', 'lifecycle.override', 'users.read', 'users.manage', 'vpn.manage', 'vpn.delete']),
      viaLegacyAdminFallback: false,
      viaLocalBreakGlass: false,
    },
    response: null,
  });
  mocks.findMany.mockResolvedValue([]);
  mocks.count.mockResolvedValue(0);
  mocks.groupBy.mockResolvedValue([]);
  mocks.accessFindFirst.mockResolvedValue(null);
  mocks.accessFindMany.mockResolvedValue([{
    id: 'request-1',
    status: 'approved',
    provisioningState: 'completed',
    ldapUsername: 'person1',
    linkedAdUsername: 'person1',
  }]);
  mocks.moduleEnabled.mockResolvedValue(true);
  mocks.assertLifecycleAccountNotProtected.mockResolvedValue(undefined);
  mocks.accessFindUnique.mockResolvedValue(null);
  mocks.batchItemFindFirst.mockResolvedValue(null);
  mocks.batchItemFindMany.mockResolvedValue([]);
  mocks.batchItemFindUnique.mockResolvedValue(null);
  mocks.vpnFindUnique.mockResolvedValue(null);
  mocks.vpnFindMany.mockResolvedValue([]);
  mocks.vpnStatusFindFirst.mockResolvedValue(null);
  mocks.lockQuery.mockResolvedValue([{ lock_acquired: 'locked' }]);
  mocks.searchLDAPUser.mockResolvedValue({
    objectName: 'CN=person1,OU=Users,DC=example,DC=test',
    attributes: [
      { type: 'sAMAccountName', values: ['person1'] },
      { type: 'userAccountControl', values: ['512'] },
      { type: 'memberOf', values: [] },
      { type: 'objectGUID', values: ['guid-person1'] },
    ],
  });
  mocks.cloneReadOnly.mockReturnValue(false);
  mocks.lifecycleCreate.mockResolvedValue({ id: 'action-1', status: 'queued' });
  mocks.lifecycleFindFirst.mockResolvedValue(null);
  mocks.planFindUnique.mockResolvedValue(null);
  mocks.planChildFindMany.mockResolvedValue([]);
  mocks.lifecycleFindUnique.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => (
    'idempotencyKey' in where ? null : { id: 'action-1', status: 'completed', history: [] }
  ));
  mocks.processLifecycleAction.mockResolvedValue({ success: true, actionId: 'action-1', adCompleted: true });
  mocks.transaction.mockImplementation(async (callback: (tx: {
    accountLifecycleAction: { create: typeof mocks.lifecycleCreate; findFirst: typeof mocks.lifecycleFindFirst; findMany: typeof mocks.planChildFindMany };
    accountLifecycleHistory: { create: typeof mocks.historyCreate };
    accountLifecycleBatch: { findUnique: typeof mocks.planFindUnique };
    accessRequest: { findMany: typeof mocks.accessFindMany; findFirst: typeof mocks.accessFindFirst; findUnique: typeof mocks.accessFindUnique };
    batchAccountItem: { findMany: typeof mocks.batchItemFindMany; findFirst: typeof mocks.batchItemFindFirst; findUnique: typeof mocks.batchItemFindUnique };
    vPNAccount: { findUnique: typeof mocks.vpnFindUnique };
    vPNAccountStatusLog: { findFirst: typeof mocks.vpnStatusFindFirst };
    $queryRaw: typeof mocks.lockQuery;
  }) => Promise<unknown>) => callback({
    accountLifecycleAction: { create: mocks.lifecycleCreate, findFirst: mocks.lifecycleFindFirst, findMany: mocks.planChildFindMany },
    accountLifecycleHistory: { create: mocks.historyCreate },
    accountLifecycleBatch: { findUnique: mocks.planFindUnique },
    accessRequest: { findMany: mocks.accessFindMany, findFirst: mocks.accessFindFirst, findUnique: mocks.accessFindUnique },
    batchAccountItem: { findMany: mocks.batchItemFindMany, findFirst: mocks.batchItemFindFirst, findUnique: mocks.batchItemFindUnique },
    vPNAccount: { findUnique: mocks.vpnFindUnique },
    vPNAccountStatusLog: { findFirst: mocks.vpnStatusFindFirst },
    $queryRaw: mocks.lockQuery,
  }));
});

describe('GET /api/admin/account-lifecycle', () => {
  it('returns the newest lifecycle actions first so recent offboards remain visible', async () => {
    const response = await GET(new NextRequest('https://example.test/api/admin/account-lifecycle'));

    await expect(response.json()).resolves.toEqual({
      items: [],
      pageInfo: { limit: 25, total: 0, hasNext: false, nextCursor: null },
      summary: {},
    });
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 26,
    }));
  });

  it('omits nested batch evidence and exposes read-only operation capabilities', async () => {
    mocks.checkAdminAuthWithRateLimit.mockResolvedValue({ admin: { username: 'viewer', permissions: new Set(['lifecycle.read']) }, response: null });
    mocks.findMany.mockResolvedValue([{ id: 'action-1', actionType: 'delete_ad', operationMode: 'request_governed', targetUsername: 'person1', requestedBy: 'admin1', createdAt: new Date(), history: [], _count: { history: 0 }, authorizationEvidence: { secret: 'manifest' } }]);
    const response = await GET(new NextRequest('https://example.test/api/admin/account-lifecycle'));
    const result = await response.json();
    expect(result.items[0]).toMatchObject({ canRetry: false, canCancel: false, canReconcile: false, authorizationEvidence: null, targetUsername: 'person1' });
    expect(result.items[0]).not.toHaveProperty('batch');
    expect(mocks.findMany.mock.calls[0][0].include).not.toHaveProperty('batch');
  });

  it('withholds deletion recovery from managers without deletion permission', async () => {
    mocks.checkAdminAuthWithRateLimit.mockResolvedValue({ admin: { username: 'manager', permissions: new Set(['lifecycle.read', 'lifecycle.manage', 'users.manage']) }, response: null });
    mocks.findMany.mockResolvedValue([{ id: 'action-1', actionType: 'delete_ad', targetUsername: 'person1', requestedBy: 'admin1', createdAt: new Date(), history: [], _count: { history: 0 } }]);
    const result = await (await GET(new NextRequest('https://example.test/api/admin/account-lifecycle'))).json();
    expect(result.items[0]).toMatchObject({ canRetry: false, canCancel: true, canReconcile: false });
  });

  it('returns 403 without lifecycle permission', async () => {
    mocks.checkAdminAuthWithRateLimit.mockResolvedValue({ admin: { username: 'viewer', permissions: new Set() }, response: null });
    const response = await GET(new NextRequest('https://example.test/api/admin/account-lifecycle'));
    expect(response.status).toBe(403);
  });

  it('rejects a cursor for a different query', async () => {
    const response = await GET(new NextRequest('https://example.test/api/admin/account-lifecycle?cursor=eyJ2IjoxfQ'));
    expect(response.status).toBe(400);
  });

  it('includes legacy and canonical group-add rows under the canonical filter', async () => {
    const response = await GET(new NextRequest('https://example.test/api/admin/account-lifecycle?actionType=add_group_member'));

    expect(response.status).toBe(200);
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { AND: [{ actionType: { in: ['add_group_member', 'add_to_group'] } }] },
    }));
  });

  it('refuses an AD lifecycle action before queueing when no request or batch item is linked', async () => {
    const response = await POST(new NextRequest('https://example.test/api/admin/account-lifecycle', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'test-confirmation-key-0001' },
      body: JSON.stringify({
        actionType: 'disable_ad',
        targetAccountType: 'AD',
        targetUsername: 'cis4710_team1',
        reason: 'Operator requested disable',
      }),
    }));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'LIFECYCLE_OWNER_REQUIRED' });
    expect(mocks.lifecycleCreate).not.toHaveBeenCalled();
  });

  it('blocks lifecycle mutations in production-clone mode before queueing', async () => {
    mocks.cloneReadOnly.mockReturnValue(true);

    const response = await POST(new NextRequest('https://example.test/api/admin/account-lifecycle', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'test-confirmation-key-0001' },
      body: JSON.stringify({
        actionType: 'disable_ad',
        targetAccountType: 'AD',
        targetUsername: 'person1',
        reason: 'Operator requested disable',
      }),
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'CLONE_READ_ONLY' });
    expect(mocks.lifecycleCreate).not.toHaveBeenCalled();
  });

  it('rejects a reviewed deletion child when reason or reference drifts after confirmation', async () => {
    mocks.planFindUnique.mockResolvedValue(reviewedAdPlan());

    const response = await POST(new NextRequest('https://example.test/api/admin/account-lifecycle', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'reviewed-delete-child-0001' },
      body: JSON.stringify({
        actionType: 'delete_ad',
        targetAccountType: 'AD',
        targetUsername: 'person1',
        relatedRequestId: 'request-1',
        relatedTicketId: 'INC-DIFFERENT',
        reason: 'Account owner confirmed permanent removal',
        deletionPlanId: 'deletion-plan-1',
        planTargetKey: 'ad:person1',
      }),
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining('changed after deletion-plan confirmation') });
    expect(mocks.searchLDAPUser).not.toHaveBeenCalled();
    expect(mocks.lifecycleCreate).not.toHaveBeenCalled();
  });

  it('requires a fresh plan before any child of an AD-containing legacy plan can start', async () => {
    const plan = reviewedAdPlan();
    mocks.planFindUnique.mockResolvedValue({
      ...plan,
      authorizationEvidence: { ...plan.authorizationEvidence, directoryDeletionMethod: undefined },
    });

    const response = await POST(new NextRequest('https://example.test/api/admin/account-lifecycle', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'reviewed-delete-child-stale-0001' },
      body: JSON.stringify({
        actionType: 'delete_ad', targetAccountType: 'AD', targetUsername: 'person1', relatedRequestId: 'request-1',
        relatedTicketId: 'INC-1042', reason: 'Account owner confirmed permanent removal',
        deletionPlanId: 'deletion-plan-1', planTargetKey: 'ad:person1',
      }),
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'DELETION_PLAN_REVIEW_REFRESH_REQUIRED' });
    expect(mocks.lifecycleCreate).not.toHaveBeenCalled();
  });

  it('blocks a VPN-first child when its combined plan predates the AD deletion method', async () => {
    const plan = reviewedAdPlan({
      authorizationEvidence: {
        ...reviewedAdPlan().authorizationEvidence,
        directoryDeletionMethod: undefined,
        action: 'delete_both_records',
      },
    });
    mocks.planFindUnique.mockResolvedValue(plan);

    const response = await POST(new NextRequest('https://example.test/api/admin/account-lifecycle', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'reviewed-delete-child-stale-vpn-0001' },
      body: JSON.stringify({
        actionType: 'delete_vpn_record', targetAccountType: 'VPN', targetUsername: 'person1',
        relatedTicketId: 'INC-1042', reason: 'Account owner confirmed permanent removal',
        deletionPlanId: 'deletion-plan-1', planTargetKey: 'ad:person1',
      }),
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'DELETION_PLAN_REVIEW_REFRESH_REQUIRED' });
    expect(mocks.lifecycleCreate).not.toHaveBeenCalled();
  });

  it('rejects a reviewed deletion child until its confirmation audit is durable', async () => {
    const plan = reviewedAdPlan();
    mocks.planFindUnique.mockResolvedValue({
      ...plan,
      authorizationEvidence: { ...plan.authorizationEvidence, auditRecordedAt: undefined },
    });

    const response = await POST(new NextRequest('https://example.test/api/admin/account-lifecycle', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'reviewed-delete-child-0002' },
      body: JSON.stringify({
        actionType: 'delete_ad', targetAccountType: 'AD', targetUsername: 'person1', relatedRequestId: 'request-1',
        relatedTicketId: 'INC-1042', reason: 'Account owner confirmed permanent removal',
        deletionPlanId: 'deletion-plan-1', planTargetKey: 'ad:person1',
      }),
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining('durable confirmation audit') });
    expect(mocks.lifecycleCreate).not.toHaveBeenCalled();
  });

  it('enforces the server-owned deletion child order while holding the plan lock', async () => {
    const disabledRequest = {
      id: 'request-1', status: 'approved', provisioningState: 'completed', adAccountStatus: 'disabled',
      version: 7, ldapUsername: 'person1', linkedAdUsername: 'person1',
    };
    const plan = reviewedAdPlan({
      authorizationEvidence: {
        ...reviewedAdPlan().authorizationEvidence,
        action: 'delete_both_records',
        recordCount: 2,
        children: [
          { ordinal: 0, targetKey: 'ad:person1', actionType: 'delete_vpn_record' },
          { ordinal: 1, targetKey: 'ad:person1', actionType: 'delete_ad' },
        ],
      },
    });
    mocks.planFindUnique.mockResolvedValue(plan);
    mocks.accessFindUnique.mockResolvedValue(disabledRequest);
    mocks.accessFindMany.mockResolvedValue([disabledRequest]);
    mocks.searchLDAPUser.mockResolvedValue({
      objectName: 'CN=person1,OU=Users,DC=example,DC=test',
      attributes: [
        { type: 'sAMAccountName', values: ['person1'] },
        { type: 'userAccountControl', values: ['514'] },
        { type: 'memberOf', values: [] },
        { type: 'objectGUID', values: ['guid-person1'] },
      ],
    });

    const response = await POST(new NextRequest('https://example.test/api/admin/account-lifecycle', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'reviewed-delete-child-0003' },
      body: JSON.stringify({
        actionType: 'delete_ad', targetAccountType: 'AD', targetUsername: 'person1', relatedRequestId: 'request-1',
        relatedTicketId: 'INC-1042', reason: 'Account owner confirmed permanent removal',
        deletionPlanId: 'deletion-plan-1', planTargetKey: 'ad:person1',
      }),
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'DELETION_PLAN_ORDER_REQUIRED' });
    expect(mocks.lockQuery).toHaveBeenCalled();
    expect(mocks.lifecycleCreate).not.toHaveBeenCalled();
  });

  it('returns a retryable conflict when a concurrent request wins a unique action slot', async () => {
    const uniqueConflict = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
    mocks.lifecycleCreate.mockRejectedValueOnce(uniqueConflict);
    mocks.accessFindUnique.mockResolvedValue({
      id: 'request-1', status: 'approved', provisioningState: 'completed', adAccountStatus: 'enabled', version: 1,
      ldapUsername: 'person1', linkedAdUsername: 'person1',
    });

    const response = await POST(new NextRequest('https://example.test/api/admin/account-lifecycle', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'concurrent-action-key-0001' },
      body: JSON.stringify({
        actionType: 'disable_ad', targetAccountType: 'AD', targetUsername: 'person1', relatedRequestId: 'request-1',
        reason: 'Disable access after review',
      }),
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'LIFECYCLE_IDEMPOTENCY_CONFLICT' });
  });

  it('accepts one lifecycle-ready portal owner and captures immutable directory identity', async () => {
    const matchedRequest = {
      id: 'request-1',
      status: 'approved',
      provisioningState: 'completed',
      ldapUsername: 'person1',
      linkedAdUsername: 'person1',
    };
    mocks.accessFindFirst.mockResolvedValue(matchedRequest);
    mocks.accessFindUnique.mockResolvedValue(matchedRequest);
    mocks.accessFindMany.mockResolvedValue([matchedRequest]);

    const response = await POST(new NextRequest('https://example.test/api/admin/account-lifecycle', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'test-confirmation-key-legacy-0001' },
      body: JSON.stringify({
        actionType: 'disable_ad',
        targetAccountType: 'AD',
        targetUsername: 'person1',
        relatedRequestId: 'request-1',
        reason: 'Operator requested disable',
      }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.lifecycleCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        operationMode: 'governed',
        relatedRequestId: 'request-1',
        targetDirectoryDn: 'CN=person1,OU=Users,DC=example,DC=test',
        targetDirectoryObjectGuid: 'guid-person1',
        bindingFailureCode: null,
        policyVersion: 'governed-directory-identity-v1',
        preflightSnapshot: expect.objectContaining({
          relatedRequestId: 'request-1',
          objectGuid: 'guid-person1',
        }),
      }),
    }));
  });

  it('rejects a governed AD action when the selected request has divergent aliases', async () => {
    const divergentRequest = {
      id: 'request-1', status: 'approved', provisioningState: 'completed',
      ldapUsername: 'person1', linkedAdUsername: 'reused-person1',
    };
    mocks.accessFindUnique.mockResolvedValue(divergentRequest);

    const response = await POST(new NextRequest('https://example.test/api/admin/account-lifecycle', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'divergent-alias-intake-0001' },
      body: JSON.stringify({
        actionType: 'disable_ad', targetAccountType: 'AD', targetUsername: 'person1',
        relatedRequestId: 'request-1', reason: 'Operator requested disable',
      }),
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'ACCESS_REQUEST_DIRECTORY_IDENTITY_CONFLICT' });
    expect(mocks.lifecycleCreate).not.toHaveBeenCalled();
  });

  it('rejects a directory account when more than one request claims its username', async () => {
    const first = {
      id: 'request-1', status: 'approved', provisioningState: 'completed',
      ldapUsername: 'person1', linkedAdUsername: 'person1',
    };
    mocks.accessFindFirst.mockResolvedValue(first);
    mocks.accessFindUnique.mockResolvedValue(first);
    mocks.accessFindMany.mockResolvedValue([first, { ...first, id: 'request-2' }]);

    const response = await POST(new NextRequest('https://example.test/api/admin/account-lifecycle', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'test-confirmation-key-legacy-0002' },
      body: JSON.stringify({
        actionType: 'disable_ad', targetAccountType: 'AD', targetUsername: 'person1',
        relatedRequestId: 'request-1', reason: 'Operator requested disable',
      }),
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'AMBIGUOUS_ACCESS_REQUEST_LINK' });
    expect(mocks.lifecycleCreate).not.toHaveBeenCalled();
  });

  it('rejects mixed ready and non-ready request owners before queueing', async () => {
    const ready = {
      id: 'request-1', status: 'approved', provisioningState: 'completed',
      ldapUsername: 'person1', linkedAdUsername: 'person1',
    };
    mocks.accessFindUnique.mockResolvedValue(ready);
    mocks.accessFindMany.mockResolvedValue([
      ready,
      { ...ready, id: 'request-2', provisioningState: 'reconciliation_required' },
    ]);

    const response = await POST(new NextRequest('https://example.test/api/admin/account-lifecycle', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'test-confirmation-key-owner-0001' },
      body: JSON.stringify({
        actionType: 'disable_ad', targetAccountType: 'AD', targetUsername: 'person1',
        relatedRequestId: 'request-1', reason: 'Operator requested disable',
      }),
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'AMBIGUOUS_ACCESS_REQUEST_LINK' });
    expect(mocks.lifecycleCreate).not.toHaveBeenCalled();
  });

  it('rechecks lifecycle readiness under the username lock before queueing', async () => {
    const ready = {
      id: 'request-1', status: 'approved', provisioningState: 'completed',
      ldapUsername: 'person1', linkedAdUsername: 'person1',
    };
    mocks.accessFindUnique.mockResolvedValue(ready);
    mocks.accessFindMany
      .mockResolvedValueOnce([ready])
      .mockResolvedValueOnce([{ ...ready, provisioningState: 'reconciliation_required' }]);

    const response = await POST(new NextRequest('https://example.test/api/admin/account-lifecycle', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'test-readiness-recheck-key-0001' },
      body: JSON.stringify({
        actionType: 'disable_ad', targetAccountType: 'AD', targetUsername: 'person1',
        relatedRequestId: 'request-1', reason: 'Operator requested disable',
      }),
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'LIFECYCLE_PREFLIGHT_CHANGED' });
    expect(mocks.lockQuery).toHaveBeenCalled();
    expect(mocks.lifecycleCreate).not.toHaveBeenCalled();
  });

  it('fails closed when AD aliases diverge after intake but before the username-lock queue check', async () => {
    const ready = {
      id: 'request-1', status: 'approved', provisioningState: 'completed',
      ldapUsername: 'person1', linkedAdUsername: 'person1',
    };
    mocks.accessFindUnique.mockResolvedValue(ready);
    mocks.accessFindMany
      .mockResolvedValueOnce([ready])
      .mockResolvedValueOnce([{ ...ready, linkedAdUsername: 'reused-person1' }]);

    const response = await POST(new NextRequest('https://example.test/api/admin/account-lifecycle', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'divergent-alias-lock-0001' },
      body: JSON.stringify({
        actionType: 'disable_ad', targetAccountType: 'AD', targetUsername: 'person1',
        relatedRequestId: 'request-1', reason: 'Operator requested disable',
      }),
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'LIFECYCLE_PREFLIGHT_CHANGED' });
    expect(mocks.lifecycleCreate).not.toHaveBeenCalled();
  });

  it.each(['rejected', 'offboarded'])('accepts the approved owner when a historical %s request retains the username', async (historicalStatus) => {
    const currentOwner = {
      id: 'request-1', status: 'approved', provisioningState: 'completed',
      ldapUsername: 'person1', linkedAdUsername: 'person1',
    };
    mocks.accessFindUnique.mockResolvedValue(currentOwner);
    mocks.accessFindMany.mockImplementation(async ({ where }: { where?: { status?: { notIn?: string[] } | string } }) => {
      const status = where?.status;
      if (typeof status === 'object' && status.notIn) return [currentOwner];
      return [{ ...currentOwner, id: 'historical-request', status: historicalStatus }];
    });

    const response = await POST(new NextRequest('https://example.test/api/admin/account-lifecycle', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': `test-history-${historicalStatus}-key` },
      body: JSON.stringify({
        actionType: 'disable_ad', targetAccountType: 'AD', targetUsername: 'person1',
        relatedRequestId: 'request-1', reason: 'Operator requested disable',
      }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.lifecycleCreate).toHaveBeenCalled();
    expect(mocks.lockQuery).toHaveBeenCalled();
  });

  it('accepts a normally approved terminal request when its live directory identity matches', async () => {
    mocks.accessFindFirst.mockResolvedValue({
      id: 'request-1',
      status: 'approved',
      provisioningState: null,
      ldapUsername: 'person1',
      linkedAdUsername: 'person1',
    });

    const response = await POST(new NextRequest('https://example.test/api/admin/account-lifecycle', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'test-confirmation-key-0001' },
      body: JSON.stringify({
        actionType: 'disable_ad',
        targetAccountType: 'AD',
        targetUsername: 'person1',
        reason: 'Operator requested disable',
      }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.lifecycleCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ relatedRequestId: 'request-1', status: 'queued' }),
    }));
    expect(mocks.processLifecycleAction).toHaveBeenCalledWith('action-1');
  });

  it('finds an offboarded request by username for a normal enable action', async () => {
    const offboardedRequest = {
      id: 'request-1',
      status: 'offboarded',
      provisioningState: null,
      ldapUsername: 'person1',
      linkedAdUsername: 'person1',
    };
    mocks.accessFindFirst.mockResolvedValue(offboardedRequest);
    mocks.accessFindMany.mockResolvedValue([offboardedRequest]);
    mocks.searchLDAPUser.mockResolvedValue({
      objectName: 'CN=person1,OU=Users,DC=example,DC=test',
      attributes: [
        { type: 'sAMAccountName', values: ['person1'] },
        { type: 'userAccountControl', values: ['514'] },
        { type: 'memberOf', values: [] },
        { type: 'objectGUID', values: ['guid-person1'] },
      ],
    });

    const response = await POST(new NextRequest('https://example.test/api/admin/account-lifecycle', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'test-confirmation-key-0001' },
      body: JSON.stringify({
        actionType: 'enable_ad',
        targetAccountType: 'AD',
        targetUsername: 'person1',
        reason: 'Operator requested restore',
      }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.accessFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ OR: expect.any(Array) }),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 2,
    }));
    expect(mocks.processLifecycleAction).toHaveBeenCalledWith('action-1');
  });

  it('queues permanent deletion only for a governed account confirmed disabled in both portal and AD', async () => {
    const disabledRequest = {
      id: 'request-1',
      status: 'approved',
      provisioningState: 'completed',
      adAccountStatus: 'disabled',
      ldapUsername: 'person1',
      linkedAdUsername: 'person1',
    };
    mocks.accessFindUnique.mockResolvedValue(disabledRequest);
    mocks.accessFindMany.mockResolvedValue([disabledRequest]);
    mocks.searchLDAPUser.mockResolvedValue({
      objectName: 'CN=person1,OU=Users,DC=example,DC=test',
      attributes: [
        { type: 'sAMAccountName', values: ['person1'] },
        { type: 'userAccountControl', values: ['514'] },
        { type: 'memberOf', values: [] },
        { type: 'objectGUID', values: ['guid-person1'] },
      ],
    });

    const response = await POST(new NextRequest('https://example.test/api/admin/account-lifecycle', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'test-delete-confirmation-0001' },
      body: JSON.stringify({
        actionType: 'delete_ad',
        targetAccountType: 'AD',
        targetUsername: 'person1',
        relatedRequestId: 'request-1',
        relatedTicketId: 'INC-1042',
        destructiveAcknowledgement: 'DELETE person1',
        irreversibleAcknowledgement: true,
        reason: 'Account owner confirmed permanent removal',
      }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.lifecycleCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        actionType: 'delete_ad',
        canRestore: false,
        policyVersion: 'governed-directory-delete-v3',
        authorizationEvidence: expect.objectContaining({
          destructiveAction: 'delete_ad',
          typedAcknowledgement: 'DELETE person1',
          irreversibleImpactAcknowledged: true,
          ticketReference: 'INC-1042',
          safetyChecks: expect.objectContaining({
            uniqueRequestOwnerVerified: true,
            portalDisabledVerified: true,
            liveDirectoryDisabledVerified: true,
            immutableIdentityCaptured: true,
          }),
        }),
        preflightSnapshot: expect.objectContaining({ enabled: false, objectGuid: 'guid-person1' }),
      }),
    }));
  });

  it('queues permanent deletion against the batch item without fabricating a request owner', async () => {
    const batchItem = {
      id: 'batch-item-1',
      batchId: 'creation-batch-1',
      batch: { id: 'creation-batch-1', description: 'Workshop identities' },
      lifecycleOwnerKind: 'batch_item',
      accessRequestId: null,
      accountType: 'AD',
      status: 'completed',
      mutationStage: 'completed',
      ldapUsername: 'person1',
      name: 'Person One',
      email: 'person1@example.test',
      version: 3,
      adAccountStatus: 'disabled',
      adDisabledAt: new Date('2026-09-04T18:00:00.000Z'),
      adDisabledBy: 'admin1',
      adDisabledReason: 'Batch expired.',
      targetDirectoryDn: 'CN=person1,OU=Users,DC=example,DC=test',
      targetDirectoryObjectGuid: 'guid-person1',
    };
    mocks.accessFindMany.mockResolvedValue([]);
    mocks.batchItemFindUnique.mockResolvedValue(batchItem);
    mocks.batchItemFindMany.mockResolvedValue([{ id: 'batch-item-1' }]);
    mocks.searchLDAPUser.mockResolvedValue({
      objectName: batchItem.targetDirectoryDn,
      attributes: [
        { type: 'sAMAccountName', values: ['person1'] },
        { type: 'userAccountControl', values: ['514'] },
        { type: 'memberOf', values: [] },
        { type: 'objectGUID', values: ['guid-person1'] },
      ],
    });

    const response = await POST(new NextRequest('https://example.test/api/admin/account-lifecycle', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'batch-delete-confirmation-0001' },
      body: JSON.stringify({
        actionType: 'delete_ad',
        targetAccountType: 'AD',
        targetUsername: 'person1',
        operationMode: 'batch_governed',
        relatedBatchAccountItemId: 'batch-item-1',
        relatedTicketId: 'INC-1043',
        destructiveAcknowledgement: 'DELETE person1',
        irreversibleAcknowledgement: true,
        reason: 'Batch owner confirmed permanent removal',
      }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.lifecycleCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        operationMode: 'batch_governed',
        relatedRequestId: null,
        relatedBatchAccountItemId: 'batch-item-1',
        targetUserId: 'batch-item-1',
        policyVersion: 'batch-governed-directory-delete-v2',
        preflightSnapshot: expect.objectContaining({ batchItemVersion: 3, sourceBatchId: 'creation-batch-1' }),
      }),
    }));
  });

  it('blocks batch-governed intake when a processing batch claim competes with the selected completed item', async () => {
    const batchItem = {
      id: 'batch-item-1', batchId: 'creation-batch-1', lifecycleOwnerKind: 'batch_item', accessRequestId: null,
      accountType: 'AD', status: 'completed', ldapUsername: 'person1', version: 3, adAccountStatus: 'active',
      targetDirectoryDn: 'CN=person1,OU=Users,DC=example,DC=test', targetDirectoryObjectGuid: 'guid-person1',
    };
    mocks.accessFindMany.mockResolvedValue([]);
    mocks.batchItemFindUnique.mockResolvedValue(batchItem);
    mocks.batchItemFindMany.mockResolvedValue([{ id: 'batch-item-1' }, { id: 'batch-item-processing' }]);

    const response = await POST(new NextRequest('https://example.test/api/admin/account-lifecycle', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'batch-processing-claim-intake-0001' },
      body: JSON.stringify({
        actionType: 'disable_ad', targetAccountType: 'AD', targetUsername: 'person1', operationMode: 'batch_governed',
        relatedBatchAccountItemId: 'batch-item-1', reason: 'Disable the completed batch identity',
      }),
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'BATCH_ACCOUNT_LINK_REQUIRED' });
    expect(mocks.lifecycleCreate).not.toHaveBeenCalled();
    expect(mocks.batchItemFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: { in: ['processing', 'completed', 'reconciliation_required'] },
        OR: [{ adAccountStatus: null }, { adAccountStatus: { not: 'deleted' } }],
      }),
    }));
  });

  it('keeps a deleted historical batch projection out of batch-governed ownership discovery', async () => {
    const batchItem = {
      id: 'batch-item-1', batchId: 'creation-batch-1', lifecycleOwnerKind: 'batch_item', accessRequestId: null,
      accountType: 'AD', status: 'completed', ldapUsername: 'person1', version: 3, adAccountStatus: 'disabled',
      targetDirectoryDn: 'CN=person1,OU=Users,DC=example,DC=test', targetDirectoryObjectGuid: 'guid-person1',
    };
    mocks.accessFindMany.mockResolvedValue([]);
    mocks.batchItemFindUnique.mockResolvedValue(batchItem);
    mocks.batchItemFindMany.mockImplementation(async ({ where }: { where: { OR?: unknown } }) => {
      expect(where.OR).toEqual([{ adAccountStatus: null }, { adAccountStatus: { not: 'deleted' } }]);
      // The database excludes the retained deleted item, leaving only the selected owner.
      return [{ id: 'batch-item-1' }];
    });
    mocks.searchLDAPUser.mockResolvedValue({
      objectName: batchItem.targetDirectoryDn,
      attributes: [
        { type: 'sAMAccountName', values: ['person1'] }, { type: 'userAccountControl', values: ['514'] },
        { type: 'objectGUID', values: ['guid-person1'] },
      ],
    });

    const response = await POST(new NextRequest('https://example.test/api/admin/account-lifecycle', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'batch-deleted-history-intake-0001' },
      body: JSON.stringify({
        actionType: 'delete_ad', targetAccountType: 'AD', targetUsername: 'person1', operationMode: 'batch_governed',
        relatedBatchAccountItemId: 'batch-item-1', relatedTicketId: 'INC-1043', destructiveAcknowledgement: 'DELETE person1',
        irreversibleAcknowledgement: true, reason: 'Delete the completed batch identity after review',
      }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.lifecycleCreate).toHaveBeenCalled();
  });

  it('rejects permanent deletion while the live directory account is enabled', async () => {
    const requestOwner = {
      id: 'request-1', status: 'approved', provisioningState: 'completed', adAccountStatus: 'disabled',
      ldapUsername: 'person1', linkedAdUsername: 'person1',
    };
    mocks.accessFindUnique.mockResolvedValue(requestOwner);
    mocks.accessFindMany.mockResolvedValue([requestOwner]);

    const response = await POST(new NextRequest('https://example.test/api/admin/account-lifecycle', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'test-delete-confirmation-0002' },
      body: JSON.stringify({
        actionType: 'delete_ad', targetAccountType: 'AD', targetUsername: 'person1',
        relatedRequestId: 'request-1', relatedTicketId: 'INC-1042', destructiveAcknowledgement: 'DELETE person1', irreversibleAcknowledgement: true,
        reason: 'Account owner confirmed permanent removal',
      }),
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'AD_ACTION_NOT_APPLICABLE' });
    expect(mocks.lifecycleCreate).not.toHaveBeenCalled();
  });

  it('requires the dedicated deletion privilege', async () => {
    mocks.checkAdminAuthWithRateLimit.mockResolvedValue({
      admin: {
        username: 'admin1',
        permissions: new Set(['lifecycle.manage', 'users.manage']),
        viaLegacyAdminFallback: false,
      },
      response: null,
    });

    const denied = await POST(new NextRequest('https://example.test/api/admin/account-lifecycle', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'test-delete-confirmation-0003' },
      body: JSON.stringify({
        actionType: 'delete_ad', targetAccountType: 'AD', targetUsername: 'person1',
        relatedRequestId: 'request-1', relatedTicketId: 'INC-1042', destructiveAcknowledgement: 'DELETE person1', irreversibleAcknowledgement: true,
        reason: 'Account owner confirmed permanent removal',
      }),
    }));
    expect(denied.status).toBe(403);
    expect(mocks.lifecycleCreate).not.toHaveBeenCalled();
  });

  it.each([
    [{ reason: '   ' }, 'reason are required'],
    [{ reason: 'short' }, 'substantive reason'],
    [{ relatedTicketId: 'x' }, 'between 3 and 200'],
    [{ destructiveAcknowledgement: 'DELETE Person1' }, 'DELETE person1 exactly'],
    [{ irreversibleAcknowledgement: false }, 'cannot be restored'],
  ])('rejects inadequate irreversible deletion evidence %#', async (override, expectedError) => {
    const response = await POST(new NextRequest('https://example.test/api/admin/account-lifecycle', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': `test-delete-evidence-${JSON.stringify(override).length}-0001` },
      body: JSON.stringify({
        actionType: 'delete_ad', targetAccountType: 'AD', targetUsername: 'person1',
        relatedRequestId: 'request-1', relatedTicketId: 'INC-1042', destructiveAcknowledgement: 'DELETE person1', irreversibleAcknowledgement: true,
        reason: 'Account owner confirmed permanent removal',
        ...override,
      }),
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining(expectedError) });
    expect(mocks.lifecycleCreate).not.toHaveBeenCalled();
  });

  it('admits a reviewed unmanaged deletion after a deleted batch username is reused', async () => {
    const auth = await mocks.checkAdminAuthWithRateLimit();
    auth.admin.permissions.add('lifecycle.delete_unmanaged');
    mocks.accessFindMany.mockResolvedValue([]);
    const plan = reviewedAdPlan();
    mocks.planFindUnique.mockResolvedValue({ ...plan, authorizationEvidence: {
      ...plan.authorizationEvidence,
      manifest: [{ ...plan.authorizationEvidence.manifest[0], operationMode: 'directory_override', requestId: null }],
    } });
    mocks.searchLDAPUser.mockResolvedValue({ objectName: 'CN=person1,OU=Users,DC=example,DC=test', attributes: [
      { type: 'sAMAccountName', values: ['person1'] }, { type: 'userAccountControl', values: ['514'] },
      { type: 'memberOf', values: [] }, { type: 'objectGUID', values: ['guid-person1'] },
    ] });
    // Simulate a real query: the historical deleted owner is excluded only
    // when both preflight and the locked recheck use the live-claim predicate.
    mocks.batchItemFindFirst.mockImplementation(async ({ where }: { where: { OR?: unknown } }) => where.OR ? null : { id: 'deleted-item' });
    const response = await POST(new NextRequest('https://example.test/api/admin/account-lifecycle', {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'reused-directory-object-0001' },
      body: JSON.stringify({ actionType: 'delete_ad', targetAccountType: 'AD', targetUsername: 'person1',
        reason: plan.description, relatedTicketId: plan.relatedTicketId,
        deletionPlanId: plan.id, planTargetKey: 'ad:person1' }),
    }));
    expect(response.status).toBe(200);
    expect(mocks.batchItemFindFirst).toHaveBeenCalledTimes(2);
    for (const [query] of mocks.batchItemFindFirst.mock.calls) {
      expect(query.where.OR).toEqual([{ adAccountStatus: null }, { adAccountStatus: { not: 'deleted' } }]);
    }
    expect(mocks.lifecycleCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ relatedRequestId: null, relatedBatchAccountItemId: null }) }));
  });

  it('allows a single evidenced directory override without fabricating an access request', async () => {
    const response = await POST(new NextRequest('https://example.test/api/admin/account-lifecycle', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'test-confirmation-key-0001' },
      body: JSON.stringify({
        actionType: 'disable_ad',
        targetAccountType: 'AD',
        targetUsername: 'person1',
        reason: 'Disable an unmanaged legacy directory account',
        relatedTicketId: 'INC-1042',
        operationMode: 'directory_override',
        exceptionEvidence: 'No governed request exists; ownership was verified in incident INC-1042.',
        overrideAcknowledgement: 'person1',
      }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.lifecycleCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        operationMode: 'directory_override',
        targetDirectoryDn: 'CN=person1,OU=Users,DC=example,DC=test',
        bindingFailureCode: 'APPLICATION_REQUEST_LINK_MISSING',
        relatedRequestId: null,
        targetUserId: null,
      }),
    }));
  });

  it('rechecks directory override ownership under the username lock before queueing', async () => {
    mocks.accessFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'request-created-concurrently' });

    const response = await POST(new NextRequest('https://example.test/api/admin/account-lifecycle', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'test-override-lock-key-0001' },
      body: JSON.stringify({
        actionType: 'disable_ad', targetAccountType: 'AD', targetUsername: 'person1',
        reason: 'Disable unmanaged account', relatedTicketId: 'INC-1042', operationMode: 'directory_override',
        exceptionEvidence: 'Ownership was checked and documented in incident INC-1042.',
        overrideAcknowledgement: 'person1',
      }),
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'DIRECTORY_OVERRIDE_NOT_ALLOWED' });
    expect(mocks.lockQuery).toHaveBeenCalled();
    expect(mocks.lifecycleCreate).not.toHaveBeenCalled();
  });

  it('requires the override privilege for a directory-only action', async () => {
    mocks.checkAdminAuthWithRateLimit.mockResolvedValue({
      admin: {
        username: 'admin1',
        permissions: new Set(['lifecycle.read', 'lifecycle.manage', 'users.read', 'users.manage']),
        viaLegacyAdminFallback: false,
      },
      response: null,
    });

    const response = await POST(new NextRequest('https://example.test/api/admin/account-lifecycle', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'test-confirmation-key-0001' },
      body: JSON.stringify({
        actionType: 'disable_ad', targetAccountType: 'AD', targetUsername: 'person1',
        reason: 'Disable legacy account', relatedTicketId: 'INC-1042', operationMode: 'directory_override',
        exceptionEvidence: 'No governed request exists and ownership was independently verified.',
        overrideAcknowledgement: 'person1',
      }),
    }));

    expect(response.status).toBe(403);
    expect(mocks.lifecycleCreate).not.toHaveBeenCalled();
  });

  it('does not allow directory override when an application record exists', async () => {
    mocks.accessFindFirst.mockResolvedValue({ id: 'request-1', status: 'approved' });

    const response = await POST(new NextRequest('https://example.test/api/admin/account-lifecycle', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'test-confirmation-key-0001' },
      body: JSON.stringify({
        actionType: 'disable_ad', targetAccountType: 'AD', targetUsername: 'person1',
        reason: 'Disable legacy account', relatedTicketId: 'INC-1042', operationMode: 'directory_override',
        exceptionEvidence: 'No governed request exists and ownership was independently verified.',
        overrideAcknowledgement: 'person1',
      }),
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'DIRECTORY_OVERRIDE_NOT_ALLOWED' });
    expect(mocks.lifecycleCreate).not.toHaveBeenCalled();
  });

  it('accepts a VPN action only when the VPN and request identity evidence agree', async () => {
    mocks.vpnFindUnique.mockResolvedValue({
      id: 'vpn-1',
      username: 'vpn-person1',
      adUsername: 'person1',
      accessRequestId: 'request-1',
      status: 'active',
      portalType: 'Limited',
      canRestore: true,
    });
    mocks.accessFindUnique.mockResolvedValue({
      id: 'request-1',
      vpnUsername: 'vpn-person1',
      linkedVpnUsername: 'vpn-person1',
      ldapUsername: 'person1',
      linkedAdUsername: 'person1',
    });

    const response = await POST(new NextRequest('https://example.test/api/admin/account-lifecycle', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'test-vpn-confirmation-key-0001' },
      body: JSON.stringify({
        actionType: 'revoke_vpn', targetAccountType: 'VPN', targetUsername: 'vpn-person1',
        relatedRequestId: 'request-1', reason: 'Remove VPN access',
      }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.lifecycleCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ targetUserId: 'vpn-1', relatedRequestId: 'request-1' }),
    }));
  });

  it('queues one revoked VPN record for permanent deletion with durable evidence', async () => {
    mocks.accessFindMany.mockResolvedValue([]);
    mocks.vpnFindUnique.mockResolvedValue({
      id: 'vpn-1', username: 'vpn-person1', adUsername: null, accessRequestId: null,
      status: 'revoked', portalType: 'Limited', canRestore: false,
      revokedAt: new Date('2026-08-30T20:00:00.000Z'), revokedBy: 'admin0', revokedReason: 'Expired service access',
    });
    mocks.vpnStatusFindFirst.mockResolvedValue({
      id: 'vpn-status-1', accountId: 'vpn-1', newStatus: 'revoked', createdAt: new Date('2026-08-30T20:00:00.000Z'),
    });

    const response = await POST(new NextRequest('https://example.test/api/admin/account-lifecycle', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'test-vpn-delete-key-0001' },
      body: JSON.stringify({
        actionType: 'delete_vpn_record', targetAccountType: 'VPN', targetUsername: 'vpn-person1',
        reason: 'Expired service access cleanup', relatedTicketId: 'CHG-2042',
        destructiveAcknowledgement: 'DELETE VPN RECORD vpn-person1', irreversibleAcknowledgement: true,
      }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.lifecycleCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        actionType: 'delete_vpn_record', targetUserId: 'vpn-1', relatedRequestId: null,
        relatedTicketId: 'CHG-2042', policyVersion: 'vpn-record-delete-v1', canRestore: false,
      }),
    }));
  });

  it('blocks a permanent VPN deletion when a processing batch reservation claims the username', async () => {
    const claim = {
      id: 'vpn-batch-1', batchId: 'batch-1', lifecycleOwnerKind: 'batch_item', accessRequestId: null,
      accountType: 'VPN', status: 'processing', ldapUsername: 'vpn-person1', vpnUsername: 'vpn-person1', version: 2,
    };
    mocks.vpnFindUnique.mockResolvedValue({
      id: 'vpn-1', username: 'vpn-person1', adUsername: null, accessRequestId: null, batchId: 'batch-1', batchAccountItemId: 'vpn-batch-1',
      status: 'revoked', portalType: 'Limited', canRestore: false,
      revokedAt: new Date('2026-08-30T20:00:00.000Z'), revokedBy: 'admin0', revokedReason: 'Expired service access',
    });
    mocks.batchItemFindUnique.mockResolvedValue(claim);
    mocks.batchItemFindMany.mockResolvedValue([claim]);

    const response = await POST(new NextRequest('https://example.test/api/admin/account-lifecycle', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'test-vpn-batch-processing-01' },
      body: JSON.stringify({
        actionType: 'delete_vpn_record', targetAccountType: 'VPN', targetUsername: 'vpn-person1',
        relatedBatchAccountItemId: 'vpn-batch-1', reason: 'Expired service access cleanup', relatedTicketId: 'CHG-2042',
        destructiveAcknowledgement: 'DELETE VPN RECORD vpn-person1', irreversibleAcknowledgement: true,
      }),
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'VPN_BATCH_DELETE_NOT_READY' });
    expect(mocks.lifecycleCreate).not.toHaveBeenCalled();
    expect(mocks.batchItemFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: { in: ['processing', 'completed', 'reconciliation_required'] },
        OR: [
          { vpnUsername: { equals: 'vpn-person1', mode: 'insensitive' } },
          { ldapUsername: { equals: 'vpn-person1', mode: 'insensitive' } },
        ],
      }),
    }));
  });

  it('rejects a reviewed VPN deletion when a request appears after a null-owner plan confirmation', async () => {
    mocks.planFindUnique.mockResolvedValue(reviewedAdPlan({
      authorizationEvidence: {
        ...reviewedAdPlan().authorizationEvidence,
        action: 'delete_vpn_record',
        manifest: [{
          key: 'vpn:vpn-person1', operationMode: 'governed', requestId: null, sourceBatchItemId: null,
          directory: null, vpn: { id: 'vpn-1', username: 'vpn-person1' },
        }],
        children: [{ ordinal: 0, targetKey: 'vpn:vpn-person1', actionType: 'delete_vpn_record' }],
      },
    }));
    mocks.vpnFindUnique.mockResolvedValue({
      id: 'vpn-1', username: 'vpn-person1', adUsername: null, accessRequestId: 'request-new', batchId: null, batchAccountItemId: null,
      status: 'revoked', portalType: 'Limited', canRestore: false,
      revokedAt: new Date('2026-08-30T20:00:00.000Z'), revokedBy: 'admin0', revokedReason: 'Expired service access',
    });

    const response = await POST(new NextRequest('https://example.test/api/admin/account-lifecycle', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'reviewed-vpn-null-owner-drift-01' },
      body: JSON.stringify({
        actionType: 'delete_vpn_record', targetAccountType: 'VPN', targetUsername: 'vpn-person1',
        relatedTicketId: 'INC-1042', reason: 'Account owner confirmed permanent removal',
        deletionPlanId: 'deletion-plan-1', planTargetKey: 'vpn:vpn-person1',
      }),
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining('request ownership changed') });
    expect(mocks.lifecycleCreate).not.toHaveBeenCalled();
  });

  it('invalidates a VPN deletion when a batch claim appears under the ownership fence', async () => {
    const confirmed = {
      id: 'vpn-1', username: 'vpn-person1', adUsername: null, accessRequestId: null, batchId: null, batchAccountItemId: null,
      status: 'revoked', portalType: 'Limited', canRestore: false,
      revokedAt: new Date('2026-08-30T20:00:00.000Z'), revokedBy: 'admin0', revokedReason: 'Expired service access',
    };
    mocks.accessFindMany.mockResolvedValue([]);
    mocks.vpnFindUnique.mockResolvedValue(confirmed);
    mocks.vpnStatusFindFirst.mockResolvedValue({ id: 'vpn-status-1', accountId: 'vpn-1', newStatus: 'revoked', createdAt: confirmed.revokedAt });
    mocks.batchItemFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: 'vpn-batch-2', batchId: 'batch-2', lifecycleOwnerKind: 'batch_item', accessRequestId: null,
        accountType: 'VPN', status: 'processing', ldapUsername: 'vpn-person1', vpnUsername: 'vpn-person1', version: 1,
      }]);

    const response = await POST(new NextRequest('https://example.test/api/admin/account-lifecycle', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'test-vpn-batch-lock-race-01' },
      body: JSON.stringify({
        actionType: 'delete_vpn_record', targetAccountType: 'VPN', targetUsername: 'vpn-person1',
        reason: 'Expired service access cleanup', relatedTicketId: 'CHG-2042',
        destructiveAcknowledgement: 'DELETE VPN RECORD vpn-person1', irreversibleAcknowledgement: true,
      }),
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'VPN_DELETE_PREFLIGHT_CHANGED' });
    expect(mocks.lifecycleCreate).not.toHaveBeenCalled();
  });

  it('blocks deletion when an active request claims an otherwise unlinked VPN username', async () => {
    mocks.vpnFindUnique.mockResolvedValue({
      id: 'vpn-1', username: 'vpn-person1', adUsername: null, accessRequestId: null,
      status: 'revoked', portalType: 'Limited', canRestore: false,
      revokedAt: new Date('2026-08-30T20:00:00.000Z'), revokedBy: 'admin0', revokedReason: 'Expired service access',
    });
    mocks.accessFindMany.mockResolvedValue([{ id: 'request-2', version: 9 }]);

    const response = await POST(new NextRequest('https://example.test/api/admin/account-lifecycle', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'test-vpn-delete-link-race-01' },
      body: JSON.stringify({
        actionType: 'delete_vpn_record', targetAccountType: 'VPN', targetUsername: 'vpn-person1',
        reason: 'Expired service access cleanup', relatedTicketId: 'CHG-2042',
        destructiveAcknowledgement: 'DELETE VPN RECORD vpn-person1', irreversibleAcknowledgement: true,
      }),
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'VPN_REQUEST_LINK_CONFLICT' });
    expect(mocks.lifecycleCreate).not.toHaveBeenCalled();
  });

  it('invalidates deletion confirmation when revocation evidence changes under the lock', async () => {
    const confirmed = {
      id: 'vpn-1', username: 'vpn-person1', adUsername: null, accessRequestId: null,
      status: 'revoked', portalType: 'Limited', canRestore: false,
      revokedAt: new Date('2026-08-30T20:00:00.000Z'), revokedBy: 'admin0', revokedReason: 'Expired service access',
    };
    mocks.accessFindMany.mockResolvedValue([]);
    mocks.vpnFindUnique
      .mockResolvedValueOnce(confirmed)
      .mockResolvedValueOnce({ ...confirmed, revokedAt: new Date('2026-08-31T20:00:00.000Z') });
    mocks.vpnStatusFindFirst.mockResolvedValue({
      id: 'vpn-status-1', accountId: 'vpn-1', newStatus: 'revoked', createdAt: confirmed.revokedAt,
    });

    const response = await POST(new NextRequest('https://example.test/api/admin/account-lifecycle', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'test-vpn-delete-state-race-01' },
      body: JSON.stringify({
        actionType: 'delete_vpn_record', targetAccountType: 'VPN', targetUsername: 'vpn-person1',
        reason: 'Expired service access cleanup', relatedTicketId: 'CHG-2042',
        destructiveAcknowledgement: 'DELETE VPN RECORD vpn-person1', irreversibleAcknowledgement: true,
      }),
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'VPN_DELETE_PREFLIGHT_CHANGED' });
    expect(mocks.lifecycleCreate).not.toHaveBeenCalled();
  });

  it('returns committed success when response enrichment and secondary audit fail', async () => {
    mocks.accessFindMany.mockResolvedValue([]);
    mocks.vpnFindUnique.mockResolvedValue({
      id: 'vpn-1', username: 'vpn-person1', adUsername: null, accessRequestId: null,
      status: 'revoked', portalType: 'Limited', canRestore: false,
      revokedAt: new Date('2026-08-30T20:00:00.000Z'), revokedBy: 'admin0', revokedReason: 'Expired service access',
    });
    mocks.vpnStatusFindFirst.mockResolvedValue({
      id: 'vpn-status-1', accountId: 'vpn-1', newStatus: 'revoked', createdAt: new Date('2026-08-30T20:00:00.000Z'),
    });
    mocks.lifecycleFindUnique.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
      if ('idempotencyKey' in where) return null;
      throw new Error('read replica unavailable');
    });
    mocks.logAuditAction.mockRejectedValue(new Error('secondary audit unavailable'));

    const response = await POST(new NextRequest('https://example.test/api/admin/account-lifecycle', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'test-vpn-delete-postcommit-01' },
      body: JSON.stringify({
        actionType: 'delete_vpn_record', targetAccountType: 'VPN', targetUsername: 'vpn-person1',
        reason: 'Expired service access cleanup', relatedTicketId: 'CHG-2042',
        destructiveAcknowledgement: 'DELETE VPN RECORD vpn-person1', irreversibleAcknowledgement: true,
      }),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ success: true, processResult: { success: true } });
  });

  it('requires vpn.delete before permanent VPN record deletion', async () => {
    mocks.checkAdminAuthWithRateLimit.mockResolvedValue({
      admin: { username: 'vpn-admin', permissions: new Set(['lifecycle.manage', 'vpn.manage']) },
      response: null,
    });
    const response = await POST(new NextRequest('https://example.test/api/admin/account-lifecycle', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'test-vpn-delete-key-0002' },
      body: JSON.stringify({
        actionType: 'delete_vpn_record', targetAccountType: 'VPN', targetUsername: 'vpn-person1',
        reason: 'Expired service access cleanup', relatedTicketId: 'CHG-2042',
        destructiveAcknowledgement: 'DELETE VPN RECORD vpn-person1', irreversibleAcknowledgement: true,
      }),
    }));
    expect(response.status).toBe(403);
    expect(mocks.lifecycleCreate).not.toHaveBeenCalled();
  });

  it('blocks VPN record deletion when revocation evidence is incomplete', async () => {
    mocks.accessFindMany.mockResolvedValue([]);
    mocks.vpnFindUnique.mockResolvedValue({
      id: 'vpn-1', username: 'vpn-person1', adUsername: null, accessRequestId: null,
      status: 'revoked', portalType: 'Limited', canRestore: false,
      revokedAt: null, revokedBy: null, revokedReason: null,
    });
    const response = await POST(new NextRequest('https://example.test/api/admin/account-lifecycle', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'test-vpn-delete-key-0003' },
      body: JSON.stringify({
        actionType: 'delete_vpn_record', targetAccountType: 'VPN', targetUsername: 'vpn-person1',
        reason: 'Expired service access cleanup', relatedTicketId: 'CHG-2042',
        destructiveAcknowledgement: 'DELETE VPN RECORD vpn-person1', irreversibleAcknowledgement: true,
      }),
    }));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'VPN_DELETE_REVOCATION_EVIDENCE_REQUIRED' });
    expect(mocks.lifecycleCreate).not.toHaveBeenCalled();
  });

  it('fails closed when VPN module state cannot be verified for deletion', async () => {
    mocks.moduleEnabled.mockRejectedValue(new Error('database unavailable'));
    const response = await POST(new NextRequest('https://example.test/api/admin/account-lifecycle', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'test-vpn-delete-key-0004' },
      body: JSON.stringify({
        actionType: 'delete_vpn_record', targetAccountType: 'VPN', targetUsername: 'vpn-person1',
        reason: 'Expired service access cleanup', relatedTicketId: 'CHG-2042',
        destructiveAcknowledgement: 'DELETE VPN RECORD vpn-person1', irreversibleAcknowledgement: true,
      }),
    }));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ code: 'MODULE_STATE_UNAVAILABLE' });
    expect(mocks.lifecycleCreate).not.toHaveBeenCalled();
  });

  it('blocks a VPN restore when the account restore policy forbids it', async () => {
    mocks.vpnFindUnique.mockResolvedValue({
      id: 'vpn-1', username: 'vpn-person1', adUsername: null, accessRequestId: null,
      status: 'revoked', portalType: 'Limited', canRestore: false,
    });

    const response = await POST(new NextRequest('https://example.test/api/admin/account-lifecycle', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'test-vpn-confirmation-key-restore' },
      body: JSON.stringify({
        actionType: 'restore_vpn', targetAccountType: 'VPN', targetUsername: 'vpn-person1', reason: 'Restore VPN access',
      }),
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'VPN_ACTION_NOT_APPLICABLE' });
    expect(mocks.lifecycleCreate).not.toHaveBeenCalled();
  });

  it('blocks a combined action when multiple VPN targets claim the same request', async () => {
    const requestOwner = {
      id: 'request-1', status: 'approved', provisioningState: 'completed',
      ldapUsername: 'person1', linkedAdUsername: 'person1', vpnUsername: 'vpn-person1', linkedVpnUsername: 'vpn-person1',
    };
    mocks.accessFindUnique.mockResolvedValue(requestOwner);
    mocks.accessFindMany.mockResolvedValue([requestOwner]);
    mocks.vpnFindMany.mockResolvedValue([
      { id: 'vpn-1', username: 'vpn-person1', status: 'active', canRestore: true },
      { id: 'vpn-2', username: 'vpn-person1-lab', status: 'active', canRestore: true },
    ]);

    const response = await POST(new NextRequest('https://example.test/api/admin/account-lifecycle', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'test-both-confirmation-key-0001' },
      body: JSON.stringify({
        actionType: 'disable_both', targetAccountType: 'BOTH', targetUsername: 'person1',
        relatedRequestId: 'request-1', reason: 'Disable all access',
      }),
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'AMBIGUOUS_VPN_TARGET' });
    expect(mocks.lifecycleCreate).not.toHaveBeenCalled();
  });

  it('blocks a combined action when its only VPN candidate contradicts the request', async () => {
    const requestOwner = {
      id: 'request-1', status: 'approved', provisioningState: 'completed',
      ldapUsername: 'person1', linkedAdUsername: 'person1', vpnUsername: 'vpn-person1', linkedVpnUsername: 'vpn-person1',
    };
    mocks.accessFindUnique.mockResolvedValue(requestOwner);
    mocks.accessFindMany.mockResolvedValue([requestOwner]);
    mocks.vpnFindMany.mockResolvedValue([{
      id: 'vpn-1', username: 'unexpected-vpn', adUsername: 'person1', accessRequestId: 'request-2',
      status: 'active', canRestore: true,
    }]);

    const response = await POST(new NextRequest('https://example.test/api/admin/account-lifecycle', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'test-both-confirmation-key-conflict' },
      body: JSON.stringify({
        actionType: 'disable_both', targetAccountType: 'BOTH', targetUsername: 'person1',
        relatedRequestId: 'request-1', reason: 'Disable all access',
      }),
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'VPN_REQUEST_LINK_CONFLICT' });
    expect(mocks.lifecycleCreate).not.toHaveBeenCalled();
  });

  it('blocks a combined action when the VPN candidate has no internal request relation', async () => {
    const requestOwner = {
      id: 'request-1', status: 'approved', provisioningState: 'completed',
      ldapUsername: 'person1', linkedAdUsername: 'person1', vpnUsername: 'vpn-person1', linkedVpnUsername: 'vpn-person1',
    };
    mocks.accessFindUnique.mockResolvedValue(requestOwner);
    mocks.accessFindMany.mockResolvedValue([requestOwner]);
    mocks.vpnFindMany.mockResolvedValue([{
      id: 'vpn-1', username: 'vpn-person1', adUsername: 'person1', accessRequestId: null,
      status: 'active', canRestore: true,
    }]);

    const response = await POST(new NextRequest('https://example.test/api/admin/account-lifecycle', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'test-both-confirmation-key-null-fk' },
      body: JSON.stringify({
        actionType: 'disable_both', targetAccountType: 'BOTH', targetUsername: 'person1',
        relatedRequestId: 'request-1', reason: 'Disable all access',
      }),
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'VPN_REQUEST_LINK_CONFLICT' });
    expect(mocks.lifecycleCreate).not.toHaveBeenCalled();
  });

  it('blocks combined actions while the VPN module is disabled', async () => {
    mocks.moduleEnabled.mockResolvedValue(false);

    const response = await POST(new NextRequest('https://example.test/api/admin/account-lifecycle', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'test-both-confirmation-key-0002' },
      body: JSON.stringify({
        actionType: 'disable_both', targetAccountType: 'BOTH', targetUsername: 'person1', reason: 'Disable all access',
      }),
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'MODULE_DISABLED' });
    expect(mocks.lifecycleCreate).not.toHaveBeenCalled();
  });

  it('rejects a dangling VPN request ID before persisting an action', async () => {
    mocks.vpnFindUnique.mockResolvedValue({
      id: 'vpn-1', username: 'vpn-person1', adUsername: 'person1', accessRequestId: 'missing-request',
      status: 'active', portalType: 'Limited',
    });

    const response = await POST(new NextRequest('https://example.test/api/admin/account-lifecycle', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'test-vpn-confirmation-key-0002' },
      body: JSON.stringify({
        actionType: 'revoke_vpn', targetAccountType: 'VPN', targetUsername: 'vpn-person1',
        relatedRequestId: 'missing-request', reason: 'Remove VPN access',
      }),
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'VPN_REQUEST_LINK_CONFLICT' });
    expect(mocks.lifecycleCreate).not.toHaveBeenCalled();
  });

  it.each([
    ['VPN username', { vpnUsername: 'different-vpn', linkedVpnUsername: null, ldapUsername: 'person1', linkedAdUsername: 'person1' }],
    ['AD username', { vpnUsername: 'vpn-person1', linkedVpnUsername: null, ldapUsername: 'different-ad', linkedAdUsername: 'different-ad' }],
  ])('rejects a mismatched %s in VPN request evidence', async (_label, linkedRequest) => {
    mocks.vpnFindUnique.mockResolvedValue({
      id: 'vpn-1', username: 'vpn-person1', adUsername: 'person1', accessRequestId: 'request-1',
      status: 'active', portalType: 'Limited',
    });
    mocks.accessFindUnique.mockResolvedValue({ id: 'request-1', ...linkedRequest });

    const response = await POST(new NextRequest('https://example.test/api/admin/account-lifecycle', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'test-vpn-confirmation-key-0003' },
      body: JSON.stringify({
        actionType: 'revoke_vpn', targetAccountType: 'VPN', targetUsername: 'vpn-person1',
        relatedRequestId: 'request-1', reason: 'Remove VPN access',
      }),
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'VPN_REQUEST_LINK_CONFLICT' });
    expect(mocks.lifecycleCreate).not.toHaveBeenCalled();
  });

  it.each([
    ['disabled restore', 'restore_vpn', 'disabled', 'Limited'],
    ['External promotion', 'promote_vpn_role', 'active', 'External'],
  ])('rejects an inapplicable %s before persisting an action', async (_label, actionType, status, portalType) => {
    mocks.vpnFindUnique.mockResolvedValue({
      id: 'vpn-1', username: 'vpn-person1', adUsername: null, accessRequestId: null, status, portalType,
    });

    const response = await POST(new NextRequest('https://example.test/api/admin/account-lifecycle', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'test-vpn-confirmation-key-0004' },
      body: JSON.stringify({
        actionType, targetAccountType: 'VPN', targetUsername: 'vpn-person1', reason: 'Operator request',
      }),
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'VPN_ACTION_NOT_APPLICABLE' });
    expect(mocks.lifecycleCreate).not.toHaveBeenCalled();
  });
});

describe('POST lifecycle confirmation idempotency', () => {
  it('requires a stable idempotency key', async () => {
    const response = await POST(new NextRequest('https://example.test/api/admin/account-lifecycle', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        actionType: 'disable_ad', targetAccountType: 'AD', targetUsername: 'person1', reason: 'Disable account',
      }),
    }));

    expect(response.status).toBe(400);
    expect(mocks.lifecycleCreate).not.toHaveBeenCalled();
  });

  it('replays an uncertain action without creating a duplicate and preserves the stop signal', async () => {
    mocks.checkAdminAuthWithRateLimit.mockResolvedValue({
      admin: {
        username: 'admin1',
        permissions: new Set(['lifecycle.manage', 'users.manage']),
        viaLegacyAdminFallback: false,
        viaLocalBreakGlass: false,
      },
      response: null,
    });
    mocks.lifecycleFindUnique.mockResolvedValue({
      id: 'action-uncertain',
      status: 'reconciliation_required',
      requestedBy: 'admin1',
      errorMessage: 'Readback uncertain',
      authorizationEvidence: { acknowledgement: 'person1' },
      preflightSnapshot: { objectGuid: 'sensitive-guid' },
      resultSnapshot: { before: {}, after: {} },
      targetDirectoryDn: 'CN=person1,OU=Users,DC=example,DC=test',
      targetDirectoryObjectGuid: 'sensitive-guid',
    });
    const response = await POST(new NextRequest('https://example.test/api/admin/account-lifecycle', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'stable-confirmation-key-0001' },
      body: JSON.stringify({
        actionType: 'disable_ad', targetAccountType: 'AD', targetUsername: 'person1', reason: 'Disable account',
      }),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      replayed: true,
      action: {
        authorizationEvidence: null,
        preflightSnapshot: null,
        resultSnapshot: null,
        targetDirectoryDn: null,
        targetDirectoryObjectGuid: null,
      },
      processResult: { actionId: 'action-uncertain', reconciliationRequired: true },
    });
    expect(mocks.lifecycleCreate).not.toHaveBeenCalled();
    expect(mocks.processLifecycleAction).not.toHaveBeenCalled();
  });
});
