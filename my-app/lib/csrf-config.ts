/**
 * Paths that should never require CSRF token validation.
 * These are typically:
 * - Logout endpoints (session termination is idempotent)
 * - Read-only/public endpoints
 * - Unauthenticated flows (where CSRF isn't needed)
 */
export const CSRF_EXEMPT_PATHS = [
  // Logout endpoints. Login requires a token pair even before a session exists
  // to prevent a cross-site request from signing the browser into another user.
  '/api/auth/logout',
  '/api/admin/logout',

  // OIDC Back-Channel Logout receiver (issue #36). Deliberate exemption:
  // this is a bearer-less machine-to-machine endpoint called by the auth
  // service per the OIDC Back-Channel Logout spec - there is no browser
  // session and therefore no CSRF token to pair. The RS256-signed
  // logout_token JWT (verified against the IdP JWKS with mandatory
  // iss/aud/iat/event/no-nonce checks) IS the authentication; a forged or
  // replayed token fails closed as a generic 400 with no side effects.
  '/api/auth/oidc/backchannel-logout',
  
  // Read-only/public endpoints
  '/api/auth/check-admin',
  '/api/auth/session',
  '/api/csrf-token',
  '/api/events/active',

  // Machine-to-machine jobs authenticate with CRON_SECRET bearer tokens.
  '/api/cron',
  
  // Admin analytics/tracking - already protected by session auth
  '/api/admin/track-view',
  
  // Unauthenticated flows - no session to protect
  '/api/request',
  '/api/verify',
  '/api/verify/confirm',
  '/api/offboard/verify',
  '/api/offboard/verify/confirm',
  '/api/profile/verify-email/confirm',
  '/api/auth/request-password-reset',
  '/api/auth/reset-password',
  '/api/account/activate'
] as const;

/**
 * Check if a given path should be exempt from CSRF validation.
 */
export function isCsrfExempt(pathname: string): boolean {
  return CSRF_EXEMPT_PATHS.some(
    path => pathname === path || pathname.startsWith(`${path}/`)
  );
}

/**
 * HTTP methods that require CSRF token validation.
 */
export const CSRF_PROTECTED_METHODS = ['POST', 'PUT', 'DELETE', 'PATCH'] as const;

/**
 * Check if an HTTP method requires CSRF validation.
 */
export function requiresCsrfValidation(method: string): boolean {
  const normalizedMethod = method.toUpperCase();
  return CSRF_PROTECTED_METHODS.some(protectedMethod => protectedMethod === normalizedMethod);
}
