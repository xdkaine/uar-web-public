import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  OIDC_NONCE_COOKIE,
  OIDC_REDIRECT_COOKIE,
  OIDC_STATE_COOKIE,
  OIDC_VERIFIER_COOKIE,
  OIDC_COOKIE_MAX_AGE_SECONDS,
  portalBaseUrl,
  prepareLogin,
} from '@/lib/auth/oidc';
import { shouldUseSecureCookies } from '@/lib/cookie-security';
import { assertPortalSignInMethodEnabled } from '@/lib/auth/sign-in-policy';

export const dynamic = 'force-dynamic';

/**
 * Starts the OIDC authorization-code + PKCE flow (ADR-0012). The stashed
 * cookies are short-lived, httpOnly, and consumed by the callback.
 */
export async function GET(request: NextRequest) {
  try {
    await assertPortalSignInMethodEnabled('oidc');
  } catch {
    return NextResponse.redirect(new URL('/login?error=oidc_disabled', portalBaseUrl()));
  }

  // Maintenance lockout applies to every sign-in path, OIDC included.
  try {
    const settings = await prisma.systemSettings.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { loginDisabled: true },
    });
    if (settings?.loginDisabled) {
      return NextResponse.redirect(new URL('/login?error=logins_disabled', portalBaseUrl()));
    }
  } catch (error) {
    console.error('[Oidc] Failed to read login settings; failing closed:', error);
    return NextResponse.redirect(new URL('/login?error=logins_disabled', portalBaseUrl()));
  }

  const requestedRedirect = request.nextUrl.searchParams.get('redirect');
  try {
    const prepared = await prepareLogin(requestedRedirect, portalBaseUrl());

    const response = NextResponse.redirect(prepared.authorizationUrl.toString());
    const cookieOptions = {
      httpOnly: true,
      secure: shouldUseSecureCookies(),
      sameSite: 'lax' as const,
      path: '/',
      maxAge: OIDC_COOKIE_MAX_AGE_SECONDS,
    };

    response.cookies.set(OIDC_STATE_COOKIE, prepared.state, cookieOptions);
    response.cookies.set(OIDC_VERIFIER_COOKIE, prepared.codeVerifier, cookieOptions);
    response.cookies.set(OIDC_NONCE_COOKIE, prepared.nonce, cookieOptions);
    response.cookies.set(OIDC_REDIRECT_COOKIE, prepared.redirectPath, cookieOptions);
    return response;
  } catch (error) {
    console.error('[Oidc] Failed to start login:', error);
    const failureUrl = new URL('/login', portalBaseUrl());
    failureUrl.searchParams.set('error', 'oidc_unavailable');
    if (requestedRedirect) failureUrl.searchParams.set('redirect', requestedRedirect);
    return NextResponse.redirect(failureUrl);
  }
}
