import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  cloneReadOnly: vi.fn(),
  findUnique: vi.fn(),
  transaction: vi.fn(),
  aggregate: vi.fn(),
  audit: vi.fn(),
}));

vi.mock('@/lib/adminAuth', () => ({ checkAdminAuthWithRateLimit: mocks.auth }));
vi.mock('@/lib/clone-safety', () => ({ isProductionCloneReadOnly: mocks.cloneReadOnly }));
vi.mock('@/lib/lifecycle-deletion-plan', () => ({
  REVIEWED_DELETION_PLAN_POLICY_VERSION: 'reviewed-lifecycle-deletion-plan-v1',
  refreshReviewedDeletionPlanAggregate: mocks.aggregate,
}));
vi.mock('@/lib/logger', () => ({ appLogger: { error: vi.fn() } }));
vi.mock('@/lib/audit-log', () => ({
  AuditCategories: { LIFECYCLE: 'lifecycle' },
  getIpAddress: vi.fn(() => '127.0.0.1'),
  getUserAgent: vi.fn(() => 'vitest'),
  logAuditAction: mocks.audit,
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    accountLifecycleBatch: { findUnique: mocks.findUnique },
    $transaction: mocks.transaction,
  },
}));

import { POST } from './route';

function request() {
  return new NextRequest('https://example.test/api/admin/account-lifecycle/deletion-plans/plan-1/complete', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ intakeFailures: ['forged'], notAttempted: 999 }),
  });
}

const processingPlan = {
  id: 'plan-1',
  policyVersion: 'reviewed-lifecycle-deletion-plan-v1',
  requestedBy: 'operator1',
  status: 'processing',
  resultSummary: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ admin: { username: 'operator1', permissions: new Set(['lifecycle.manage']) }, response: null });
  mocks.cloneReadOnly.mockReturnValue(false);
  mocks.findUnique.mockResolvedValue(processingPlan);
  mocks.transaction.mockImplementation(async (callback: (tx: { accountLifecycleBatch: { findUnique: typeof mocks.findUnique } }) => Promise<unknown>) => callback({ accountLifecycleBatch: { findUnique: mocks.findUnique } }));
  mocks.aggregate.mockResolvedValue({ ...processingPlan, status: 'partial', resultSummary: { completed: 1, notAttempted: 1, derivedFromPersistedActions: true } });
  mocks.audit.mockResolvedValue(undefined);
});

describe('POST reviewed deletion plan completion', () => {
  it('ignores caller-authored counts and requests a persisted-action aggregate under a transaction', async () => {
    const response = await POST(request(), { params: Promise.resolve({ id: 'plan-1' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.aggregate).toHaveBeenCalledWith(expect.anything(), 'plan-1', { finalizationRequested: true });
    expect(data.resultSummary).toEqual(expect.objectContaining({ derivedFromPersistedActions: true, notAttempted: 1 }));
    expect(JSON.stringify(mocks.aggregate.mock.calls)).not.toContain('forged');
    expect(JSON.stringify(mocks.aggregate.mock.calls)).not.toContain('999');
  });

  it('makes terminal finalization an immutable replay', async () => {
    mocks.findUnique.mockResolvedValue({ ...processingPlan, status: 'partial', resultSummary: { completed: 1, notAttempted: 1 } });

    const response = await POST(request(), { params: Promise.resolve({ id: 'plan-1' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.replayed).toBe(true);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.aggregate).not.toHaveBeenCalled();
  });

  it('blocks finalization in a production clone', async () => {
    mocks.cloneReadOnly.mockReturnValue(true);

    const response = await POST(request(), { params: Promise.resolve({ id: 'plan-1' }) });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'CLONE_READ_ONLY' });
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it('prevents another operator from finalizing the plan', async () => {
    mocks.findUnique.mockResolvedValue({ ...processingPlan, requestedBy: 'operator2' });

    const response = await POST(request(), { params: Promise.resolve({ id: 'plan-1' }) });

    expect(response.status).toBe(403);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
