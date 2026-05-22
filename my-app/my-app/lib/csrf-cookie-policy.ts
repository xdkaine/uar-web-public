import { shouldUseSecureCookies } from '@/lib/cookie-security';
import { timingSafeCompare } from '@/lib/timing-safe';

export const CSRF_COOKIE_NAME = 'csrf-token';
export const CSRF_HEADER_NAME = 'x-csrf-token';
export const CSRF_MAX_AGE_SECONDS = 60 * 60 * 8;
export const CSRF_COOKIE_SAMESITE = 'strict' as const;

export function csrfCookieOptions(value: string) {
  return {
    name: CSRF_COOKIE_NAME,
    value,
    httpOnly: true,
    secure: shouldUseSecureCookies(),
    sameSite: CSRF_COOKIE_SAMESITE,
    path: '/',
    maxAge: CSRF_MAX_AGE_SECONDS,
  };
}

export function validateCsrfTokenPair(
  token: string | null | undefined,
  cookieToken: string | null | undefined
): boolean {
  if (!token || !cookieToken) {
    return false;
  }

  try {
    return timingSafeCompare(token, cookieToken);
  } catch {
    return false;
  }
}

export function shouldRefreshCsrfCookie(method: string, pathname: string): boolean {
  return method.toUpperCase() === 'GET' && pathname !== '/api/csrf-token';
}