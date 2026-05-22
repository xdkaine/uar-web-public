import { NextRequest, NextResponse } from 'next/server';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { logAuditAction, AuditActions, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';
import { prisma } from '@/lib/prisma';
import { processLifecycleAction } from '@/lib/lifecycle-processor';
import { secureJsonResponse } from '@/lib/apiResponse';

/**
 * POST /api/admin/account-lifecycle/batch
 * Create and process a batch of account lifecycle actions immediately
 */
export async function POST(request: NextRequest) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const {
      batchType,
      description,
      actions,
      relatedTicketId,
      notes,
    } = body;

    // Validate
    if (!batchType || !description || !actions || actions.length === 0) {
      return NextResponse.json(
        { error: 'batchType, description, and actions array are required' },
        { status: 400 }
      );
    }

    if (actions.length > 100) {
      return NextResponse.json(
        { error: 'Maximum 100 actions per batch' },
        { status: 400 }
      );
    }

    // Create batch with processing status
    const batch = await prisma.accountLifecycleBatch.create({
      data: {
        batchType,
        description,
        requestedBy: admin.username,
        totalActions: actions.length,
        relatedTicketId,
        notes,
        status: 'processing',
        startedAt: new Date(),
      },
    });

    // Create and process all actions in the batch
    const createdActions = [];
    const processResults = [];
    
    for (const actionData of actions) {
      // Create action with processing status
      const action = await prisma.accountLifecycleAction.create({
        data: {
          batchId: batch.id,
          actionType: actionData.actionType,
          targetAccountType: actionData.targetAccountType,
          targetUsername: actionData.targetUsername,
          reason: actionData.reason || description,
          requestedBy: admin.username,
          relatedRequestId: actionData.relatedRequestId,
          relatedTicketId: relatedTicketId || actionData.relatedTicketId,
          vpnRoleChange: actionData.vpnRoleChange,
          notes: actionData.notes,
          status: 'processing',
          processedAt: new Date(),
          processedBy: 'system',
        },
      });

      // Create history entry
      await prisma.accountLifecycleHistory.create({
        data: {
          actionId: action.id,
          event: 'created',
          performedBy: admin.username,
          newStatus: 'processing',
          details: JSON.stringify({
            batchId: batch.id,
            actionType: actionData.actionType,
            targetUsername: actionData.targetUsername,
          }),
        },
      });

      // Process action immediately
      let processResult;
      try {
        processResult = await processLifecycleAction(action.id);
      } catch (error) {
        processResult = {
          success: false,
          actionId: action.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }

      createdActions.push(action);
      processResults.push(processResult);
    }

    // Update batch with final statistics
    const successCount = processResults.filter(r => r.success).length;
    const failedCount = processResults.filter(r => !r.success).length;
    
    await prisma.accountLifecycleBatch.update({
      where: { id: batch.id },
      data: {
        completedActions: successCount,
        failedActions: failedCount,
        status: failedCount === 0 ? 'completed' : (successCount === 0 ? 'failed' : 'partial'),
        completedAt: new Date(),
      },
    });

    // Fetch updated batch with all actions
    const updatedBatch = await prisma.accountLifecycleBatch.findUnique({
      where: { id: batch.id },
      include: {
        actions: {
          include: {
            history: {
              orderBy: { createdAt: 'desc' },
            },
            adActivityLogs: {
              orderBy: { createdAt: 'desc' },
            },
            vpnActivityLogs: {
              orderBy: { createdAt: 'desc' },
            },
          },
        },
      },
    });

    // Log audit action
    await logAuditAction({
      action: AuditActions.CREATE_LIFECYCLE_BATCH,
      category: AuditCategories.LIFECYCLE,
      username: admin.username,
      targetId: batch.id,
      targetType: 'AccountLifecycleBatch',
      details: {
        batchType,
        description,
        totalActions: actions.length,
        successCount,
        failedCount,
        relatedTicketId,
      },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    return secureJsonResponse(
      {
        success: failedCount < actions.length,
        batch: updatedBatch,
        processResults,
        message: `Batch processed: ${successCount} succeeded, ${failedCount} failed out of ${actions.length} actions`,
      },
      200
    );
  } catch (error) {
    console.error('Error creating lifecycle batch:', error);
    
    const { admin } = await checkAdminAuthWithRateLimit(request);
    if (admin) {
      await logAuditAction({
        action: AuditActions.CREATE_LIFECYCLE_BATCH,
        category: AuditCategories.LIFECYCLE,
        username: admin.username,
        targetType: 'AccountLifecycleBatch',
        success: false,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        ipAddress: getIpAddress(request),
        userAgent: getUserAgent(request),
      });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create lifecycle batch' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/admin/account-lifecycle/batch
 * Get all batches with optional filtering
 */
export async function GET(request: NextRequest) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const batchType = searchParams.get('batchType');

    const where: any = {};
    if (status) where.status = status;
    if (batchType) where.batchType = batchType;

    const batches = await prisma.accountLifecycleBatch.findMany({
      where,
      include: {
        actions: {
          take: 10,
          orderBy: { createdAt: 'asc' },
        },
        _count: {
          select: { actions: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return NextResponse.json({ batches });
  } catch (error) {
    console.error('Error fetching lifecycle batches:', error);
    return NextResponse.json(
      { error: 'Failed to fetch lifecycle batches' },
      { status: 500 }
    );
  }
}
