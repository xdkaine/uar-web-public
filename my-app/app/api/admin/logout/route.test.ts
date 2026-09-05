import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  checkRateLimitAsync: vi.fn(),
  getSessionFromCookies: vi.fn(),
  revokeSessionByToken: vi.fn(),
  clearSession: vi.fn(),
  logAuditAction: vi.fn(),
  cookiesGet: vi.fn(),
}));

vi.mock('@/lib/ratelimit', () => ({
  checkRateLimitAsync: mocks.checkRateLimitAsync,
  getClientIp: () => '203.0.113.9',
  RateLimitPresets: {
    general: { maxRequests: 100, windowMs: 60_000 },
  },
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: mocks.cookiesGet }),
}));

vi.mock('@/lib/session', () => ({
  getSessionCookieName: () => 'uar_session',
  getSessionFromCookies: mocks.getSessionFromCookies,
  revokeSessionByToken: mocks.revokeSessionByToken,
  clearSession: mocks.clearSession,
}));

vi.mock('@/lib/audit-log', () => ({
  logAuditAction: mocks.logAuditAction,
  AuditActions: { ADMIN_LOGOUT: 'admin_logout' },
  AuditCategories: { NAVIGATION: 'navigation' },
  getIpAddress: () => '203.0.113.9',
  getUserAgent: () => 'admin-logout-route-test',
}));

vi.mock('@/lib/logger', () => ({
  appLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { POST } from './route';

function setEnv(configured: boolean) {
  delete process.env.OIDC_INTERNAL_ISSUER_URL;
  delete process.env.AUTH_ISSUER;
  delete process.env.AUTH_CLIENT_ID;
  delete process.env.AUTH_CLIENT_SECRET;
  if (configured) {
    process.env.OIDC_INTERNAL_ISSUER_URL = 'http://auth-service:3003';
    process.env.AUTH_CLIENT_ID = 'uar-portal';
    process.env.AUTH_CLIENT_SECRET = 'secret';
  }
}

function post() {
  return new NextRequest('https://portal.example.test/api/admin/logout', { method: 'POST' });
}

function adminSession() {
  return {
    id: 'sess-admin-1',
    username: 'admin.user',
    isAdmin: true,
    expiresAt: new Date(Date.now() + 60_000),
    lastActivity: new Date(),
    authProvider: 'ad',
  };
}

function rows() {
  const calls = mocks.logAuditAction.mock.calls as unknown as [
    { action: string; category: string }
  ][];
  return calls.map((call) => call[0]);
}

function providerRow() {
  return rows().find((entry) => entry.category === 'session');
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', mocks.fetch);
  mocks.checkRateLimitAsync.mockResolvedValue({
    success: true,
    limit: 100,
    remaining: 99,
    reset: Date.now() + 60_000,
  });
  mocks.cookiesGet.mockImplementation((name: string) =>
    name === 'uar_session' ? { value: 'token-abc' } : undefined
  );
  mocks.getSessionFromCookies.mockResolvedValue(adminSession());
  mocks.revokeSessionByToken.mockResolvedValue({ providerSid: 'sid-admin-1' });
  mocks.logAuditAction.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('POST /api/admin/logout provider logout auditing', () => {
  it('records a success row alongside the existing navigation row', async () => {
    setEnv(true);
    mocks.fetch.mockResolvedValue({ ok: true, status: 204 });

    const response = await POST(post());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });

    expect(rows()[0]).toMatchObject({
      action: 'admin_logout',
      category: 'navigation',
      username: 'admin.user',
    });

    expect(providerRow()).toEqual({
      action: 'admin_logout',
      category: 'session',
      username: 'admin.user',
      actorType: 'admin',
      targetType: 'Session',
      targetId: 'sess-admin-1',
      outcome: 'success',
      success: true,
      ipAddress: '203.0.113.9',
      userAgent: 'admin-logout-route-test',
      details: {
        providerSidPresent: true,
        providerLogoutAttempted: true,
        providerSessionDestroyed: true,
        providerLogoutOutcome: 'success',
      },
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    const init = (mocks.fetch.mock.calls as unknown as [string, { body: string }][])[0][1];
    expect(JSON.parse(init.body)).toEqual({ sid: 'sid-admin-1' });
    expect(mocks.clearSession).toHaveBeenCalledTimes(1);
  });

  it('records a durable failure row when the IdP is unreachable, without failing logout', async () => {
    setEnv(true);
    mocks.fetch.mockRejectedValue(new Error('connect timeout'));

    const response = await POST(post());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(mocks.clearSession).toHaveBeenCalledTimes(1);

    expect(providerRow()).toMatchObject({
      action: 'admin_logout',
      username: 'admin.user',
      outcome: 'failure',
      success: false,
      details: {
        providerSidPresent: true,
        providerLogoutAttempted: true,
        providerSessionDestroyed: false,
        providerLogoutOutcome: 'failure',
      },
    });
  });

  it('records not-configured when no provider session id was recorded', async () => {
    setEnv(true);
    mocks.revokeSessionByToken.mockResolvedValue({ providerSid: null });

    await POST(post());

    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(providerRow()).toMatchObject({
      action: 'admin_logout',
      username: 'admin.user',
      actorType: 'admin',
      targetId: 'sess-admin-1',
      outcome: 'skipped',
      details: {
        providerSidPresent: false,
        providerLogoutAttempted: false,
        providerSessionDestroyed: false,
        providerLogoutOutcome: 'not-configured',
      },
    });
  });

  it('records not-configured when no auth-service integration exists but a sid was present', async () => {
    setEnv(false);

    await POST(post());

    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(providerRow()).toMatchObject({
      action: 'admin_logout',
      username: 'admin.user',
      actorType: 'admin',
      outcome: 'skipped',
      success: false,
      details: {
        providerSidPresent: true,
        providerLogoutAttempted: false,
        providerSessionDestroyed: false,
        providerLogoutOutcome: 'not-configured',
      },
    });
  });

  it('does not write a navigation row for non-admins but still audits the provider outcome', async () => {
    setEnv(true);
    mocks.fetch.mockResolvedValue({ ok: true, status: 204 });
    mocks.getSessionFromCookies.mockResolvedValue({
      ...adminSession(),
      id: 'sess-user-2',
      username: 'plain.user',
      isAdmin: false,
    });

    await POST(post());

    expect(rows().filter((entry) => entry.category === 'navigation')).toHaveLength(0);
    expect(providerRow()).toMatchObject({
      action: 'admin_logout',
      category: 'session',
      username: 'plain.user',
      actorType: 'user',
      targetId: 'sess-user-2',
      outcome: 'success',
    });
  });

  it('records an anonymous not-configured row when no portal session existed', async () => {
    setEnv(true);
    mocks.getSessionFromCookies.mockResolvedValue(null);
    mocks.revokeSessionByToken.mockResolvedValue(null);

    await POST(post());

    expect(rows().filter((entry) => entry.category === 'navigation')).toHaveLength(0);
    expect(providerRow()).toMatchObject({
      action: 'admin_logout',
      username: 'unknown',
      actorType: 'anonymous',
      outcome: 'skipped',
      details: {
        providerSidPresent: false,
        providerLogoutAttempted: false,
        providerSessionDestroyed: false,
        providerLogoutOutcome: 'not-configured',
      },
    });
  });

  it('keeps rate limiting ahead of any audit or logout work', async () => {
    setEnv(true);
    mocks.checkRateLimitAsync.mockResolvedValue({
      success: false,
      limit: 100,
      remaining: 0,
      reset: Date.now() + 30_000,
    });

    const response = await POST(post());

    expect(response.status).toBe(429);
    expect(mocks.logAuditAction).not.toHaveBeenCalled();
    expect(mocks.revokeSessionByToken).not.toHaveBeenCalled();
    expect(mocks.clearSession).not.toHaveBeenCalled();
  });
});
