import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/session';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { actorHasPermission } from '@/lib/rbac/core';
import { revokeUserSessionsEverywhere } from '@/lib/auth/provider-logout-audit';
import { getIpAddress, getUserAgent } from '@/lib/audit-log';
import { parseJsonWithLimit } from '@/lib/validation';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/sessions/end-all
 * Body: { username }
 *
 * Ends EVERY portal session for a user AND their IdP sessions via the
 * backchannel (ADR-0014 full-logout parity). One audited operation - the
 * per-row DELETE kill remains available for single-session precision.
 */
export async function POST(request: NextRequest) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!actorHasPermission(admin, 'sessions.revoke')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const actorSession = await getSessionFromRequest(request);
    if (!actorSession) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let body: { username?: unknown };
    try {
      body = (await parseJsonWithLimit(request, 4 * 1024)) as { username?: unknown };
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
    if (!username || username.length > 104) {
      return NextResponse.json({ error: 'A target username is required' }, { status: 400 });
    }

    if (username === actorSession.username) {
      return NextResponse.json(
        { error: 'Cannot end your own sessions - sign out instead' },
        { status: 400 }
      );
    }

    const result = await revokeUserSessionsEverywhere(username, {
      actor: admin.username,
      actorType: 'admin',
      reason: 'admin_end_all',
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    const partial = result.providerLogoutsReconciliationRequired > 0
      || result.providerSessionsDestroyed < result.providerLogoutsAttempted;
    return NextResponse.json({
      success: true,
      partial,
      message: `Ended ${result.portalSessionsRevoked} portal session(s)` +
        (result.providerLogoutsAttempted
          ? `; identity-provider logout ${result.providerSessionsDestroyed}/${result.providerLogoutsAttempted} confirmed` +
            (partial ? '. Some provider sessions may still allow silent sign-in.' : '')
          : ''),
      ...result,
    });
  } catch (error) {
    console.error('Error ending all sessions for user:', error);
    return NextResponse.json({ error: 'Failed to end sessions' }, { status: 500 });
  }
}
