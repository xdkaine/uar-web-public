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

import { POST } from './route';

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

describe('deleting separately requested offboarded accounts', () => {
  function targets(action: string) {
    mocks.auth.mockResolvedValue({ admin: { username: 'operator1', permissions: new Set([
      'lifecycle.manage', 'lifecycle.delete', 'users.manage', 'vpn.manage', 'vpn.delete',
    ]) }, response: null });
    mocks.requestFindMany.mockImplementation(async ({ where }) => {
      const username = where.OR[0].ldapUsername.equals;
      return [{ id: `request-${username}`, ldapUsername: username, status: 'offboarded', provisioningState: 'succeeded', adAccountStatus: 'disabled' }];
    });
    mocks.vpnFindUnique.mockImplementation(async ({ where }) => ({
      id: where.id, username: where.id.replace('vpn-', ''), accessRequestId: `request-${where.id.replace('vpn-', '')}`,
      status: 'revoked', revokedAt: new Date(), revokedBy: 'offboard-worker', revokedReason: 'Offboarding completed.',
    }));
    mocks.statusFindFirst.mockResolvedValue({ newStatus: 'revoked' });
    return ['person1', 'person2'].map((username) => ({
      accountRef: `ad:${username}`, directoryUsername: username, requestId: `request-${username}`,
      ...(action !== 'delete_ad' ? { vpnUsername: username, vpnRecordId: `vpn-${username}` } : {}),
    }));
  }

  it.each(['delete_ad', 'delete_vpn_record', 'delete_both_records'])('allows %s without creation-batch provenance', async (action) => {
    const selection = targets(action);
    const recordCount = action === 'delete_both_records' ? 4 : 2;
    const response = await POST(request(baseBody({ action, targets: selection,
      destructiveAcknowledgement: `DELETE 2 ACCOUNTS / ${recordCount} RECORDS`,
    })));
    expect(response.status).toBe(201);
    const data = await response.json();
    expect(data.plan.manifest).toEqual(selection.map((target) => expect.objectContaining({
      key: target.accountRef, requestId: target.requestId, operationMode: 'governed', sourceBatchId: null,
    })));
    const evidence = mocks.planCreate.mock.calls[0][0].data.authorizationEvidence;
    expect(evidence.children).toHaveLength(recordCount);
    if (action === 'delete_both_records') expect(evidence.children.map((child: { actionType: string }) => child.actionType))
      .toEqual(['delete_vpn_record', 'delete_ad', 'delete_vpn_record', 'delete_ad']);
  });

  it.each(['active_vpn', 'missing_revoke_log', 'wrong_vpn_request', 'enabled_ad', 'unready_request'])(
    'rejects %s before saving any deletion plan', async (failure) => {
      const selection = targets('delete_both_records');
      if (failure === 'active_vpn' || failure === 'wrong_vpn_request') mocks.vpnFindUnique.mockResolvedValue({
        id: 'vpn-person1', username: 'person1', accessRequestId: failure === 'wrong_vpn_request' ? 'another-request' : 'request-person1',
        status: failure === 'active_vpn' ? 'active' : 'revoked', revokedAt: new Date(), revokedBy: 'operator', revokedReason: 'Offboarded.',
      });
      if (failure === 'missing_revoke_log') mocks.statusFindFirst.mockResolvedValue(null);
      if (failure === 'enabled_ad') mocks.searchLDAPUser.mockResolvedValue({ objectName: 'CN=person1,DC=example,DC=test', attributes: [
        { type: 'objectGUID', values: ['guid-person1'] }, { type: 'userAccountControl', values: ['512'] },
      ] });
      if (failure === 'unready_request') mocks.requestFindMany.mockResolvedValue([{
        id: 'request-person1', ldapUsername: 'person1', status: 'offboarded', provisioningState: 'processing', adAccountStatus: 'disabled',
      }]);
      const response = await POST(request(baseBody({ action: 'delete_both_records', targets: selection, destructiveAcknowledgement: 'DELETE 2 ACCOUNTS / 4 RECORDS' })));
      expect(response.status).toBe(409);
      expect((await response.json()).code).toBe({
        active_vpn: 'VPN_DELETE_NOT_READY', missing_revoke_log: 'VPN_DELETE_NOT_READY', wrong_vpn_request: 'AD_VPN_LINK_CONFLICT',
        enabled_ad: 'AD_DELETE_REQUIRES_DISABLED', unready_request: 'GOVERNED_DELETE_NOT_READY',
      }[failure]);
      expect(mocks.planCreate).not.toHaveBeenCalled();
    },
  );

  it('rejects VPN-only request-owner drift after inventory review', async () => {
    const selection = targets('delete_vpn_record');
    mocks.vpnFindUnique.mockImplementation(async ({ where }) => ({
      id: where.id,
      username: where.id.replace('vpn-', ''),
      accessRequestId: 'request-relinked-after-review',
      status: 'revoked',
      revokedAt: new Date(),
      revokedBy: 'operator',
      revokedReason: 'Offboarded.',
    }));

    const response = await POST(request(baseBody({
      action: 'delete_vpn_record',
      targets: selection,
      destructiveAcknowledgement: 'DELETE 2 ACCOUNTS / 2 RECORDS',
    })));

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('ACCESS_REQUEST_LINK_CHANGED');
    expect(mocks.planCreate).not.toHaveBeenCalled();
  });
  it('requires recorded batch ownership for multi-account VPN deletion without request owners', async () => {
    const selection = targets('delete_vpn_record').map(({ requestId: _requestId, ...target }) => target);
    mocks.vpnFindUnique.mockImplementation(async ({ where }) => ({
      id: where.id, username: where.id.replace('vpn-', ''), accessRequestId: null,
      status: 'revoked', revokedAt: new Date(), revokedBy: 'operator', revokedReason: 'Retired.',
    }));
    const response = await POST(request(baseBody({ action: 'delete_vpn_record', targets: selection,
      destructiveAcknowledgement: 'DELETE 2 ACCOUNTS / 2 RECORDS',
    })));
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('BATCH_PROVENANCE_REQUIRED');
    expect(mocks.planCreate).not.toHaveBeenCalled();
  });

});
