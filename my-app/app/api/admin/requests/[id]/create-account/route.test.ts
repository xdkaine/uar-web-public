import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  checkReviewAccessWithRateLimit: vi.fn(),
  transaction: vi.fn(),
  findUnique: vi.fn(),
  findUniqueOrThrow: vi.fn(),
  findFirst: vi.fn(),
  updateMany: vi.fn(),
  commentCreate: vi.fn(),
  searchLDAPUserForProvisioning: vi.fn(),
  createLDAPUser: vi.fn(),
  setLDAPUserPassword: vi.fn(),
  setLDAPUserExpiration: vi.fn(),
  deleteLDAPUser: vi.fn(),
  disableLDAPUser: vi.fn(),
  descriptionMatchesRequestTag: vi.fn(() => false),
  decryptPassword: vi.fn((value: string) => `plain(${value})`),
  findReusableOffboardedRequest: vi.fn(),
  isModuleEnabled: vi.fn(),
  extractBronconame: vi.fn(),
  sanitizeDatabaseText: vi.fn((value: string) => value),
  logAuditAction: vi.fn(),
  workflowFindFirst: vi.fn(),
  workflowFindUnique: vi.fn(),
}));

vi.mock('@/lib/adminAuth', () => ({ checkReviewAccessWithRateLimit: mocks.checkReviewAccessWithRateLimit }));
vi.mock('@/lib/ldap', () => ({
  searchLDAPUserForProvisioning: mocks.searchLDAPUserForProvisioning,
  createLDAPUser: mocks.createLDAPUser,
  setLDAPUserPassword: mocks.setLDAPUserPassword,
  setLDAPUserExpiration: mocks.setLDAPUserExpiration,
  deleteLDAPUser: mocks.deleteLDAPUser,
  disableLDAPUser: mocks.disableLDAPUser,
  descriptionMatchesRequestTag: mocks.descriptionMatchesRequestTag,
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: mocks.transaction,
    accessRequest: {
      findUnique: mocks.findUnique,
      findUniqueOrThrow: mocks.findUniqueOrThrow,
      findFirst: mocks.findFirst,
      updateMany: mocks.updateMany,
    },
    requestComment: { create: mocks.commentCreate },
    workflowDefinition: {
      findFirst: mocks.workflowFindFirst,
      findUnique: mocks.workflowFindUnique,
    },
  },
}));
vi.mock('@/lib/encryption', () => ({ decryptPassword: mocks.decryptPassword }));
vi.mock('@/lib/audit-log', () => ({
  AuditActions: { CREATE_ACCOUNT: 'create_account' },
  AuditCategories: { ACCESS_REQUEST: 'access_request' },
  getIpAddress: () => '203.0.113.10',
  getUserAgent: () => 'create-account-test',
  sanitizeDatabaseText: mocks.sanitizeDatabaseText,
  logAuditAction: mocks.logAuditAction,
}));
vi.mock('@/lib/validation', () => ({ extractBronconame: mocks.extractBronconame }));
vi.mock('@/lib/offboard-reenrollment', () => ({
  findReusableOffboardedRequest: mocks.findReusableOffboardedRequest,
}));
vi.mock('@/lib/modules/core', () => ({ isModuleEnabled: mocks.isModuleEnabled }));

import { POST } from './route';

const params = { params: Promise.resolve({ id: 'request-1' }) };
const routeUrl = 'https://portal.example.test/api/admin/requests/request-1/create-account';
const request = () => new NextRequest(routeUrl, { method: 'POST' });

function reviewerContext() {
  return {
    username: 'reviewonly-admin',
    roles: new Set<string>(),
    permissions: new Set(['access_requests.review.faculty']),
    viaLegacyAdminFallback: false,
  };
}

function provisioningContext() {
  return {
    username: 'provisioner',
    roles: new Set<string>(),
    permissions: new Set(['access_requests.review.director', 'access_requests.provision']),
    viaLegacyAdminFallback: false,
  };
}

const provisionableRequest = {
  id: 'request-1',
  name: 'External User',
  email: 'external@example.net',
  isInternal: false,
  isVerified: true,
  status: 'pending_student_directors',
  version: 5,
  ldapUsername: 'extuser',
  vpnUsername: 'extvpn',
  accountPassword: 'ciphertext',
  accountExpiresAt: new Date('2030-01-01T00:00:00.000Z'),
  accountCreatedAt: null,
  provisioningState: null,
  provisioningStartedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkReviewAccessWithRateLimit.mockResolvedValue({
    admin: provisioningContext(),
    response: null,
  });
  mocks.isModuleEnabled.mockResolvedValue(false);
  mocks.searchLDAPUserForProvisioning.mockResolvedValue(null);
  mocks.createLDAPUser.mockResolvedValue(undefined);
  mocks.setLDAPUserPassword.mockResolvedValue(undefined);
  mocks.setLDAPUserExpiration.mockResolvedValue(undefined);
  mocks.deleteLDAPUser.mockResolvedValue(undefined);
  mocks.disableLDAPUser.mockResolvedValue(undefined);
  mocks.findReusableOffboardedRequest.mockResolvedValue(null);
  mocks.logAuditAction.mockResolvedValue(undefined);
  mocks.workflowFindFirst.mockResolvedValue(null);
  mocks.workflowFindUnique.mockResolvedValue(null);
  mocks.commentCreate.mockResolvedValue({ id: 'c1' });
  mocks.updateMany.mockResolvedValue({ count: 1 });
  mocks.findUniqueOrThrow.mockResolvedValue({ ...provisionableRequest });
  mocks.transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
    fn({
      accessRequest: {
        findUnique: mocks.findUnique,
        findUniqueOrThrow: mocks.findUniqueOrThrow,
        findFirst: mocks.findFirst,
        updateMany: mocks.updateMany,
      },
      requestComment: { create: mocks.commentCreate },
    })
  );
});

describe('POST /api/admin/requests/[id]/create-account authorization', () => {
  it('denies a review-only actor with 403 before any directory or database mutation', async () => {
    mocks.checkReviewAccessWithRateLimit.mockResolvedValue({
      admin: reviewerContext(),
      response: null,
    });

    const response = await POST(request(), params);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe('Forbidden');

    expect(mocks.searchLDAPUserForProvisioning).not.toHaveBeenCalled();
    expect(mocks.createLDAPUser).not.toHaveBeenCalled();
    expect(mocks.setLDAPUserPassword).not.toHaveBeenCalled();
    expect(mocks.decryptPassword).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();

    expect(mocks.logAuditAction).toHaveBeenCalledWith(expect.objectContaining({
      action: 'create_account',
      category: 'access_request',
      username: 'reviewonly-admin',
      eventKind: 'security',
      outcome: 'denied',
      success: false,
      details: expect.objectContaining({
        reason: 'permission_denied',
        missingPermission: 'access_requests.provision',
        route: '/api/admin/requests/request-1/create-account',
      }),
    }));
  });

  it('allows the configured stage reviewer with provisioning permission to complete provisioning', async () => {
    mocks.findUnique.mockResolvedValue({ ...provisionableRequest });

    const response = await POST(request(), params);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);

    expect(mocks.createLDAPUser).toHaveBeenCalledOnce();
    expect(mocks.createLDAPUser).toHaveBeenCalledWith(
      'extuser',
      'external@example.net',
      'External User',
      true,
      'request-1',
      provisionableRequest.accountExpiresAt
    );
    expect(mocks.setLDAPUserPassword).toHaveBeenCalledWith('extuser', 'plain(ciphertext)');
    expect(mocks.logAuditAction).toHaveBeenCalledWith(expect.objectContaining({
      action: 'create_account',
      eventKind: 'write',
      outcome: 'success',
      username: 'provisioner',
    }));
  });

  it('keeps a one-stage workflow in its configured final stage after account preparation', async () => {
    const finalStageRequest = {
      ...provisionableRequest,
      status: 'pending_faculty',
      workflowVersionId: 'workflow-faculty-v3',
      requestTypeKey: 'standard_access',
    };
    mocks.checkReviewAccessWithRateLimit.mockResolvedValue({
      admin: {
        username: 'faculty-provisioner',
        roles: new Set<string>(),
        permissions: new Set([
          'access_requests.review.faculty',
          'access_requests.provision',
        ]),
        viaLegacyAdminFallback: false,
      },
      response: null,
    });
    mocks.workflowFindUnique.mockResolvedValue({
      id: 'workflow-faculty-v3',
      requestTypeKey: 'standard_access',
      version: 3,
      status: 'published',
      stages: [
        {
          key: 'faculty',
          label: 'Security Review',
          reviewerRoleKey: 'faculty',
          notifyEmails: null,
        },
      ],
    });
    mocks.findUnique.mockResolvedValue(finalStageRequest);
    mocks.findUniqueOrThrow.mockResolvedValue(finalStageRequest);

    const response = await POST(request(), params);

    expect(response.status).toBe(200);
    const completionCall = mocks.updateMany.mock.calls.find(
      ([argument]) => argument?.data?.provisioningState === 'succeeded'
    );
    expect(completionCall?.[0]).toEqual(expect.objectContaining({
      where: expect.objectContaining({ status: 'pending_faculty' }),
      data: expect.objectContaining({ status: 'pending_faculty' }),
    }));
    expect(completionCall?.[0].data).not.toHaveProperty('acknowledgedByDirector');
  });

  it('records earlier-stage evidence when a non-director stage advances', async () => {
    const reversedRequest = {
      ...provisionableRequest,
      status: 'pending_faculty',
      workflowVersionId: 'workflow-reversed-v2',
      requestTypeKey: 'standard_access',
    };
    mocks.checkReviewAccessWithRateLimit.mockResolvedValue({
      admin: {
        username: 'faculty-provisioner',
        roles: new Set<string>(),
        permissions: new Set(['access_requests.review.faculty', 'access_requests.provision']),
        viaLegacyAdminFallback: false,
      },
      response: null,
    });
    mocks.workflowFindUnique.mockResolvedValue({
      id: 'workflow-reversed-v2',
      requestTypeKey: 'standard_access',
      version: 2,
      status: 'published',
      stages: [
        { key: 'faculty', label: 'Initial Review', reviewerRoleKey: 'faculty', notifyEmails: null },
        { key: 'student_directors', label: 'Final Review', reviewerRoleKey: 'director', notifyEmails: null },
      ],
    });
    mocks.findUnique.mockResolvedValue(reversedRequest);
    mocks.findUniqueOrThrow.mockResolvedValue({ ...reversedRequest, status: 'pending_student_directors' });

    const response = await POST(request(), params);

    expect(response.status).toBe(200);
    const completionCall = mocks.updateMany.mock.calls.find(
      ([argument]) => argument?.data?.provisioningState === 'succeeded'
    );
    expect(completionCall?.[0].data).toEqual(expect.objectContaining({
      status: 'pending_student_directors',
      acknowledgedByDirector: true,
      acknowledgedBy: 'faculty-provisioner',
    }));
  });

  it('does not fall through to failure auditing when the denial audit write fails', async () => {
    mocks.checkReviewAccessWithRateLimit.mockResolvedValue({
      admin: reviewerContext(),
      response: null,
    });
    mocks.logAuditAction.mockRejectedValue(new Error('audit store unavailable'));

    const response = await POST(request(), params);

    expect(response.status).toBe(403);
    expect(mocks.logAuditAction).toHaveBeenCalledTimes(1);
    expect(mocks.createLDAPUser).not.toHaveBeenCalled();
  });
});
