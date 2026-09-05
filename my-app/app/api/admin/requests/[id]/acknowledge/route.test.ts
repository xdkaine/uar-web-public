import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  checkReviewAccessWithRateLimit: vi.fn(),
  searchLDAPUserForProvisioning: vi.fn(),
  findUnique: vi.fn(),
  findFirst: vi.fn(),
  updateMany: vi.fn(),
  vpnFindUnique: vi.fn(),
  vpnCreate: vi.fn(),
  vpnUpdate: vi.fn(),
  statusLogCreate: vi.fn(),
  commentCreate: vi.fn(),
  workflowFindFirst: vi.fn(),
  workflowFindUnique: vi.fn(),
  isModuleEnabled: vi.fn(),
  encryptPassword: vi.fn((value: string) => `enc(${value})`),
  sendVPNPendingFacultyNotification: vi.fn(),
  sendStudentDirectorNotification: vi.fn(),
  sendFacultyNotification: vi.fn(),
  sendWorkflowStageNotification: vi.fn(),
  getEmailConfig: vi.fn(),
  getStudentDirectorEmails: vi.fn(),
  logAuditAction: vi.fn(),
  findReusableOffboardedRequest: vi.fn(),
  deliverFacultyNotification: vi.fn(),
}));

vi.mock('@/lib/adminAuth', () => ({ checkReviewAccessWithRateLimit: mocks.checkReviewAccessWithRateLimit }));
vi.mock('@/lib/ldap', () => ({ searchLDAPUserForProvisioning: mocks.searchLDAPUserForProvisioning }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    accessRequest: {
      findUnique: mocks.findUnique,
      findFirst: mocks.findFirst,
      updateMany: mocks.updateMany,
    },
    vPNAccount: {
      findUnique: mocks.vpnFindUnique,
      create: mocks.vpnCreate,
      update: mocks.vpnUpdate,
    },
    vPNAccountStatusLog: { create: mocks.statusLogCreate },
    requestComment: { create: mocks.commentCreate },
    workflowDefinition: { findFirst: mocks.workflowFindFirst, findUnique: mocks.workflowFindUnique },
  },
}));
vi.mock('@/lib/modules/core', () => ({ isModuleEnabled: mocks.isModuleEnabled }));
vi.mock('@/lib/encryption', () => ({ encryptPassword: mocks.encryptPassword }));
vi.mock('@/lib/email', () => ({
  sendVPNPendingFacultyNotification: mocks.sendVPNPendingFacultyNotification,
  sendStudentDirectorNotification: mocks.sendStudentDirectorNotification,
  sendFacultyNotification: mocks.sendFacultyNotification,
  sendWorkflowStageNotification: mocks.sendWorkflowStageNotification,
}));
vi.mock('@/lib/email-config', () => ({
  getEmailConfig: mocks.getEmailConfig,
  getStudentDirectorEmails: mocks.getStudentDirectorEmails,
}));
vi.mock('@/lib/offboard-reenrollment', () => ({
  findReusableOffboardedRequest: mocks.findReusableOffboardedRequest,
}));
vi.mock('@/lib/faculty-notification', () => ({
  deliverFacultyNotification: mocks.deliverFacultyNotification,
}));
vi.mock('@/lib/audit-log', () => ({
  AuditActions: { ACKNOWLEDGE_REQUEST: 'acknowledge_request' },
  AuditCategories: { ACCESS_REQUEST: 'access_request' },
  getIpAddress: vi.fn(() => '127.0.0.1'),
  getUserAgent: vi.fn(() => 'vitest'),
  logAuditAction: mocks.logAuditAction,
}));

import { POST } from './route';

const baseRequest = {
  id: 'req-1',
  name: 'Test User',
  email: 'test@example.edu',
  isInternal: true,
  needsDomainAccount: true,
  isVerified: true,
  status: 'pending_student_directors',
  accountCreatedAt: new Date('2026-01-01T00:00:00Z'),
};

function adminContext() {
  return {
    username: 'admin1',
    roles: new Set(['system_administrator']),
    permissions: new Set(['access_requests.review.director', 'access_requests.provision']),
    viaLegacyAdminFallback: true,
  };
}

function makePost() {
  return new NextRequest('https://example.test/api/admin/requests/req-1/acknowledge', {
    method: 'POST',
    body: JSON.stringify({ ldapUsername: 'tuser', password: 'secret1' }),
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  let findUniqueCall = 0;
  mocks.checkReviewAccessWithRateLimit.mockResolvedValue({ admin: adminContext(), response: null });
  mocks.isModuleEnabled.mockResolvedValue(true);
  mocks.searchLDAPUserForProvisioning.mockResolvedValue(null);
  mocks.findReusableOffboardedRequest.mockResolvedValue(null);
  mocks.workflowFindFirst.mockResolvedValue(null);
  mocks.workflowFindUnique.mockResolvedValue(null);
  // Call order inside the route: initial fetch (full record), optional status
  // probe ({select}), post-update refetch (full record).
  mocks.findUnique.mockImplementation(async (args?: { select?: unknown }) => {
    if (args?.select) {
      return { status: 'pending_student_directors' };
    }
    findUniqueCall += 1;
    return findUniqueCall === 1
      ? { ...baseRequest }
      : { ...baseRequest, status: 'pending_faculty', ldapUsername: 'tuser' };
  });
  mocks.updateMany.mockResolvedValue({ count: 1 });
  mocks.findFirst.mockResolvedValue(null);
  mocks.vpnFindUnique.mockResolvedValue(null);
  mocks.vpnCreate.mockResolvedValue({ id: 'vpn-1' });
  mocks.getEmailConfig.mockResolvedValue({ facultyEmail: 'faculty@example.edu' });
  mocks.getStudentDirectorEmails.mockResolvedValue([]);
  mocks.deliverFacultyNotification.mockImplementation(async ({ vpnModuleEnabled }) => ({
    status: 'delivered',
    request: { ...baseRequest, status: 'pending_faculty', ldapUsername: 'tuser', vpnModuleEnabled },
  }));
  mocks.sendWorkflowStageNotification.mockResolvedValue(undefined);
});

describe('POST /api/admin/requests/[id]/acknowledge', () => {
  it('creates the VPN tracking entry when the VPN module is enabled', async () => {
    const response = await POST(makePost(), { params: Promise.resolve({ id: 'req-1' }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mocks.vpnCreate).toHaveBeenCalledTimes(1);
    expect(mocks.statusLogCreate).toHaveBeenCalledTimes(1);
    expect(mocks.deliverFacultyNotification).toHaveBeenCalledWith(expect.objectContaining({ vpnModuleEnabled: true }));

    const commentArg = mocks.commentCreate.mock.calls[0][0].data.comment;
    expect(commentArg).toContain('VPN account entry created');
  });

  it('skips VPN records and reports honestly when the VPN module is disabled', async () => {
    mocks.isModuleEnabled.mockResolvedValue(false);

    const response = await POST(makePost(), { params: Promise.resolve({ id: 'req-1' }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mocks.vpnFindUnique).not.toHaveBeenCalled();
    expect(mocks.vpnCreate).not.toHaveBeenCalled();
    expect(mocks.vpnUpdate).not.toHaveBeenCalled();
    expect(mocks.statusLogCreate).not.toHaveBeenCalled();
    // The generic faculty notice replaces the VPN-specific one.
    expect(mocks.sendVPNPendingFacultyNotification).not.toHaveBeenCalled();
    expect(mocks.deliverFacultyNotification).toHaveBeenCalledWith(expect.objectContaining({ vpnModuleEnabled: false }));

    const commentArg = mocks.commentCreate.mock.calls[0][0].data.comment;
    expect(commentArg).toContain('VPN management is disabled');

    // The audit trail reflects reality instead of claiming a VPN entry was created.
    const auditCall = mocks.logAuditAction.mock.calls.find(
      (call) => call[0]?.details?.vpnAccountCreated !== undefined && call[0]?.success !== false
    );
    expect(auditCall?.[0].details.vpnAccountCreated).toBe(false);
    expect(auditCall?.[0].details.vpnModuleEnabled).toBe(false);
  });

  it('still completes AD-only governance when disabled: credentials stored and status advanced', async () => {
    mocks.isModuleEnabled.mockResolvedValue(false);

    await POST(makePost(), { params: Promise.resolve({ id: 'req-1' }) });

    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: 'req-1',
        status: 'pending_student_directors',
      }),
      data: expect.objectContaining({
        status: 'pending_faculty',
        acknowledgedByDirector: true,
        accountPassword: 'enc(secret1)',
      }),
    }));
    expect(mocks.updateMany.mock.calls[0][0].data).not.toHaveProperty('vpnUsername');
  });

  it('rejects acknowledge at the final review stage of the pinned workflow', async () => {
    mocks.findUnique.mockImplementation(async () => ({
      ...baseRequest,
      status: 'pending_faculty',
    }));

    const response = await POST(makePost(), { params: Promise.resolve({ id: 'req-1' }) });
    expect(response.status).toBe(409);
  });

  it('requires provisioning permission in addition to the configured stage role', async () => {
    mocks.checkReviewAccessWithRateLimit.mockResolvedValue({
      admin: {
        username: 'reviewer-only',
        roles: new Set<string>(),
        permissions: new Set(['access_requests.review.director']),
        viaLegacyAdminFallback: false,
      },
      response: null,
    });

    const response = await POST(makePost(), { params: Promise.resolve({ id: 'req-1' }) });

    expect(response.status).toBe(403);
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.searchLDAPUserForProvisioning).not.toHaveBeenCalled();
  });

  it('uses a role-neutral notification for a reversed configured stage order', async () => {
    const reversedRequest = {
      ...baseRequest,
      status: 'pending_faculty',
      workflowVersionId: 'workflow-reversed',
      requestTypeKey: 'standard_access',
    };
    let requestRead = 0;
    mocks.findUnique.mockImplementation(async (args?: { select?: unknown }) => {
      if (args?.select) return { status: 'pending_faculty' };
      requestRead += 1;
      return requestRead === 1
        ? reversedRequest
        : { ...reversedRequest, status: 'pending_student_directors', ldapUsername: 'tuser' };
    });
    mocks.workflowFindUnique.mockResolvedValue({
      id: 'workflow-reversed',
      requestTypeKey: 'standard_access',
      version: 4,
      status: 'published',
      stages: [
        { key: 'faculty', label: 'Initial Review', reviewerRoleKey: 'faculty', notifyEmails: null },
        { key: 'student_directors', label: 'Final Security Review', reviewerRoleKey: 'director', notifyEmails: ['directors@cpp.edu'] },
      ],
    });
    mocks.checkReviewAccessWithRateLimit.mockResolvedValue({
      admin: {
        username: 'faculty-provisioner',
        roles: new Set<string>(),
        permissions: new Set(['access_requests.review.faculty', 'access_requests.provision']),
        viaLegacyAdminFallback: false,
      },
      response: null,
    });
    mocks.isModuleEnabled.mockResolvedValue(false);

    const response = await POST(makePost(), { params: Promise.resolve({ id: 'req-1' }) });

    expect(response.status).toBe(200);
    expect(mocks.deliverFacultyNotification).not.toHaveBeenCalled();
    expect(mocks.sendStudentDirectorNotification).not.toHaveBeenCalled();
    expect(mocks.sendWorkflowStageNotification).toHaveBeenCalledWith(expect.objectContaining({
      recipients: ['directors@cpp.edu'],
      stageLabel: 'Final Security Review',
    }));
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'pending_student_directors' }),
    }));
    const transition = mocks.updateMany.mock.calls.find(([argument]) => argument?.data?.status === 'pending_student_directors');
    expect(transition?.[0].data).not.toHaveProperty('facultyNotificationState');
    expect(transition?.[0].data).toMatchObject({
      stageNotificationState: 'delivery_unknown',
      stageNotificationStageKey: 'student_directors',
    });
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ stageNotificationState: 'delivered' }),
    }));
  });

  it('persists an ambiguous generic-stage delivery for operator reconciliation', async () => {
    const reversedRequest = {
      ...baseRequest,
      status: 'pending_faculty',
      workflowVersionId: 'workflow-reversed',
      requestTypeKey: 'standard_access',
    };
    let requestRead = 0;
    mocks.findUnique.mockImplementation(async (args?: { select?: unknown }) => {
      if (args?.select) return { status: 'pending_faculty' };
      requestRead += 1;
      return requestRead === 1
        ? reversedRequest
        : { ...reversedRequest, status: 'pending_student_directors', ldapUsername: 'tuser' };
    });
    mocks.workflowFindUnique.mockResolvedValue({
      id: 'workflow-reversed',
      requestTypeKey: 'standard_access',
      version: 4,
      status: 'published',
      stages: [
        { key: 'faculty', label: 'Initial Review', reviewerRoleKey: 'faculty', notifyEmails: null },
        { key: 'student_directors', label: 'Final Security Review', reviewerRoleKey: 'director', notifyEmails: ['directors@cpp.edu'] },
      ],
    });
    mocks.checkReviewAccessWithRateLimit.mockResolvedValue({
      admin: {
        username: 'faculty-provisioner',
        roles: new Set<string>(),
        permissions: new Set(['access_requests.review.faculty', 'access_requests.provision']),
        viaLegacyAdminFallback: false,
      },
      response: null,
    });
    mocks.isModuleEnabled.mockResolvedValue(false);
    mocks.sendWorkflowStageNotification.mockRejectedValue(new Error('SMTP outcome unavailable'));

    const response = await POST(makePost(), { params: Promise.resolve({ id: 'req-1' }) });

    expect(response.status).toBe(202);
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ stageNotificationState: 'delivery_unknown' }),
      data: expect.objectContaining({
        stageNotificationState: 'delivery_unknown',
        stageNotificationError: expect.stringContaining('could not be confirmed'),
      }),
    }));
  });
});
