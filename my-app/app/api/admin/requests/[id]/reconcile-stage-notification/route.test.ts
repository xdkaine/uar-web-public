import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  findUnique: vi.fn(),
  updateMany: vi.fn(),
  commentCreate: vi.fn(),
  audit: vi.fn(),
  emitAudit: vi.fn(),
  transaction: vi.fn(),
  canAct: vi.fn(),
  resolveWorkflow: vi.fn(),
}));

vi.mock('@/lib/adminAuth', () => ({ checkReviewAccessWithRateLimit: mocks.auth }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    accessRequest: { findUnique: mocks.findUnique, updateMany: mocks.updateMany },
    requestComment: { create: mocks.commentCreate },
    $transaction: mocks.transaction,
  },
}));
vi.mock('@/lib/rbac/core', () => ({ actorCanActOnStage: mocks.canAct }));
vi.mock('@/lib/workflow/core', () => ({
  findStageIndexByStatus: vi.fn(() => 1),
  resolveWorkflowForRequest: mocks.resolveWorkflow,
  workflowIntegrityConflict: vi.fn(() => null),
}));
vi.mock('@/lib/audit-log', () => ({
  AuditActions: { RECONCILE_STAGE_NOTIFICATION: 'reconcile_stage_notification' },
  AuditCategories: { ACCESS_REQUEST: 'access_request' },
  getIpAddress: vi.fn(),
  getUserAgent: vi.fn(),
  logAuditAction: mocks.audit,
  emitAuditActionLog: mocks.emitAudit,
}));

import { POST } from './route';

function request(resolution = 'delivered') {
  return new NextRequest('https://example.test/api/admin/requests/request-1/reconcile-stage-notification', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ resolution, evidence: 'Provider trace confirms the outcome.' }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({
    admin: { username: 'reviewer', roles: new Set(), permissions: new Set(), viaLegacyAdminFallback: false },
    response: null,
  });
  mocks.findUnique.mockResolvedValue({
    id: 'request-1',
    version: 7,
    status: 'pending_faculty',
    requestTypeKey: 'standard_access',
    workflowVersionId: 'workflow-1',
    stageNotificationState: 'delivery_unknown',
    stageNotificationStageKey: 'faculty',
  });
  mocks.resolveWorkflow.mockResolvedValue({
    id: 'workflow-1',
    version: 1,
    requestTypeKey: 'standard_access',
    source: 'pinned',
    integrity: 'valid',
    stages: [
      { key: 'student_directors', label: 'Initial Review', reviewerRoleKey: 'director' },
      { key: 'faculty', label: 'Final Review', reviewerRoleKey: 'faculty' },
    ],
  });
  mocks.canAct.mockReturnValue(true);
  mocks.updateMany.mockResolvedValue({ count: 1 });
  mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({
    accessRequest: { updateMany: mocks.updateMany },
    requestComment: { create: mocks.commentCreate },
    auditLog: { create: vi.fn() },
  }));
});

describe('POST /api/admin/requests/[id]/reconcile-stage-notification', () => {
  it('records evidence and resolves an ambiguous delivery with a CAS', async () => {
    const response = await POST(request(), { params: Promise.resolve({ id: 'request-1' }) });

    expect(response.status).toBe(200);
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        version: 7,
        stageNotificationStageKey: 'faculty',
        stageNotificationState: 'delivery_unknown',
      }),
      data: expect.objectContaining({ stageNotificationState: 'delivered' }),
    }));
    expect(mocks.commentCreate).toHaveBeenCalledOnce();
    expect(mocks.audit).toHaveBeenCalledOnce();
    expect(mocks.audit).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
      accessRequest: expect.any(Object),
      requestComment: expect.any(Object),
      auditLog: expect.any(Object),
    }), { emitOperationalLog: false });
    expect(mocks.emitAudit).toHaveBeenCalledOnce();
  });

  it('rolls the state change back when evidence persistence fails', async () => {
    mocks.commentCreate.mockRejectedValue(new Error('comment write failed'));

    await expect(POST(request(), { params: Promise.resolve({ id: 'request-1' }) }))
      .rejects.toThrow('comment write failed');
    expect(mocks.emitAudit).not.toHaveBeenCalled();
  });

  it('requires the configured current-stage reviewer role', async () => {
    mocks.canAct.mockReturnValue(false);

    const response = await POST(request(), { params: Promise.resolve({ id: 'request-1' }) });

    expect(response.status).toBe(403);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
});
