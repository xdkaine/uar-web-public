import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/session';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { prisma } from '@/lib/prisma';
import { getIpAddress, logAuditAction } from '@/lib/audit-log';

/**
 * GET /api/admin/sessions
 * List all active sessions
 */
export async function GET(request: NextRequest) {
  try {
    // Verify admin session
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const session = { username: admin.username };

    // Get all active sessions
    const sessions = await prisma.session.findMany({
      where: {
        revokedAt: null,
        expiresAt: {
          gt: new Date()
        }
      },
      orderBy: {
        lastActivity: 'desc'
      },
      select: {
        id: true,
        username: true,
        isAdmin: true,
        createdAt: true,
        lastActivity: true,
        expiresAt: true,
        ipAddress: true,
        userAgent: true
      }
    });

    // Log the view action
    await logAuditAction({
      action: 'view_sessions',
      category: 'session',
      username: session.username,
      details: {
        totalActiveSessions: sessions.length
      },
      ipAddress: getIpAddress(request),
      userAgent: request.headers.get('user-agent') || undefined
    });

    return NextResponse.json({ sessions });
  } catch (error) {
    console.error('Error fetching sessions:', error);
    return NextResponse.json(
      { error: 'Failed to fetch sessions' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/admin/sessions?id=sessionId
 * Kill a session by ID
 */
export async function DELETE(request: NextRequest) {
  try {
    // Verify admin session
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('id');

    if (!sessionId) {
      return NextResponse.json(
        { error: 'Session ID is required' },
        { status: 400 }
      );
    }

    // Prevent admins from killing their own session
    if (sessionId === session.id) {
      return NextResponse.json(
        { error: 'Cannot kill your own session' },
        { status: 400 }
      );
    }

    // Get session info before deleting for audit log
    const targetSession = await prisma.session.findUnique({
      where: { id: sessionId },
      select: {
        username: true,
        isAdmin: true,
        ipAddress: true
      }
    });

    if (!targetSession) {
      return NextResponse.json(
        { error: 'Session not found' },
        { status: 404 }
      );
    }

    // Delete the session
    await prisma.session.update({
      where: { id: sessionId },
      data: {
        revokedAt: new Date()
      }
    });

    // Log the kill action
    await logAuditAction({
      action: 'kill_session',
      category: 'session',
      username: session.username,
      targetId: sessionId,
      targetType: 'Session',
      details: {
        targetUsername: targetSession.username,
        targetIsAdmin: targetSession.isAdmin,
        targetIpAddress: targetSession.ipAddress
      },
      ipAddress: getIpAddress(request),
      userAgent: request.headers.get('user-agent') || undefined
    });

    return NextResponse.json({ 
      success: true,
      message: 'Session terminated successfully' 
    });
  } catch (error) {
    console.error('Error killing session:', error);
    
    await logAuditAction({
      action: 'kill_session',
      category: 'session',
      username: (await getSessionFromRequest(request))?.username || 'unknown',
      success: false,
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
      ipAddress: getIpAddress(request),
      userAgent: request.headers.get('user-agent') || undefined
    });

    return NextResponse.json(
      { error: 'Failed to terminate session' },
      { status: 500 }
    );
  }
}
