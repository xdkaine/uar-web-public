import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readiness: vi.fn(),
}));

vi.mock('@/lib/auth/sign-in-policy', () => ({
  getPortalSignInPolicy: vi.fn(),
  getPortalSignInReadiness: mocks.readiness,
}));

import { validateAuthModeWrite } from './mode';

describe('validateAuthModeWrite', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readiness.mockResolvedValue({
      oidc: { ready: true, issue: null },
      native_ad: { ready: true, issue: null },
      local_break_glass: { ready: true, issue: null },
    });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('rejects values outside the persistable enum', async () => {
    await expect(validateAuthModeWrite('saml')).resolves.toMatchObject({
      ok: false,
      error: 'authMode must be one of: oidc, native, local (or null to clear the override)',
    });
    await expect(validateAuthModeWrite(42)).resolves.toMatchObject({ ok: false });
    await expect(validateAuthModeWrite(undefined)).resolves.toMatchObject({ ok: false });
  });

  it('allows null to clear the persisted override', async () => {
    await expect(validateAuthModeWrite(null)).resolves.toEqual({ ok: true, value: null });
    expect(mocks.readiness).not.toHaveBeenCalled();
  });

  it('requires issuer and client secret before enabling oidc', async () => {
    mocks.readiness.mockResolvedValueOnce({
      oidc: { ready: false, issue: 'Configure OIDC.' },
      native_ad: { ready: true, issue: null },
      local_break_glass: { ready: true, issue: null },
    });
    await expect(validateAuthModeWrite('oidc')).resolves.toMatchObject({ ok: false });
    await expect(validateAuthModeWrite('oidc')).resolves.toEqual({
      ok: true,
      value: 'oidc',
    });
  });

  it('requires an active break-glass account before enabling local-only sign-in', async () => {
    mocks.readiness.mockResolvedValueOnce({
      oidc: { ready: true, issue: null },
      native_ad: { ready: true, issue: null },
      local_break_glass: { ready: false, issue: 'Create an account.' },
    });
    await expect(validateAuthModeWrite('local')).resolves.toMatchObject({ ok: false });
    await expect(validateAuthModeWrite('local')).resolves.toEqual({ ok: true, value: 'local' });
  });

  it('requires complete direct Active Directory readiness for native mode', async () => {
    await expect(validateAuthModeWrite('native')).resolves.toEqual({ ok: true, value: 'native' });

    mocks.readiness.mockResolvedValueOnce({
      oidc: { ready: true, issue: null },
      native_ad: { ready: false, issue: 'Configure the full LDAP connection.' },
      local_break_glass: { ready: true, issue: null },
    });
    await expect(validateAuthModeWrite('native')).resolves.toMatchObject({ ok: false });
  });
});
