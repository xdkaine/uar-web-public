import { NextRequest, NextResponse } from 'next/server';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { logAuditAction, AuditActions, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';
import { prisma } from '@/lib/prisma';
import { secureJsonResponse } from '@/lib/apiResponse';

/**
 * GET /api/admin/account-lifecycle/[id]
 * Get detailed information about a specific lifecycle action
 * Includes all history, activity logs, and related data
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    // Fetch action with all related data
    const action = await prisma.accountLifecycleAction.findUnique({
      where: { id },
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

    if (!action) {
      return NextResponse.json(
        { error: 'Lifecycle action not found' },
        { status: 404 }
      );
    }

    // Fetch related access request if available
    let relatedAccessRequest = null;
    if (action.relatedRequestId) {
      relatedAccessRequest = await prisma.accessRequest.findUnique({
        where: { id: action.relatedRequestId },
        select: {
          id: true,
          name: true,
          email: true,
          ldapUsername: true,
          vpnUsername: true,
          status: true,
          adAccountStatus: true,
          vpnAccountStatus: true,
        },
      });
    }

    // Fetch related ticket if available
    let relatedTicket = null;
    if (action.relatedTicketId) {
      relatedTicket = await prisma.supportTicket.findUnique({
        where: { id: action.relatedTicketId },
        select: {
          id: true,
          subject: true,
          category: true,
          status: true,
          createdAt: true,
        },
      });
    }

    // Fetch target account details
    let targetAccount = null;
    if (action.targetUserId) {
      if (action.targetAccountType === 'AD' || action.targetAccountType === 'BOTH') {
        targetAccount = await prisma.accessRequest.findUnique({
          where: { id: action.targetUserId },
          select: {
            id: true,
            name: true,
            email: true,
            ldapUsername: true,
            adAccountStatus: true,
            adDisabledAt: true,
            adDisabledBy: true,
            adDisabledReason: true,
            adEnabledAt: true,
            adEnabledBy: true,
          },
        });
      } else if (action.targetAccountType === 'VPN') {
        targetAccount = await prisma.vPNAccount.findUnique({
          where: { id: action.targetUserId },
          select: {
            id: true,
            username: true,
            name: true,
            email: true,
            portalType: true,
            status: true,
            revokedAt: true,
            revokedBy: true,
            revokedReason: true,
            restoredAt: true,
            restoredBy: true,
          },
        });
      }
    }

    return secureJsonResponse({
      action,
      relatedAccessRequest,
      relatedTicket,
      targetAccount,
    });
  } catch (error) {
    console.error('Error fetching lifecycle action:', error);
    return NextResponse.json(
      { error: 'Failed to fetch lifecycle action' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/admin/account-lifecycle/[id]
 * Delete a specific lifecycle action from the queue
 * Only pending, queued, failed, or cancelled actions can be deleted
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    if (!id) {
      return NextResponse.json({ error: 'Action ID is required' }, { status: 400 });
    }

    // Find the action
    const action = await prisma.accountLifecycleAction.findUnique({
      where: { id },
      include: {
        history: true,
      },
    });

    if (!action) {
      return NextResponse.json({ error: 'Action not found' }, { status: 404 });
    }

    // Check if action can be deleted (only certain statuses)
    const deletableStatuses = ['pending', 'queued', 'failed', 'cancelled'];
    if (!deletableStatuses.includes(action.status)) {
      return NextResponse.json(
        { 
          error: `Cannot delete action with status '${action.status}'. Only pending, queued, failed, or cancelled actions can be deleted.` 
        },
        { status: 400 }
      );
    }

    // Store action details for audit log before deletion
    const actionDetails = {
      id: action.id,
      actionType: action.actionType,
      targetAccountType: action.targetAccountType,
      targetUsername: action.targetUsername,
      status: action.status,
      reason: action.reason,
      requestedBy: action.requestedBy,
      createdAt: action.createdAt,
    };

    // Delete the action and its history (cascade should handle this, but be explicit)
    await prisma.$transaction(async (tx: any) => {
      // Delete history entries
      await tx.accountLifecycleHistory.deleteMany({
        where: { actionId: id },
      });

      // Delete the action
      await tx.accountLifecycleAction.delete({
        where: { id },
      });
    });

    // Log audit action
    await logAuditAction({
      action: AuditActions.DELETE_LIFECYCLE_ACTION,
      category: AuditCategories.USER,
      username: admin.username,
      targetId: id,
      targetType: 'AccountLifecycleAction',
      success: true,
      details: {
        deletedAction: actionDetails,
        deletedBy: admin.username,
      },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    return secureJsonResponse({
      success: true,
      message: 'Lifecycle action deleted successfully',
      deletedAction: actionDetails,
    });
  } catch (error) {
    console.error('Error deleting lifecycle action:', error);

    const { admin } = await checkAdminAuthWithRateLimit(request);
    if (admin) {
      await logAuditAction({
        action: AuditActions.DELETE_LIFECYCLE_ACTION,
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
      { error: error instanceof Error ? error.message : 'Failed to delete lifecycle action' },
      { status: 500 }
    );
  }
}
