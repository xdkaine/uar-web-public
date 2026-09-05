import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  requestFind: vi.fn(),
  workflowFind: vi.fn(),
  requestUpdateMany: vi.fn(),
  auditCreate: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('@/lib/adminAuth', () => ({ checkAdminAuthWithRateLimit: mocks.auth }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: mocks.transaction,
  },
}));

import { POST } from './route';
import { DEFAULT_STANDARD_WORKFLOW_STAGES } from '@/lib/workflow/schema';

const requestRow = {
  id: 'req-1',
  version: 8,
  status: 'pending_student_directors',
  workflowVersionId: 'missing-pin',
  requestTypeKey: 'standard_access',
};
const target = {
  id: 'wf-good',
  version: 3,
  status: 'archived',
  requestTypeKey: 'standard_access',
  stages: DEFAULT_STANDARD_WORKFLOW_STAGES,
};

function apiRequest(overrides: Record<string, unknown> = {}) {
  return new NextRequest('https://portal.test/api/admin/requests/req-1/reconcile-workflow', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      targetWorkflowDefinitionId: 'wf-good',
      expectedRequestVersion: 8,
      expectedWorkflowVersionId: 'missing-pin',
      expectedStatus: 'pending_student_directors',
      reason: 'Database restore left the original immutable pin unavailable.',
      ...overrides,
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({
    admin: { username: 'governor', roles: new Set(), permissions: new Set(['governance.configure']) },
    response: null,
  });
  mocks.requestFind.mockResolvedValue(requestRow);
  mocks.workflowFind.mockImplementation(({ where }: { where: { id: string } }) =>
    Promise.resolve(where.id === 'wf-good' ? target : null)
  );
  mocks.requestUpdateMany.mockResolvedValue({ count: 1 });
  mocks.auditCreate.mockResolvedValue({ id: 'audit-1' });
  mocks.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback({
    accessRequest: { findUnique: mocks.requestFind, updateMany: mocks.requestUpdateMany },
    workflowDefinition: { findUnique: mocks.workflowFind },
    auditLog: { create: mocks.auditCreate },
  }));
});

describe('POST request workflow reconciliation', () => {
  it('requires governance configuration permission', async () => {
    mocks.auth.mockResolvedValue({ admin: { username: 'viewer', roles: new Set(), permissions: new Set() }, response: null });
    expect((await POST(apiRequest(), { params: Promise.resolve({ id: 'req-1' }) })).status).toBe(403);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('rejects a target that does not contain the current review stage', async () => {
    mocks.workflowFind.mockImplementation(({ where }: { where: { id: string } }) => Promise.resolve(
      where.id === 'wf-good' ? { ...target, stages: [DEFAULT_STANDARD_WORKFLOW_STAGES[1]] } : null
    ));
    const response = await POST(apiRequest(), { params: Promise.resolve({ id: 'req-1' }) });
    expect(response.status).toBe(400);
    expect(mocks.requestUpdateMany).not.toHaveBeenCalled();
  });

  it('repins with optimistic state checks and writes the audit in the same transaction', async () => {
    const response = await POST(apiRequest(), { params: Promise.resolve({ id: 'req-1' }) });
    expect(response.status).toBe(200);
    expect(mocks.requestUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'req-1', version: 8, status: 'pending_student_directors', workflowVersionId: 'missing-pin' }),
      data: expect.objectContaining({ workflowVersionId: 'wf-good', requestTypeKey: 'standard_access' }),
    }));
    expect(mocks.auditCreate).toHaveBeenCalledTimes(1);
  });

  it('returns a conflict when the request changed before the compare-and-swap', async () => {
    mocks.requestUpdateMany.mockResolvedValue({ count: 0 });
    const response = await POST(apiRequest(), { params: Promise.resolve({ id: 'req-1' }) });
    expect(response.status).toBe(409);
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });
});
