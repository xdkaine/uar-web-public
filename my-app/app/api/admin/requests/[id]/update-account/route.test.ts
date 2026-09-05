import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  requestFindUnique: vi.fn(),
  requestFindMany: vi.fn(),
  requestUpdateMany: vi.fn(),
  workflowFindFirst: vi.fn(),
  commentCreate: vi.fn(),
  searchLDAPUser: vi.fn(),
  setLDAPUserPassword: vi.fn(),
  setLDAPUserExpiration: vi.fn(),
  renameLDAPUser: vi.fn(),
  audit: vi.fn(),
}));

vi.mock('@/lib/adminAuth', () => ({ checkReviewAccessWithRateLimit: mocks.auth }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    accessRequest: {
      findUnique: mocks.requestFindUnique,
      findMany: mocks.requestFindMany,
      updateMany: mocks.requestUpdateMany,
    },
    workflowDefinition: { findFirst: mocks.workflowFindFirst },
    requestComment: { create: mocks.commentCreate },
  },
}));
vi.mock('@/lib/ldap', () => ({
  searchLDAPUser: mocks.searchLDAPUser,
  setLDAPUserPassword: mocks.setLDAPUserPassword,
  setLDAPUserExpiration: mocks.setLDAPUserExpiration,
  renameLDAPUser: mocks.renameLDAPUser,
}));
vi.mock('@/lib/audit-log', () => ({
  AuditActions: { UPDATE_ACCOUNT: 'update_account' },
  AuditCategories: { ACCESS_REQUEST: 'access_request' },
  getIpAddress: vi.fn(),
  getUserAgent: vi.fn(),
  logAuditAction: mocks.audit,
}));
vi.mock('@/lib/encryption', () => ({ encryptPassword: vi.fn(() => 'encrypted-password') }));

import { POST } from './route';

const baseRequest = {
  id: 'request-1',
  status: 'pending_student_directors',
  version: 3,
  workflowVersionId: null,
  accountCreatedAt: new Date('2026-08-01T00:00:00.000Z'),
  ldapUsername: 'authoritative-user',
  vpnUsername: null,
  isInternal: true,
  email: 'requester@example.test',
  name: 'Fixture Requester',
  accountExpiresAt: null,
  accountUpdateState: null,
  accountUpdateClaimId: null,
  accountUpdateClaimedUntil: null,
};

function admin(permissions: string[]) {
  return {
    username: 'operator',
    permissions: new Set(permissions),
    roles: new Set<string>(),
    viaLegacyAdminFallback: false,
  };
}

function request(body: Record<string, unknown>): NextRequest {
  return new NextRequest('https://portal.example.test/api/admin/requests/request-1/update-account', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const params = { params: Promise.resolve({ id: 'request-1' }) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requestFindUnique.mockResolvedValue(baseRequest);
  mocks.requestFindMany.mockResolvedValue([baseRequest]);
  mocks.requestUpdateMany.mockResolvedValue({ count: 1 });
  mocks.workflowFindFirst.mockResolvedValue(null);
  mocks.searchLDAPUser.mockResolvedValue({
    objectName: 'CN=Authoritative Person,OU=Users,DC=example,DC=test',
    attributes: [
      { type: 'sAMAccountName', values: ['authoritative-user'] },
      { type: 'objectGUID', values: ['guid-authoritative-user'] },
    ],
  });
  mocks.setLDAPUserPassword.mockResolvedValue(undefined);
  mocks.commentCreate.mockResolvedValue({});
  mocks.audit.mockResolvedValue(undefined);
});

describe('POST /api/admin/requests/[id]/update-account', () => {
  it('rejects malformed usernames and weak passwords before directory reads', async () => {
    mocks.auth.mockResolvedValue({
      admin: admin(['access_requests.read', 'access_requests.review.director', 'access_requests.provision']),
      response: null,
    });

    const malformed = await POST(request({ newLdapUsername: 'bad username', newPassword: 'Safe-Candidate9!' }), params);
    expect(malformed.status).toBe(400);
    const weak = await POST(request({ newLdapUsername: 'valid-user', newPassword: 'weak' }), params);
    expect(weak.status).toBe(400);
    expect(mocks.searchLDAPUser).not.toHaveBeenCalled();
  });

  it('denies a reviewer without the provisioning capability before reading the target', async () => {
    mocks.auth.mockResolvedValue({
      admin: admin(['access_requests.read', 'access_requests.review.director']),
      response: null,
    });

    const response = await POST(request({ newLdapUsername: 'authoritative-user', newPassword: 'Safe-Candidate9!' }), params);

    expect(response.status).toBe(403);
    expect(mocks.requestFindUnique).not.toHaveBeenCalled();
    expect(mocks.searchLDAPUser).not.toHaveBeenCalled();
  });

  it('requires the reviewer role governing the current workflow stage', async () => {
    mocks.auth.mockResolvedValue({
      admin: admin(['access_requests.read', 'access_requests.provision']),
      response: null,
    });

    const response = await POST(request({ newLdapUsername: 'authoritative-user', newPassword: 'Safe-Candidate9!' }), params);

    expect(response.status).toBe(403);
    expect(mocks.searchLDAPUser).not.toHaveBeenCalled();
  });

  it('ignores caller-supplied old usernames and mutates only the authoritative request identity', async () => {
    mocks.auth.mockResolvedValue({
      admin: admin([
        'access_requests.read',
        'access_requests.review.director',
        'access_requests.provision',
      ]),
      response: null,
    });

    const response = await POST(request({
      oldLdapUsername: 'unrelated-victim',
      oldVpnUsername: 'another-victim',
      newLdapUsername: 'authoritative-user',
      newPassword: 'Safe-Candidate9!',
    }), params);

    expect(response.status).toBe(200);
    expect(mocks.searchLDAPUser).toHaveBeenCalledWith('authoritative-user');
    expect(mocks.searchLDAPUser).not.toHaveBeenCalledWith('unrelated-victim');
    expect(mocks.renameLDAPUser).not.toHaveBeenCalled();
    expect(mocks.setLDAPUserPassword).toHaveBeenCalledWith(
      'authoritative-user',
      'Safe-Candidate9!',
      'CN=Authoritative Person,OU=Users,DC=example,DC=test'
    );
  });

  it('does not perform directory mutations when another operator wins the database claim', async () => {
    mocks.auth.mockResolvedValue({
      admin: admin([
        'access_requests.read',
        'access_requests.review.director',
        'access_requests.provision',
      ]),
      response: null,
    });
    mocks.requestUpdateMany.mockResolvedValueOnce({ count: 0 });

    const response = await POST(
      request({ newLdapUsername: 'authoritative-user', newPassword: 'Safe-Candidate9!' }),
      params
    );

    expect(response.status).toBe(409);
    expect(mocks.renameLDAPUser).not.toHaveBeenCalled();
    expect(mocks.setLDAPUserPassword).not.toHaveBeenCalled();
    expect(mocks.setLDAPUserExpiration).not.toHaveBeenCalled();
  });

  it('rejects a caller-selected occupied VPN destination before claiming or mutating LDAP', async () => {
    mocks.auth.mockResolvedValue({
      admin: admin([
        'access_requests.read',
        'access_requests.review.director',
        'access_requests.provision',
      ]),
      response: null,
    });
    mocks.requestFindUnique.mockResolvedValue({
      ...baseRequest,
      isInternal: false,
      vpnUsername: 'authoritative-vpn',
      accountExpiresAt: new Date('2026-09-01T00:00:00.000Z'),
    });
    mocks.searchLDAPUser.mockImplementation(async (username: string) => {
      if (username === 'occupied-vpn') return {
        objectName: 'CN=occupied-vpn,DC=example,DC=test',
        attributes: [],
      };
      return {
        objectName: `CN=${username},DC=example,DC=test`,
        attributes: [
          { type: 'sAMAccountName', values: [username] },
          { type: 'objectGUID', values: [`guid-${username}`] },
        ],
      };
    });

    const response = await POST(request({
      newLdapUsername: 'authoritative-user',
      newVpnUsername: 'occupied-vpn',
      newPassword: 'Safe-Candidate9!',
      newExpirationDate: '2026-09-02T00:00:00.000Z',
    }), params);

    expect(response.status).toBe(409);
    expect(mocks.requestUpdateMany).not.toHaveBeenCalled();
    expect(mocks.renameLDAPUser).not.toHaveBeenCalled();
    expect(mocks.setLDAPUserPassword).not.toHaveBeenCalled();
  });

  it('records reconciliation_required and blocks automatic retry after an ambiguous LDAP failure', async () => {
    mocks.auth.mockResolvedValue({
      admin: admin([
        'access_requests.read',
        'access_requests.review.director',
        'access_requests.provision',
      ]),
      response: null,
    });
    mocks.setLDAPUserPassword.mockRejectedValueOnce(new Error('connection closed after request'));

    const response = await POST(
      request({ newLdapUsername: 'authoritative-user', newPassword: 'Safe-Candidate9!' }),
      params
    );

    expect(response.status).toBe(202);
    expect(mocks.requestUpdateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      data: expect.objectContaining({ accountUpdateState: 'reconciliation_required' }),
    }));
  });
});
