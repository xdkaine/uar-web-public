import { NextRequest, NextResponse } from 'next/server';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { actorHasPermission } from '@/lib/rbac/core';
import { logAuditAction, AuditActions, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';
import { processLifecycleAction } from '@/lib/lifecycle-processor';
import { prisma } from '@/lib/prisma';
import { actorCanOperateLifecycleAction } from '@/lib/lifecycle-authorization';
import { isProductionCloneReadOnly } from '@/lib/clone-safety';

/**
 * POST /api/admin/account-lifecycle/process
 * Process lifecycle actions from the queue
 */
export async function POST(request: NextRequest) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!actorHasPermission(admin, 'lifecycle.manage')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const { actionId, processAll = false } = body;

    if (isProductionCloneReadOnly()) {
      return NextResponse.json({ error: 'Lifecycle mutations are disabled in this production-clone environment.' }, { status: 409 });
    }
    if (!actionId || processAll) {
      return NextResponse.json({
        error: 'Global queue draining is disabled. Process only an explicitly reviewed lifecycle action.',
      }, { status: 400 });
    }
    const action = await prisma.accountLifecycleAction.findUnique({
      where: { id: actionId },
      select: { actionType: true, operationMode: true },
    });
    if (!action) return NextResponse.json({ error: 'Lifecycle action not found' }, { status: 404 });
    if (!actorCanOperateLifecycleAction(admin, action)) {
      return NextResponse.json({ error: 'Your privileges do not allow processing this lifecycle action.' }, { status: 403 });
    }

    const results = await processLifecycleAction(actionId);
      
      await logAuditAction({
        action: AuditActions.PROCESS_LIFECYCLE_ACTION,
        category: AuditCategories.LIFECYCLE,
        username: admin.username,
        targetId: actionId,
        targetType: 'AccountLifecycleAction',
        details: { actionId, result: results },
        ipAddress: getIpAddress(request),
        userAgent: getUserAgent(request),
      });

    return NextResponse.json({
      success: results.success,
      partial: !results.success,
      result: results,
      message: results.success ? 'Action processed successfully' : 'Action processing failed',
    }, { status: results.success ? 200 : 207 });
  } catch (error) {
    console.error('Error processing lifecycle action:', error);
    
    const { admin } = await checkAdminAuthWithRateLimit(request);
    if (admin) {
      await logAuditAction({
        action: AuditActions.PROCESS_LIFECYCLE_ACTION,
        category: AuditCategories.LIFECYCLE,
        username: admin.username,
        targetType: 'AccountLifecycleAction',
        success: false,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        ipAddress: getIpAddress(request),
        userAgent: getUserAgent(request),
      });
    }

    if (error instanceof Error && error.message.includes('is not ready for processing')) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to process lifecycle action' },
      { status: 500 }
    );
  }
}
