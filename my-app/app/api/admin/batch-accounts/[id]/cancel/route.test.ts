import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  findUnique: vi.fn(),
  batchUpdateMany: vi.fn(),
  batchUpdate: vi.fn(),
  itemUpdateMany: vi.fn(),
  requestUpdateMany: vi.fn(),
  batchAuditCreate: vi.fn(),
  rollback: vi.fn(),
  vpnRollback: vi.fn(),
  audit: vi.fn(),
  transaction: vi.fn(),
  queryRaw: vi.fn(),
}));

vi.mock('@/lib/adminAuth', () => ({ checkAdminAuthWithRateLimit: mocks.auth }));
vi.mock('@/lib/batch-account-rollback', () => ({ rollbackBatchAccounts: mocks.rollback }));
vi.mock('@/lib/batch-vpn-rollback', () => ({ rollbackBatchVpnAccounts: mocks.vpnRollback }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: mocks.transaction,
    batchAccountCreation: {
      findUnique: mocks.findUnique,
      updateMany: mocks.batchUpdateMany,
      update: mocks.batchUpdate,
    },
    batchAccountItem: { updateMany: mocks.itemUpdateMany },
    accessRequest: { updateMany: mocks.requestUpdateMany },
    batchAuditLog: { create: mocks.batchAuditCreate },
  },
}));
vi.mock('@/lib/audit-log', () => ({
  logAuditAction: mocks.audit,
  AuditActions: { CANCEL_BATCH: 'cancel_batch' },
  AuditCategories: { BATCH: 'batch' },
  getIpAddress: () => '203.0.113.60',
  getUserAgent: () => 'batch-cancel-test',
}));

import { DELETE } from './route';

const request = () => new NextRequest(
  'https://portal.example.test/api/admin/batch-accounts/batch-1/cancel',
  { method: 'DELETE' }
);
const params = { params: Promise.resolve({ id: 'batch-1' }) };

function batch(overrides: Record<string, unknown> = {}) {
  return {
    id: 'batch-1',
    status: 'failed',
    failedAccounts: 1,
    totalAccounts: 1,
    accounts: [{
      id: 'item-1',
      accountType: 'AD',
      ldapUsername: 'alice',
      status: 'failed',
      ldapCreatedAt: null,
      accessRequestId: 'request-1',
      targetDirectoryDn: 'CN=alice,OU=Users,DC=example,DC=test',
      targetDirectoryObjectGuid: 'guid-alice',
      password: 'encrypted-secret',
    }],
    ...overrides,
  };
}

describe('batch cancellation coordination', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ admin: { username: 'batch-admin', permissions: new Set(['batch.manage']) }, response: null });
    mocks.findUnique.mockResolvedValue(batch());
    mocks.batchUpdateMany.mockResolvedValue({ count: 1 });
    mocks.batchUpdate.mockResolvedValue({ ...batch(), status: 'cancelled', auditLogs: [] });
    mocks.itemUpdateMany.mockResolvedValue({ count: 1 });
    mocks.requestUpdateMany.mockResolvedValue({ count: 1 });
    mocks.batchAuditCreate.mockResolvedValue({});
    mocks.audit.mockResolvedValue(undefined);
    mocks.rollback.mockResolvedValue({
      successful: ['alice'],
      failed: [],
      items: [{ username: 'alice', outcome: 'deleted', resolved: true }],
    });
    mocks.vpnRollback.mockResolvedValue({ successful: [], failed: [], items: [] });
    mocks.queryRaw.mockResolvedValue([{ lock_acquired: 'locked' }]);
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback({
      $queryRaw: mocks.queryRaw,
    }));
  });

  it('rejects cancellation while creation is active', async () => {
    mocks.findUnique.mockResolvedValue(batch({
      status: 'processing',
      processingClaimId: 'active-claim',
      processingClaimedUntil: new Date(Date.now() + 60_000),
    }));

    const response = await DELETE(request(), params);

    expect(response.status).toBe(409);
    expect(mocks.batchUpdateMany).not.toHaveBeenCalled();
    expect(mocks.rollback).not.toHaveBeenCalled();
  });

  it('recovers an expired processing claim with no durable account items', async () => {
    mocks.findUnique.mockResolvedValue(batch({
      status: 'processing',
      processingClaimId: 'expired-claim',
      processingClaimedUntil: new Date(Date.now() - 60_000),
      accounts: [],
    }));
    mocks.batchUpdate.mockResolvedValue({
      ...batch({ accounts: [] }),
      status: 'cancelled',
      auditLogs: [],
    });

    const response = await DELETE(request(), params);

    expect(response.status).toBe(200);
    expect(mocks.batchUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: 'batch-1',
        OR: expect.arrayContaining([
          expect.objectContaining({ status: 'processing' }),
        ]),
      }),
      data: expect.objectContaining({
        status: 'rolling_back',
        processingClaimId: null,
        processingClaimedUntil: null,
      }),
    }));
    expect(mocks.rollback).not.toHaveBeenCalled();
    expect(mocks.vpnRollback).not.toHaveBeenCalled();
  });

  it('forces reconciliation instead of rolling back an ambiguous late create', async () => {
    mocks.findUnique.mockResolvedValue(batch({
      status: 'processing',
      processingClaimId: 'expired-claim',
      processingClaimedUntil: new Date(Date.now() - 60_000),
      accounts: [{
        ...batch().accounts[0],
        mutationStage: 'ldap_create_started',
      }],
    }));

    const response = await DELETE(request(), params);

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: 'BATCH_EXTERNAL_MUTATION_RECONCILIATION_REQUIRED',
    });
    expect(mocks.batchUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'reconciliation_required' }),
    }));
    expect(mocks.rollback).not.toHaveBeenCalled();
    expect(mocks.vpnRollback).not.toHaveBeenCalled();
  });

  it('rejects legacy summaries without durable account items', async () => {
    mocks.findUnique.mockResolvedValue(batch({ accounts: [] }));

    const response = await DELETE(request(), params);

    expect(response.status).toBe(409);
    expect(mocks.rollback).not.toHaveBeenCalled();
  });

  it('includes failed AD items even when ldapCreatedAt was never recorded', async () => {
    const response = await DELETE(request(), params);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.rollback).toHaveBeenCalledWith([{
      username: 'alice',
      accessRequestId: 'request-1',
      targetDirectoryDn: 'CN=alice,OU=Users,DC=example,DC=test',
      targetDirectoryObjectGuid: 'guid-alice',
    }], 'batch-1');
    expect(body.rollback.outcomes).toEqual([
      { username: 'alice', outcome: 'deleted', resolved: true, accountType: 'AD' },
    ]);
    expect(body.batch.accounts[0]).not.toHaveProperty('password');
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'cancel_batch', targetId: 'batch-1' }),
    );
  });

  it('preserves the explicit legacy rollback path for pre-migration item rows', async () => {
    mocks.findUnique.mockResolvedValue(batch({
      accounts: [{
        id: 'legacy-item-1',
        accountType: 'AD',
        ldapUsername: 'legacy-alice',
        status: 'failed',
        accessRequestId: null,
        targetDirectoryDn: null,
        targetDirectoryObjectGuid: null,
        password: 'legacy-encrypted-secret',
      }],
    }));
    mocks.rollback.mockResolvedValue({
      successful: ['legacy-alice'],
      failed: [],
      items: [{ username: 'legacy-alice', outcome: 'deleted', resolved: true }],
    });

    const response = await DELETE(request(), params);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.rollback).toHaveBeenCalledWith(['legacy-alice'], 'batch-1');
    expect(body.batch.accounts[0]).not.toHaveProperty('password');
  });

  it('revokes VPN-only batch items before reporting cancellation', async () => {
    mocks.findUnique.mockResolvedValue(batch({
      accounts: [{
        id: 'vpn-item-1',
        accountType: 'VPN',
        ldapUsername: 'vpn-user',
        vpnUsername: 'vpn-user',
        status: 'completed',
      }],
    }));
    mocks.rollback.mockResolvedValue({ successful: [], failed: [], items: [] });
    mocks.vpnRollback.mockResolvedValue({
      successful: ['vpn-user'],
      failed: [],
      items: [{ username: 'vpn-user', outcome: 'revoked', resolved: true }],
    });

    const response = await DELETE(request(), params);

    expect(response.status).toBe(200);
    expect(mocks.vpnRollback).toHaveBeenCalledWith(['vpn-user'], 'batch-1', 'batch-admin');
    expect(mocks.batchUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'cancelled' }),
    }));
  });

  it('keeps a mixed batch unresolved when VPN revocation is unresolved', async () => {
    mocks.findUnique.mockResolvedValue(batch({
      accounts: [
        { id: 'ad-1', accountType: 'AD', ldapUsername: 'alice', status: 'failed' },
        { id: 'vpn-1', accountType: 'VPN', ldapUsername: 'vpn-user', vpnUsername: 'vpn-user', status: 'completed' },
      ],
    }));
    mocks.vpnRollback.mockResolvedValue({
      successful: [],
      failed: [{ username: 'vpn-user', outcome: 'ownership_mismatch', error: 'unresolved' }],
      items: [{ username: 'vpn-user', outcome: 'ownership_mismatch', resolved: false, error: 'unresolved' }],
    });

    const response = await DELETE(request(), params);

    expect(response.status).toBe(207);
    expect(mocks.batchUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'reconciliation_required' }),
    }));
    expect(await response.json()).toMatchObject({
      success: false,
      rollback: { failed: 1 },
    });
  });

  it('does not claim cancelled when an account is unresolved', async () => {
    mocks.rollback.mockResolvedValue({
      successful: [],
      failed: [{ username: 'alice', outcome: 'lookup_failed', error: 'unresolved' }],
      items: [{ username: 'alice', outcome: 'lookup_failed', resolved: false, error: 'unresolved' }],
    });

    const response = await DELETE(request(), params);

    expect(response.status).toBe(207);
    expect(mocks.batchUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'reconciliation_required' }),
    }));
    const body = await response.json();
    expect(body).toMatchObject({ success: false });
    expect(body.batch.accounts[0]).not.toHaveProperty('password');
  });

  it('rejects a concurrent cancellation claim', async () => {
    mocks.batchUpdateMany.mockResolvedValue({ count: 0 });

    const response = await DELETE(request(), params);

    expect(response.status).toBe(409);
    expect(mocks.rollback).not.toHaveBeenCalled();
  });

  it('moves a claimed batch to reconciliation_required after a crash', async () => {
    mocks.batchAuditCreate.mockRejectedValueOnce(new Error('audit database unavailable'));

    const response = await DELETE(request(), params);

    expect(response.status).toBe(500);
    expect(mocks.batchUpdateMany).toHaveBeenLastCalledWith({
      where: { id: 'batch-1', status: 'rolling_back' },
      data: { status: 'reconciliation_required' },
    });
  });
});
