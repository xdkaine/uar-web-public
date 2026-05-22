import { NextRequest, NextResponse } from 'next/server';
import { isUserDomainAdmin } from '@/lib/ldap';
import { checkRateLimitAsync, getClientIp, isRateLimitUnavailable, RateLimitPresets } from '@/lib/ratelimit';
import { getSessionFromCookies, revokeSessionById, clearSession } from '@/lib/session';
import { logAuditAction, AuditActions, categorizeRequest, getIpAddress, getUserAgent } from '@/lib/audit-log';

export interface AdminAuthResult {
  username: string;
}

export async function checkAdminAuthWithRateLimit(
  request: NextRequest
): Promise<{ admin: AdminAuthResult | null; response?: NextResponse }> {
  const clientIp = getClientIp(request);
  const session = await getSessionFromCookies();
  const rateLimitKey = session?.id ? 'admin-session' : clientIp;
  const identifier = session?.id || undefined;

  let rateLimitResult;
  try {
    rateLimitResult = await checkRateLimitAsync(rateLimitKey, {
      ...RateLimitPresets.adminOperations,
      identifier,
    });
  } catch (error) {
    if (isRateLimitUnavailable(error)) {
      return {
        admin: null,
        response: NextResponse.json(
          { error: 'Rate limit service is temporarily unavailable' },
          { status: 503 }
        ),
      };
    }

    throw error;
  }
  
  if (!rateLimitResult.success) {
    return {
      admin: null,
      response: NextResponse.json(
        { 
          error: 'Too many requests. Please try again later.',
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
      ),
    };
  }

  if (!session || !session.isAdmin) {
    const response = NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    clearSession(response);
    return {
      admin: null,
      response,
    };
  }

  const isDomainAdmin = await isUserDomainAdmin(session.username);
  
  if (!isDomainAdmin) {
    const response = NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    await revokeSessionById(session.id);
    clearSession(response);
    return {
      admin: null,
      response,
    };
  }

  try {
    await logAuditAction({
      action: AuditActions.ADMIN_API_REQUEST,
      category: categorizeRequest(request.nextUrl.pathname),
      username: session.username,
      details: {
        method: request.method,
        path: request.nextUrl.pathname,
        query: Object.fromEntries(request.nextUrl.searchParams),
      },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });
  } catch (error) {
    console.error('Failed to log admin API request:', error);
  }

  return {
    admin: { username: session.username },
  };
}

export async function checkAdminAuth(): Promise<AdminAuthResult | null> {
  const session = await getSessionFromCookies();

  if (!session || !session.isAdmin) {
    return null;
  }

  const isDomainAdmin = await isUserDomainAdmin(session.username);
  
  if (!isDomainAdmin) {
    await revokeSessionById(session.id);
    return null;
  }

  return { username: session.username };
}
