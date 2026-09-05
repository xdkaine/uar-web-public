import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearSessionCookiesOnResponse,
  getSessionMaxIdleSeconds,
  getSessionMaxAgeSeconds,
  LEGACY_SESSION_COOKIE_NAMES,
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_SAMESITE,
  SESSION_TIMEOUTS,
  setSessionCookieOnResponse,
} from './session-cookie-policy';

const ORIGINAL_ENV = process.env;

function responseWithCookieSpy() {
  return {
    cookies: {
      set: vi.fn(),
    },
  } as unknown as Parameters<typeof setSessionCookieOnResponse>[0] & {
    cookies: { set: ReturnType<typeof vi.fn> };
  };
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('getSessionMaxAgeSeconds', () => {
  it('uses existing admin and user defaults', () => {
    process.env = { ...ORIGINAL_ENV, AUTH_SESSION_MAX_AGE: undefined };

    expect(getSessionMaxAgeSeconds(true)).toBe(SESSION_TIMEOUTS.admin);
    expect(getSessionMaxAgeSeconds(false)).toBe(SESSION_TIMEOUTS.user);
  });

  it('uses a positive AUTH_SESSION_MAX_AGE override', () => {
    process.env = { ...ORIGINAL_ENV, AUTH_SESSION_MAX_AGE: '123.9' };

    expect(getSessionMaxAgeSeconds(true)).toBe(123);
  });

  it('ignores invalid AUTH_SESSION_MAX_AGE values', () => {
    process.env = { ...ORIGINAL_ENV, AUTH_SESSION_MAX_AGE: '-1' };

    expect(getSessionMaxAgeSeconds(true)).toBe(SESSION_TIMEOUTS.admin);
  });

  it('uses the OIDC session lifetime only for OIDC-backed portal sessions', () => {
    process.env = {
      ...ORIGINAL_ENV,
      AUTH_SESSION_MAX_AGE: undefined,
      AUTH_OIDC_SESSION_MAX_AGE: '28800',
    };

    expect(getSessionMaxAgeSeconds(true, 'oidc')).toBe(28800);
    expect(getSessionMaxAgeSeconds(true, 'ad_manual')).toBe(SESSION_TIMEOUTS.admin);
    expect(getSessionMaxAgeSeconds(true, 'local')).toBe(SESSION_TIMEOUTS.admin);
  });

  it('defaults OIDC-backed portal sessions to eight hours', () => {
    process.env = {
      ...ORIGINAL_ENV,
      AUTH_SESSION_MAX_AGE: undefined,
      AUTH_OIDC_SESSION_MAX_AGE: undefined,
    };

    expect(getSessionMaxAgeSeconds(true, 'oidc')).toBe(SESSION_TIMEOUTS.oidc);
  });

  it('does not apply the native/local override to OIDC-backed sessions', () => {
    process.env = {
      ...ORIGINAL_ENV,
      AUTH_SESSION_MAX_AGE: '1800',
      AUTH_OIDC_SESSION_MAX_AGE: undefined,
    };

    expect(getSessionMaxAgeSeconds(true, 'oidc')).toBe(SESSION_TIMEOUTS.oidc);
    expect(getSessionMaxAgeSeconds(true, 'local')).toBe(1800);
  });

  it.each(['299', '1209601', 'not-a-number'])(
    'rejects unsafe OIDC session lifetime %s',
    (configuredLifetime) => {
      process.env = {
        ...ORIGINAL_ENV,
        AUTH_OIDC_SESSION_MAX_AGE: configuredLifetime,
      };

      expect(() => getSessionMaxAgeSeconds(true, 'oidc')).toThrow(/AUTH_OIDC_SESSION_MAX_AGE/);
    },
  );

  it('keeps OIDC idle lifetime aligned with its absolute portal lifetime', () => {
    process.env = {
      ...ORIGINAL_ENV,
      AUTH_OIDC_SESSION_MAX_AGE: '28800',
    };

    expect(getSessionMaxIdleSeconds('oidc')).toBe(28800);
    expect(getSessionMaxIdleSeconds('ad_manual')).toBe(SESSION_TIMEOUTS.maxIdle);
    expect(getSessionMaxIdleSeconds('local')).toBe(SESSION_TIMEOUTS.maxIdle);
  });
});

describe('session cookie response helpers', () => {
  it('sets the session cookie and clears legacy session cookies', () => {
    process.env = { ...ORIGINAL_ENV, SESSION_COOKIE_ALLOW_INSECURE: 'true' };
    const response = responseWithCookieSpy();
    const expiresAt = new Date(Date.now() + 60_000);

    setSessionCookieOnResponse(response, 'token-1', expiresAt);

    expect(response.cookies.set).toHaveBeenCalledWith(
      SESSION_COOKIE_NAME,
      'token-1',
      expect.objectContaining({
        httpOnly: true,
        secure: false,
        sameSite: SESSION_COOKIE_SAMESITE,
        path: '/',
      })
    );

    for (const cookieName of LEGACY_SESSION_COOKIE_NAMES) {
      expect(response.cookies.set).toHaveBeenCalledWith(
        cookieName,
        '',
        expect.objectContaining({ maxAge: 0 })
      );
    }
  });

  it('clears current and legacy session cookies', () => {
    const response = responseWithCookieSpy();

    clearSessionCookiesOnResponse(response);

    expect(response.cookies.set).toHaveBeenCalledWith(
      SESSION_COOKIE_NAME,
      '',
      expect.objectContaining({ maxAge: 0 })
    );

    for (const cookieName of LEGACY_SESSION_COOKIE_NAMES) {
      expect(response.cookies.set).toHaveBeenCalledWith(
        cookieName,
        '',
        expect.objectContaining({ maxAge: 0 })
      );
    }
  });
});
