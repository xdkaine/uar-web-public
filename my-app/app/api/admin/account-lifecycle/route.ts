import { NextRequest, NextResponse } from 'next/server';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { logAuditAction, AuditActions, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';
import { prisma } from '@/lib/prisma';
import { processLifecycleAction } from '@/lib/lifecycle-processor';
import { secureJsonResponse } from '@/lib/apiResponse';

type LifecycleActionWhere = {
  status?: string;
  actionType?: string;
  targetUsername?: { contains: string; mode: 'insensitive' };
  batchId?: string;
};

/**
 * GET /api/admin/account-lifecycle
 * Get all lifecycle actions with filtering
 */
export async function GET(request: NextRequest) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const actionType = searchParams.get('actionType');
    const username = searchParams.get('username');
    const batchId = searchParams.get('batchId');

    const where: LifecycleActionWhere = {};
    if (status) where.status = status;
    if (actionType) where.actionType = actionType;
    if (username) where.targetUsername = { contains: username, mode: 'insensitive' };
    if (batchId) where.batchId = batchId;

    const actions = await prisma.accountLifecycleAction.findMany({
      where,
      include: {
        batch: true,
        history: {
          orderBy: { createdAt: 'desc' },
          take: 5,
        },
      },
      orderBy: [
        { createdAt: 'desc' },
      ],
      take: 100,
    });

    return NextResponse.json({ actions });
  } catch (error) {
    console.error('Error fetching lifecycle actions:', error);
    return NextResponse.json(
      { error: 'Failed to fetch lifecycle actions' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/account-lifecycle
 * Create a new account lifecycle action (disable/enable/revoke/restore/role change)
 * Actions are processed immediately and results returned
 */
export async function POST(request: NextRequest) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const {
      actionType,
      targetAccountType,
      targetUsername,
      reason,
      scheduledFor,
      relatedRequestId,
      relatedTicketId,
      vpnRoleChange,
      notes,
    } = body;

    const effectiveTargetAccountType = ['disable_both', 'enable_both'].includes(actionType)
      ? 'BOTH'
      : targetAccountType;
    const explicitRelatedRequestId = typeof relatedRequestId === 'string' && relatedRequestId.trim()
      ? relatedRequestId.trim()
      : null;

    // Validate required fields
    if (!actionType || !targetAccountType || !targetUsername || !reason) {
      return NextResponse.json(
        { error: 'actionType, targetAccountType, targetUsername, and reason are required' },
        { status: 400 }
      );
    }

    // Validate actionType
    const validActions = [
      'disable_ad',
      'enable_ad',
      'revoke_vpn',
      'restore_vpn',
      'promote_vpn_role',
      'demote_vpn_role',
      'disable_both',
      'enable_both',
    ];
    if (!validActions.includes(actionType)) {
      return NextResponse.json(
        { error: `Invalid actionType. Must be one of: ${validActions.join(', ')}` },
        { status: 400 }
      );
    }

    // Check if target account exists
    let targetUserId = null;
    let resolvedRelatedRequestId = explicitRelatedRequestId;
    if (effectiveTargetAccountType === 'AD' || effectiveTargetAccountType === 'BOTH') {
      const adAccount = explicitRelatedRequestId
        ? await prisma.accessRequest.findUnique({
            where: { id: explicitRelatedRequestId },
          })
        : await prisma.accessRequest.findFirst({
            where: {
              OR: [
                { ldapUsername: targetUsername },
                { linkedAdUsername: targetUsername },
              ],
              status: { notIn: ['rejected', 'offboarded'] },
            },
            orderBy: { createdAt: 'desc' },
          });
      if (adAccount) {
        targetUserId = adAccount.id;
        resolvedRelatedRequestId = adAccount.id;
      }
    } else if (effectiveTargetAccountType === 'VPN') {
      const vpnAccount = await prisma.vPNAccount.findUnique({
        where: { username: targetUsername },
      });
      if (vpnAccount) {
        targetUserId = vpnAccount.id;
        resolvedRelatedRequestId = explicitRelatedRequestId || vpnAccount.accessRequestId || null;
      }
    }

    // Create the lifecycle action with 'processing' status (will be processed immediately)
    const action = await prisma.accountLifecycleAction.create({
      data: {
        actionType,
        targetAccountType: effectiveTargetAccountType,
        targetUsername,
        targetUserId,
        reason,
        requestedBy: admin.username,
        scheduledFor: scheduledFor ? new Date(scheduledFor) : null,
        relatedRequestId: resolvedRelatedRequestId,
        relatedTicketId,
        vpnRoleChange,
        notes,
        status: 'processing', // Start in processing state
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
          actionType,
          targetAccountType: effectiveTargetAccountType,
          targetUsername,
          reason,
        }),
      },
    });

    // Process the action immediately
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

    // Fetch the updated action with all details
    const updatedAction = await prisma.accountLifecycleAction.findUnique({
      where: { id: action.id },
      include: {
        batch: true,
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
    });

    // Log audit action
    await logAuditAction({
      action: AuditActions.CREATE_LIFECYCLE_ACTION,
      category: AuditCategories.USER,
      username: admin.username,
      targetId: action.id,
      targetType: 'AccountLifecycleAction',
      success: processResult.success,
      details: {
        actionType,
        targetAccountType: effectiveTargetAccountType,
        targetUsername,
        reason,
        status: updatedAction?.status,
      },
      errorMessage: processResult.success ? undefined : processResult.error,
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    return secureJsonResponse(
      {
        success: processResult.success,
        action: updatedAction,
        processResult,
        message: processResult.success 
          ? 'Account lifecycle action completed successfully' 
          : `Action failed: ${processResult.error}`,
      },
      processResult.success ? 200 : 500
    );
  } catch (error) {
    console.error('Error creating lifecycle action:', error);
    
    const { admin } = await checkAdminAuthWithRateLimit(request);
    if (admin) {
      await logAuditAction({
        action: AuditActions.CREATE_LIFECYCLE_ACTION,
        category: AuditCategories.USER,
        username: admin.username,
        targetType: 'AccountLifecycleAction',
        success: false,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        ipAddress: getIpAddress(request),
        userAgent: getUserAgent(request),
      });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create lifecycle action' },
      { status: 500 }
    );
  }
}
