import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { SessionInfo } from '@/lib/session';

const mocks = vi.hoisted(() => ({
  localAccountFindUnique: vi.fn(),
  privilegeAssignmentFindMany: vi.fn(),
  isUserDomainAdmin: vi.fn(),
  searchLDAPUserForProvisioning: vi.fn(),
  checkRateLimitAsync: vi.fn(),
  getClientIp: vi.fn(),
  isRateLimitUnavailable: vi.fn(),
  getSessionFromCookies: vi.fn(),
  revokeSessionById: vi.fn(),
  clearSession: vi.fn(),
  logAuditAction: vi.fn(),
  categorizeRequest: vi.fn(),
  getIpAddress: vi.fn(),
  getUserAgent: vi.fn(),
  getConfigValue: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    localAccount: { findUnique: mocks.localAccountFindUnique },
    privilegeAssignment: { findMany: mocks.privilegeAssignmentFindMany },
  },
}));

vi.mock('@/lib/ldap', () => ({
  isUserDomainAdmin: mocks.isUserDomainAdmin,
  searchLDAPUserForProvisioning: mocks.searchLDAPUserForProvisioning,
}));

vi.mock('@/lib/ratelimit', () => ({
  checkRateLimitAsync: mocks.checkRateLimitAsync,
  getClientIp: mocks.getClientIp,
  isRateLimitUnavailable: mocks.isRateLimitUnavailable,
  RateLimitPresets: { adminOperations: { maxRequests: 400, windowMs: 60_000 } },
}));

vi.mock('@/lib/session', () => ({
  getSessionFromCookies: mocks.getSessionFromCookies,
  revokeSessionById: mocks.revokeSessionById,
  clearSession: mocks.clearSession,
}));

vi.mock('@/lib/audit-log', () => ({
  logAuditAction: mocks.logAuditAction,
  AuditActions: { ADMIN_API_REQUEST: 'admin_api_request' },
  categorizeRequest: mocks.categorizeRequest,
  getIpAddress: mocks.getIpAddress,
  getUserAgent: mocks.getUserAgent,
}));

vi.mock('@/lib/config/resolver', () => ({
  getConfigValue: mocks.getConfigValue,
}));

import { clearPrivilegeCache } from '@/lib/rbac/core';
import {
  checkAdminAuthWithRateLimit,
  checkReviewAccessWithRateLimit,
} from './adminAuth';

const facultyGroupDn = 'CN=UAR-Faculty,OU=Groups,DC=example,DC=test';

const facultyAssignment = {
  permissionKey: 'access_requests.review.faculty',
  adGroupDns: [facultyGroupDn],
  updatedBy: null,
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

function adSession(username = 'admin1'): SessionInfo {
  return {
    id: 'sess-ad',
    username,
    isAdmin: true,
    expiresAt: new Date(Date.now() + 900_000),
    lastActivity: new Date(),
    authProvider: 'ad',
  };
}

function localSession(username = 'breakglass', authProvider = 'local'): SessionInfo {
  return {
    id: 'sess-local',
    username,
    isAdmin: true,
    expiresAt: new Date(Date.now() + 900_000),
    lastActivity: new Date(),
    authProvider,
  };
}

function request(): NextRequest {
  return new NextRequest('https://portal.example.test/api/admin/settings');
}

beforeEach(() => {
  vi.clearAllMocks();
  clearPrivilegeCache();
  mocks.isRateLimitUnavailable.mockReturnValue(false);
  mocks.getClientIp.mockReturnValue('203.0.113.9');
  mocks.checkRateLimitAsync.mockResolvedValue({
    success: true,
    limit: 400,
    remaining: 399,
    reset: Date.now() + 60_000,
  });
  mocks.revokeSessionById.mockResolvedValue(undefined);
  mocks.clearSession.mockImplementation(() => undefined);
  mocks.logAuditAction.mockResolvedValue(undefined);
  mocks.categorizeRequest.mockReturnValue('admin_api');
  mocks.getIpAddress.mockReturnValue('203.0.113.9');
  mocks.getUserAgent.mockReturnValue('vitest-agent');
  mocks.getConfigValue.mockResolvedValue([]);
  mocks.getSessionFromCookies.mockResolvedValue(adSession());
});

describe('checkAdminAuthWithRateLimit legacy domain-admin tier', () => {
  it('fails open to the full catalog even when the privilege store is unreadable', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.isUserDomainAdmin.mockResolvedValue(true);
    mocks.privilegeAssignmentFindMany.mockRejectedValue(new Error('db down'));

    const { admin, response } = await checkAdminAuthWithRateLimit(request());

    expect(response).toBeUndefined();
    expect(admin?.username).toBe('admin1');
    expect(admin?.viaLegacyAdminFallback).toBe(true);
    expect(admin?.roles.has('system_administrator')).toBe(true);
    expect(admin?.permissions.has('settings.manage')).toBe(true);
    consoleError.mockRestore();
  });

  it('resolves mapped privileges from live memberOf directory groups for non-admins', async () => {
    mocks.isUserDomainAdmin.mockResolvedValue(false);
    mocks.privilegeAssignmentFindMany.mockResolvedValue([facultyAssignment]);
    mocks.searchLDAPUserForProvisioning.mockResolvedValue({
      attributes: [{ type: 'memberOf', values: [facultyGroupDn.toUpperCase()] }, { type: 'userAccountControl', values: ['512'] }],
    });

    const { admin, response } = await checkAdminAuthWithRateLimit(request());

    expect(response).toBeUndefined();
    expect(admin?.viaLegacyAdminFallback).toBe(false);
    expect(admin?.permissions.has('access_requests.review.faculty')).toBe(true);
    expect(admin?.permissions.has('settings.manage')).toBe(false);
    expect(admin?.roles.size).toBe(0);
    expect(mocks.searchLDAPUserForProvisioning).toHaveBeenCalledWith('admin1');
    expect(mocks.logAuditAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'admin_api_request', username: 'admin1' })
    );
  });

  it('denies unmapped AD users and revokes their elevated session', async () => {
    mocks.isUserDomainAdmin.mockResolvedValue(false);
    mocks.privilegeAssignmentFindMany.mockResolvedValue([]);

    const { admin, response } = await checkAdminAuthWithRateLimit(request());

    expect(admin).toBeNull();
    expect(response?.status).toBe(401);
    expect(mocks.searchLDAPUserForProvisioning).not.toHaveBeenCalled();
    expect(mocks.revokeSessionById).toHaveBeenCalledWith('sess-ad');
    expect(mocks.clearSession).toHaveBeenCalled();
  });
});

describe('checkAdminAuthWithRateLimit local break-glass tier', () => {
  it('grants the full catalog from an active break-glass account without directory calls', async () => {
    mocks.getSessionFromCookies.mockResolvedValue(localSession('BreakGlass'));
    mocks.localAccountFindUnique.mockResolvedValue({ isActive: true, purpose: 'break_glass' });

    const { admin, response } = await checkAdminAuthWithRateLimit(request());

    expect(response).toBeUndefined();
    expect(admin?.username).toBe('BreakGlass');
    expect(admin?.viaLocalBreakGlass).toBe(true);
    expect(admin?.permissions.has('offboard.manage')).toBe(true);
    expect(mocks.localAccountFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { username: 'breakglass' },
        select: { isActive: true, purpose: true },
      })
    );
    expect(mocks.isUserDomainAdmin).not.toHaveBeenCalled();
    expect(mocks.searchLDAPUserForProvisioning).not.toHaveBeenCalled();
  });

  it('applies the same active-account fence to a healthy-state local session', async () => {
    mocks.getSessionFromCookies.mockResolvedValue(localSession('BreakGlass', 'local_manual'));
    mocks.localAccountFindUnique.mockResolvedValue({ isActive: true, purpose: 'break_glass' });

    const { admin, response } = await checkAdminAuthWithRateLimit(request());

    expect(response).toBeUndefined();
    expect(admin?.viaLocalBreakGlass).toBe(true);
    expect(mocks.isUserDomainAdmin).not.toHaveBeenCalled();
  });

  it('revokes instantly when the break-glass account is deactivated between requests', async () => {
    mocks.getSessionFromCookies.mockResolvedValue(localSession('root'));
    mocks.localAccountFindUnique
      .mockResolvedValueOnce({ isActive: true, purpose: 'break_glass' })
      .mockResolvedValue({ isActive: false, purpose: 'break_glass' });

    const first = await checkAdminAuthWithRateLimit(request());
    expect(first.admin).not.toBeNull();

    const second = await checkAdminAuthWithRateLimit(request());

    expect(second.admin).toBeNull();
    expect(second.response?.status).toBe(401);
    expect(mocks.revokeSessionById).toHaveBeenCalledWith('sess-local');
    expect(mocks.clearSession).toHaveBeenCalled();
  });
});

describe('checkReviewAccessWithRateLimit reviewer tier', () => {
  it('stays fail-closed when the directory lookup errors and preserves the portal session', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.getSessionFromCookies.mockResolvedValue(adSession('prof1'));
    mocks.privilegeAssignmentFindMany.mockResolvedValue([facultyAssignment]);
    mocks.searchLDAPUserForProvisioning.mockRejectedValue(new Error('ldap down'));

    const { admin, response } = await checkReviewAccessWithRateLimit(request());

    expect(admin).toBeNull();
    expect(response?.status).toBe(401);
    expect(mocks.revokeSessionById).not.toHaveBeenCalled();
    expect(mocks.clearSession).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

describe('privilege assignment cache behavior', () => {
  it('serves assignments from cache within the TTL, refetches after expiry, and honors invalidation', async () => {
    const base = new Date('2026-01-01T12:00:00Z').getTime();
    vi.useFakeTimers();
    vi.setSystemTime(base);
    try {
      mocks.isUserDomainAdmin.mockResolvedValue(false);
      mocks.privilegeAssignmentFindMany.mockResolvedValue([facultyAssignment]);
      mocks.searchLDAPUserForProvisioning.mockResolvedValue({
        attributes: [{ type: 'memberOf', values: [facultyGroupDn] }, { type: 'userAccountControl', values: ['512'] }],
      });

      await checkAdminAuthWithRateLimit(request());
      await checkAdminAuthWithRateLimit(request());
      expect(mocks.privilegeAssignmentFindMany).toHaveBeenCalledTimes(1);

      vi.setSystemTime(base + 31_000);
      await checkAdminAuthWithRateLimit(request());
      expect(mocks.privilegeAssignmentFindMany).toHaveBeenCalledTimes(2);

      clearPrivilegeCache();
      await checkAdminAuthWithRateLimit(request());
      expect(mocks.privilegeAssignmentFindMany).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
});
