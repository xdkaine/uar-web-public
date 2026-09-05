import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertMethod: vi.fn(), assertSignIn: vi.fn(), searchUser: vi.fn(), authenticate: vi.fn(),
  changePassword: vi.fn(), clearRequired: vi.fn(), authorization: vi.fn(), audit: vi.fn(),
  getChallenge: vi.fn(), consumeChallenge: vi.fn(), claimChallenge: vi.fn(), markApplied: vi.fn(),
  incrementAttempts: vi.fn(), rateLimit: vi.fn(), establishSession: vi.fn(), parse: vi.fn(), turnstile: vi.fn(),
}));
vi.mock('@/lib/auth/sign-in-policy', () => ({ assertPortalSignInMethodEnabled: mocks.assertMethod }));
vi.mock('@/lib/auth/sign-in-availability', () => ({ assertSignInEnabled: mocks.assertSignIn, SignInDisabledError: class SignInDisabledError extends Error {} }));
vi.mock('@/lib/ldap', () => ({
  searchLDAPUser: mocks.searchUser, authenticateLDAP: mocks.authenticate,
  changeLDAPUserPassword: mocks.changePassword, clearLDAPUserPasswordChangeRequired: mocks.clearRequired,
  isPasswordChangeRequiredAuthStatus: (status: string) => status === 'password_change_required' || status === 'password_expired',
}));
vi.mock('@/lib/rbac/core', () => ({ resolveReviewerAuthorization: mocks.authorization }));
vi.mock('@/lib/audit-log', () => ({
  AuditActions: { PASSWORD_CHANGE_FAILURE: 'password_change_failure', PASSWORD_CHANGE_DIRECTORY_MUTATION_COMPLETED: 'password_change_directory_mutation_completed', PASSWORD_CHANGE_SUCCESS: 'password_change_success' },
  AuditCategories: { AUTH: 'auth' }, logAuditAction: mocks.audit,
}));
vi.mock('@/lib/password-change-challenge', () => ({
  clearPasswordChangeChallengeCookie: vi.fn(), claimPasswordChangeChallenge: mocks.claimChallenge,
  consumePasswordChangeChallenge: mocks.consumeChallenge, getValidPasswordChangeChallenge: mocks.getChallenge,
  incrementPasswordChangeChallengeAttempts: mocks.incrementAttempts,
  markPasswordChangeChallengeDirectoryApplied: mocks.markApplied,
}));
vi.mock('@/lib/ratelimit', () => ({ checkRateLimitAsync: mocks.rateLimit, getRequiredClientIp: () => '192.0.2.10', isRateLimitUnavailable: () => false }));
vi.mock('@/lib/session', () => ({ establishSessionOnResponse: mocks.establishSession }));
vi.mock('@/lib/validation', () => ({ parseJsonWithLimit: mocks.parse, isJsonBodyError: () => false, MAX_REQUEST_BODY_SIZE: { SMALL: 4096 } }));
vi.mock('@/lib/password-policy', () => ({ PASSWORD_MAX_LENGTH: 1024, validatePasswordPolicy: () => ({ isValid: true, issues: [] }) }));
vi.mock('@/lib/turnstile', () => ({ verifyTurnstileToken: mocks.turnstile }));
vi.mock('@/lib/logger', () => ({ appLogger: { error: vi.fn(), warn: vi.fn() } }));

import { POST } from './route';

const challenge = {
  id: 'challenge-1', username: 'alice', reason: 'password_change_required',
  authProvider: 'ad_manual', correlationId: 'direct-1', state: 'active',
  expiresAt: new Date(Date.now() + 60000), attempts: 0,
};

function request() {
  return new NextRequest('https://portal.example.test/api/auth/complete-required-password-change', { method: 'POST' });
}

describe('direct AD required-password-change policy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertMethod.mockResolvedValue(undefined);
    mocks.assertSignIn.mockResolvedValue(undefined);
    mocks.getChallenge.mockResolvedValue(challenge);
    mocks.claimChallenge.mockResolvedValue(true);
    mocks.markApplied.mockResolvedValue(undefined);
    mocks.consumeChallenge.mockResolvedValue(undefined);
    mocks.rateLimit.mockResolvedValue({ success: true, limit: 10, remaining: 9, reset: Date.now() + 60000 });
    mocks.parse.mockResolvedValue({ currentPassword: 'old password', newPassword: 'new password', turnstileToken: 'verified' });
    mocks.turnstile.mockResolvedValue(true);
    mocks.searchUser.mockResolvedValue({ objectName: 'CN=Alice', attributes: [] });
    mocks.authenticate.mockImplementation(async (_username: string, password: string) => password === 'old password'
      ? { success: false, status: 'password_change_required' }
      : { success: true, status: 'authenticated' });
    mocks.authorization.mockResolvedValue({ permissions: new Set(['users.read']), roles: new Set(['reviewer']), viaLegacyAdminFallback: false });
    mocks.audit.mockResolvedValue(undefined);
    mocks.incrementAttempts.mockResolvedValue({ exhausted: false, attempts: 1 });
    mocks.establishSession.mockResolvedValue(undefined);
  });

  it('retires legacy outage-fallback challenges', async () => {
    mocks.getChallenge.mockResolvedValue({ ...challenge, authProvider: 'ad_outage_fallback' });
    const response = await POST(request());
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ action: 'METHOD_DISABLED' });
    expect(mocks.changePassword).not.toHaveBeenCalled();
  });

  it('changes the directory password and mints a direct-AD session', async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.changePassword).toHaveBeenCalledWith('alice', 'new password', 'CN=Alice');
    expect(mocks.establishSession).toHaveBeenCalledWith(expect.any(NextResponse), 'alice', true, '192.0.2.10', undefined, 'ad_manual');
  });

  it('requires Turnstile for direct AD continuation', async () => {
    mocks.turnstile.mockResolvedValue(false);
    const response = await POST(request());
    expect(response.status).toBe(400);
    expect(mocks.changePassword).not.toHaveBeenCalled();
  });

  it('lets only an atomically claimed challenge mutate Active Directory', async () => {
    mocks.claimChallenge.mockResolvedValue(false);
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(mocks.changePassword).not.toHaveBeenCalled();
  });

  it('rechecks direct AD policy before the directory mutation', async () => {
    mocks.assertMethod.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('disabled'));
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(mocks.changePassword).not.toHaveBeenCalled();
  });
});
