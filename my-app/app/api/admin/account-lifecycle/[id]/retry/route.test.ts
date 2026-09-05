import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), findUnique: vi.fn(), retry: vi.fn() }));

vi.mock('@/lib/adminAuth', () => ({ checkAdminAuthWithRateLimit: mocks.auth }));
vi.mock('@/lib/rbac/core', () => ({ actorHasPermission: () => true }));
vi.mock('@/lib/clone-safety', () => ({ isProductionCloneReadOnly: () => false }));
vi.mock('@/lib/lifecycle-processor', () => ({ retryFailedAction: mocks.retry }));
vi.mock('@/lib/audit-log', () => ({ AuditActions: { RETRY_LIFECYCLE_ACTION: 'retry' }, AuditCategories: { LIFECYCLE: 'lifecycle' }, getIpAddress: () => null, logAuditAction: vi.fn() }));
vi.mock('@/lib/lifecycle-authorization', () => ({ actorCanOperateLifecycleAction: () => true }));
vi.mock('@/lib/prisma', () => ({ prisma: { accountLifecycleAction: { findUnique: mocks.findUnique } } }));

import { POST } from './route';

describe('POST lifecycle retry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ admin: { username: 'operator1' }, response: null });
  });

  it('requires fresh confirmation for an AD deletion reviewed with the earlier method', async () => {
    mocks.findUnique.mockResolvedValue({
      status: 'failed', actionType: 'delete_ad', operationMode: 'governed',
      policyVersion: 'governed-directory-delete-v2', authorizationEvidence: {},
    });

    const response = await POST(new NextRequest('https://example.test/api/admin/account-lifecycle/action-1/retry', { method: 'POST' }), {
      params: Promise.resolve({ id: 'action-1' }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining('earlier deletion method') });
    expect(mocks.retry).not.toHaveBeenCalled();
  });
});
