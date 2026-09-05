import { NextRequest, NextResponse } from 'next/server';
import { validateBackchannelLogoutToken } from '@/lib/auth/backchannel-receiver';
import { revokeSessionsByProviderSid, type ProviderSidRevocation } from '@/lib/session';
import { getIpAddress, getUserAgent, logAuditAction } from '@/lib/audit-log';
import {
  checkRateLimitAsync,
  getRequiredClientIp,
  isRateLimitUnavailable,
} from '@/lib/ratelimit';
import { appLogger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' };

// The receiver is unauthenticated by design (the RS256 logout_token IS the
// authentication), so throttle blind traffic before any JWKS/crypto work.
// Legit IdP logout pushes are tiny; 60/min per source is generous.
const BACKCHANNEL_RATE_LIMIT = { maxRequests: 60, windowMs: 60 * 1000 };

function invalidLogoutToken(): NextResponse {
  // Generic body on purpose: never reveal which validation step failed.
  return NextResponse.json(
    { error: 'Invalid logout token' },
    { status: 400, headers: NO_STORE_HEADERS }
  );
}

function serviceUnavailable(): NextResponse {
  return NextResponse.json(
    { error: 'Service temporarily unavailable' },
    { status: 503, headers: NO_STORE_HEADERS }
  );
}

/**
 * IdP-initiated OIDC Back-Channel Logout receiver (issue #36). The auth
 * service POSTs an application/x-www-form-urlencoded logout_token JWT; the
 * signed token itself is the only authentication (see the CSRF exemption in
 * lib/csrf-config.ts). Per spec: any invalid token => generic 400 with no
 * side effects; a valid token with a completed revocation attempt returns 200
 * even when no local session matches the sid. A persistence failure returns
 * 503 so the IdP cannot record a false delivery acknowledgement.
 */
export async function POST(request: NextRequest) {
  try {
    const clientIp = getRequiredClientIp(request);
    const rateLimit = await checkRateLimitAsync(clientIp, BACKCHANNEL_RATE_LIMIT);
    if (!rateLimit.success) {
      appLogger.warn('[Oidc] Back-channel logout rate limited', {
        ipHashPrefix: clientIp.slice(0, 8),
      });
      return NextResponse.json(
        { error: 'Too many requests' },
        { status: 429, headers: NO_STORE_HEADERS }
      );
    }
  } catch (error) {
    if (isRateLimitUnavailable(error)) {
      appLogger.error('[Oidc] Back-channel logout rate limiter unavailable', {
        error: error instanceof Error ? error.message : 'unknown',
      });
      return serviceUnavailable();
    }
    throw error;
  }

  let logoutToken: string | null = null;
  try {
    const form = new URLSearchParams(await request.text());
    logoutToken = form.get('logout_token');
  } catch {
    return invalidLogoutToken();
  }

  const validated = await validateBackchannelLogoutToken(logoutToken);
  if (!validated) {
    appLogger.warn('[Oidc] Back-channel logout rejected: invalid logout_token');
    return invalidLogoutToken();
  }

  let revoked: ProviderSidRevocation[] = [];
  try {
    revoked = await revokeSessionsByProviderSid(validated.sid);
  } catch (error) {
    appLogger.error('[Oidc] Back-channel logout session revocation failed', {
      error: error instanceof Error ? error.message : 'unknown',
    });
    return serviceUnavailable();
  }

  const matched = revoked.length > 0;

  try {
    await logAuditAction({
      action: 'idp_backchannel_logout',
      category: 'session',
      username: matched ? revoked[0].username : 'unknown',
      actorType: 'system',
      targetType: 'Session',
      targetId: matched ? revoked[0].sessionId : undefined,
      eventKind: 'security',
      outcome: matched ? 'success' : 'skipped',
      success: matched,
      details: {
        source: 'idp_initiated_backchannel_logout',
        providerSidPresent: true,
        matchedSession: matched,
        revokedSessionCount: revoked.length,
      },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });
  } catch (error) {
    appLogger.error('[Oidc] Failed to persist back-channel logout audit row', {
      error: error instanceof Error ? error.message : 'unknown',
    });
  }

  // Spec: respond 200 whenever validation passed - unknown/dead sids included.
  return NextResponse.json({}, { status: 200, headers: NO_STORE_HEADERS });
}
