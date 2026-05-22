import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { prisma } from '@/lib/prisma';
import { setLDAPUserPassword } from '@/lib/ldap';
import { validatePasswordPolicy } from '@/lib/password-policy';
import { checkRateLimitAsync, getRequiredClientIp, isRateLimitUnavailable, RateLimitPresets } from '@/lib/ratelimit';
import { sendAccountActivationSuccessEmail } from '@/lib/email';
import { appLogger } from '@/lib/logger';
import { parseJsonWithLimit, MAX_REQUEST_BODY_SIZE, isJsonBodyError } from '@/lib/validation';
import { logActionHistoryEvent } from '@/lib/action-history';
import { AuditActions, AuditCategories, getUserAgent } from '@/lib/audit-log';

const MAX_TOKEN_ATTEMPTS = 5;

type ActivationAccessRequest = {
  id: string;
  email: string;
  name: string;
  ldapUsername: string | null;
  isInternal: boolean;
  status: string;
};

type ActivationTransactionResult =
  | {
      ok: true;
      accessRequest: ActivationAccessRequest;
      tokenId: string;
      usedAt: Date;
    }
  | {
      ok: false;
      reason: string;
      issues?: string[];
    };

export async function POST(request: NextRequest) {
  try {
    const { token, username, newPassword } = await parseJsonWithLimit<{
      token?: string;
      username?: string;
      newPassword?: string
    }>(request, MAX_REQUEST_BODY_SIZE.SMALL);

    // Apply rate limiting: 5 attempts per hour per IP/User to prevent token brute forcing
    // We use the username as identifier so shared IPs (NAT) don't block each other
    const clientIp = getRequiredClientIp(request);
    const rateLimitResult = await checkRateLimitAsync(clientIp, {
      maxRequests: 5,
      windowMs: RateLimitPresets.passwordReset.windowMs,
      identifier: typeof username === 'string' ? username.trim() : undefined // Add username to unique key
    });

    if (!rateLimitResult.success) {
      return NextResponse.json(
        {
          error: 'Too many activation attempts. Please try again later.',
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

    if (
      typeof token !== 'string' ||
      typeof username !== 'string' ||
      typeof newPassword !== 'string' ||
      !token ||
      !username.trim() ||
      !newPassword
    ) {
      return NextResponse.json(
        { error: 'Token, username, and password are required' },
        { status: 400 }
      );
    }

    const requestedUsername = username.trim();
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const correlationId = `account-activation:${Date.now()}:${tokenHash.substring(0, 8)}`;

    // ATOMIC: Use transaction to fetch and validate token, then mark as used
    let accessRequest: ActivationAccessRequest;
    let consumedToken: { id: string; usedAt: Date };

    try {
      const now = new Date();

      const result = await prisma.$transaction(async (tx: Prisma.TransactionClient): Promise<ActivationTransactionResult> => {
        // Fetch the token first within transaction
        const tokenData = await tx.accountActivationToken.findUnique({
          where: { tokenHash },
          include: {
            accessRequest: {
              select: {
                id: true,
                email: true,
                name: true,
                ldapUsername: true,
                isInternal: true,
                status: true,
              },
            },
          },
        });

        // Validate token exists
        if (!tokenData) {
          return { ok: false, reason: 'INVALID_TOKEN' };
        }

        // Validate token state
        if (tokenData.used) {
          return { ok: false, reason: 'TOKEN_ALREADY_USED' };
        }

        if (tokenData.attempts >= MAX_TOKEN_ATTEMPTS) {
          return { ok: false, reason: 'TOO_MANY_ATTEMPTS' };
        }

        if (tokenData.expiresAt <= now) {
          return { ok: false, reason: 'TOKEN_EXPIRED' };
        }

        // Validate username matches the access request
        if (
          !tokenData.accessRequest.ldapUsername ||
          tokenData.accessRequest.ldapUsername.toLowerCase() !== requestedUsername.toLowerCase()
        ) {
          // Increment attempts but don't mark as used - wrong username
          await tx.accountActivationToken.updateMany({
            where: {
              id: tokenData.id,
              tokenHash,
              used: false,
              attempts: { lt: MAX_TOKEN_ATTEMPTS },
              expiresAt: { gt: now },
            },
            data: {
              attempts: { increment: 1 },
            },
          });
          return { ok: false, reason: 'USERNAME_MISMATCH' };
        }

        // Validate request is for internal user (security check)
        if (!tokenData.accessRequest.isInternal) {
          return { ok: false, reason: 'INVALID_USER_TYPE' };
        }

        // Validate request status is approved
        if (tokenData.accessRequest.status !== 'approved') {
          return { ok: false, reason: 'REQUEST_NOT_APPROVED' };
        }

        const passwordValidation = validatePasswordPolicy(newPassword, {
          username: tokenData.accessRequest.ldapUsername,
          email: tokenData.accessRequest.email,
          fullName: tokenData.accessRequest.name,
        });

        if (!passwordValidation.isValid) {
          return {
            ok: false,
            reason: 'PASSWORD_POLICY',
            issues: passwordValidation.issues,
          };
        }

        const usedAt = now;

        // Mark token as used with a conditional update so concurrent submits cannot both consume it.
        const consumeResult = await tx.accountActivationToken.updateMany({
          where: {
            id: tokenData.id,
            tokenHash,
            used: false,
            attempts: { lt: MAX_TOKEN_ATTEMPTS },
            expiresAt: { gt: now },
          },
          data: {
            attempts: { increment: 1 },
            used: true,
            usedAt,
            ipAddress: clientIp,
            userAgent: request.headers.get('user-agent') || undefined,
          },
        });

        if (consumeResult.count !== 1) {
          return { ok: false, reason: 'TOKEN_CONSUME_CONFLICT' };
        }

        // Clear any legacy encrypted password from the access request
        await tx.accessRequest.update({
          where: { id: tokenData.accessRequestId },
          data: {
            accountPassword: null,
          },
        });

        return {
          ok: true,
          accessRequest: tokenData.accessRequest,
          tokenId: tokenData.id,
          usedAt,
        };
      }, {
        isolationLevel: 'Serializable', // Prevent race conditions
        timeout: 10000,
      });

      if (!result.ok) {
        if (result.reason === 'PASSWORD_POLICY') {
          await logActionHistoryEvent({
            action: AuditActions.ACCOUNT_ACTIVATION_FAILED,
            category: AuditCategories.AUTH,
            username: requestedUsername,
            actorType: 'user',
            subjectUsername: requestedUsername,
            eventKind: 'security',
            outcome: 'denied',
            success: false,
            details: { reason: result.reason, issueCount: result.issues?.length || 0 },
            ipAddress: clientIp,
            userAgent: getUserAgent(request),
            correlationId,
          });
          return NextResponse.json(
            { error: 'Password does not meet requirements', issues: result.issues || [] },
            { status: 400 }
          );
        }

        appLogger.warn('Account activation failed', {
          errorType: result.reason,
          timestamp: new Date().toISOString(),
          ip: clientIp,
          username: requestedUsername
        });
        console.error('[Account Activation] Error processing token:', result.reason);

        await logActionHistoryEvent({
          action: AuditActions.ACCOUNT_ACTIVATION_FAILED,
          category: AuditCategories.AUTH,
          username: requestedUsername,
          actorType: 'user',
          subjectUsername: requestedUsername,
          eventKind: 'security',
          outcome: 'denied',
          success: false,
          details: { reason: result.reason },
          ipAddress: clientIp,
          userAgent: getUserAgent(request),
          correlationId,
        });

        return NextResponse.json(
          {
            error: 'Invalid or expired activation link. Please contact IT support if you continue to have issues.',
          },
          { status: 400 }
        );
      }

      accessRequest = result.accessRequest;
      consumedToken = {
        id: result.tokenId,
        usedAt: result.usedAt,
      };
    } catch (error) {
      // Log specific error for debugging (not exposed to user)
      if (error instanceof Error) {
        appLogger.warn('Account activation failed', {
          errorType: error.message,
          timestamp: new Date().toISOString(),
          ip: clientIp,
          username: username
        });
        console.error('[Account Activation] Error processing token:', error.message);

        await logActionHistoryEvent({
          action: AuditActions.ACCOUNT_ACTIVATION_FAILED,
          category: AuditCategories.AUTH,
          username: username || 'anonymous',
          actorType: username ? 'user' : 'anonymous',
          subjectUsername: typeof username === 'string' ? username : null,
          eventKind: 'security',
          outcome: 'failure',
          success: false,
          errorMessage: error.message,
          details: { reason: 'activation_transaction_error' },
          ipAddress: clientIp,
          userAgent: getUserAgent(request),
          correlationId,
        });

        // Return specific error messages for certain cases
        // Return generic error message for all validation failures to prevent enumeration
        // Specific errors are already logged above
        return NextResponse.json(
          {
            error: 'Invalid or expired activation link. Please contact IT support if you continue to have issues.',
          },
          { status: 400 }
        );
      }

      // Return uniform error for other cases to prevent token enumeration
      return NextResponse.json(
        {
          error: 'Invalid or expired activation link. Please contact IT support if you continue to have issues.',
        },
        { status: 400 }
      );
    }

    // Set password in Active Directory
    try {
      await setLDAPUserPassword(accessRequest.ldapUsername!, newPassword);
      // Password operation completed - details logged by ldapLogger
    } catch (ldapError) {
      console.error('[Account Activation] ❌ Failed to set password in AD:', ldapError);

      const errorMessage = ldapError instanceof Error ? ldapError.message : 'Unknown error';

      appLogger.error('Failed to set password in AD during activation', {
        username: accessRequest.ldapUsername,
        error: errorMessage,
        timestamp: new Date().toISOString(),
      });

      // Mark token as unused so user can retry. Only roll back this exact token attempt.
      await prisma.accountActivationToken.updateMany({
        where: {
          id: consumedToken.id,
          tokenHash,
          used: true,
          usedAt: consumedToken.usedAt,
          attempts: { gt: 0 },
        },
        data: {
          used: false,
          usedAt: null,
          attempts: { decrement: 1 },
        },
      });

      await logActionHistoryEvent({
        action: AuditActions.ACCOUNT_ACTIVATION_TOKEN_ROLLED_BACK,
        category: AuditCategories.AUTH,
        username: accessRequest.ldapUsername || requestedUsername,
        actorType: 'user',
        targetId: accessRequest.id,
        targetType: 'AccessRequest',
        subjectUsername: accessRequest.ldapUsername,
        subjectEmail: accessRequest.email,
        relatedRequestId: accessRequest.id,
        eventKind: 'security',
        outcome: 'rollback',
        success: false,
        errorMessage,
        details: { reason: 'ldap_password_set_failed' },
        ipAddress: clientIp,
        userAgent: getUserAgent(request),
        correlationId,
      });

      // Provide more specific error messages for known LDAP issues
      let clientErrorMessage = 'Failed to set password in Active Directory. Please try again.';

      if (errorMessage.includes('WILL_NOT_PERFORM') || errorMessage.includes('constraint violation')) {
        clientErrorMessage = 'Password was rejected by Active Directory. It may match a previous password or a directory-only rule. Please choose a different password and try again.';
      } else if (errorMessage.includes('data 532') || errorMessage.includes('data 533')) {
        // 532 = password expired, 533 = account disabled - shouldn't happen here usually but good to handle
        clientErrorMessage = 'Account status prevents password change. Please contact support.';
      }

      return NextResponse.json(
        { error: clientErrorMessage, details: process.env.NODE_ENV === 'development' ? errorMessage : undefined },
        { status: 400 } // Use 400 for validation-like errors from AD
      );
    }

    // Send confirmation email
    let confirmationEmailSent = true;
    try {
      await sendAccountActivationSuccessEmail(
        accessRequest.email,
        accessRequest.name,
        accessRequest.ldapUsername!
      );
      console.log('[Account Activation] ✅ Confirmation email sent to:', accessRequest.email);
    } catch (emailError) {
      confirmationEmailSent = false;
      console.error('[Account Activation] ⚠️ Failed to send confirmation email:', emailError);
      // Don't fail the request if email fails - password was set successfully
    }

    // Log success
    appLogger.info('Account password set via activation link', {
      username: accessRequest.ldapUsername,
      email: accessRequest.email,
      ip: clientIp,
      timestamp: new Date().toISOString(),
    });

    await logActionHistoryEvent({
      action: AuditActions.ACCOUNT_ACTIVATION_COMPLETED,
      category: AuditCategories.AUTH,
      username: accessRequest.ldapUsername || requestedUsername,
      actorType: 'user',
      targetId: accessRequest.id,
      targetType: 'AccessRequest',
      subjectUsername: accessRequest.ldapUsername,
      subjectEmail: accessRequest.email,
      relatedRequestId: accessRequest.id,
      eventKind: 'security',
      outcome: 'success',
      success: true,
      details: { confirmationEmailSent },
      ipAddress: clientIp,
      userAgent: getUserAgent(request),
      correlationId,
    });

    return NextResponse.json({
      success: true,
      message: 'Password set successfully. You can now log in with your credentials.',
    });
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

    console.error('[Account Activation] Unexpected error:', error);

    appLogger.error('Account activation unexpected error', {
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    });

    return NextResponse.json(
      { error: 'An unexpected error occurred. Please try again or contact IT support.' },
      { status: 500 }
    );
  }
}
