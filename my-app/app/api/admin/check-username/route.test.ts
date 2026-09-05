import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  ldapSearch: vi.fn(),
  rateLimit: vi.fn(),
  requestFindUnique: vi.fn(),
  requestFindFirst: vi.fn(),
  audit: vi.fn(),
}));

vi.mock('@/lib/adminAuth', () => ({ checkReviewAccessWithRateLimit: mocks.auth }));
vi.mock('@/lib/ldap', () => ({ searchLDAPUserForProvisioning: mocks.ldapSearch }));
vi.mock('@/lib/ratelimit', () => ({
  checkRateLimitAsync: mocks.rateLimit,
  getClientIp: vi.fn(() => '127.0.0.1'),
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    accessRequest: {
      findUnique: mocks.requestFindUnique,
      findFirst: mocks.requestFindFirst,
    },
  },
}));
vi.mock('@/lib/audit-log', () => ({
  AuditActions: { CHECK_USERNAME: 'check_username' },
  AuditCategories: { USER: 'user' },
  getIpAddress: vi.fn(),
  getUserAgent: vi.fn(),
  logAuditAction: mocks.audit,
}));
vi.mock('@/lib/offboard-reenrollment', () => ({ findReusableOffboardedRequest: vi.fn() }));

import { POST } from './route';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/admin/check-username', () => {
  it('denies non-provisioners before parsing, rate limiting, database, or LDAP access', async () => {
    mocks.auth.mockResolvedValue({
      admin: {
        username: 'reviewer',
        permissions: new Set(['access_requests.read']),
        roles: new Set(),
        viaLegacyAdminFallback: false,
      },
      response: null,
    });
    const request = new NextRequest('https://portal.example.test/api/admin/check-username', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'target-user' }),
    });

    const response = await POST(request);

    expect(response.status).toBe(403);
    expect(mocks.rateLimit).not.toHaveBeenCalled();
    expect(mocks.requestFindUnique).not.toHaveBeenCalled();
    expect(mocks.requestFindFirst).not.toHaveBeenCalled();
    expect(mocks.ldapSearch).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});
