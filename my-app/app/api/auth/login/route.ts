import { NextRequest, NextResponse } from 'next/server';
import { authenticateLDAP, searchLDAPUser, isUserDomainAdmin, isPasswordChangeRequiredAuthStatus } from '@/lib/ldap';
import { checkRateLimitAsync, getRequiredClientIp, isRateLimitUnavailable, RateLimitPresets } from '@/lib/ratelimit';
import { establishSessionOnResponse } from '@/lib/session';
import { parseJsonWithLimit, MAX_REQUEST_BODY_SIZE, isJsonBodyError } from '@/lib/validation';
import { prisma } from '@/lib/prisma';
import { verifyTurnstileToken } from '@/lib/turnstile';
import { StandardErrors, authenticationError } from '@/lib/standardErrors';
import { appLogger } from '@/lib/logger';
import { AuditActions, AuditCategories, logAuditAction } from '@/lib/audit-log';
import {
  attachPasswordChangeChallengeCookie,
  createPasswordChangeChallenge,
  type PasswordChangeChallengeReason,
} from '@/lib/password-change-challenge';

function toPasswordChangeChallengeReason(status: string): PasswordChangeChallengeReason {
  return status === 'password_expired' ? 'password_expired' : 'password_change_required';
}

async function logAuthAudit(entry: Parameters<typeof logAuditAction>[0]) {
  try {
    await logAuditAction(entry);
  } catch (auditError) {
    appLogger.error('Failed to log auth audit action:', undefined, { error: auditError });
  }
}

export async function POST(request: NextRequest) {
  try {
    // Check if logins are disabled
    const settings = await prisma.systemSettings.findFirst({
      orderBy: { createdAt: 'desc' },
    });

    if (settings?.loginDisabled) {
      return NextResponse.json(
        { error: StandardErrors.SERVICE_UNAVAILABLE },
        { status: 503 }
      );
    }

    // Apply rate limiting: 5 attempts per 15 minutes per IP
    const clientIp = getRequiredClientIp(request);
    const rateLimitResult = await checkRateLimitAsync(clientIp, RateLimitPresets.login);
    
    if (!rateLimitResult.success) {
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
    
    const body = await parseJsonWithLimit<{ username?: string; password?: string; turnstileToken?: string }>(request, MAX_REQUEST_BODY_SIZE.SMALL);
    const { username, password, turnstileToken } = body;

    if (!turnstileToken) {
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

    if (!username || !password) {
      return NextResponse.json(
        { error: StandardErrors.INVALID_INPUT },
        { status: 400 }
      );
    }

    const requestedUsername = username.trim();
    const ipAddress = clientIp === 'unknown' ? undefined : clientIp;
    const userAgent = request.headers.get('user-agent') || undefined;

    const authResult = await authenticateLDAP(requestedUsername, password);

    if (!authResult.success) {
      if (isPasswordChangeRequiredAuthStatus(authResult.status)) {
        const reason = toPasswordChangeChallengeReason(authResult.status);
        const challenge = await createPasswordChangeChallenge({
          username: requestedUsername,
          reason,
          ipAddress,
          userAgent,
        });

        await logAuthAudit({
          action: AuditActions.PASSWORD_CHANGE_REQUIRED,
          category: AuditCategories.AUTH,
          username: requestedUsername,
          details: {
            method: 'LDAP',
            reason,
          },
          ipAddress,
          userAgent,
        });

        const response = NextResponse.json(
          {
            action: 'PASSWORD_CHANGE_REQUIRED',
            reason,
            message: 'Your account requires a new password before sign in can continue.',
          },
          { status: 409 }
        );

        attachPasswordChangeChallengeCookie(response, challenge.token, challenge.expiresAt);
        return response;
      }

      // Log detailed error server-side only
      appLogger.error('[Login] Authentication failed:', undefined, {
        username: requestedUsername, // Safe to log username for audit purposes
        error: authResult.error,
        status: authResult.status,
        timestamp: new Date().toISOString(),
        ip: clientIp,
      });
      
      // Return generic error to client - don't reveal if user exists or password is wrong
      return NextResponse.json(
        { error: StandardErrors.INVALID_CREDENTIALS },
        { status: 401 }
      );
    }

    const userInfo = await searchLDAPUser(requestedUsername);
    const isDomainAdmin = await isUserDomainAdmin(requestedUsername);

    const response = NextResponse.json(
      {
        message: 'Authentication successful',
        user: {
          username: requestedUsername,
          email: userInfo?.attributes?.find(attr => attr.type === 'mail')?.values?.[0] || '',
          name: userInfo?.attributes?.find(attr => attr.type === 'cn')?.values?.[0] || requestedUsername,
        },
        isAdmin: isDomainAdmin,
      },
      { status: 200 }
    );

    // Log successful login
    await logAuthAudit({
      action: AuditActions.LOGIN_SUCCESS,
      category: AuditCategories.AUTH,
      username: requestedUsername,
      details: {
        method: 'LDAP',
        isAdmin: isDomainAdmin,
      },
      ipAddress,
      userAgent,
    });

    await establishSessionOnResponse(response, requestedUsername, isDomainAdmin, ipAddress, userAgent);

    return response;
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

    // Log detailed error information server-side
    return authenticationError(error, 'Login');
  }
}
