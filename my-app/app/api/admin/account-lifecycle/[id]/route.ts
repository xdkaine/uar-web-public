import { NextRequest, NextResponse } from 'next/server';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { actorHasPermission } from '@/lib/rbac/core';
import { prisma } from '@/lib/prisma';
import { secureJsonResponse } from '@/lib/apiResponse';
import { redactLifecycleExceptionEvidence } from '@/lib/lifecycle-evidence';

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

    if (!actorHasPermission(admin, 'lifecycle.manage')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
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
    let deletedVpnEvidence = null;
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
        if (!targetAccount && action.actionType === 'delete_vpn_record') {
          const [statusLogs, comments] = await Promise.all([
            prisma.vPNAccountStatusLog.findMany({
              where: { accountId: action.targetUserId },
              orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
              take: 25,
            }),
            prisma.vPNAccountComment.findMany({
              where: { accountId: action.targetUserId },
              orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
              take: 25,
            }),
          ]);
          deletedVpnEvidence = { state: 'deleted_record', statusLogs, comments };
        }
      }
    }

    return secureJsonResponse({
      action: redactLifecycleExceptionEvidence(
        action,
        action.actionType === 'delete_ad'
          ? actorHasPermission(admin, 'lifecycle.delete')
          : action.actionType === 'delete_vpn_record'
            ? actorHasPermission(admin, 'vpn.delete')
          : actorHasPermission(admin, 'lifecycle.override')
      ),
      relatedAccessRequest,
      relatedTicket,
      targetAccount,
      deletedVpnEvidence,
    });
  } catch (error) {
    console.error('Error fetching lifecycle action:', error);
    return NextResponse.json(
      { error: 'Failed to fetch lifecycle action' },
      { status: 500 }
    );
  }
}

/** Confirmed lifecycle evidence is immutable; queued work uses the cancel route. */
export async function DELETE(
  request: NextRequest
) {
  const { admin, response } = await checkAdminAuthWithRateLimit(request);
  if (!admin || response) {
    return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!actorHasPermission(admin, 'lifecycle.manage')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return NextResponse.json({
    error: 'Confirmed lifecycle evidence is immutable. Cancel queued work instead of deleting its history.',
  }, { status: 405, headers: { Allow: 'GET' } });
}
