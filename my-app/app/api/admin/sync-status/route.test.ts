import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), directory: vi.fn(), vpns: vi.fn(), requests: vi.fn(), batches: vi.fn(), latest: vi.fn(), module: vi.fn() }));
vi.mock('@/lib/adminAuth', () => ({ checkAdminAuthWithRateLimit: mocks.auth }));
vi.mock('@/lib/ldap', () => ({ listUsersInOU: mocks.directory }));
vi.mock('@/lib/modules/core', () => ({ isModuleEnabled: mocks.module }));
vi.mock('@/lib/prisma', () => ({ prisma: {
  vPNAccount: { findMany: mocks.vpns }, accessRequest: { findMany: mocks.requests },
  batchAccountItem: { findMany: mocks.batches }, aDAccountSync: { findFirst: mocks.latest },
} }));
import { GET } from './route';

const url = 'https://example.test/api/admin/sync-status';
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ admin: { username: 'operator', permissions: new Set(['sync.read', 'batch.manage']) } });
  mocks.directory.mockResolvedValue([{ username: 'person', dn: 'CN=person', objectGuid: 'original-guid', displayName: 'Person', email: 'person@cpp.edu', accountEnabled: false }]);
  mocks.vpns.mockResolvedValue([]);
  mocks.requests.mockResolvedValue([]);
  mocks.batches.mockResolvedValue([{ id: 'item', batchId: 'run', batch: { id: 'run', description: 'Fixture' }, accessRequestId: null, lifecycleOwnerKind: 'batch_item', accountType: 'AD', ldapUsername: 'person', status: 'completed', adAccountStatus: 'disabled', targetDirectoryDn: 'CN=person', targetDirectoryObjectGuid: 'original-guid' }]);
  mocks.latest.mockResolvedValue(null);
  mocks.module.mockResolvedValue(true);
});

describe('GET /api/admin/sync-status', () => {
  it.each(['completed', 'processing', 'failed'])('does not give unmatched rows a %s run timestamp', async (status) => {
    mocks.latest.mockResolvedValue({ id: 'sync', status, createdAt: new Date(), completedAt: new Date(), matches: [] });
    const response = await GET(new NextRequest(url));
    const { accounts } = await response.json();
    expect(accounts[0]).toMatchObject({ adSyncDate: null, lastSyncId: null, wasAutoAssigned: false });
  });
  it.each(['completed', 'processing', 'failed'])('uses only the persisted account match timestamp for a %s run', async (status) => {
    const createdAt = new Date('2026-09-04T12:00:00Z');
    mocks.latest.mockResolvedValue({ id: 'sync', status, createdAt: new Date(), completedAt: new Date(), matches: [{ adUsername: 'PERSON', createdAt, wasAutoAssigned: true }] });
    const response = await GET(new NextRequest(url));
    const { accounts } = await response.json();
    expect(accounts[0]).toMatchObject({ adSyncDate: createdAt.toISOString(), lastSyncId: 'sync', wasAutoAssigned: true });
  });
  it('returns shared batch ownership and no legacy resolver eligibility', async () => {
    const response = await GET(new NextRequest(url));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ accounts: [{
      accountRef: 'ad:person', requestId: null, resolutionKind: null, syncIssues: [],
      ownership: { ownerType: 'batch_account', batchItemId: 'item', batchRunId: 'run', batchHref: '/admin/batch-accounts/run' },
    }] });
    expect(mocks.batches).toHaveBeenCalledWith(expect.objectContaining({ where: { status: { in: ['processing', 'completed', 'reconciliation_required'] } } }));
  });
  it.each(['processing', 'reconciliation_required'])('keeps %s batch ownership out of the unowned category', async (status) => {
    const [item] = await mocks.batches();
    mocks.batches.mockResolvedValue([{ ...item, status }]);
    const response = await GET(new NextRequest(url));
    expect(await response.json()).toMatchObject({ accounts: [{ ownership: { ownerType: 'batch_account', readiness: 'needs_review' }, syncIssues: ['Portal ownership needs review'] }] });
  });
  it('does not claim missing AD accounts when the directory source failed', async () => {
    mocks.directory.mockRejectedValue(new Error('sensitive directory diagnostic'));
    const response = await GET(new NextRequest(url));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'Account sources could not be verified. Refresh Sync Status before using account ownership information.', code: 'SYNC_SOURCES_UNAVAILABLE' });
  });
  it('does not classify accounts as unowned when the ownership source failed', async () => {
    mocks.batches.mockRejectedValue(new Error('sensitive database diagnostic'));
    const response = await GET(new NextRequest(url));
    expect(response.status).toBe(503);
    expect((await response.json()).accounts).toBeUndefined();
  });
  it.each([null, { username: 'operator', permissions: new Set(['users.read']) }])('rejects an unauthorized caller before reading account sources', async (admin) => {
    mocks.auth.mockResolvedValue({ admin });
    const response = await GET(new NextRequest(url));
    expect(response.status).toBe(admin ? 403 : 401);
    expect(mocks.directory).not.toHaveBeenCalled();
    expect(mocks.batches).not.toHaveBeenCalled();
  });
});
