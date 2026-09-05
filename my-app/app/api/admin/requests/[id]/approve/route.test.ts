import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  checkReviewAccessWithRateLimit: vi.fn(),
  transaction: vi.fn(),
  findUnique: vi.fn(),
  updateMock: vi.fn(),
  updateMany: vi.fn(),
  vpnFindUnique: vi.fn(),
  vpnUpdate: vi.fn(),
  statusLogCreate: vi.fn(),
  commentCreate: vi.fn(),
  workflowFindFirst: vi.fn(),
  isModuleEnabled: vi.fn(),
  enableLDAPUser: vi.fn(),
  disableLDAPUser: vi.fn(),
  setLDAPUserExpiration: vi.fn(),
  decryptPassword: vi.fn((value: string) => `plain(${value})`),
  sendAccountReadyEmail: vi.fn(),
  sendAccountActivationEmail: vi.fn(),
  logAuditAction: vi.fn(),
}));

vi.mock('@/lib/adminAuth', () => ({ checkReviewAccessWithRateLimit: mocks.checkReviewAccessWithRateLimit }));
vi.mock('@/lib/ldap', () => ({
  enableLDAPUser: mocks.enableLDAPUser,
  disableLDAPUser: mocks.disableLDAPUser,
  setLDAPUserExpiration: mocks.setLDAPUserExpiration,
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: mocks.transaction,
    accessRequest: {
      findUnique: mocks.findUnique,
      update: mocks.updateMock,
      updateMany: mocks.updateMany,
    },
    vPNAccount: {
      findUnique: mocks.vpnFindUnique,
      update: mocks.vpnUpdate,
    },
    vPNAccountStatusLog: { create: mocks.statusLogCreate },
    requestComment: { create: mocks.commentCreate },
    workflowDefinition: { findFirst: mocks.workflowFindFirst },
  },
}));
vi.mock('@/lib/modules/core', () => ({ isModuleEnabled: mocks.isModuleEnabled }));
vi.mock('@/lib/encryption', () => ({ decryptPassword: mocks.decryptPassword }));
vi.mock('@/lib/email', () => ({
  sendAccountReadyEmail: mocks.sendAccountReadyEmail,
  sendAccountActivationEmail: mocks.sendAccountActivationEmail,
}));
vi.mock('@/lib/audit-log', () => ({
  AuditActions: { APPROVE_REQUEST: 'approve_request' },
  AuditCategories: { ACCESS_REQUEST: 'access_request' },
  getIpAddress: vi.fn(() => '127.0.0.1'),
  getUserAgent: vi.fn(() => 'vitest'),
  logAuditAction: mocks.logAuditAction,
}));

import { POST } from './route';

const externalRequest = {
  id: 'req-ext',
  name: 'External User',
  email: 'ext@example.net',
  isInternal: false,
  needsDomainAccount: true,
  isVerified: true,
  status: 'pending_faculty',
  version: 3,
  ldapUsername: 'extuser',
  vpnUsername: 'extvpn',
  accountPassword: 'enc-pass',
  accountExpiresAt: new Date('2026-12-01T00:00:00Z'),
  provisioningState: null,
};

function adminContext() {
  return {
    username: 'facultyadmin',
    roles: new Set(['system_administrator']),
    permissions: new Set(['access_requests.review.faculty']),
    viaLegacyAdminFallback: true,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkReviewAccessWithRateLimit.mockResolvedValue({ admin: adminContext(), response: null });
  mocks.isModuleEnabled.mockResolvedValue(false);
  mocks.workflowFindFirst.mockResolvedValue(null);
  mocks.enableLDAPUser.mockResolvedValue(true);
  mocks.sendAccountReadyEmail.mockResolvedValue(undefined);
  // First findUnique runs inside the claim transaction; later ones refetch.
  mocks.findUnique.mockImplementation(async () => ({ ...externalRequest }));
  mocks.updateMany.mockResolvedValue({ count: 1 });
  mocks.updateMock.mockResolvedValue({ ...externalRequest });
  mocks.logAuditAction.mockResolvedValue(undefined);
  mocks.commentCreate.mockResolvedValue({ id: 'c1' });
  mocks.transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
    fn({
      accessRequest: {
        findUnique: mocks.findUnique,
        updateMany: mocks.updateMany,
      },
      vPNAccount: { findUnique: mocks.vpnFindUnique },
      requestComment: { create: mocks.commentCreate },
    })
  );
});

describe('POST /api/admin/requests/[id]/approve with VPN module disabled', () => {
  it('approves an external AD-only request without touching VPN records', async () => {
    const request = new NextRequest('https://example.test/api/admin/requests/req-ext/approve', {
      method: 'POST',
      body: JSON.stringify({ message: 'ok' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(request, { params: Promise.resolve({ id: 'req-ext' }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);

    // Only the primary LDAP account is enabled; the VPN-linked account is not.
    expect(mocks.enableLDAPUser).toHaveBeenCalledTimes(1);
    expect(mocks.enableLDAPUser).toHaveBeenCalledWith('extuser');

    // No VPN record reads or writes occur while the module is disabled.
    expect(mocks.vpnFindUnique).not.toHaveBeenCalled();
    expect(mocks.vpnUpdate).not.toHaveBeenCalled();
    expect(mocks.statusLogCreate).not.toHaveBeenCalled();

    // Credentials email still goes out.
    expect(mocks.sendAccountReadyEmail).toHaveBeenCalled();

    const auditCall = mocks.logAuditAction.mock.calls.find((c) => c[0]?.outcome === 'success');
    expect(auditCall?.[0].details.vpnModuleEnabled).toBe(false);
  });

  it('still enforces credentials and username preconditions for external users', async () => {
    mocks.findUnique.mockResolvedValue({ ...externalRequest, accountPassword: null });

    const request = new NextRequest('https://example.test/api/admin/requests/req-ext/approve', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(request, { params: Promise.resolve({ id: 'req-ext' }) });
    expect(response.status).toBe(400);
    await response.json().then((body) => {
      expect(body.error).toMatch(/credentials must be set/i);
    });
  });

  it('does not claim a request while directory reconciliation is in progress', async () => {
    mocks.findUnique.mockResolvedValue({ ...externalRequest, provisioningState: 'reconciliation_pending' });

    const request = new NextRequest('https://example.test/api/admin/requests/req-ext/approve', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(request, { params: Promise.resolve({ id: 'req-ext' }) });

    expect(response.status).toBe(409);
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.enableLDAPUser).not.toHaveBeenCalled();
  });
});
