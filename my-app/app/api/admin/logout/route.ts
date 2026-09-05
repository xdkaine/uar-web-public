import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { checkRateLimitAsync, getClientIp, RateLimitPresets } from '@/lib/ratelimit';
import {
  clearSession,
  getSessionCookieName,
  getSessionFromCookies,
  revokeSessionByToken,
} from '@/lib/session';
import { logAuditAction, AuditActions, AuditCategories, getUserAgent, getIpAddress } from '@/lib/audit-log';
import { recordProviderLogoutOutcome } from '@/lib/auth/provider-logout-audit';

export async function POST(request: NextRequest) {
  // Apply rate limiting even for logout
  const clientIp = getClientIp(request);
  const rateLimitResult = await checkRateLimitAsync(clientIp, RateLimitPresets.general);
  
  if (!rateLimitResult.success) {
    return NextResponse.json(
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
    );
  }

  const cookieStore = await cookies();
  const token = cookieStore.get(getSessionCookieName())?.value;
  const session = await getSessionFromCookies();

  if (session?.isAdmin) {
    await logAuditAction({
      action: AuditActions.ADMIN_LOGOUT,
      category: AuditCategories.NAVIGATION,
      username: session.username,
      targetType: 'Session',
      targetId: session.id,
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });
  }

  // revokeSessionByToken returns the deleted row's providerSid so the IdP
  // session dies with the portal session (same full-logout path as
  // /api/auth/logout - otherwise the next /auth silently SSOs back in).
  // The ACTUAL backchannel outcome is recorded durably (ADR-0014).
  const revoked = await revokeSessionByToken(token, 'admin_logout');
  await recordProviderLogoutOutcome({
    surface: 'admin_console',
    username: session?.username,
    sessionId: session?.id,
    isAdmin: session?.isAdmin,
    hadSession: Boolean(revoked),
    providerSid: revoked?.providerSid,
    providerLogoutTaskId: revoked?.providerLogoutTaskId,
    ipAddress: getIpAddress(request),
    userAgent: getUserAgent(request),
  });
  const response = NextResponse.json({ success: true });

  clearSession(response);

  return response;
}
