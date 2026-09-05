import { NextRequest, NextResponse } from 'next/server';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { actorHasPermission } from '@/lib/rbac/core';
import { logAuditAction, AuditActions, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';
import { runDirectoryGroupSync } from '@/lib/support/directory-sync';

export const dynamic = 'force-dynamic';

// Manually trigger a membership snapshot refresh for all active allowed groups
export async function POST(request: NextRequest) {
  const { admin, response } = await checkAdminAuthWithRateLimit(request);
  if (!admin || response) {
    return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!actorHasPermission(admin, 'tickets.configure')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const outcome = await runDirectoryGroupSync({ triggeredBy: admin.username });

    await logAuditAction({
      action: AuditActions.SYNC_TICKET_GROUPS,
      category: AuditCategories.SUPPORT,
      username: admin.username,
      targetId: outcome.runId,
      targetType: 'DirectorySyncRun',
      details: {
        trigger: 'manual',
        status: outcome.status,
        groupsProcessed: outcome.groupsProcessed,
        membersCaptured: outcome.membersCaptured,
        failureCount: outcome.errors.length,
      },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    return NextResponse.json({ success: true, outcome });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to run directory sync';
    // A concurrently running sync is a normal outcome, not a server fault.
    const isConflict = message.includes('already running');
    console.error('Manual directory sync failed:', error);
    return NextResponse.json(
      { success: false, error: message },
      { status: isConflict ? 409 : 500 }
    );
  }
}
