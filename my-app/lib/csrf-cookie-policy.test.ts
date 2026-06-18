import { afterEach, describe, expect, it } from 'vitest';
import {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  CSRF_MAX_AGE_SECONDS,
  csrfCookieOptions,
  shouldRefreshCsrfCookie,
  validateCsrfTokenPair,
} from './csrf-cookie-policy';

const ORIGINAL_ENV = process.env;

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('csrf cookie policy', () => {
  it('builds the existing CSRF cookie settings', () => {
    process.env = { ...ORIGINAL_ENV, SESSION_COOKIE_ALLOW_INSECURE: 'true' };

    expect(csrfCookieOptions('token-1')).toEqual({
      name: CSRF_COOKIE_NAME,
      value: 'token-1',
      httpOnly: true,
      secure: false,
      sameSite: 'strict',
      path: '/',
      maxAge: CSRF_MAX_AGE_SECONDS,
    });
    expect(CSRF_HEADER_NAME).toBe('x-csrf-token');
  });

  it('validates matching token pairs without accepting missing or mismatched values', () => {
    expect(validateCsrfTokenPair('abc', 'abc')).toBe(true);
    expect(validateCsrfTokenPair('abc', 'def')).toBe(false);
    expect(validateCsrfTokenPair(null, 'abc')).toBe(false);
    expect(validateCsrfTokenPair('abc', undefined)).toBe(false);
  });

  it('refreshes CSRF cookies only on non-token GET requests', () => {
    expect(shouldRefreshCsrfCookie('GET', '/admin')).toBe(true);
    expect(shouldRefreshCsrfCookie('GET', '/api/csrf-token')).toBe(false);
    expect(shouldRefreshCsrfCookie('POST', '/admin')).toBe(false);
  });
});