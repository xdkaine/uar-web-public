import { NextRequest, NextResponse } from 'next/server';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import {
  isRateLimitUnavailable,
  listRateLimitSessions,
  releaseRateLimitSession,
} from '@/lib/ratelimit';
import {
  AuditActions,
  AuditCategories,
  getIpAddress,
  getUserAgent,
  logAuditAction,
} from '@/lib/audit-log';

export async function GET(request: NextRequest) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const sessions = await listRateLimitSessions();

    await logAuditAction({
      action: AuditActions.VIEW_RATE_LIMITS,
      category: AuditCategories.RATE_LIMIT,
      username: admin.username,
      details: {
        totalSessions: sessions.length,
        limitedSessions: sessions.filter((session) => session.status === 'limited').length,
      },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    return NextResponse.json({ sessions });
  } catch (error) {
    console.error('Error fetching rate limit sessions:', error);

    if (isRateLimitUnavailable(error)) {
      return NextResponse.json(
        { error: 'Rate limit service is temporarily unavailable' },
        { status: 503 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to fetch rate limit sessions' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  let adminUsername = 'unknown';
  let targetKey = '';

  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    adminUsername = admin.username;

    targetKey = request.nextUrl.searchParams.get('key') || '';
    if (!targetKey) {
      return NextResponse.json(
        { error: 'Rate limit key is required' },
        { status: 400 }
      );
    }

    const releasedSession = await releaseRateLimitSession(targetKey);

    if (!releasedSession) {
      await logAuditAction({
        action: AuditActions.RELEASE_RATE_LIMIT,
        category: AuditCategories.RATE_LIMIT,
        username: adminUsername,
        targetId: targetKey,
        targetType: 'RateLimitSession',
        success: false,
        errorMessage: 'Rate limit session not found',
        ipAddress: getIpAddress(request),
        userAgent: getUserAgent(request),
      });

      return NextResponse.json(
        { error: 'Rate limit session not found' },
        { status: 404 }
      );
    }

    await logAuditAction({
      action: AuditActions.RELEASE_RATE_LIMIT,
      category: AuditCategories.RATE_LIMIT,
      username: adminUsername,
      targetId: releasedSession.key,
      targetType: 'RateLimitSession',
      details: {
        scope: releasedSession.scope,
        identifier: releasedSession.identifier,
        count: releasedSession.count,
        limit: releasedSession.limit,
        status: releasedSession.status,
        storage: releasedSession.storage,
      },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    return NextResponse.json({
      success: true,
      message: 'Rate limit session released successfully',
      releasedSession,
    });
  } catch (error) {
    console.error('Error releasing rate limit session:', error);

    await logAuditAction({
      action: AuditActions.RELEASE_RATE_LIMIT,
      category: AuditCategories.RATE_LIMIT,
      username: adminUsername,
      targetId: targetKey || undefined,
      targetType: 'RateLimitSession',
      success: false,
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    if (isRateLimitUnavailable(error)) {
      return NextResponse.json(
        { error: 'Rate limit service is temporarily unavailable' },
        { status: 503 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to release rate limit session' },
      { status: 500 }
    );
  }
}