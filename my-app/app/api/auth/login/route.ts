import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { searchLDAPUser, isPasswordChangeRequiredAuthStatus } from '@/lib/ldap';
import { authenticateDirectoryOnly, authenticateLocalOnly } from '@/lib/auth/provider';
import { canonicalizeBreakGlassUsername, LOCAL_USERNAME_SUFFIX } from '@/lib/auth/local-username';
import { assertPortalSignInMethodEnabled, type PortalSignInMethodId } from '@/lib/auth/sign-in-policy';
import { resolveReviewerAuthorization, buildBreakGlassAuthorization } from '@/lib/rbac/core';
import { checkRateLimitAsync, getRequiredClientIp, isRateLimitUnavailable, RateLimitPresets } from '@/lib/ratelimit';
import { establishSessionOnResponse } from '@/lib/session';
import { parseJsonWithLimit, MAX_REQUEST_BODY_SIZE, isJsonBodyError } from '@/lib/validation';
import { assertSignInEnabled, SignInDisabledError } from '@/lib/auth/sign-in-availability';
import { LocalCredentialChangedError } from '@/lib/auth/local-credential-version';
import { verifyTurnstileToken } from '@/lib/turnstile';
import { StandardErrors, authenticationError } from '@/lib/standardErrors';
import { appLogger } from '@/lib/logger';
import { AuditActions, AuditCategories, logAuditAction } from '@/lib/audit-log';
import {
  attachPasswordChangeChallengeCookie,
  createPasswordChangeChallenge,
  type PasswordChangeChallengeReason,
} from '@/lib/password-change-challenge';

type CredentialSignInMethod = Extract<PortalSignInMethodId, 'native_ad' | 'local_break_glass'>;

function toPasswordChangeChallengeReason(status: string): PasswordChangeChallengeReason {
  return status === 'password_expired' ? 'password_expired' : 'password_change_required';
}

function rateLimitDeniedResponse(result: { limit: number; remaining: number; reset: number }) {
  const retryAfter = Math.max(1, Math.ceil((result.reset - Date.now()) / 1000));
  return NextResponse.json(
    { error: StandardErrors.RATE_LIMIT_EXCEEDED, retryAfter },
    {
      status: 429,
      headers: {
        'X-RateLimit-Limit': result.limit.toString(),
        'X-RateLimit-Remaining': result.remaining.toString(),
        'X-RateLimit-Reset': new Date(result.reset).toISOString(),
        'Retry-After': retryAfter.toString(),
      },
    }
  );
}

function methodDisabledResponse() {
  return NextResponse.json(
    { action: 'METHOD_DISABLED', error: 'This sign-in method is not enabled.' },
    { status: 409 }
  );
}

async function methodStillEnabled(method: CredentialSignInMethod): Promise<boolean> {
  try {
    await assertSignInEnabled();
    await assertPortalSignInMethodEnabled(method);
    return true;
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  try {
    const clientIp = getRequiredClientIp(request);
    const rateLimitResult = await checkRateLimitAsync(clientIp, RateLimitPresets.login);
    if (!rateLimitResult.success) return rateLimitDeniedResponse(rateLimitResult);
    await assertSignInEnabled();

    const body = await parseJsonWithLimit<{
      username?: string;
      password?: string;
      turnstileToken?: string;
      signInMethod?: string;
    }>(request, MAX_REQUEST_BODY_SIZE.SMALL);
    const { username, password, turnstileToken } = body;
    const signInMethod: CredentialSignInMethod | null =
      body.signInMethod === 'native_ad' || body.signInMethod === 'local_break_glass'
        ? body.signInMethod
        : null;

    if (!signInMethod) return methodDisabledResponse();
    try {
      await assertPortalSignInMethodEnabled(signInMethod);
    } catch {
      await logAuditAction({
        action: AuditActions.LOGIN_FAILURE,
        category: AuditCategories.AUTH,
        username: typeof username === 'string' ? username.trim() : 'unknown',
        outcome: 'denied',
        details: { method: signInMethod, reason: 'sign_in_method_disabled' },
        ipAddress: clientIp === 'unknown' ? undefined : clientIp,
        userAgent: request.headers.get('user-agent') || undefined,
      });
      return methodDisabledResponse();
    }

    if (!turnstileToken || !await verifyTurnstileToken(turnstileToken)) {
      return NextResponse.json({ error: StandardErrors.TURNSTILE_VALIDATION_FAILED }, { status: 400 });
    }
    if (!username || !password) {
      return NextResponse.json({ error: StandardErrors.INVALID_INPUT }, { status: 400 });
    }

    const requestedUsername = username.trim();
    const ipAddress = clientIp === 'unknown' ? undefined : clientIp;
    const userAgent = request.headers.get('user-agent') || undefined;
    const correlationId = randomUUID();
    const localUsername = canonicalizeBreakGlassUsername(requestedUsername);
    const reservedLocalIdentity = requestedUsername.toLowerCase().endsWith(LOCAL_USERNAME_SUFFIX);
    if (
      (signInMethod === 'native_ad' && reservedLocalIdentity)
      || (signInMethod === 'local_break_glass' && !localUsername)
    ) {
      await logAuditAction({
        action: AuditActions.LOGIN_FAILURE,
        category: AuditCategories.AUTH,
        username: requestedUsername,
        outcome: 'denied',
        details: { method: signInMethod, reason: 'provider_identity_mismatch' },
        correlationId,
        ipAddress,
        userAgent,
      });
      return NextResponse.json({ error: StandardErrors.INVALID_CREDENTIALS }, { status: 401 });
    }

    // One request is bound to one provider. No result can trigger a retry
    // against the other credential store.
    const outcome = signInMethod === 'local_break_glass'
      ? await authenticateLocalOnly(requestedUsername, password)
      : await authenticateDirectoryOnly(requestedUsername, password);

    if (outcome.kind === 'unavailable') {
      await logAuditAction({
        action: AuditActions.LOGIN_FAILURE,
        category: AuditCategories.AUTH,
        username: requestedUsername,
        outcome: 'denied',
        details: { method: signInMethod, reason: 'invalid_credentials' },
        correlationId,
        ipAddress,
        userAgent,
      });
      return NextResponse.json({ error: StandardErrors.INVALID_CREDENTIALS }, { status: 401 });
    }

    if (outcome.kind === 'local') {
      const canonicalUsername = requestedUsername.toLowerCase();
      const authorization = await buildBreakGlassAuthorization(canonicalUsername);
      if (!await methodStillEnabled(signInMethod)) return methodDisabledResponse();

      const response = NextResponse.json({
        message: 'Authentication successful',
        user: { username: canonicalUsername, email: '', name: canonicalUsername },
        isAdmin: true,
        isSystemAdministrator: true,
        roles: [...authorization.roles],
        authProvider: 'local',
      });

      await logAuditAction({
        action: AuditActions.LOCAL_BREAK_GLASS_LOGIN,
        category: AuditCategories.AUTH,
        username: canonicalUsername,
        actorType: 'admin',
        eventKind: 'security',
        correlationId,
        details: { method: 'PORTAL_LOCAL', provider: 'local', elevated: true },
        ipAddress,
        userAgent,
      });
      if (!await methodStillEnabled(signInMethod)) return methodDisabledResponse();

      appLogger.warn('[Login] Portal local break-glass authentication used', {
        username: canonicalUsername,
        ip: clientIp,
      });
      try {
        await establishSessionOnResponse(
          response,
          canonicalUsername,
          true,
          ipAddress,
          userAgent,
          'local',
          undefined,
          outcome.credentialVersion
        );
      } catch (sessionError) {
        if (sessionError instanceof LocalCredentialChangedError) {
          return NextResponse.json({ error: StandardErrors.INVALID_CREDENTIALS }, { status: 401 });
        }
        throw sessionError;
      }
      return response;
    }

    const authResult = outcome.result;
    if (!authResult.success) {
      if (isPasswordChangeRequiredAuthStatus(authResult.status)) {
        if (!await methodStillEnabled(signInMethod)) return methodDisabledResponse();
        const reason = toPasswordChangeChallengeReason(authResult.status);
        const challenge = await createPasswordChangeChallenge({
          username: requestedUsername,
          reason,
          authProvider: 'ad_manual',
          correlationId,
          ipAddress,
          userAgent,
        });
        await logAuditAction({
          action: AuditActions.PASSWORD_CHANGE_REQUIRED,
          category: AuditCategories.AUTH,
          username: requestedUsername,
          details: { method: 'DIRECT_LDAP', reason },
          correlationId,
          ipAddress,
          userAgent,
        });
        const response = NextResponse.json({
          action: 'PASSWORD_CHANGE_REQUIRED',
          reason,
          message: 'Your account requires a new password before sign in can continue.',
        }, { status: 409 });
        attachPasswordChangeChallengeCookie(response, challenge.token, challenge.expiresAt);
        return response;
      }

      await logAuditAction({
        action: AuditActions.LOGIN_FAILURE,
        category: AuditCategories.AUTH,
        username: requestedUsername,
        outcome: 'denied',
        details: { method: 'DIRECT_LDAP', reason: authResult.status || 'authentication_failed' },
        correlationId,
        ipAddress,
        userAgent,
      });
      appLogger.error('[Login] Active Directory authentication failed', undefined, {
        username: requestedUsername,
        error: authResult.error,
        status: authResult.status,
        ip: clientIp,
      });
      return NextResponse.json({ error: StandardErrors.INVALID_CREDENTIALS }, { status: 401 });
    }

    const [userInfo, authorization] = await Promise.all([
      searchLDAPUser(requestedUsername),
      resolveReviewerAuthorization(requestedUsername),
    ]);
    const isDomainAdmin = authorization.viaLegacyAdminFallback;
    const elevated = authorization.permissions.size > 0;
    if (!await methodStillEnabled(signInMethod)) return methodDisabledResponse();

    const response = NextResponse.json({
      message: 'Authentication successful',
      user: {
        username: requestedUsername,
        email: userInfo?.attributes?.find((attribute) => attribute.type === 'mail')?.values?.[0] || '',
        name: userInfo?.attributes?.find((attribute) => attribute.type === 'cn')?.values?.[0] || requestedUsername,
      },
      isAdmin: elevated,
      isSystemAdministrator: isDomainAdmin,
      roles: [...authorization.roles],
      authProvider: 'ad_manual',
    });
    await logAuditAction({
      action: AuditActions.LOGIN_SUCCESS,
      category: AuditCategories.AUTH,
      username: requestedUsername,
      details: { method: 'DIRECT_LDAP', isAdmin: isDomainAdmin, roles: [...authorization.roles] },
      correlationId,
      ipAddress,
      userAgent,
    });
    if (!await methodStillEnabled(signInMethod)) return methodDisabledResponse();
    await establishSessionOnResponse(
      response,
      requestedUsername,
      elevated,
      ipAddress,
      userAgent,
      'ad_manual'
    );
    return response;
  } catch (error) {
    if (error instanceof SignInDisabledError) {
      return NextResponse.json({ error: StandardErrors.SERVICE_UNAVAILABLE }, { status: 503 });
    }
    if (isJsonBodyError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    if (isRateLimitUnavailable(error)) {
      return NextResponse.json({ error: StandardErrors.SERVICE_UNAVAILABLE }, { status: 503 });
    }
    return authenticationError(error, 'Login');
  }
}
