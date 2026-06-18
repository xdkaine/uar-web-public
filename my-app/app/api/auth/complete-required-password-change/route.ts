import { NextRequest, NextResponse } from 'next/server';
import {
  authenticateLDAP,
  changeLDAPUserPassword,
  clearLDAPUserPasswordChangeRequired,
  isPasswordChangeRequiredAuthStatus,
  isUserDomainAdmin,
  searchLDAPUser,
} from '@/lib/ldap';
import { AuditActions, AuditCategories, logAuditAction } from '@/lib/audit-log';
import { appLogger } from '@/lib/logger';
import {
  clearPasswordChangeChallengeCookie,
  consumePasswordChangeChallenge,
  getValidPasswordChangeChallenge,
  incrementPasswordChangeChallengeAttempts,
} from '@/lib/password-change-challenge';
import { checkRateLimitAsync, getRequiredClientIp, isRateLimitUnavailable } from '@/lib/ratelimit';
import { establishSessionOnResponse } from '@/lib/session';
import { isJsonBodyError, MAX_REQUEST_BODY_SIZE, parseJsonWithLimit } from '@/lib/validation';
import { PASSWORD_MAX_LENGTH, validatePasswordPolicy } from '@/lib/password-policy';

interface CompletePasswordChangeBody {
  currentPassword?: unknown;
  newPassword?: unknown;
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

  await logAuthAudit({
    action: AuditActions.PASSWORD_CHANGE_FAILURE,
    category: AuditCategories.AUTH,
    username: input.username,
    details: {
      reason: input.auditReason,
      attempts: attemptResult.attempts,
      exhausted: attemptResult.exhausted,
    },
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
    success: false,
    errorMessage: input.auditReason,
  });

  return response;
}

export async function POST(request: NextRequest) {
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

    const { currentPassword, newPassword } = await parseJsonWithLimit<CompletePasswordChangeBody>(
      request,
      MAX_REQUEST_BODY_SIZE.SMALL
    );

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
      });
    }

    try {
      await changeLDAPUserPassword(challenge.username, newPassword, userInfo.objectName);
    } catch (passwordError) {
      const errorMessage = passwordError instanceof Error ? passwordError.message : 'Unknown error';
      appLogger.error('Required password change failed in Active Directory', passwordError, {
        username: challenge.username,
      });

      let clientMessage = 'Active Directory rejected the password change. Please choose a different password and try again.';
      if (errorMessage.includes('secure connection')) {
        clientMessage = 'Active Directory requires a secure connection to change passwords. Please contact support.';
      }

      return rejectWithChallengeAttempt({
        challengeId: challenge.id,
        username: challenge.username,
        message: clientMessage,
        ipAddress,
        userAgent,
        auditReason: 'ldap_password_change_rejected',
      });
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
      await logAuthAudit({
        action: AuditActions.PASSWORD_CHANGE_FAILURE,
        category: AuditCategories.AUTH,
        username: challenge.username,
        details: {
          reason: 'post_change_authentication_failed',
          status: postChangeAuthResult.status,
        },
        ipAddress,
        userAgent,
        success: false,
        errorMessage: 'post_change_authentication_failed',
      });

      const response = NextResponse.json({
        message: 'Password updated. Please sign in with your new password.',
        requiresLogin: true,
      });
      clearPasswordChangeChallengeCookie(response);
      return response;
    }

    const refreshedUserInfo = await searchLDAPUser(challenge.username);
    const isDomainAdmin = await isUserDomainAdmin(challenge.username);
    const response = NextResponse.json(
      {
        message: 'Password updated and authentication successful',
        user: {
          username: challenge.username,
          email: getAttribute(refreshedUserInfo?.attributes, 'mail') || '',
          name: getAttribute(refreshedUserInfo?.attributes, 'cn') || challenge.username,
        },
        isAdmin: isDomainAdmin,
      },
      { status: 200 }
    );

    await consumePasswordChangeChallenge(challenge.id);
    clearPasswordChangeChallengeCookie(response);

    await logAuthAudit({
      action: AuditActions.PASSWORD_CHANGE_SUCCESS,
      category: AuditCategories.AUTH,
      username: challenge.username,
      details: {
        reason: challenge.reason,
        isAdmin: isDomainAdmin,
      },
      ipAddress,
      userAgent,
    });

    await establishSessionOnResponse(response, challenge.username, isDomainAdmin, ipAddress, userAgent);
    return response;
  } catch (error) {
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