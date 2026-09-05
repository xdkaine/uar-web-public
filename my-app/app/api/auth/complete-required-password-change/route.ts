import { NextRequest, NextResponse } from 'next/server';
import {
  authenticateLDAP,
  changeLDAPUserPassword,
  clearLDAPUserPasswordChangeRequired,
  isPasswordChangeRequiredAuthStatus,
  searchLDAPUser,
} from '@/lib/ldap';
import { AuditActions, AuditCategories, logAuditAction } from '@/lib/audit-log';
import { appLogger } from '@/lib/logger';
import {
  clearPasswordChangeChallengeCookie,
  claimPasswordChangeChallenge,
  consumePasswordChangeChallenge,
  getValidPasswordChangeChallenge,
  incrementPasswordChangeChallengeAttempts,
  markPasswordChangeChallengeDirectoryApplied,
} from '@/lib/password-change-challenge';
import { resolveReviewerAuthorization } from '@/lib/rbac/core';
import { checkRateLimitAsync, getRequiredClientIp, isRateLimitUnavailable } from '@/lib/ratelimit';
import { establishSessionOnResponse } from '@/lib/session';
import { isJsonBodyError, MAX_REQUEST_BODY_SIZE, parseJsonWithLimit } from '@/lib/validation';
import { PASSWORD_MAX_LENGTH, validatePasswordPolicy } from '@/lib/password-policy';
import { verifyTurnstileToken } from '@/lib/turnstile';
import { assertSignInEnabled, SignInDisabledError } from '@/lib/auth/sign-in-availability';
import { assertPortalSignInMethodEnabled } from '@/lib/auth/sign-in-policy';

interface CompletePasswordChangeBody {
  currentPassword?: unknown;
  newPassword?: unknown;
  turnstileToken?: unknown;
}

function getAttribute(
  attributes: Array<{ type: string; values: string[] }> | undefined,
  name: string
): string | null {
  return attributes?.find((attr) => attr.type === name)?.values?.[0] || null;
}

async function logAuthAudit(entry: Parameters<typeof logAuditAction>[0]) {
  try {
    await logAuditAction(entry);
  } catch (auditError) {
    appLogger.error('Failed to log password-change audit action:', undefined, { error: auditError });
  }
}

async function rejectWithChallengeAttempt(input: {
  challengeId: string;
  username: string;
  message: string;
  ipAddress?: string;
  userAgent?: string;
  status?: number;
  auditReason: string;
  correlationId?: string;
  requireDurableAudit?: boolean;
}) {
  const attemptResult = await incrementPasswordChangeChallengeAttempts(input.challengeId);
  const response = NextResponse.json(
    {
      error: attemptResult.exhausted
        ? 'Too many password change attempts. Please start again from the sign in page.'
        : input.message,
    },
    { status: attemptResult.exhausted ? 429 : input.status || 400 }
  );

  if (attemptResult.exhausted) {
    clearPasswordChangeChallengeCookie(response);
  }

  const auditEntry = {
    action: AuditActions.PASSWORD_CHANGE_FAILURE,
    category: AuditCategories.AUTH,
    username: input.username,
    details: {
      reason: input.auditReason,
      attempts: attemptResult.attempts,
      exhausted: attemptResult.exhausted,
    },
    correlationId: input.correlationId,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
    success: false,
    errorMessage: input.auditReason,
  } satisfies Parameters<typeof logAuditAction>[0];
  if (input.requireDurableAudit) await logAuditAction(auditEntry);
  else await logAuthAudit(auditEntry);

  return response;
}

export async function POST(request: NextRequest) {
  let postMutationContext: {
    challengeId: string;
    username: string;
    reason: string;
    correlationId?: string;
    ipAddress?: string;
    userAgent?: string;
    method: string;
  } | null = null;
  try {
    const clientIp = getRequiredClientIp(request);
    const ipAddress = clientIp === 'unknown' ? undefined : clientIp;
    const userAgent = request.headers.get('user-agent') || undefined;
    const challenge = await getValidPasswordChangeChallenge(request);

    if (!challenge) {
      const response = NextResponse.json(
        { error: 'This password change session has expired. Please sign in again.' },
        { status: 400 }
      );
      clearPasswordChangeChallengeCookie(response);
      return response;
    }

    await assertSignInEnabled();
    const isOutageContinuation = challenge.authProvider === 'ad_outage_fallback';
    const isGuardedContinuation = true;
    const continuationMethod = isOutageContinuation
      ? 'RETIRED_OIDC_OUTAGE_FALLBACK_LDAP'
      : 'DIRECT_LDAP';
    const continuationStillAuthorized = async () => {
      await assertSignInEnabled();
      if (isOutageContinuation) return false;
      try {
        await assertPortalSignInMethodEnabled('native_ad');
        return true;
      } catch {
        return false;
      }
    };
    if (isGuardedContinuation && !await continuationStillAuthorized()) {
      const response = NextResponse.json(
        {
          action: 'METHOD_DISABLED',
          error: 'Direct Active Directory sign-in is no longer enabled. Return to sign in.',
        },
        { status: 409 }
      );
      clearPasswordChangeChallengeCookie(response);
      return response;
    }

    const rateLimitResult = await checkRateLimitAsync(clientIp, {
      maxRequests: 10,
      windowMs: 15 * 60 * 1000,
      identifier: `password-change:${challenge.id}`,
    });

    if (!rateLimitResult.success) {
      return NextResponse.json(
        {
          error: 'Too many password change attempts. Please try again later.',
          retryAfter: Math.ceil((rateLimitResult.reset - Date.now()) / 1000),
        },
        {
          status: 429,
          headers: {
            'X-RateLimit-Limit': rateLimitResult.limit.toString(),
            'X-RateLimit-Remaining': rateLimitResult.remaining.toString(),
            'X-RateLimit-Reset': new Date(rateLimitResult.reset).toISOString(),
            'Retry-After': Math.ceil((rateLimitResult.reset - Date.now()) / 1000).toString(),
          },
        }
      );
    }

    const { currentPassword, newPassword, turnstileToken } = await parseJsonWithLimit<CompletePasswordChangeBody>(
      request,
      MAX_REQUEST_BODY_SIZE.SMALL
    );

    if (
      isGuardedContinuation
      && (typeof turnstileToken !== 'string' || !turnstileToken || !await verifyTurnstileToken(turnstileToken))
    ) {
      return rejectWithChallengeAttempt({
        challengeId: challenge.id,
        username: challenge.username,
        message: 'Human verification failed or was not completed.',
        ipAddress,
        userAgent,
        auditReason: 'turnstile_failed',
        correlationId: challenge.correlationId ?? undefined,
        requireDurableAudit: true,
      });
    }

    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || !currentPassword || !newPassword) {
      return NextResponse.json(
        { error: 'Current password and new password are required' },
        { status: 400 }
      );
    }

    if (currentPassword.length > PASSWORD_MAX_LENGTH || newPassword.length > PASSWORD_MAX_LENGTH) {
      return NextResponse.json(
        { error: `Passwords must not exceed ${PASSWORD_MAX_LENGTH} characters` },
        { status: 400 }
      );
    }

    const userInfo = await searchLDAPUser(challenge.username);
    if (!userInfo) {
      return rejectWithChallengeAttempt({
        challengeId: challenge.id,
        username: challenge.username,
        message: 'Account status prevents password change. Please contact support.',
        ipAddress,
        userAgent,
        auditReason: 'ldap_user_not_found',
        correlationId: challenge.correlationId ?? undefined,
        requireDurableAudit: isGuardedContinuation,
      });
    }

    const email = getAttribute(userInfo.attributes, 'mail');
    const displayName = getAttribute(userInfo.attributes, 'displayName') || getAttribute(userInfo.attributes, 'cn');
    const passwordValidation = validatePasswordPolicy(newPassword, {
      username: challenge.username,
      email,
      fullName: displayName,
    });

    if (!passwordValidation.isValid) {
      return NextResponse.json(
        { error: 'Password does not meet requirements', issues: passwordValidation.issues },
        { status: 400 }
      );
    }

    const currentAuthResult = await authenticateLDAP(challenge.username, currentPassword);
    if (!isPasswordChangeRequiredAuthStatus(currentAuthResult.status)) {
      const message = currentAuthResult.success
        ? 'This account no longer requires a forced password change. Please sign in normally.'
        : 'Current password was not accepted by Active Directory.';

      return rejectWithChallengeAttempt({
        challengeId: challenge.id,
        username: challenge.username,
        message,
        ipAddress,
        userAgent,
        auditReason: currentAuthResult.status,
        correlationId: challenge.correlationId ?? undefined,
        requireDurableAudit: isGuardedContinuation,
      });
    }

    if (isGuardedContinuation && !await continuationStillAuthorized()) {
      const response = NextResponse.json(
        { action: 'METHOD_DISABLED', error: 'Direct Active Directory sign-in is no longer enabled. Return to sign in.' },
        { status: 409 }
      );
      clearPasswordChangeChallengeCookie(response);
      return response;
    }

    if (!await claimPasswordChangeChallenge(challenge.id)) {
      const response = NextResponse.json(
        { error: 'This password change is already processing or has expired. Please sign in again.' },
        { status: 409 }
      );
      clearPasswordChangeChallengeCookie(response);
      return response;
    }

    // Claiming fences concurrent submissions, but policy can still change
    // between the pre-claim read and the directory mutation. Reauthorize the
    // exact guarded path once more while holding the challenge claim.
    if (isGuardedContinuation && !await continuationStillAuthorized()) {
      await consumePasswordChangeChallenge(challenge.id);
      await logAuditAction({
        action: AuditActions.PASSWORD_CHANGE_FAILURE,
        category: AuditCategories.AUTH,
        username: challenge.username,
        details: {
          reason: 'direct_sign_in_policy_changed_before_directory_mutation',
          method: continuationMethod,
          challengeConsumed: true,
        },
        correlationId: challenge.correlationId ?? undefined,
        ipAddress,
        userAgent,
        success: false,
        errorMessage: 'direct_sign_in_policy_changed_before_directory_mutation',
      });
      const response = NextResponse.json(
        { action: 'METHOD_DISABLED', error: 'Direct Active Directory sign-in is no longer enabled. Return to sign in.' },
        { status: 409 }
      );
      clearPasswordChangeChallengeCookie(response);
      return response;
    }

    try {
      await changeLDAPUserPassword(challenge.username, newPassword, userInfo.objectName);
      postMutationContext = {
        challengeId: challenge.id,
        username: challenge.username,
        reason: challenge.reason,
        correlationId: challenge.correlationId ?? undefined,
        ipAddress,
        userAgent,
        method: continuationMethod,
      };
      await markPasswordChangeChallengeDirectoryApplied(challenge.id);
      await logAuditAction({
        action: AuditActions.PASSWORD_CHANGE_DIRECTORY_MUTATION_COMPLETED,
        category: AuditCategories.AUTH,
        username: challenge.username,
        details: {
          reason: challenge.reason,
          method: postMutationContext.method,
          sessionMinted: false,
          challengeState: 'directory_applied',
        },
        correlationId: challenge.correlationId ?? undefined,
        ipAddress,
        userAgent,
      });
    } catch (passwordError) {
      if (postMutationContext) throw passwordError;
      await consumePasswordChangeChallenge(challenge.id);
      const errorMessage = passwordError instanceof Error ? passwordError.message : 'Unknown error';
      appLogger.error('Required password change failed in Active Directory', passwordError, {
        username: challenge.username,
      });

      let clientMessage = 'Active Directory rejected the password change. Please choose a different password and try again.';
      if (errorMessage.includes('secure connection')) {
        clientMessage = 'Active Directory requires a secure connection to change passwords. Please contact support.';
      }

      const failureAudit = {
        action: AuditActions.PASSWORD_CHANGE_FAILURE,
        category: AuditCategories.AUTH,
        username: challenge.username,
        details: { reason: 'ldap_password_change_rejected', challengeConsumed: true },
        correlationId: challenge.correlationId ?? undefined,
        ipAddress,
        userAgent,
        success: false,
        errorMessage: 'ldap_password_change_rejected',
      } satisfies Parameters<typeof logAuditAction>[0];
      if (isGuardedContinuation) await logAuditAction(failureAudit);
      else await logAuthAudit(failureAudit);

      const response = NextResponse.json(
        { error: clientMessage, requiresLogin: true },
        { status: 409 }
      );
      clearPasswordChangeChallengeCookie(response);
      return response;
    }

    try {
      await clearLDAPUserPasswordChangeRequired(challenge.username, userInfo.objectName);
    } catch (clearError) {
      appLogger.warn('Unable to explicitly clear AD password-change-required marker after password update', {
        username: challenge.username,
        error: clearError instanceof Error ? clearError.message : 'Unknown error',
      });
    }

    const postChangeAuthResult = await authenticateLDAP(challenge.username, newPassword);
    if (!postChangeAuthResult.success) {
      await consumePasswordChangeChallenge(challenge.id);
      const postChangeFailureAudit = {
        action: AuditActions.PASSWORD_CHANGE_FAILURE,
        category: AuditCategories.AUTH,
        username: challenge.username,
        details: {
          reason: 'post_change_authentication_failed',
          status: postChangeAuthResult.status,
        },
        correlationId: challenge.correlationId ?? undefined,
        ipAddress,
        userAgent,
        success: false,
        errorMessage: 'post_change_authentication_failed',
      } satisfies Parameters<typeof logAuditAction>[0];
      if (isGuardedContinuation) await logAuditAction(postChangeFailureAudit);
      else await logAuthAudit(postChangeFailureAudit);
      postMutationContext = null;

      const response = NextResponse.json({
        message: 'Password updated. Please sign in with your new password.',
        requiresLogin: true,
      });
      clearPasswordChangeChallengeCookie(response);
      return response;
    }

    const refreshedUserInfo = await searchLDAPUser(challenge.username);
    const authorization = await resolveReviewerAuthorization(challenge.username);
    const isDomainAdmin = authorization.viaLegacyAdminFallback;
    const elevated = authorization.permissions.size > 0;
    if (isGuardedContinuation && !await continuationStillAuthorized()) {
      await consumePasswordChangeChallenge(challenge.id);
      await logAuditAction({
        action: AuditActions.PASSWORD_CHANGE_SUCCESS,
        category: AuditCategories.AUTH,
        username: challenge.username,
        details: {
          reason: challenge.reason,
          method: continuationMethod,
          sessionMinted: false,
          sessionDeniedReason: 'direct_ad_disabled',
        },
        correlationId: challenge.correlationId ?? undefined,
        ipAddress,
        userAgent,
      });
      postMutationContext = null;
      const response = NextResponse.json({
        message: 'Password updated. Return to sign in with your new password.',
        requiresLogin: true,
      });
      clearPasswordChangeChallengeCookie(response);
      return response;
    }
    const response = NextResponse.json(
      {
        message: 'Password updated and authentication successful',
        user: {
          username: challenge.username,
          email: getAttribute(refreshedUserInfo?.attributes, 'mail') || '',
          name: getAttribute(refreshedUserInfo?.attributes, 'cn') || challenge.username,
        },
        isAdmin: elevated,
        isSystemAdministrator: isDomainAdmin,
        roles: [...authorization.roles],
      },
      { status: 200 }
    );

    await consumePasswordChangeChallenge(challenge.id);
    clearPasswordChangeChallengeCookie(response);

    const successAudit = {
      action: AuditActions.PASSWORD_CHANGE_SUCCESS,
      category: AuditCategories.AUTH,
      username: challenge.username,
      details: {
        reason: challenge.reason,
        isAdmin: elevated,
        roles: [...authorization.roles],
        method: continuationMethod,
      },
      correlationId: challenge.correlationId ?? undefined,
      ipAddress,
      userAgent,
    } satisfies Parameters<typeof logAuditAction>[0];
    if (isGuardedContinuation) await logAuditAction(successAudit);
    else await logAuthAudit(successAudit);
    if (isGuardedContinuation && !await continuationStillAuthorized()) {
      await logAuditAction({
        action: AuditActions.PASSWORD_CHANGE_SUCCESS,
        category: AuditCategories.AUTH,
        username: challenge.username,
        details: {
          reason: challenge.reason,
          method: continuationMethod,
          sessionMinted: false,
          sessionDeniedReason: 'direct_ad_disabled_after_success_audit',
        },
        correlationId: challenge.correlationId ?? undefined,
        ipAddress,
        userAgent,
      });
      postMutationContext = null;
      const fencedResponse = NextResponse.json({
        message: 'Password updated. Return to sign in with your new password.',
        requiresLogin: true,
      });
      clearPasswordChangeChallengeCookie(fencedResponse);
      return fencedResponse;
    }
    await establishSessionOnResponse(
      response,
      challenge.username,
      elevated,
      ipAddress,
      userAgent,
      'ad_manual'
    );
    postMutationContext = null;
    return response;
  } catch (error) {
    if (postMutationContext) {
      let challengeState = 'directory_applied';
      try {
        await consumePasswordChangeChallenge(postMutationContext.challengeId);
        challengeState = 'consumed';
      } catch (consumeError) {
        appLogger.error('Failed to finalize password challenge after directory mutation', consumeError, {
          challengeId: postMutationContext.challengeId,
          username: postMutationContext.username,
        });
      }
      try {
        await logAuditAction({
          action: AuditActions.PASSWORD_CHANGE_SUCCESS,
          category: AuditCategories.AUTH,
          username: postMutationContext.username,
          details: {
            reason: postMutationContext.reason,
            method: postMutationContext.method,
            sessionMinted: false,
            challengeState,
            reconciliationRequired: challengeState !== 'consumed',
            postMutationFailure: error instanceof Error ? error.message : 'unknown',
          },
          correlationId: postMutationContext.correlationId,
          ipAddress: postMutationContext.ipAddress,
          userAgent: postMutationContext.userAgent,
        });
      } catch (auditError) {
        appLogger.error('Failed to audit completed directory password mutation', auditError, {
          username: postMutationContext.username,
          challengeState,
        });
      }

      const response = NextResponse.json(
        {
          message: 'Password updated. Please sign in again with your new password.',
          requiresLogin: true,
        },
        { status: 500 }
      );
      clearPasswordChangeChallengeCookie(response);
      return response;
    }

    if (error instanceof SignInDisabledError) {
      return NextResponse.json({ error: 'Sign-in is currently disabled. Please try again later.' }, { status: 503 });
    }
    if (isJsonBodyError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }

    if (isRateLimitUnavailable(error)) {
      return NextResponse.json(
        { error: 'This service is temporarily unavailable. Please try again later.' },
        { status: 503 }
      );
    }

    appLogger.error('Required password change unexpected error', error);
    return NextResponse.json(
      { error: 'Failed to complete password change. Please try again or contact support.' },
      { status: 500 }
    );
  }
}
