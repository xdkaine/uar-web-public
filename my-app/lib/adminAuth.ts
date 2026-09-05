import { NextRequest, NextResponse } from 'next/server';
import { isUserDomainAdmin } from '@/lib/ldap';
import { checkRateLimitAsync, getClientIp, isRateLimitUnavailable, RateLimitPresets } from '@/lib/ratelimit';
import { getSessionFromCookies, revokeSessionById, clearSession, type SessionInfo } from '@/lib/session';
import { logAuditAction, AuditActions, categorizeRequest, getIpAddress, getUserAgent } from '@/lib/audit-log';
import { prisma } from '@/lib/prisma';
import {
  resolveActorAuthorization,
  resolveReviewerAuthorization,
  buildBreakGlassAuthorization,
  type ActorAuthorization,
} from '@/lib/rbac/core';
import type { PermissionKey } from '@/lib/rbac/permissions';
import { isLocalBreakGlassSessionProvider } from '@/lib/auth/session-provider';

export interface AdminAuthResult extends ActorAuthorization {
  username: string;
}

/**
 * Provider-aware elevation resolution (ADR-0009). AD sessions re-verify
 * against the live directory exactly as before; local sessions must still map
 * to an ACTIVE break-glass account at request time, so disabling an account
 * revokes its practical authority immediately without touching sessions.
 *
 * Privilege-first RBAC: legacy domain administrators keep the full catalog,
 * and any user whose AD groups map at least one privilege now qualifies.
 * Every gated route additionally enforces its own privilege via
 * actorHasPermission, so elevation alone grants nothing beyond the gate.
 */
async function resolveElevatedForSession(
  session: SessionInfo
): Promise<AdminAuthResult | null> {
  if (isLocalBreakGlassSessionProvider(session.authProvider)) {
    const account = await prisma.localAccount.findUnique({
      where: { username: session.username.toLowerCase() },
      select: { isActive: true, purpose: true },
    });
    if (!account || !account.isActive || account.purpose !== 'break_glass') {
      return null;
    }
    return buildBreakGlassAuthorization(session.username);
  }

  const isDomainAdmin = await isUserDomainAdmin(session.username);
  const authorization = await resolveActorAuthorization(session.username, { isDomainAdmin });
  if (authorization.permissions.size === 0) {
    return null;
  }
  return authorization;
}

/**
 * Authorization for non-admin-gated surfaces that accept any resolved role.
 * Local break-glass sessions resolve to system_administrator without any
 * directory call; AD sessions keep the single live lookup (ADR-0006).
 */
export async function resolveAnyRoleForSession(
  session: SessionInfo
): Promise<ActorAuthorization | null> {
  if (isLocalBreakGlassSessionProvider(session.authProvider)) {
    const account = await prisma.localAccount.findUnique({
      where: { username: session.username.toLowerCase() },
      select: { isActive: true, purpose: true },
    });
    if (!account || !account.isActive || account.purpose !== 'break_glass') {
      return null;
    }
    return buildBreakGlassAuthorization(session.username);
  }
  return resolveReviewerAuthorization(session.username);
}

const REVIEWER_PERMISSIONS: readonly PermissionKey[] = [
  'access_requests.read',
  'access_requests.review.director',
  'access_requests.review.faculty',
];

/**
 * Gate for request-review surfaces (ADR-0006): any authenticated session with
 * at least one resolved request-review privilege qualifies - legacy domain
 * administrators keep full access, and mapped reviewers gain exactly the
 * review surfaces that call this gate. Stage-privilege enforcement inside
 * each route constrains which actions each reviewer may perform.
 *
 * Fail-closed: no resolvable privileges means the same 401 as before.
 */
export async function checkReviewAccessWithRateLimit(
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
        { status: 429 }
      ),
    };
  }

  if (!session) {
    const response = NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    clearSession(response);
    return { admin: null, response };
  }

  const authorization = await resolveAnyRoleForSession(session);
  if (!authorization) {
    return { admin: null, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  const hasReviewPrivilege = REVIEWER_PERMISSIONS.some((permission) =>
    authorization.permissions.has(permission)
  );

  if (!hasReviewPrivilege) {
    // A plain user poking admin APIs keeps their portal session; only the
    // elevated surface is denied. No cookie clearing or revocation here.
    return { admin: null, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  return { admin: authorization };
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

  const authorization = await resolveElevatedForSession(session);

  if (!authorization) {
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
    admin: authorization,
  };
}

export async function checkAdminAuth(): Promise<AdminAuthResult | null> {
  const session = await getSessionFromCookies();

  if (!session || !session.isAdmin) {
    return null;
  }

  const authorization = await resolveElevatedForSession(session);

  if (!authorization) {
    await revokeSessionById(session.id);
    return null;
  }

  return authorization;
}

/**
 * Gate for read-oriented evidence surfaces (roadmap §9 Auditor role):
 * any authenticated session whose live directory memberships resolve the
 * "audit.read" permission qualifies - mapped Auditors gain exactly these
 * surfaces without being domain administrators, and system administrators
 * keep access through their full catalog.
 *
 * Fail-closed: no resolvable permission means the same 401 as before. A plain
 * user keeps their portal session - only the elevated surface is denied, and
 * sessions are never cleared or revoked here (unlike the legacy admin gate,
 * which assumes its callers must be domain admins).
 */
export async function checkAuditAccessWithRateLimit(
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
        { error: 'Too many requests. Please try again later.' },
        { status: 429 }
      ),
    };
  }

  if (!session) {
    return { admin: null, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const authorization = await resolveAnyRoleForSession(session);

  if (!authorization || !authorization.permissions.has('audit.read')) {
    return { admin: null, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }

  return { admin: authorization };
}
