import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  checkAdminAuthWithRateLimit: vi.fn(),
  actorHasPermission: vi.fn(),
  timerFindMany: vi.fn(),
  actionFindMany: vi.fn(),
  actionUpdateMany: vi.fn(),
  providerFindMany: vi.fn(),
  providerUpdateMany: vi.fn(),
  timerFindUnique: vi.fn(),
  timerUpdateMany: vi.fn(),
  runUpdateMany: vi.fn(),
  transaction: vi.fn(),
  processProviderLogoutTask: vi.fn(),
  resumeAuthorizedFlowActionAttempt: vi.fn(),
  logAuditAction: vi.fn(),
  emitAuditActionLog: vi.fn(),
}));

vi.mock('@/lib/adminAuth', () => ({
  checkAdminAuthWithRateLimit: mocks.checkAdminAuthWithRateLimit,
}));

vi.mock('@/lib/rbac/core', () => ({
  actorHasPermission: mocks.actorHasPermission,
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: mocks.transaction,
    flowTimer: {
      findMany: mocks.timerFindMany,
      findUnique: mocks.timerFindUnique,
      updateMany: mocks.timerUpdateMany,
    },
    flowRun: { updateMany: mocks.runUpdateMany },
    flowActionAttempt: {
      findMany: mocks.actionFindMany,
      updateMany: mocks.actionUpdateMany,
    },
    providerLogoutTask: {
      findMany: mocks.providerFindMany,
      updateMany: mocks.providerUpdateMany,
    },
  },
}));

vi.mock('@/lib/auth/provider-logout-audit', () => ({
  processProviderLogoutTask: mocks.processProviderLogoutTask,
}));

vi.mock('@/lib/flow/engine', () => ({
  resumeAuthorizedFlowActionAttempt: mocks.resumeAuthorizedFlowActionAttempt,
}));

vi.mock('@/lib/audit-log', () => ({
  logAuditAction: mocks.logAuditAction,
  emitAuditActionLog: mocks.emitAuditActionLog,
  AuditActions: { RECONCILE_WORKFLOW_OPERATION: 'reconcile_workflow_operation' },
  AuditCategories: { CONFIGURATION: 'configuration' },
  getIpAddress: () => '203.0.113.40',
  getUserAgent: () => 'workflow-recovery-test',
}));

import { GET, POST } from './route';

function request(method: 'GET' | 'POST', body?: unknown) {
  return new NextRequest('https://portal.example.test/api/admin/workflow-recovery', {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe('workflow recovery identity boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkAdminAuthWithRateLimit.mockResolvedValue({
      admin: { username: 'automation-admin' },
      response: null,
    });
    mocks.actorHasPermission.mockImplementation(
      (_admin: unknown, permission: string) => permission === 'automation.manage',
    );
    mocks.timerFindMany.mockResolvedValue([]);
    mocks.actionFindMany.mockResolvedValue([]);
    mocks.providerFindMany.mockResolvedValue([{ id: 'logout-1', username: 'private-user' }]);
    mocks.providerUpdateMany.mockResolvedValue({ count: 1 });
    mocks.actionUpdateMany.mockResolvedValue({ count: 1 });
    mocks.timerFindUnique.mockResolvedValue({ runId: 'run-1' });
    mocks.timerUpdateMany.mockResolvedValue({ count: 1 });
    mocks.runUpdateMany.mockResolvedValue({ count: 1 });
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback({
      flowTimer: {
        findUnique: mocks.timerFindUnique,
        updateMany: mocks.timerUpdateMany,
      },
      flowRun: { updateMany: mocks.runUpdateMany },
      flowActionAttempt: { updateMany: mocks.actionUpdateMany },
      providerLogoutTask: { updateMany: mocks.providerUpdateMany },
      auditLog: { create: vi.fn() },
    }));
    mocks.processProviderLogoutTask.mockResolvedValue({ destroyed: true });
    mocks.resumeAuthorizedFlowActionAttempt.mockResolvedValue(true);
    mocks.logAuditAction.mockResolvedValue(undefined);
  });

  it('does not reveal provider logout recovery tasks to an automation-only operator', async () => {
    const response = await GET(request('GET'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ timers: [], emailAttempts: [], providerLogouts: [] });
    expect(mocks.providerFindMany).not.toHaveBeenCalled();
  });

  it('lists only provider logout tasks that actually require reconciliation', async () => {
    mocks.actorHasPermission.mockReturnValue(true);

    await GET(request('GET'));

    expect(mocks.providerFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'reconciliation_required' } }),
    );
  });

  it('does not let an automation-only operator retry provider logout', async () => {
    const response = await POST(request('POST', {
      kind: 'provider_logout',
      id: 'logout-1',
      resolution: 'retry_authorized',
      evidence: 'Reviewed the remote provider state.',
    }));

    expect(response.status).toBe(403);
    expect(mocks.providerUpdateMany).not.toHaveBeenCalled();
    expect(mocks.processProviderLogoutTask).not.toHaveBeenCalled();
  });

  it('records an incomplete provider retry as pending rather than successful', async () => {
    mocks.actorHasPermission.mockReturnValue(true);
    mocks.processProviderLogoutTask.mockResolvedValue({ destroyed: false });

    const response = await POST(request('POST', {
      kind: 'provider_logout',
      id: 'logout-1',
      resolution: 'retry_authorized',
      evidence: 'The provider still reports an active session.',
    }));

    expect(response.status).toBe(202);
    expect(mocks.logAuditAction).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'pending',
        details: expect.objectContaining({ recoveryIncomplete: true }),
      }),
    );
  });

  it('commits a timer re-arm, run transition, and durable audit in one transaction', async () => {
    const response = await POST(request('POST', {
      kind: 'timer',
      id: 'timer-1',
      resolution: 'not_executed',
      evidence: 'The timer callback was not executed.',
    }));

    expect(response.status).toBe(200);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.logAuditAction).toHaveBeenCalledWith(
      expect.objectContaining({ targetId: 'timer-1', outcome: 'success' }),
      expect.objectContaining({ flowTimer: expect.any(Object) }),
      { emitOperationalLog: false },
    );
    expect(mocks.emitAuditActionLog).toHaveBeenCalledWith(
      expect.objectContaining({ targetId: 'timer-1', outcome: 'success' }),
    );
  });

  it('does not record recovery when the run transition fails', async () => {
    mocks.runUpdateMany.mockRejectedValue(new Error('database failure'));

    const response = await POST(request('POST', {
      kind: 'timer',
      id: 'timer-1',
      resolution: 'not_executed',
      evidence: 'The timer callback was not executed.',
    }));

    expect(response.status).toBe(500);
    expect(mocks.logAuditAction).not.toHaveBeenCalled();
    expect(mocks.emitAuditActionLog).not.toHaveBeenCalled();
  });

  it('fails the transaction when durable audit evidence cannot be written', async () => {
    mocks.logAuditAction.mockRejectedValue(new Error('audit failure'));

    const response = await POST(request('POST', {
      kind: 'timer',
      id: 'timer-1',
      resolution: 'not_executed',
      evidence: 'The timer callback was not executed.',
    }));

    expect(response.status).toBe(500);
    expect(mocks.logAuditAction).toHaveBeenCalledTimes(1);
    expect(mocks.emitAuditActionLog).not.toHaveBeenCalled();
  });

  it('does not start provider logout when durable retry authorization cannot be audited', async () => {
    mocks.actorHasPermission.mockReturnValue(true);
    mocks.logAuditAction.mockRejectedValue(new Error('audit failure'));

    const response = await POST(request('POST', {
      kind: 'provider_logout',
      id: 'logout-1',
      resolution: 'retry_authorized',
      evidence: 'The provider session remains active.',
    }));

    expect(response.status).toBe(500);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.processProviderLogoutTask).not.toHaveBeenCalled();
  });

  it('does not start an action retry when durable authorization cannot be audited', async () => {
    mocks.logAuditAction.mockRejectedValue(new Error('audit failure'));

    const response = await POST(request('POST', {
      kind: 'action_attempt',
      id: 'attempt-1',
      resolution: 'not_executed',
      evidence: 'The target action was not executed.',
    }));

    expect(response.status).toBe(500);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.resumeAuthorizedFlowActionAttempt).not.toHaveBeenCalled();
  });
});
