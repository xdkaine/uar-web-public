import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { prisma } from '@/lib/prisma';
import { changeLDAPUserPassword, searchLDAPUser } from '@/lib/ldap';
import { validatePasswordStrength } from '@/lib/password';
import { checkRateLimitAsync, getRequiredClientIp, isRateLimitUnavailable, RateLimitPresets } from '@/lib/ratelimit';
import { appLogger } from '@/lib/logger';
import { parseJsonWithLimit, MAX_REQUEST_BODY_SIZE, isJsonBodyError } from '@/lib/validation';
import { logActionHistoryEvent } from '@/lib/action-history';
import { AuditActions, AuditCategories, getUserAgent } from '@/lib/audit-log';

const MAX_TOKEN_ATTEMPTS = 5;

export async function POST(request: NextRequest) {
  try {
    // Apply rate limiting: 3 attempts per hour per IP to prevent token brute forcing
    const clientIp = getRequiredClientIp(request);
    const rateLimitResult = await checkRateLimitAsync(clientIp, RateLimitPresets.passwordReset);
    
    if (!rateLimitResult.success) {
      return NextResponse.json(
        { 
          error: 'Too many password reset attempts. Please try again later.',
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
    
    const { token, newPassword } = await parseJsonWithLimit<{ token?: string; newPassword?: string }>(request, MAX_REQUEST_BODY_SIZE.SMALL);

    if (!token || !newPassword) {
      return NextResponse.json(
        { error: 'Token and new password are required' },
        { status: 400 }
      );
    }

    // Validate password strength
    const passwordValidation = validatePasswordStrength(newPassword);
    if (!passwordValidation.isValid) {
      return NextResponse.json(
        { error: 'Password does not meet requirements', issues: passwordValidation.issues },
        { status: 400 }
      );
    }

    const tokenHash = createHash('sha256').update(token).digest('hex');
    const correlationId = `password-reset:${Date.now()}:${tokenHash.substring(0, 8)}`;

    // ATOMIC: Use transaction to fetch and mark token as used atomically
    // This prevents TOCTOU race conditions and ensures data consistency
    let resetToken;
    try {
      const now = new Date();
      
      resetToken = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        // Fetch the token first within transaction
        const tokenData = await tx.passwordResetToken.findUnique({
          where: { tokenHash },
        });

        // Validate token exists
        if (!tokenData) {
          throw new Error('INVALID_TOKEN');
        }

        // Validate token state
        if (tokenData.used) {
          throw new Error('TOKEN_ALREADY_USED');
        }

        if (tokenData.attempts >= MAX_TOKEN_ATTEMPTS) {
          throw new Error('TOO_MANY_ATTEMPTS');
        }

        if (tokenData.expiresAt <= now) {
          throw new Error('TOKEN_EXPIRED');
        }

        // Mark token as used atomically in same transaction
        await tx.passwordResetToken.update({
          where: { tokenHash },
          data: {
            attempts: { increment: 1 },
            used: true,
            usedAt: now,
          },
        });

        return tokenData;
      }, {
        isolationLevel: 'Serializable', // Prevent race conditions
        timeout: 10000,
      });
    } catch (error) {
      // Log specific error for debugging (not exposed to user)
      if (error instanceof Error) {
        appLogger.warn('Password reset failed', { 
          errorType: error.message,
          timestamp: new Date().toISOString(),
          ip: clientIp
        });
        console.error('[Password Reset] Error processing token:', error.message);
        await logActionHistoryEvent({
          action: AuditActions.PASSWORD_RESET_TOKEN_INVALID,
          category: AuditCategories.AUTH,
          username: 'anonymous',
          actorType: 'anonymous',
          eventKind: 'security',
          outcome: 'denied',
          success: false,
          details: { reason: error.message, tokenPresent: true },
          ipAddress: clientIp,
          userAgent: getUserAgent(request),
          correlationId,
        });
      } else {
        console.error('[Password Reset] Error processing token:', error);
        await logActionHistoryEvent({
          action: AuditActions.PASSWORD_RESET_TOKEN_INVALID,
          category: AuditCategories.AUTH,
          username: 'anonymous',
          actorType: 'anonymous',
          eventKind: 'security',
          outcome: 'denied',
          success: false,
          details: { reason: 'unknown_token_error', tokenPresent: true },
          ipAddress: clientIp,
          userAgent: getUserAgent(request),
          correlationId,
        });
      }
      
      // Return uniform error to prevent token enumeration
      // All error conditions return the same message to prevent attackers from
      // determining token state (expired, used, invalid, etc.)
      return NextResponse.json(
        { 
          error: 'Invalid or expired reset token. Please request a new password reset link.',
        },
        { status: 400 }  // Consistent status code for all errors
      );
    }

    // Get email from token data
    const email = resetToken.email;
    let username: string | null = null;
    let userDN: string | null = null;

    try {
      const { Client } = await import('ldapts');
      const { escapeLDAPFilter } = await import('@/lib/ldap');
      
      const ldapUrl = process.env.LDAP_URL || '';
      const client = new Client({
        url: ldapUrl,
        tlsOptions: ldapUrl.startsWith('ldaps://') ? {
          rejectUnauthorized: false,
        } : undefined,
      });
      
      try {
        await client.bind(
          process.env.LDAP_BIND_DN || '',
          process.env.LDAP_BIND_PASSWORD || ''
        );

        const opts = {
          filter: `(mail=${escapeLDAPFilter(email)})`,
          scope: 'sub' as const,
          attributes: ['sAMAccountName', 'distinguishedName'],
        };

        const { searchEntries } = await client.search(process.env.LDAP_SEARCH_BASE || '', opts);

        if (searchEntries.length === 0) {
          await logActionHistoryEvent({
            action: AuditActions.PASSWORD_RESET_DENIED,
            category: AuditCategories.AUTH,
            username: 'anonymous',
            actorType: 'anonymous',
            subjectEmail: email,
            eventKind: 'security',
            outcome: 'denied',
            success: false,
            details: { reason: 'ldap_email_not_found' },
            ipAddress: clientIp,
            userAgent: getUserAgent(request),
            correlationId,
          });
          return NextResponse.json(
            { error: 'No account found with this email address' },
            { status: 404 }
          );
        }

        username = String(searchEntries[0].sAMAccountName || '');
        userDN = String(searchEntries[0].distinguishedName || searchEntries[0].dn || '');
        
        // Log without exposing DN for security (DN reveals directory structure)
        appLogger.info('Password reset: User found in LDAP', {
          username,
          dnHash: createHash('sha256').update(userDN).digest('hex').substring(0, 8)
        });
      } finally {
        try {
          await client.unbind();
        } catch {
        }
      }
    } catch (error) {
      console.error('[Password Reset] Error searching LDAP:', error);
      return NextResponse.json(
        { error: 'Failed to find user account' },
        { status: 500 }
      );
    }

    if (!username || !userDN) {
      await logActionHistoryEvent({
        action: AuditActions.PASSWORD_RESET_DENIED,
        category: AuditCategories.AUTH,
        username: 'anonymous',
        actorType: 'anonymous',
        subjectEmail: email,
        eventKind: 'security',
        outcome: 'denied',
        success: false,
        details: { reason: 'missing_ldap_username_or_dn' },
        ipAddress: clientIp,
        userAgent: getUserAgent(request),
        correlationId,
      });
      return NextResponse.json(
        { error: 'No account found with this email address' },
        { status: 404 }
      );
    }

    // Verify user exists in LDAP
    const userInfo = await searchLDAPUser(username);
    if (!userInfo) {
      await logActionHistoryEvent({
        action: AuditActions.PASSWORD_RESET_DENIED,
        category: AuditCategories.AUTH,
        username,
        actorType: 'user',
        subjectUsername: username,
        subjectEmail: email,
        eventKind: 'security',
        outcome: 'denied',
        success: false,
        details: { reason: 'ldap_user_not_found' },
        ipAddress: clientIp,
        userAgent: getUserAgent(request),
        correlationId,
      });
      return NextResponse.json(
        { error: 'User account not found in directory' },
        { status: 404 }
      );
    }

    // Change the password in LDAP using the actual DN
    try {
      await changeLDAPUserPassword(username, newPassword, userDN);
      appLogger.info('Password reset: Successfully changed password', { username });
    } catch (error) {
      appLogger.error('Password reset: Error changing password', error, { username });

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // CRITICAL: If password change fails, we need to rollback the token usage
      // This ensures users can retry with the same token if the LDAP operation fails
      try {
        await prisma.passwordResetToken.update({
          where: { tokenHash },
          data: {
            used: false,
            usedAt: null,
          },
        });
        appLogger.info('Password reset: Token usage rolled back due to password change failure', { username });
        await logActionHistoryEvent({
          action: AuditActions.PASSWORD_RESET_TOKEN_ROLLED_BACK,
          category: AuditCategories.AUTH,
          username,
          actorType: 'user',
          subjectUsername: username,
          subjectEmail: email,
          eventKind: 'security',
          outcome: 'rollback',
          success: false,
          errorMessage,
          details: { reason: 'ldap_password_change_failed' },
          ipAddress: clientIp,
          userAgent: getUserAgent(request),
          correlationId,
        });
      } catch (rollbackError) {
        console.error('[Password Reset] Failed to rollback token:', rollbackError);
        // Log but don't fail the response - user needs to request new token
      }

      // Provide more specific error messages for known LDAP issues
      let clientErrorMessage = 'Failed to change password. Please try again or contact IT support.';

      if (errorMessage.includes('WILL_NOT_PERFORM') || errorMessage.includes('constraint violation')) {
        clientErrorMessage = 'Password was rejected by Active Directory. It may not meet complexity requirements or matches previous passwords.';
      } else if (errorMessage.includes('data 532') || errorMessage.includes('data 533')) {
        clientErrorMessage = 'Account status prevents password change. Please contact support.';
      }

      return NextResponse.json(
        { error: clientErrorMessage, details: process.env.NODE_ENV === 'development' ? errorMessage : undefined },
        { status: 400 }
      );
    }

    // Token is already marked as used (atomically at the beginning)
    // Password has been successfully changed
    const relatedRequest = await prisma.accessRequest.findFirst({
      where: { email: email.toLowerCase() },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });

    await logActionHistoryEvent({
      action: AuditActions.PASSWORD_RESET_COMPLETED,
      category: AuditCategories.AUTH,
      username,
      actorType: 'user',
      targetId: relatedRequest?.id,
      targetType: relatedRequest ? 'AccessRequest' : 'User',
      subjectUsername: username,
      subjectEmail: email,
      relatedRequestId: relatedRequest?.id,
      eventKind: 'security',
      outcome: 'success',
      success: true,
      details: { method: 'reset_link' },
      ipAddress: clientIp,
      userAgent: getUserAgent(request),
      correlationId,
    });

    return NextResponse.json({
      message: 'Password has been successfully reset',
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

    console.error('[Password Reset] Error:', error);
    return NextResponse.json(
      { error: 'Failed to reset password' },
      { status: 500 }
    );
  }
}

// GET endpoint to verify if a token is valid (for showing the reset form)
export async function GET(request: NextRequest) {
  try {
    const token = request.nextUrl.searchParams.get('token');

    if (!token) {
      return NextResponse.json(
        { error: 'Token is required' },
        { status: 400 }
      );
    }

    const tokenHash = createHash('sha256').update(token).digest('hex');

    const resetToken = await prisma.passwordResetToken.findUnique({
      where: { tokenHash },
    });

    if (!resetToken) {
      return NextResponse.json(
        { valid: false, error: 'Invalid token' },
        { status: 404 }
      );
    }

    if (resetToken.used) {
      return NextResponse.json(
        { valid: false, error: 'Token has already been used' },
        { status: 400 }
      );
    }

    if (resetToken.attempts >= MAX_TOKEN_ATTEMPTS) {
      return NextResponse.json(
        { valid: false, error: 'Token has exceeded the maximum number of verification attempts' },
        { status: 400 }
      );
    }

    if (new Date() > resetToken.expiresAt) {
      return NextResponse.json(
        { valid: false, error: 'Token has expired' },
        { status: 400 }
      );
    }

    return NextResponse.json({
      valid: true,
      email: resetToken.email,
    });
  } catch (error) {
    console.error('[Password Reset Verify] Error:', error);
    return NextResponse.json(
      { error: 'Failed to verify token' },
      { status: 500 }
    );
  }
}
