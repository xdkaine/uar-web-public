import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  OIDC_NONCE_COOKIE,
  OIDC_REDIRECT_COOKIE,
  OIDC_STATE_COOKIE,
  OIDC_VERIFIER_COOKIE,
  exchangeCallback,
  portalBaseUrl,
} from '@/lib/auth/oidc';
import { resolveReviewerAuthorization } from '@/lib/rbac/core';
import { establishSessionOnResponse } from '@/lib/session';
import { logAuditAction, AuditActions, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';
import { getSafeRelativeRedirect } from '@/lib/safe-redirect';
import { appLogger } from '@/lib/logger';
import { assertPortalSignInMethodEnabled } from '@/lib/auth/sign-in-policy';

export const dynamic = 'force-dynamic';

function clearOidcCookies(response: NextResponse): void {
  for (const name of [OIDC_STATE_COOKIE, OIDC_VERIFIER_COOKIE, OIDC_NONCE_COOKIE, OIDC_REDIRECT_COOKIE]) {
    response.cookies.set(name, '', { path: '/', maxAge: 0 });
  }
}

function rejectOidcCallback(reason: string): NextResponse {
  appLogger.warn('[Oidc] Callback rejected', { reason });
  const response = NextResponse.redirect(new URL('/login?error=oidc_failed', portalBaseUrl()));
  clearOidcCookies(response);
  return response;
}

async function auditOrLog(entry: Parameters<typeof logAuditAction>[0]): Promise<void> {
  try {
    await logAuditAction(entry);
  } catch (error) {
    console.error('[Oidc] Failed to write auth audit:', error);
  }
}

/**
 * OIDC callback (ADR-0012): verifies the code against the stashed state/PKCE
 * cookies, resolves elevation exactly like the native login (live directory
 * lookups stay portal-side), then mints the standard portal session.
 */
export async function GET(request: NextRequest) {
  const state = request.cookies.get(OIDC_STATE_COOKIE)?.value;
  const verifier = request.cookies.get(OIDC_VERIFIER_COOKIE)?.value;
  const nonce = request.cookies.get(OIDC_NONCE_COOKIE)?.value;
  const redirectCookie = request.cookies.get(OIDC_REDIRECT_COOKIE)?.value;

  try {
    await assertPortalSignInMethodEnabled('oidc');
  } catch {
    appLogger.warn('[Oidc] Callback rejected', { reason: 'oidc_disabled' });
    const response = NextResponse.redirect(new URL('/login?error=oidc_disabled', portalBaseUrl()));
    clearOidcCookies(response);
    return response;
  }

  if (!state || !verifier) {
    return rejectOidcCallback('missing_login_state');
  }

  let identity;
  try {
    // Build the callback URL against the BROWSER-FACING base (same policy as
    // the login route): request.nextUrl inside the container resolves to the
    // internal bind address (e.g. 0.0.0.0:3002) whenever forwarded-host
    // handling is off, which poisons the provider's redirect_uri comparison.
    const callbackUrl = new URL(
      `${request.nextUrl.pathname}${request.nextUrl.search}`,
      portalBaseUrl(),
    );
    identity = await exchangeCallback({
      callbackUrl,
      expectedState: state,
      codeVerifier: verifier,
      expectedNonce: nonce,
    });
  } catch {
    return rejectOidcCallback('exchange_failed');
  }

  const ipAddress = getIpAddress(request);
  const userAgent = getUserAgent(request);
  const username = identity.username;
  const hasAdAuthority = identity.amr.includes('ad');
  const contradictoryAuthority = identity.amr.some((method) =>
    method === 'local_break_glass' || method === 'local_recovery' || method === 'portal_local'
  );
  const providerSessionExpiresAt = identity.providerSessionExpiresAt
    ? new Date(identity.providerSessionExpiresAt * 1000)
    : null;
  if (
    !hasAdAuthority
    || contradictoryAuthority
    || !identity.sid
    || !providerSessionExpiresAt
    || !Number.isFinite(providerSessionExpiresAt.getTime())
    || providerSessionExpiresAt <= new Date()
  ) {
    return rejectOidcCallback('invalid_authentication_authority');
  }

  // Maintenance lockout applies to every sign-in path, OIDC included.
  try {
    const settings = await prisma.systemSettings.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { loginDisabled: true },
    });
    if (settings?.loginDisabled) {
      appLogger.warn('[Oidc] Login rejected: portal logins are disabled', { username });
      return rejectOidcCallback('logins_disabled');
    }
  } catch (settingsError) {
    console.error('[Oidc] Failed to read login settings; failing closed:', settingsError);
    return rejectOidcCallback('logins_disabled');
  }

  // Only vetted internal paths survive this helper (rejects //evil.com etc.);
  // the IdP round-trip must never become an open redirect.
  const safeRedirect = getSafeRelativeRedirect(redirectCookie);

  try {
    // One live directory resolution decides elevation - identical to native.
    const authorization = await resolveReviewerAuthorization(username);
    const isDomainAdmin = authorization.viaLegacyAdminFallback;
    const elevated = authorization.permissions.size > 0 || isDomainAdmin;

    const target = safeRedirect ?? (elevated ? '/admin' : '/instructions');
    const response = NextResponse.redirect(new URL(target, portalBaseUrl()));
    clearOidcCookies(response);

    // The method can be disabled while the browser is at the provider. Recheck
    // immediately before minting a portal session.
    await assertPortalSignInMethodEnabled('oidc');

    await establishSessionOnResponse(
      response,
      username,
      elevated,
      ipAddress,
      userAgent,
      'oidc',
      identity.sid,
      undefined,
      'direct',
      providerSessionExpiresAt,
    );

    await auditOrLog({
      action: AuditActions.LOGIN_SUCCESS,
      category: AuditCategories.AUTH,
      username,
      details: {
        method: 'OIDC',
        isAdmin: isDomainAdmin,
        roles: [...authorization.roles],
      },
      ipAddress,
      userAgent,
    });

    return response;
  } catch (error) {
    console.error('[Oidc] Failed to establish session:', error);
    return rejectOidcCallback('session_establishment_failed');
  }
}
