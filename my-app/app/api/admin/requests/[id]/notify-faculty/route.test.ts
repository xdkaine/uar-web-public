import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  accessFindUnique: vi.fn(),
  accessUpdateMany: vi.fn(),
  txAccessUpdateMany: vi.fn(),
  requestCommentCreate: vi.fn(),
  transaction: vi.fn(),
  sendFacultyNotification: vi.fn(),
  logAuditAction: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    accessRequest: {
      findUnique: mocks.accessFindUnique,
      updateMany: mocks.accessUpdateMany,
    },
    $transaction: mocks.transaction,
  },
}));
vi.mock('@/lib/adminAuth', () => ({
  checkReviewAccessWithRateLimit: vi.fn().mockResolvedValue({
    admin: { username: 'reviewer' }, response: null,
  }),
}));
vi.mock('@/lib/rbac/core', () => ({ actorCanActOnStage: vi.fn(() => true) }));
vi.mock('@/lib/modules/core', () => ({ isModuleEnabled: vi.fn().mockResolvedValue(false) }));
vi.mock('@/lib/workflow/core', () => ({
  resolveWorkflowForRequest: vi.fn().mockResolvedValue({
    stages: [
      { reviewerRoleKey: 'student_director', notificationRecipients: [] },
      { reviewerRoleKey: 'faculty', notificationRecipients: ['faculty@example.test'] },
    ],
  }),
  supportsFacultyHandoffActions: vi.fn(() => true),
  workflowIntegrityConflict: vi.fn(() => null),
  stageStatus: vi.fn(() => 'pending_faculty'),
  resolveStageNotificationRecipients: vi.fn(async (stage: { notificationRecipients?: string[] }) =>
    stage.notificationRecipients ?? []
  ),
}));
vi.mock('@/lib/email', () => ({
  sendVPNPendingFacultyNotification: vi.fn(),
  sendStudentDirectorNotification: vi.fn(),
  sendFacultyNotification: mocks.sendFacultyNotification,
}));
vi.mock('@/lib/email-config', () => ({
  getEmailConfig: vi.fn().mockResolvedValue({ facultyEmail: 'faculty@example.test' }),
  getStudentDirectorEmails: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/lib/audit-log', () => ({
  logAuditAction: mocks.logAuditAction,
  AuditActions: { SEND_TO_FACULTY: 'send_to_faculty' },
  AuditCategories: { ACCESS_REQUEST: 'access_request' },
  getIpAddress: () => '127.0.0.1',
  getUserAgent: () => 'vitest',
}));

import { POST } from './route';

const requestRow = {
  id: 'request-1',
  version: 7,
  status: 'pending_faculty',
  isVerified: true,
  sentToFacultyAt: null,
  facultyNotificationState: null,
  workflowVersionId: 'workflow-v1',
  name: 'Student User',
  email: 'student@example.test',
  isInternal: true,
  needsDomainAccount: true,
  vpnUsername: null,
  ldapUsername: 'student',
};

function invoke() {
  return POST(
    new NextRequest('https://portal.example.test/api/admin/requests/request-1/notify-faculty', { method: 'POST' }),
    { params: Promise.resolve({ id: 'request-1' }) }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.accessFindUnique.mockResolvedValue(requestRow);
  mocks.accessUpdateMany.mockResolvedValue({ count: 1 });
  mocks.txAccessUpdateMany.mockResolvedValue({ count: 1 });
  mocks.requestCommentCreate.mockResolvedValue({});
  mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({
    accessRequest: { updateMany: mocks.txAccessUpdateMany, findUnique: vi.fn().mockResolvedValue(requestRow) },
    requestComment: { create: mocks.requestCommentCreate },
  }));
  mocks.sendFacultyNotification.mockResolvedValue(undefined);
  mocks.logAuditAction.mockResolvedValue(undefined);
});

describe('notify faculty delivery handoff', () => {
  it('claims delivery before SMTP and records delivered only after SMTP succeeds', async () => {
    mocks.sendFacultyNotification.mockImplementation(async () => {
      expect(mocks.accessUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ facultyNotificationState: 'sending' }),
      }));
      expect(mocks.transaction).not.toHaveBeenCalled();
    });

    const response = await invoke();

    expect(response.status).toBe(200);
    expect(mocks.txAccessUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ facultyNotificationState: 'sending' }),
      data: expect.objectContaining({ facultyNotificationState: 'delivered' }),
    }));
  });

  it('records an unknown outcome and does not retry automatically when SMTP fails ambiguously', async () => {
    mocks.sendFacultyNotification.mockRejectedValue(new Error('SMTP unavailable'));

    const response = await invoke();

    expect(response.status).toBe(202);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.accessUpdateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        facultyNotificationState: 'delivery_unknown',
        facultyNotificationError: 'SMTP unavailable',
      }),
    }));
  });
});
