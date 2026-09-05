import { NextRequest, NextResponse } from 'next/server';
import { createHash, randomBytes } from 'crypto';
import { prisma } from '@/lib/prisma';
import { sendPasswordResetEmail } from '@/lib/email';
import { appLogger } from '@/lib/logger';
import { getLDAPUserEmail, searchUserByEmail } from '@/lib/ldap';
import { checkRateLimitAsync, getRequiredClientIp, isRateLimitUnavailable, RateLimitPresets } from '@/lib/ratelimit';
import { verifyTurnstileToken } from '@/lib/turnstile';
import { StandardErrors, internalError } from '@/lib/standardErrors';
import { getSessionFromCookies } from '@/lib/session';
import { isJsonBodyError, MAX_REQUEST_BODY_SIZE, parseJsonWithLimit, validateEmail } from '@/lib/validation';
import { logActionHistoryEvent } from '@/lib/action-history';
import { AuditActions, AuditCategories, getUserAgent } from '@/lib/audit-log';

interface PasswordResetRequestBody {
  email?: unknown;
  username?: unknown;
  turnstileToken?: unknown;
}

function rateLimitedResponse(rateLimitResult: {
  limit: number;
  remaining: number;
  reset: number;
}) {
  return NextResponse.json(
    {
      error: StandardErrors.RATE_LIMIT_EXCEEDED,
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

export async function POST(request: NextRequest) {
  try {
    const { email, username, turnstileToken } = await parseJsonWithLimit<PasswordResetRequestBody>(
      request,
      MAX_REQUEST_BODY_SIZE.SMALL
    );

    // Determine if this is a logged-in user request (has username) or non-logged-in (has email)
    let targetEmail: string | null = null;
    const successMessage =
      'If an account exists with this email, you will receive a password reset link.';

    const providedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    const providedUsername = typeof username === 'string' ? username.trim() : '';
    const correlationId = `password-reset-request:${Date.now()}:${randomBytes(4).toString('hex')}`;

    // Apply independent IP and target limits.
    const clientIp = getRequiredClientIp(request);
    const ipRateLimitResult = await checkRateLimitAsync(clientIp, RateLimitPresets.passwordReset);

    if (!ipRateLimitResult.success) {
      return rateLimitedResponse(ipRateLimitResult);
    }

    if (providedUsername) {
      const session = await getSessionFromCookies();

      if (!session) {
        return NextResponse.json({ error: StandardErrors.UNAUTHORIZED }, { status: 401 });
      }

      if (session.username.toLowerCase() !== providedUsername.toLowerCase()) {
        return NextResponse.json({ error: StandardErrors.FORBIDDEN }, { status: 403 });
      }

      const targetRateLimitResult = await checkRateLimitAsync('password-reset-target', {
        maxRequests: 3,
        windowMs: RateLimitPresets.passwordReset.windowMs,
        identifier: session.username.toLowerCase(),
      });

      if (!targetRateLimitResult.success) {
        return rateLimitedResponse(targetRateLimitResult);
      }

      // Logged-in user - get their email from LDAP
      const ldapEmail = await getLDAPUserEmail(session.username);
      if (!ldapEmail) {
        appLogger.warn(
          'LDAP username not found during password reset request',
          { username: session.username }
        );
      } else {
        targetEmail = ldapEmail.trim().toLowerCase();
      }
    } else if (providedEmail) {
      // Verify Turnstile for public requests
      if (typeof turnstileToken !== 'string' || !turnstileToken) {
        return NextResponse.json(
          { error: StandardErrors.TURNSTILE_VALIDATION_FAILED },
          { status: 400 }
        );
      }

      const isTurnstileValid = await verifyTurnstileToken(turnstileToken);
      if (!isTurnstileValid) {
        return NextResponse.json(
          { error: StandardErrors.TURNSTILE_VALIDATION_FAILED },
          { status: 400 }
        );
      }

      // Non-logged-in user - verify email format
      if (!validateEmail(providedEmail)) {
        return NextResponse.json(
          { error: StandardErrors.INVALID_INPUT },
          { status: 400 }
        );
      }

      const targetRateLimitResult = await checkRateLimitAsync('password-reset-target', {
        maxRequests: 3,
        windowMs: RateLimitPresets.passwordReset.windowMs,
        identifier: providedEmail,
      });

      if (!targetRateLimitResult.success) {
        return rateLimitedResponse(targetRateLimitResult);
      }

      targetEmail = providedEmail;
    } else {
      return NextResponse.json(
        { error: StandardErrors.INVALID_INPUT },
        { status: 400 }
      );
    }

    if (!targetEmail) {
      // Return uniform success response even when no matching LDAP user is found
      appLogger.info('Password reset: No target email resolved (invalid input or LDAP lookup failure)', { username: providedUsername, providedEmail });
      await logActionHistoryEvent({
        action: AuditActions.PASSWORD_RESET_DENIED,
        category: AuditCategories.AUTH,
        username: providedUsername || 'anonymous',
        actorType: providedUsername ? 'user' : 'anonymous',
        subjectUsername: providedUsername || null,
        subjectEmail: providedEmail || null,
        eventKind: 'security',
        outcome: 'denied',
        success: true,
        details: { reason: 'no_target_email_resolved' },
        ipAddress: clientIp,
        userAgent: getUserAgent(request),
        correlationId,
      });
      return NextResponse.json({ message: successMessage });
    }

    // Check if the user exists in Active Directory using the email
    // This prevents sending emails to non-existent users (email enumeration/spam prevention)
    const adUser = await searchUserByEmail(targetEmail);
    if (!adUser) {
      // Return uniform success response without logging to avoid notifying the user/logs
      appLogger.info('Password reset: User not found in AD', { email: targetEmail });
      await logActionHistoryEvent({
        action: AuditActions.PASSWORD_RESET_DENIED,
        category: AuditCategories.AUTH,
        username: providedUsername || 'anonymous',
        actorType: providedUsername ? 'user' : 'anonymous',
        subjectUsername: providedUsername || null,
        subjectEmail: targetEmail,
        eventKind: 'security',
        outcome: 'denied',
        success: true,
        details: { reason: 'ad_user_not_found' },
        ipAddress: clientIp,
        userAgent: getUserAgent(request),
        correlationId,
      });
      return NextResponse.json({ message: successMessage });
    }

    // Check account status before sending reset email
    const accessRequest = await prisma.accessRequest.findFirst({
      where: { email: targetEmail.toLowerCase() },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        status: true,
        accountExpiresAt: true,
        rejectionReason: true,
        ldapUsername: true,
        linkedAdUsername: true,
      },
    });

    // If account exists, validate its status
    if (accessRequest) {
      // For reconnaissance resistance, never reveal account status to callers.
      // Only approved accounts can receive reset links; all other states return
      // the same generic response to avoid account/user enumeration.
      const status = accessRequest.status;
      const isExpired = accessRequest.accountExpiresAt && accessRequest.accountExpiresAt < new Date();

      if (
        status === 'rejected' ||
        status === 'pending_verification' ||
        status === 'pending_student_directors' ||
        status === 'pending_faculty' ||
        status !== 'approved' ||
        isExpired
      ) {
        appLogger.info('Password reset: Account status invalid or expired', { email: targetEmail, status, isExpired });
        await logActionHistoryEvent({
          action: AuditActions.PASSWORD_RESET_DENIED,
          category: AuditCategories.AUTH,
          username: providedUsername || 'anonymous',
          actorType: providedUsername ? 'user' : 'anonymous',
          targetId: accessRequest.id,
          targetType: 'AccessRequest',
          subjectUsername: accessRequest.ldapUsername || accessRequest.linkedAdUsername || providedUsername || null,
          subjectEmail: targetEmail,
          relatedRequestId: accessRequest.id,
          eventKind: 'security',
          outcome: 'denied',
          success: true,
          details: { reason: 'account_status_not_resettable', status, isExpired },
          ipAddress: clientIp,
          userAgent: getUserAgent(request),
          correlationId,
        });
        return NextResponse.json({ message: successMessage });
      }
    }

    // Invalidate any existing unused tokens for this email
    // This prevents multiple valid tokens from existing simultaneously
    await prisma.passwordResetToken.updateMany({
      where: {
        email: targetEmail,
        used: false,
        expiresAt: {
          gt: new Date(), // Only invalidate tokens that haven't expired yet
        },
      },
      data: {
        used: true,
        usedAt: new Date(),
      },
    });

    // Generate a secure token
    const resetToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(resetToken).digest('hex');

    // Token expires in 1 hour
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    // Store the token in the database
    await prisma.passwordResetToken.create({
      data: {
        email: targetEmail,
        tokenHash,
        expiresAt,
      },
    });

    // Send the reset email
    await sendPasswordResetEmail(targetEmail, resetToken);

    await logActionHistoryEvent({
      action: AuditActions.PASSWORD_RESET_LINK_SENT,
      category: AuditCategories.AUTH,
      username: providedUsername || 'anonymous',
      actorType: providedUsername ? 'user' : 'anonymous',
      targetId: accessRequest?.id,
      targetType: accessRequest ? 'AccessRequest' : 'User',
      subjectUsername: accessRequest?.ldapUsername || accessRequest?.linkedAdUsername || providedUsername || null,
      subjectEmail: targetEmail,
      relatedRequestId: accessRequest?.id,
      eventKind: 'notification',
      outcome: 'success',
      success: true,
      details: { expiresAt: expiresAt.toISOString(), initiatedBy: providedUsername ? 'self_service' : 'public_request' },
      ipAddress: clientIp,
      userAgent: getUserAgent(request),
      correlationId,
    });

    // Return success without revealing if the email exists
    return NextResponse.json({ message: successMessage });
  } catch (error) {
    if (isJsonBodyError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }

    if (isRateLimitUnavailable(error)) {
      return NextResponse.json(
        { error: StandardErrors.SERVICE_UNAVAILABLE },
        { status: 503 }
      );
    }

    return internalError(error, 'Password Reset Request');
  }
}
