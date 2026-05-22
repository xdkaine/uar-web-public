import { NextRequest, NextResponse } from 'next/server';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { logAuditAction, AuditActions, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';
import { processLifecycleAction, processNextQueuedAction, processAllQueuedActions } from '@/lib/lifecycle-processor';

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

    const body = await request.json().catch(() => ({}));
    const { actionId, processAll = false } = body;

    let results;

    if (actionId) {
      // Process specific action
      results = await processLifecycleAction(actionId);
      
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
        result: results,
        message: results.success ? 'Action processed successfully' : 'Action processing failed',
      });
    } else if (processAll) {
      // Process all queued actions
      results = await processAllQueuedActions();
      
      await logAuditAction({
        action: AuditActions.PROCESS_LIFECYCLE_ACTION,
        category: AuditCategories.LIFECYCLE,
        username: admin.username,
        targetType: 'AccountLifecycleAction',
        details: { 
          processAll: true,
          totalProcessed: results.length,
          successful: results.filter(r => r.success).length,
          failed: results.filter(r => !r.success).length,
        },
        ipAddress: getIpAddress(request),
        userAgent: getUserAgent(request),
      });

      return NextResponse.json({
        success: true,
        results,
        summary: {
          total: results.length,
          successful: results.filter(r => r.success).length,
          failed: results.filter(r => !r.success).length,
        },
        message: `Processed ${results.length} actions from the queue`,
      });
    } else {
      // Process next action in queue
      const result = await processNextQueuedAction();
      
      if (!result) {
        return NextResponse.json({
          success: true,
          message: 'No actions in queue to process',
          result: null,
        });
      }

      await logAuditAction({
        action: AuditActions.PROCESS_LIFECYCLE_ACTION,
        category: AuditCategories.LIFECYCLE,
        username: admin.username,
        targetId: result.actionId,
        targetType: 'AccountLifecycleAction',
        details: { result },
        ipAddress: getIpAddress(request),
        userAgent: getUserAgent(request),
      });

      return NextResponse.json({
        success: result.success,
        result,
        message: result.success ? 'Next action processed successfully' : 'Action processing failed',
      });
    }
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

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to process lifecycle action' },
      { status: 500 }
    );
  }
}
