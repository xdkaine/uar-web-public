import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertMethod: vi.fn(),
  prepareLogin: vi.fn(),
  settings: vi.fn(),
}));
vi.mock('@/lib/auth/sign-in-policy', () => ({ assertPortalSignInMethodEnabled: mocks.assertMethod }));
vi.mock('@/lib/auth/oidc', () => ({
  OIDC_NONCE_COOKIE: 'oidc_nonce', OIDC_REDIRECT_COOKIE: 'oidc_redirect',
  OIDC_STATE_COOKIE: 'oidc_state', OIDC_VERIFIER_COOKIE: 'oidc_verifier',
  OIDC_COOKIE_MAX_AGE_SECONDS: 600,
  portalBaseUrl: () => 'https://portal.example.test',
  prepareLogin: mocks.prepareLogin,
}));
vi.mock('@/lib/prisma', () => ({ prisma: { systemSettings: { findFirst: mocks.settings } } }));
vi.mock('@/lib/cookie-security', () => ({ shouldUseSecureCookies: () => true }));

import { GET } from './route';

describe('GET /api/auth/oidc/login', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertMethod.mockResolvedValue(undefined);
    mocks.settings.mockResolvedValue({ loginDisabled: false });
  });

  it('rejects a direct OIDC start when the portal policy disables it', async () => {
    mocks.assertMethod.mockRejectedValue(new Error('disabled'));
    const response = await GET(new NextRequest('https://portal.example.test/api/auth/oidc/login'));
    expect(response.headers.get('location')).toBe('https://portal.example.test/login?error=oidc_disabled');
    expect(mocks.prepareLogin).not.toHaveBeenCalled();
  });

  it('returns to the portal with the operational error on provider failure', async () => {
    mocks.prepareLogin.mockRejectedValue(new Error('connect refused'));
    const response = await GET(new NextRequest('https://portal.example.test/api/auth/oidc/login?redirect=%2Fadmin%2Fusers'));
    expect(response.headers.get('location')).toBe('https://portal.example.test/login?error=oidc_unavailable&redirect=%2Fadmin%2Fusers');
  });

  it('sets the complete short-lived OIDC cookie set on success', async () => {
    mocks.prepareLogin.mockResolvedValue({
      authorizationUrl: new URL('https://auth.example.test/auth?client_id=portal'),
      state: 'state', codeVerifier: 'verifier', nonce: 'nonce', redirectPath: '/admin',
    });
    const response = await GET(new NextRequest('https://portal.example.test/api/auth/oidc/login'));
    expect(response.headers.get('location')).toContain('https://auth.example.test/auth');
    expect(response.cookies.get('oidc_state')?.value).toBe('state');
    expect(response.cookies.get('oidc_verifier')?.value).toBe('verifier');
    expect(response.cookies.get('oidc_nonce')?.value).toBe('nonce');
  });
});
