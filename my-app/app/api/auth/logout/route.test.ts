import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  revokeSessionByToken: vi.fn(),
  clearSession: vi.fn(),
  logAuditAction: vi.fn(),
  cookiesGet: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: mocks.cookiesGet }),
}));

vi.mock('@/lib/session', () => ({
  getSessionCookieName: () => 'uar_session',
  revokeSessionByToken: mocks.revokeSessionByToken,
  clearSession: mocks.clearSession,
}));

vi.mock('@/lib/audit-log', () => ({
  logAuditAction: mocks.logAuditAction,
  getIpAddress: () => '203.0.113.7',
  getUserAgent: () => 'self-logout-route-test',
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
  return new NextRequest('https://portal.example.test/api/auth/logout', { method: 'POST' });
}

function providerRow() {
  const calls = mocks.logAuditAction.mock.calls as unknown as [
    { action: string; category: string }
  ][];
  return calls.map((call) => call[0]).find((entry) => entry.category === 'session');
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', mocks.fetch);
  mocks.cookiesGet.mockImplementation((name: string) =>
    name === 'uar_session' ? { value: 'token-abc' } : undefined
  );
  mocks.revokeSessionByToken.mockResolvedValue({ providerSid: 'sid-1' });
  mocks.logAuditAction.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('POST /api/auth/logout provider logout auditing', () => {
  it('records a success row when the IdP confirms destruction', async () => {
    setEnv(true);
    mocks.fetch.mockResolvedValue({ ok: true, status: 204 });

    const response = await POST(post());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = mocks.fetch.mock.calls[0] as unknown as [
      string,
      { method: string; body: string }
    ];
    expect(url).toBe('http://auth-service:3003/session/backchannel-logout');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ sid: 'sid-1' });

    expect(providerRow()).toEqual({
      action: 'user_logout',
      category: 'session',
      username: 'unknown',
      actorType: 'user',
      targetType: 'Session',
      targetId: undefined,
      outcome: 'success',
      success: true,
      ipAddress: '203.0.113.7',
      userAgent: 'self-logout-route-test',
      details: {
        providerSidPresent: true,
        providerLogoutAttempted: true,
        providerSessionDestroyed: true,
        providerLogoutOutcome: 'success',
      },
    });
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
      action: 'user_logout',
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

  it('records a failure row when the IdP rejects the request', async () => {
    setEnv(true);
    mocks.fetch.mockResolvedValue({ ok: false, status: 401 });

    await POST(post());

    expect(providerRow()).toMatchObject({
      action: 'user_logout',
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

  it('records not-configured when the destroyed session had no provider session id', async () => {
    setEnv(true);
    mocks.revokeSessionByToken.mockResolvedValue({ providerSid: null });

    await POST(post());

    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(providerRow()).toEqual({
      action: 'user_logout',
      category: 'session',
      username: 'unknown',
      actorType: 'user',
      targetType: 'Session',
      targetId: undefined,
      outcome: 'skipped',
      success: false,
      ipAddress: '203.0.113.7',
      userAgent: 'self-logout-route-test',
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
    mocks.fetch.mockClear();

    await POST(post());

    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(providerRow()).toMatchObject({
      action: 'user_logout',
      actorType: 'user',
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

  it('records an anonymous not-configured row when no portal session existed', async () => {
    setEnv(true);
    mocks.revokeSessionByToken.mockResolvedValue(null);

    const response = await POST(post());

    expect(response.status).toBe(200);
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(providerRow()).toMatchObject({
      action: 'user_logout',
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

  it('still clears the session cookie and succeeds when the audit write itself fails', async () => {
    setEnv(true);
    mocks.fetch.mockResolvedValue({ ok: true, status: 204 });
    mocks.logAuditAction.mockRejectedValue(new Error('audit db down'));

    const response = await POST(post());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(mocks.clearSession).toHaveBeenCalledTimes(1);
  });
});
