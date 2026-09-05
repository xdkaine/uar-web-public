import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertMethod: vi.fn(), assertSignIn: vi.fn(), directory: vi.fn(), local: vi.fn(),
  search: vi.fn(), authorization: vi.fn(), breakGlassAuthorization: vi.fn(),
  session: vi.fn(), parse: vi.fn(), rateLimit: vi.fn(), turnstile: vi.fn(),
  audit: vi.fn(), createChallenge: vi.fn(), attachChallenge: vi.fn(),
}));
vi.mock('@/lib/auth/sign-in-policy', () => ({ assertPortalSignInMethodEnabled: mocks.assertMethod }));
vi.mock('@/lib/auth/sign-in-availability', () => ({ assertSignInEnabled: mocks.assertSignIn, SignInDisabledError: class SignInDisabledError extends Error {} }));
vi.mock('@/lib/auth/provider', () => ({ authenticateDirectoryOnly: mocks.directory, authenticateLocalOnly: mocks.local }));
vi.mock('@/lib/ldap', () => ({
  searchLDAPUser: mocks.search,
  isPasswordChangeRequiredAuthStatus: (status: string) => status === 'password_change_required' || status === 'password_expired',
}));
vi.mock('@/lib/rbac/core', () => ({ resolveReviewerAuthorization: mocks.authorization, buildBreakGlassAuthorization: mocks.breakGlassAuthorization }));
vi.mock('@/lib/session', () => ({ establishSessionOnResponse: mocks.session }));
vi.mock('@/lib/validation', () => ({ parseJsonWithLimit: mocks.parse, MAX_REQUEST_BODY_SIZE: { SMALL: 4096 }, isJsonBodyError: () => false }));
vi.mock('@/lib/ratelimit', () => ({
  checkRateLimitAsync: mocks.rateLimit, getRequiredClientIp: () => '192.0.2.10', isRateLimitUnavailable: () => false,
  RateLimitPresets: { login: { maxRequests: 20, windowMs: 900000 } },
}));
vi.mock('@/lib/turnstile', () => ({ verifyTurnstileToken: mocks.turnstile }));
vi.mock('@/lib/audit-log', () => ({
  AuditActions: { LOGIN_FAILURE: 'login_failure', LOGIN_SUCCESS: 'login_success', LOCAL_BREAK_GLASS_LOGIN: 'local_break_glass_login', PASSWORD_CHANGE_REQUIRED: 'password_change_required' },
  AuditCategories: { AUTH: 'auth' }, logAuditAction: mocks.audit,
}));
vi.mock('@/lib/password-change-challenge', () => ({
  attachPasswordChangeChallengeCookie: mocks.attachChallenge,
  createPasswordChangeChallenge: mocks.createChallenge,
}));
vi.mock('@/lib/standardErrors', () => ({
  StandardErrors: { RATE_LIMIT_EXCEEDED: 'Too many', TURNSTILE_VALIDATION_FAILED: 'Verification failed', INVALID_INPUT: 'Invalid input', INVALID_CREDENTIALS: 'Invalid credentials', SERVICE_UNAVAILABLE: 'Unavailable' },
  authenticationError: () => NextResponse.json({ error: 'Authentication failed' }, { status: 500 }),
}));
vi.mock('@/lib/logger', () => ({ appLogger: { warn: vi.fn(), error: vi.fn() } }));

import { POST } from './route';

function request() {
  return new NextRequest('https://portal.example.test/api/auth/login', { method: 'POST' });
}

describe('POST /api/auth/login portal method isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertMethod.mockResolvedValue(undefined);
    mocks.assertSignIn.mockResolvedValue(undefined);
    mocks.rateLimit.mockResolvedValue({ success: true, limit: 20, remaining: 19, reset: Date.now() + 60000 });
    mocks.turnstile.mockResolvedValue(true);
    mocks.audit.mockResolvedValue(undefined);
    mocks.search.mockResolvedValue({ attributes: [] });
    mocks.authorization.mockResolvedValue({ permissions: new Set(['users.read']), roles: new Set(['reviewer']), viaLegacyAdminFallback: false });
    mocks.breakGlassAuthorization.mockResolvedValue({ roles: new Set(['system_administrator']) });
    mocks.session.mockResolvedValue(undefined);
    mocks.createChallenge.mockResolvedValue({ token: 'token', expiresAt: new Date(Date.now() + 60000) });
  });

  it('rejects a hidden or disabled method before credential verification', async () => {
    mocks.parse.mockResolvedValue({ username: 'alice', password: 'pw', turnstileToken: 'ok', signInMethod: 'native_ad' });
    mocks.assertMethod.mockRejectedValue(new Error('disabled'));
    const response = await POST(request());
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ action: 'METHOD_DISABLED' });
    expect(mocks.directory).not.toHaveBeenCalled();
    expect(mocks.local).not.toHaveBeenCalled();
  });

  it('submits direct Active Directory credentials only to LDAP, including on transport failure', async () => {
    mocks.parse.mockResolvedValue({ username: 'alice', password: 'pw', turnstileToken: 'ok', signInMethod: 'native_ad' });
    mocks.directory.mockResolvedValue({ kind: 'ad', result: { success: false, status: 'timeout', error: 'unavailable' } });
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(mocks.directory).toHaveBeenCalledWith('alice', 'pw');
    expect(mocks.local).not.toHaveBeenCalled();
  });

  it('submits portal local credentials only to the portal account store', async () => {
    mocks.parse.mockResolvedValue({ username: 'ops@local', password: 'pw', turnstileToken: 'ok', signInMethod: 'local_break_glass' });
    mocks.local.mockResolvedValue({ kind: 'local', username: 'ops@local', credentialVersion: 'version-1' });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.local).toHaveBeenCalledWith('ops@local', 'pw');
    expect(mocks.directory).not.toHaveBeenCalled();
    expect(mocks.session).toHaveBeenCalledWith(expect.anything(), 'ops@local', true, '192.0.2.10', undefined, 'local', undefined, 'version-1');
  });

  it('does not mint an AD session when the method is disabled during verification', async () => {
    mocks.parse.mockResolvedValue({ username: 'alice', password: 'pw', turnstileToken: 'ok', signInMethod: 'native_ad' });
    mocks.directory.mockResolvedValue({ kind: 'ad', result: { success: true, status: 'authenticated' } });
    mocks.assertMethod.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('disabled'));
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(mocks.session).not.toHaveBeenCalled();
  });

  it('binds a required-password-change challenge to direct AD provenance', async () => {
    mocks.parse.mockResolvedValue({ username: 'alice', password: 'old', turnstileToken: 'ok', signInMethod: 'native_ad' });
    mocks.directory.mockResolvedValue({ kind: 'ad', result: { success: false, status: 'password_expired' } });
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(mocks.createChallenge).toHaveBeenCalledWith(expect.objectContaining({ username: 'alice', authProvider: 'ad_manual' }));
  });
});
