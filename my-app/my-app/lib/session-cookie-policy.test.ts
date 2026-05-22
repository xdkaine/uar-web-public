import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearSessionCookiesOnResponse,
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