import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimitAsync, getRequiredClientIp, isRateLimitUnavailable, RateLimitPresets } from '@/lib/ratelimit';
import { changeLDAPUserPasswordWithCurrentPassword } from '@/lib/ldap';
import { getOffboardRecipientVerificationContext, verifyOffboardRecipientToken } from '@/lib/offboard-campaign';
import { PASSWORD_MAX_LENGTH, validatePasswordPolicy } from '@/lib/password-policy';
import { isJsonBodyError, MAX_REQUEST_BODY_SIZE, parseJsonWithLimit } from '@/lib/validation';
import { appLogger } from '@/lib/logger';

const OFFBOARD_PASSWORD_CHANGE_TOKEN_ATTEMPTS = 5;

interface ConfirmAccessBody {
  currentPassword?: unknown;
  newPassword?: unknown;
}

export async function GET(request: NextRequest) {
  try {
    const clientIp = getRequiredClientIp(request);
    const token = request.nextUrl.searchParams.get('token');

    const ipLimit = await checkRateLimitAsync(clientIp, RateLimitPresets.verification);
    const tokenLimit = await checkRateLimitAsync('offboard-verification-token-check', {
      maxRequests: 10,
      windowMs: 60 * 60 * 1000,
      identifier: token || 'no-token',
    });

    if (!ipLimit.success || !tokenLimit.success) {
      return NextResponse.json(
        { error: 'Too many verification attempts. Please try again later.' },
        { status: 429 }
      );
    }

    if (!token) {
      return NextResponse.json({ error: 'Invalid verification link' }, { status: 400 });
    }

    const recipient = await getOffboardRecipientVerificationContext(token);

    return NextResponse.json({
      valid: true,
      alreadyVerified: recipient.alreadyVerified,
    });
  } catch (error) {
    if (isRateLimitUnavailable(error)) {
      return NextResponse.json(
        { error: 'This service is temporarily unavailable. Please try again later.' },
        { status: 503 }
      );
    }

    return NextResponse.json(
      { error: getPublicOffboardErrorMessage(error, 'Failed to validate verification link') },
      { status: 400 }
    );
  }
}

function getPublicOffboardErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) {
    return fallback;
  }

  if (
    error.message === 'Invalid or expired verification link' ||
    error.message === 'This verification link has expired' ||
    error.message === 'This account can no longer be verified because enforcement has started or completed'
  ) {
    return error.message;
  }

  appLogger.error('Unexpected offboard verification error', error);
  return fallback;
}

export async function POST(request: NextRequest) {
  try {
    const clientIp = getRequiredClientIp(request);
    const token = request.nextUrl.searchParams.get('token');

    const ipLimit = await checkRateLimitAsync(clientIp, RateLimitPresets.verification);
    const tokenLimit = await checkRateLimitAsync('offboard-verification-token', {
      maxRequests: OFFBOARD_PASSWORD_CHANGE_TOKEN_ATTEMPTS,
      windowMs: 60 * 60 * 1000,
      identifier: token || 'no-token',
    });

    if (!ipLimit.success || !tokenLimit.success) {
      return NextResponse.json(
        { error: 'Too many verification attempts. Please try again later.' },
        { status: 429 }
      );
    }

    if (!token) {
      return NextResponse.json({ error: 'Invalid verification link' }, { status: 400 });
    }

    const { currentPassword, newPassword } = await parseJsonWithLimit<ConfirmAccessBody>(
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

    const recipient = await getOffboardRecipientVerificationContext(token);

    if (recipient.alreadyVerified) {
      return NextResponse.json({ message: 'Continued access already confirmed' });
    }

    const passwordValidation = validatePasswordPolicy(newPassword, {
      username: recipient.adUsername,
      email: recipient.email,
      fullName: recipient.displayName,
    });

    if (!passwordValidation.isValid) {
      return NextResponse.json(
        { error: 'Password does not meet requirements', issues: passwordValidation.issues },
        { status: 400 }
      );
    }

    try {
      await changeLDAPUserPasswordWithCurrentPassword(
        recipient.adUsername,
        currentPassword,
        newPassword,
        recipient.adDn
      );
    } catch (passwordError) {
      const errorMessage = passwordError instanceof Error ? passwordError.message : '';
      appLogger.warn('Offboard password change rejected by Active Directory', {
        recipientId: recipient.recipientId,
        adUsername: recipient.adUsername,
        error: errorMessage || 'Unknown error',
      });

      const publicMessage = errorMessage.includes('Current password was not accepted')
        ? 'Current password was not accepted by Active Directory.'
        : errorMessage.includes('Active Directory rejected the new password')
          ? 'Active Directory rejected the new password. It may not meet complexity requirements or may match a previous password.'
          : 'Unable to update password. Please try again or contact support.';

      return NextResponse.json(
        { error: publicMessage },
        { status: 400 }
      );
    }

    await verifyOffboardRecipientToken(
      token,
      clientIp,
      request.headers.get('user-agent') || undefined
    );

    return NextResponse.json({ message: 'Continued access confirmed' });
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

    return NextResponse.json(
      { error: getPublicOffboardErrorMessage(error, 'Failed to confirm continued access') },
      { status: 400 }
    );
  }
}
