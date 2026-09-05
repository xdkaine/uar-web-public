import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  checkReviewAccessWithRateLimit: vi.fn(),
  transaction: vi.fn(),
  queryRaw: vi.fn(),
  batchFindMany: vi.fn(),
  findUnique: vi.fn(),
  findFirst: vi.fn(),
  update: vi.fn(),
  commentCreate: vi.fn(),
  searchLDAPUserForProvisioning: vi.fn(),
  encryptPassword: vi.fn((value: string) => `encrypted(${value})`),
  findReusableOffboardedRequest: vi.fn(),
  logAuditAction: vi.fn(),
  workflowFindFirst: vi.fn(),
}));

vi.mock('@/lib/adminAuth', () => ({ checkReviewAccessWithRateLimit: mocks.checkReviewAccessWithRateLimit }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: mocks.transaction,
    accessRequest: {
      findUnique: mocks.findUnique,
      findFirst: mocks.findFirst,
      update: mocks.update,
    },
    requestComment: { create: mocks.commentCreate },
    workflowDefinition: { findFirst: mocks.workflowFindFirst },
  },
}));
vi.mock('@/lib/ldap', () => ({
  searchLDAPUserForProvisioning: mocks.searchLDAPUserForProvisioning,
}));
vi.mock('@/lib/encryption', () => ({ encryptPassword: mocks.encryptPassword }));
vi.mock('@/lib/audit-log', () => ({
  AuditActions: { SAVE_REQUEST_CREDENTIALS: 'save_request_credentials' },
  AuditCategories: { ACCESS_REQUEST: 'access_request' },
  getIpAddress: () => '203.0.113.20',
  getUserAgent: () => 'save-credentials-test',
  logAuditAction: mocks.logAuditAction,
}));
vi.mock('@/lib/offboard-reenrollment', () => ({
  findReusableOffboardedRequest: mocks.findReusableOffboardedRequest,
}));

import { POST } from './route';

const params = { params: Promise.resolve({ id: 'request-1' }) };
const routeUrl = 'https://portal.example.test/api/admin/requests/request-1/save-credentials';
const request = (body?: Record<string, string>) => new NextRequest(
  routeUrl,
  {
    method: 'POST',
    ...(body ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}),
  }
);

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

const credentialReadyRequest = {
  id: 'request-1',
  name: 'Internal User',
  email: 'internal@example.net',
  isInternal: true,
  isVerified: true,
  status: 'pending_student_directors',
  version: 7,
  ldapUsername: null,
  vpnUsername: null,
  accountExpiresAt: null,
  accountCreatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkReviewAccessWithRateLimit.mockResolvedValue({
    admin: provisioningContext(),
    response: null,
  });
  mocks.searchLDAPUserForProvisioning.mockResolvedValue(null);
  mocks.batchFindMany.mockResolvedValue([]);
  mocks.findReusableOffboardedRequest.mockResolvedValue(null);
  mocks.logAuditAction.mockResolvedValue(undefined);
  mocks.workflowFindFirst.mockResolvedValue(null);
  mocks.commentCreate.mockResolvedValue({ id: 'c1' });
  mocks.update.mockResolvedValue({ ...credentialReadyRequest });
  mocks.transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
    fn({
      $queryRaw: mocks.queryRaw,
      accessRequest: {
        findUnique: mocks.findUnique,
        update: mocks.update,
      },
      batchAccountItem: { findMany: mocks.batchFindMany },
      requestComment: { create: mocks.commentCreate },
    })
  );
});

describe('POST /api/admin/requests/[id]/save-credentials authorization', () => {
  it('denies a review-only actor with 403 before any directory lookup or credential persistence', async () => {
    mocks.checkReviewAccessWithRateLimit.mockResolvedValue({
      admin: reviewerContext(),
      response: null,
    });

    const response = await POST(request({ ldapUsername: 'extuser', password: 'secret' }), params);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe('Forbidden');

    expect(mocks.searchLDAPUserForProvisioning).not.toHaveBeenCalled();
    expect(mocks.encryptPassword).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();

    expect(mocks.logAuditAction).toHaveBeenCalledWith(expect.objectContaining({
      action: 'save_request_credentials',
      category: 'access_request',
      username: 'reviewonly-admin',
      eventKind: 'security',
      outcome: 'denied',
      success: false,
      details: expect.objectContaining({
        reason: 'permission_denied',
        missingPermission: 'access_requests.provision',
        route: '/api/admin/requests/request-1/save-credentials',
      }),
    }));
  });

  it('allows an actor holding access_requests.provision to save credentials', async () => {
    mocks.findUnique.mockResolvedValue({ ...credentialReadyRequest });

    const response = await POST(
      request({ ldapUsername: 'internaluser', password: 'S3curePass!' }),
      params
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);

    expect(mocks.encryptPassword).toHaveBeenCalledWith('S3curePass!');
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'request-1', version: 7 }),
    }));
    expect(mocks.logAuditAction).toHaveBeenCalledWith(expect.objectContaining({
      username: 'provisioner',
      targetId: 'request-1',
    }));
  });

  it('does not reserve credentials for a username governed by a batch run', async () => {
    mocks.findUnique.mockResolvedValue({ ...credentialReadyRequest });
    mocks.batchFindMany.mockResolvedValue([
      { id: 'item-1', batchId: 'batch-1', accountType: 'AD', status: 'completed' },
    ]);

    const response = await POST(
      request({ ldapUsername: 'internaluser', password: 'S3curePass!' }),
      params
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('governed by batch batch-1'),
    });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('does not fall through to failure auditing when the denial audit write fails', async () => {
    mocks.checkReviewAccessWithRateLimit.mockResolvedValue({
      admin: reviewerContext(),
      response: null,
    });
    mocks.logAuditAction.mockRejectedValue(new Error('audit store unavailable'));

    const response = await POST(request({ ldapUsername: 'extuser', password: 'secret' }), params);

    expect(response.status).toBe(403);
    expect(mocks.logAuditAction).toHaveBeenCalledTimes(1);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
