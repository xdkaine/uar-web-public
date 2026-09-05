import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertMethod: vi.fn(), exchangeCallback: vi.fn(), settings: vi.fn(),
  establishSession: vi.fn(), audit: vi.fn(), authorization: vi.fn(),
}));
vi.mock('@/lib/auth/sign-in-policy', () => ({ assertPortalSignInMethodEnabled: mocks.assertMethod }));
vi.mock('@/lib/auth/oidc', () => ({
  OIDC_NONCE_COOKIE: 'oidc_nonce', OIDC_REDIRECT_COOKIE: 'oidc_redirect',
  OIDC_STATE_COOKIE: 'oidc_state', OIDC_VERIFIER_COOKIE: 'oidc_verifier',
  exchangeCallback: mocks.exchangeCallback,
  portalBaseUrl: () => 'https://portal.example.test',
}));
vi.mock('@/lib/prisma', () => ({ prisma: { systemSettings: { findFirst: mocks.settings } } }));
vi.mock('@/lib/rbac/core', () => ({ resolveReviewerAuthorization: mocks.authorization }));
vi.mock('@/lib/session', () => ({ establishSessionOnResponse: mocks.establishSession }));
vi.mock('@/lib/audit-log', () => ({
  AuditActions: { LOGIN_SUCCESS: 'login_success', LOCAL_BREAK_GLASS_LOGIN: 'local_break_glass_login' },
  AuditCategories: { AUTH: 'auth' }, getIpAddress: vi.fn(), getUserAgent: vi.fn(), logAuditAction: mocks.audit,
}));
vi.mock('@/lib/logger', () => ({ appLogger: { warn: vi.fn() } }));

import { GET } from './route';

function request() {
  return new NextRequest('https://portal.example.test/api/auth/oidc/callback?code=code&state=state', {
    headers: { cookie: 'oidc_state=state; oidc_verifier=verifier; oidc_nonce=nonce' },
  });
}

describe('GET /api/auth/oidc/callback authority validation', () => {
  const providerSessionExpiresAt = Math.floor(Date.now() / 1000) + 3600;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertMethod.mockResolvedValue(undefined);
    mocks.settings.mockResolvedValue({ loginDisabled: false });
    mocks.authorization.mockResolvedValue({
      permissions: new Set(['users.read']), roles: new Set(['reviewer']), viaLegacyAdminFallback: false,
    });
    mocks.establishSession.mockResolvedValue(undefined);
    mocks.audit.mockResolvedValue(undefined);
  });

  it('rejects a disabled OIDC method before exchanging the authorization code and clears transient cookies', async () => {
    mocks.assertMethod.mockRejectedValueOnce(new Error('disabled'));

    const response = await GET(request());

    expect(response.headers.get('location')).toBe('https://portal.example.test/login?error=oidc_disabled');
    expect(mocks.exchangeCallback).not.toHaveBeenCalled();
    expect(mocks.settings).not.toHaveBeenCalled();
    expect(mocks.authorization).not.toHaveBeenCalled();
    expect(mocks.establishSession).not.toHaveBeenCalled();
    const clearedCookies = response.cookies.getAll();
    expect(clearedCookies).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'oidc_state', value: '' }),
      expect.objectContaining({ name: 'oidc_verifier', value: '' }),
      expect.objectContaining({ name: 'oidc_nonce', value: '' }),
      expect.objectContaining({ name: 'oidc_redirect', value: '' }),
    ]));
  });

  it.each([
    { amr: [], sid: 'sid-1', expiresAt: providerSessionExpiresAt, label: 'missing AD authority' },
    { amr: ['local_break_glass'], sid: 'sid-1', expiresAt: providerSessionExpiresAt, label: 'local authority' },
    { amr: ['ad', 'local_recovery'], sid: 'sid-1', expiresAt: providerSessionExpiresAt, label: 'contradictory authority' },
    { amr: ['ad'], sid: undefined, expiresAt: providerSessionExpiresAt, label: 'missing provider sid' },
    { amr: ['ad'], sid: 'sid-1', expiresAt: undefined, label: 'missing provider expiry' },
    { amr: ['ad'], sid: 'sid-1', expiresAt: 1, label: 'expired provider session' },
  ])('rejects $label', async ({ amr, sid, expiresAt }) => {
    mocks.exchangeCallback.mockResolvedValue({ username: 'alice', amr, sid, providerSessionExpiresAt: expiresAt });
    const response = await GET(request());
    expect(response.headers.get('location')).toBe('https://portal.example.test/login?error=oidc_failed');
    expect(mocks.establishSession).not.toHaveBeenCalled();
  });

  it('accepts AD authority with additional MFA evidence and preserves sid', async () => {
    mocks.exchangeCallback.mockResolvedValue({
      username: 'alice',
      amr: ['pwd', 'ad', 'mfa'],
      sid: 'sid-1',
      providerSessionExpiresAt,
    });
    const response = await GET(request());
    expect(response.headers.get('location')).toBe('https://portal.example.test/admin');
    expect(mocks.establishSession).toHaveBeenCalledWith(
      expect.anything(), 'alice', true, undefined, undefined, 'oidc', 'sid-1',
      undefined, 'direct', new Date(providerSessionExpiresAt * 1000)
    );
  });

  it('rechecks policy after the provider round trip before minting', async () => {
    mocks.exchangeCallback.mockResolvedValue({
      username: 'alice', amr: ['ad'], sid: 'sid-1', providerSessionExpiresAt,
    });
    mocks.assertMethod.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('disabled'));
    const response = await GET(request());
    expect(response.headers.get('location')).toBe('https://portal.example.test/login?error=oidc_failed');
    expect(mocks.establishSession).not.toHaveBeenCalled();
  });
});
