import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), transaction: vi.fn(), users: vi.fn() }));
vi.mock('@/lib/adminAuth', () => ({ checkAdminAuthWithRateLimit: mocks.auth }));
vi.mock('@/lib/prisma', () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock('@/lib/ldap', () => ({ listUsersInOU: mocks.users }));
vi.mock('@/lib/clone-safety', () => ({ isProductionCloneReadOnly: () => false }));
vi.mock('@/lib/audit-log', () => ({
  AuditCategories: { SYNC_STATUS: 'sync_status' }, getIpAddress: vi.fn(),
  getUserAgent: vi.fn(), logAuditAction: vi.fn(),
}));
import { POST } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ admin: { username: 'operator', permissions: new Set(['sync.read', 'access_requests.provision']) } });
  mocks.users.mockResolvedValue([]);
});

describe('retired Sync Status linkage action', () => {
  it('rejects stale authorized clients without querying AD or writing portal records', async () => {
    const response = await POST(new NextRequest('https://example.test/api/admin/sync-status/resolve', {
      method: 'POST', body: JSON.stringify({ identifier: 'batch-person' }),
    }));
    expect(response.status).toBe(405);
    expect(await response.json()).toMatchObject({ code: 'SYNC_LINKAGE_RETIRED' });
    expect(mocks.users).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it('preserves authentication denial', async () => {
    mocks.auth.mockResolvedValue({ admin: null });
    const response = await POST(new NextRequest('https://example.test/api/admin/sync-status/resolve', { method: 'POST' }));
    expect(response.status).toBe(401);
    expect(mocks.users).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it('preserves Sync Status permission checks', async () => {
    mocks.auth.mockResolvedValue({ admin: { username: 'operator', permissions: new Set(['users.read']) } });
    const response = await POST(new NextRequest('https://example.test/api/admin/sync-status/resolve', { method: 'POST' }));
    expect(response.status).toBe(403);
    expect(mocks.users).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
