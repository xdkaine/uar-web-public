import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  cloneReadOnly: vi.fn(),
  moduleEnabled: vi.fn(),
  accessFindUnique: vi.fn(),
  accessFindFirst: vi.fn(),
  accessUpdateMany: vi.fn(),
  transaction: vi.fn(),
  txUpdateMany: vi.fn(),
  txFindUnique: vi.fn(),
  txFindFirst: vi.fn(),
  batchFindMany: vi.fn(),
  txQueryRaw: vi.fn(),
  commentCreate: vi.fn(),
  search: vi.fn(),
  audit: vi.fn(),
  email: vi.fn(),
  stageEmail: vi.fn(),
  getEmailConfig: vi.fn(),
  getStudentDirectorEmails: vi.fn(),
  workflowFindFirst: vi.fn(),
  workflowFindUnique: vi.fn(),
}));

vi.mock('@/lib/adminAuth', () => ({ checkAdminAuthWithRateLimit: mocks.auth }));
vi.mock('@/lib/clone-safety', () => ({ isProductionCloneReadOnly: mocks.cloneReadOnly }));
vi.mock('@/lib/modules/core', () => ({ isModuleEnabled: mocks.moduleEnabled }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    accessRequest: {
      findUnique: mocks.accessFindUnique,
      findFirst: mocks.accessFindFirst,
      updateMany: mocks.accessUpdateMany,
    },
    workflowDefinition: { findFirst: mocks.workflowFindFirst, findUnique: mocks.workflowFindUnique },
    $transaction: mocks.transaction,
  },
}));
vi.mock('@/lib/ldap', () => ({
  searchLDAPUser: mocks.search,
}));
vi.mock('@/lib/email', () => ({
  sendManualAssignmentLinkedEmail: mocks.email,
  sendWorkflowStageNotification: mocks.stageEmail,
}));
vi.mock('@/lib/email-config', () => ({
  getEmailConfig: mocks.getEmailConfig,
  getStudentDirectorEmails: mocks.getStudentDirectorEmails,
}));
vi.mock('@/lib/logger', () => ({ appLogger: { warn: vi.fn() } }));
vi.mock('@/lib/audit-log', () => ({
  AuditActions: { MANUAL_ASSIGN_REQUEST: 'manual_assign_request' },
  AuditCategories: { ACCESS_REQUEST: 'access_request' },
  getIpAddress: vi.fn(),
  getUserAgent: vi.fn(),
  logAuditAction: mocks.audit,
}));

import { POST } from './route';

function accessRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: 'request-1',
    version: 3,
    name: 'Person One',
    email: 'person1@cpp.edu',
    isInternal: true,
    isVerified: true,
    status: 'pending_faculty',
    isManuallyAssigned: false,
    linkedAdUsername: null,
    manuallyAssignedAt: null,
    manuallyAssignedBy: null,
    accountUpdateState: null,
    facultyNotificationState: null,
    isGrandfatheredAccount: false,
    provisioningState: null,
    ...overrides,
  };
}

function request() {
  return new NextRequest('https://example.test/api/admin/requests/request-1/manual-assign', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ linkedAdUsername: 'person1', notes: 'Existing managed account' }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.accessFindUnique.mockReset();
  mocks.auth.mockResolvedValue({
    admin: {
      username: 'operator',
      roles: new Set(),
      permissions: new Set([
        'access_requests.provision',
        'access_requests.review.director',
        'access_requests.review.faculty',
      ]),
      viaLegacyAdminFallback: false,
    },
    response: null,
  });
  mocks.cloneReadOnly.mockReturnValue(false);
  mocks.moduleEnabled.mockResolvedValue(false);
  mocks.accessFindFirst.mockResolvedValue(null);
  mocks.accessUpdateMany.mockResolvedValue({ count: 1 });
  mocks.txUpdateMany.mockResolvedValue({ count: 1 });
  mocks.search.mockResolvedValue({
    objectName: 'CN=Person One,DC=example,DC=test',
    attributes: [{ type: 'objectGUID', values: ['guid-person1'] }],
  });
  mocks.txFindFirst.mockResolvedValue(null);
  mocks.batchFindMany.mockResolvedValue([]);
  mocks.txQueryRaw.mockResolvedValue([{ lock_acquired: 'locked' }]);
  mocks.email.mockResolvedValue(undefined);
  mocks.stageEmail.mockResolvedValue(undefined);
  mocks.getEmailConfig.mockResolvedValue({ facultyEmail: 'faculty@example.edu' });
  mocks.getStudentDirectorEmails.mockResolvedValue(['directors@example.edu']);
  mocks.workflowFindFirst.mockResolvedValue(null);
  mocks.workflowFindUnique.mockResolvedValue(null);

  const initial = accessRequest();
  const pending = accessRequest({
    version: 4,
    status: 'approved',
    isManuallyAssigned: true,
    ldapUsername: 'person1',
    linkedAdUsername: 'person1',
    provisioningState: 'reconciliation_pending',
  });
  const completed = accessRequest({
    ...pending,
    version: 5,
    provisioningState: 'completed',
    provisioningCompletedAt: new Date(),
  });
  mocks.accessFindUnique.mockResolvedValueOnce(initial).mockResolvedValueOnce(completed);
  mocks.txFindUnique.mockResolvedValue(pending);
  mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({
    $queryRaw: mocks.txQueryRaw,
    accessRequest: { updateMany: mocks.txUpdateMany, findUnique: mocks.txFindUnique, findFirst: mocks.txFindFirst },
    batchAccountItem: { findMany: mocks.batchFindMany },
    requestComment: { create: mocks.commentCreate },
  }));
});

describe('POST /api/admin/requests/[id]/manual-assign', () => {
  it('claims reconciliation, records portal ownership, and CAS-finalizes completed', async () => {
    const response = await POST(request(), { params: Promise.resolve({ id: 'request-1' }) });

    expect(response.status).toBe(200);
    expect(mocks.txUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ provisioningState: 'reconciliation_pending' }),
    }));
    expect(mocks.accessUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: 'request-1',
        version: 4,
        status: 'approved',
        provisioningState: 'reconciliation_pending',
      }),
      data: expect.objectContaining({ provisioningState: 'completed' }),
    }));
  });

  it('does not overwrite a concurrent transition after directory identity confirmation', async () => {
    mocks.accessUpdateMany.mockResolvedValue({ count: 0 });

    const response = await POST(request(), { params: Promise.resolve({ id: 'request-1' }) });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'RECONCILIATION_CONFLICT' });
  });

  it('does not write LDAP metadata while establishing portal ownership', async () => {

    const response = await POST(request(), { params: Promise.resolve({ id: 'request-1' }) });

    expect(response.status).toBe(200);
    expect(mocks.accessUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ version: 4, provisioningState: 'reconciliation_pending' }),
      data: expect.objectContaining({ provisioningState: 'completed' }),
    }));
    expect(mocks.search).toHaveBeenCalledTimes(2);
  });

  it('rejects another request that owns the username through linkedAdUsername', async () => {
    mocks.txFindFirst.mockResolvedValue({ id: 'request-2' });

    const response = await POST(request(), { params: Promise.resolve({ id: 'request-1' }) });

    expect(response.status).toBe(409);
    expect(mocks.txUpdateMany).not.toHaveBeenCalled();
  });

  it('rejects an AD username governed by a batch run', async () => {
    mocks.batchFindMany.mockResolvedValue([{ id: 'item-1', batchId: 'batch-1', accountType: 'AD', status: 'completed' }]);

    const response = await POST(request(), { params: Promise.resolve({ id: 'request-1' }) });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('active batch run owner'),
    });
    expect(mocks.txUpdateMany).not.toHaveBeenCalled();
  });

  it('blocks clone-mode assignment before reading or changing a request', async () => {
    mocks.cloneReadOnly.mockReturnValue(true);

    const response = await POST(request(), { params: Promise.resolve({ id: 'request-1' }) });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'CLONE_READ_ONLY' });
    expect(mocks.accessFindUnique).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('advances a non-final configured stage instead of skipping to approval', async () => {
    const initial = accessRequest({
      status: 'pending_student_directors',
      workflowVersionId: 'workflow-two-stage',
      requestTypeKey: 'standard_access',
    });
    const pendingNextStage = accessRequest({
      ...initial,
      version: 4,
      status: 'pending_faculty',
      isManuallyAssigned: true,
      ldapUsername: 'person1',
      linkedAdUsername: 'person1',
      provisioningState: 'reconciliation_pending',
    });
    const completed = { ...pendingNextStage, version: 5, provisioningState: 'completed' };
    mocks.workflowFindUnique.mockResolvedValue({
      id: 'workflow-two-stage',
      requestTypeKey: 'standard_access',
      version: 2,
      status: 'published',
      stages: [
        { key: 'student_directors', label: 'Initial Review', reviewerRoleKey: 'director', notifyEmails: null },
        { key: 'faculty', label: 'Final Review', reviewerRoleKey: 'faculty', notifyEmails: null },
      ],
    });
    mocks.accessFindUnique.mockReset().mockResolvedValueOnce(initial).mockResolvedValueOnce(completed);
    mocks.txFindUnique.mockResolvedValue(pendingNextStage);

    const response = await POST(request(), { params: Promise.resolve({ id: 'request-1' }) });

    expect(response.status).toBe(200);
    expect(mocks.txUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: 'pending_student_directors' }),
      data: expect.objectContaining({ status: 'pending_faculty' }),
    }));
    const transition = mocks.txUpdateMany.mock.calls.find(([argument]) => argument?.data?.isManuallyAssigned);
    expect(transition?.[0].data).not.toHaveProperty('approvedAt');
    expect(mocks.accessUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: 'pending_faculty' }),
    }));
    expect(mocks.stageEmail).toHaveBeenCalledWith(expect.objectContaining({
      recipients: ['faculty@example.edu'],
      stageLabel: 'Final Review',
    }));
    expect(mocks.accessUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        stageNotificationStageKey: 'faculty',
        stageNotificationState: 'delivery_unknown',
      }),
      data: expect.objectContaining({ stageNotificationState: 'delivered' }),
    }));
  });

  it('persists an ambiguous configured-stage delivery for reconciliation', async () => {
    const initial = accessRequest({
      status: 'pending_student_directors',
      workflowVersionId: 'workflow-two-stage',
      requestTypeKey: 'standard_access',
    });
    const pendingNextStage = accessRequest({
      ...initial,
      version: 4,
      status: 'pending_faculty',
      isManuallyAssigned: true,
      ldapUsername: 'person1',
      linkedAdUsername: 'person1',
      provisioningState: 'reconciliation_pending',
    });
    const completed = { ...pendingNextStage, version: 5, provisioningState: 'completed' };
    mocks.workflowFindUnique.mockResolvedValue({
      id: 'workflow-two-stage',
      requestTypeKey: 'standard_access',
      version: 2,
      status: 'published',
      stages: [
        { key: 'student_directors', label: 'Initial Review', reviewerRoleKey: 'director', notifyEmails: null },
        { key: 'faculty', label: 'Final Review', reviewerRoleKey: 'faculty', notifyEmails: ['faculty@example.edu'] },
      ],
    });
    mocks.accessFindUnique.mockReset().mockResolvedValueOnce(initial).mockResolvedValue(completed);
    mocks.txFindUnique.mockResolvedValue(pendingNextStage);
    mocks.stageEmail.mockRejectedValue(new Error('SMTP outcome unavailable'));

    const response = await POST(request(), { params: Promise.resolve({ id: 'request-1' }) });

    expect(response.status).toBe(202);
    expect(mocks.accessUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ stageNotificationState: 'delivery_unknown' }),
    }));
  });
});
