import type { NextResponse } from 'next/server';
import { shouldUseSecureCookies } from '@/lib/cookie-security';

export const SESSION_COOKIE_NAME = 'session_token';
export const LEGACY_SESSION_COOKIE_NAMES = ['admin_session', 'user_session'] as const;

export const SESSION_TIMEOUTS = {
  admin: 30 * 60,
  user: 60 * 60,
  oidc: 8 * 60 * 60,
  maxIdle: 15 * 60,
} as const;

const OIDC_SESSION_MIN_SECONDS = 5 * 60;
const OIDC_SESSION_MAX_SECONDS = 14 * 24 * 60 * 60;

export const SESSION_COOKIE_SAMESITE = 'strict' as const;

export function getSessionMaxAgeSeconds(
  isAdmin: boolean = false,
  authProvider: string = 'ad',
): number {
  const oidcBacked = authProvider === 'oidc';
  const defaultTimeout = oidcBacked
    ? SESSION_TIMEOUTS.oidc
    : isAdmin
      ? SESSION_TIMEOUTS.admin
      : SESSION_TIMEOUTS.user;
  const fromEnv = oidcBacked
    ? process.env.AUTH_OIDC_SESSION_MAX_AGE
    : process.env.AUTH_SESSION_MAX_AGE;

  if (!fromEnv) {
    return defaultTimeout;
  }

  const parsed = Number(fromEnv);

  if (oidcBacked && (
    !Number.isFinite(parsed)
    || parsed < OIDC_SESSION_MIN_SECONDS
    || parsed > OIDC_SESSION_MAX_SECONDS
  )) {
    throw new Error(
      `AUTH_OIDC_SESSION_MAX_AGE must be between ${OIDC_SESSION_MIN_SECONDS} and ${OIDC_SESSION_MAX_SECONDS} seconds`,
    );
  }

  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.floor(parsed);
  }

  return defaultTimeout;
}

export function getSessionMaxIdleSeconds(authProvider: string = 'ad'): number {
  return authProvider === 'oidc'
    ? getSessionMaxAgeSeconds(false, authProvider)
    : SESSION_TIMEOUTS.maxIdle;
}

export function setSessionCookieOnResponse(
  response: NextResponse,
  token: string,
  expiresAt: Date
): void {
  const maxAgeSeconds = Math.max(
    0,
    Math.floor((expiresAt.getTime() - Date.now()) / 1000)
  );
  const secure = shouldUseSecureCookies();

  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure,
    sameSite: SESSION_COOKIE_SAMESITE,
    maxAge: maxAgeSeconds,
    path: '/',
  });

  for (const cookieName of LEGACY_SESSION_COOKIE_NAMES) {
    response.cookies.set(cookieName, '', {
      httpOnly: true,
      secure,
      sameSite: SESSION_COOKIE_SAMESITE,
      maxAge: 0,
      path: '/',
    });
  }
}

export function clearSessionCookiesOnResponse(response: NextResponse): void {
  const secure = shouldUseSecureCookies();

  response.cookies.set(SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    secure,
    sameSite: SESSION_COOKIE_SAMESITE,
    maxAge: 0,
    path: '/',
  });

  for (const cookieName of LEGACY_SESSION_COOKIE_NAMES) {
    response.cookies.set(cookieName, '', {
      httpOnly: true,
      secure,
      sameSite: SESSION_COOKIE_SAMESITE,
      maxAge: 0,
      path: '/',
    });
  }
}
