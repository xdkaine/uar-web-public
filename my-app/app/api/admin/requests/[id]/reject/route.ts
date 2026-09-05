import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { sendRejectionEmail } from '@/lib/email';
import { checkReviewAccessWithRateLimit } from '@/lib/adminAuth';
import { deleteLDAPUser, disableLDAPUser, setLDAPUserExpiration } from '@/lib/ldap';
import { logAuditAction, AuditActions, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';
import { isModuleEnabled } from '@/lib/modules/core';
import { actorCanActOnStage } from '@/lib/rbac/core';
import { findStageIndexByStatus, resolveWorkflowForRequest, workflowIntegrityConflict } from '@/lib/workflow/core';
import { isJsonBodyError, MAX_REQUEST_BODY_SIZE, parseJsonWithLimit } from '@/lib/validation';
import { toSafeAccessRequestResponse } from '@/lib/access-request-response';
import {
  revokeLinkedVpnForRejection,
  VpnRejectionConflictError,
} from '@/lib/vpn-rejection-retention';

const REJECTION_STATE_IN_PROGRESS = 'rejection_in_progress';
const REJECTION_STATE_FAILED = 'rejection_failed';
const REJECTION_EMAIL_PENDING = 'rejection_email_pending';
const APPROVAL_STATE_IN_PROGRESS = 'approval_in_progress';
const ACCOUNT_CREATION_IN_PROGRESS = 'in_progress';

class HttpError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

interface RejectRequestBody {
  reason?: unknown;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let requestId: string | null = null;
  let adminUsername: string | null = null;
  let claimedRejection = false;

  try {
    const { admin, response } = await checkReviewAccessWithRateLimit(request);

    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    adminUsername = admin.username;
    const resolvedParams = await params;
    requestId = resolvedParams.id;
    const body = await parseJsonWithLimit<RejectRequestBody>(request, MAX_REQUEST_BODY_SIZE.SMALL);
    const { reason } = body;
    const rejectionReason = typeof reason === 'string' ? reason.trim() : '';

    if (!rejectionReason) {
      return NextResponse.json(
        { error: 'Rejection reason is required' },
        { status: 400 }
      );
    }

    const accessRequest = await prisma.accessRequest.findUnique({
      where: { id: resolvedParams.id },
    });

    if (!accessRequest) {
      return NextResponse.json({ error: 'Request not found' }, { status: 404 });
    }

    // Allow rejection from any non-terminal state
    if (accessRequest.status === 'approved' || accessRequest.status === 'rejected') {
      return NextResponse.json(
        { error: 'Request has already been processed and cannot be rejected' },
        { status: 409 }
      );
    }
    if (['in_progress', 'reconciliation_required'].includes(accessRequest.accountUpdateState || '')) {
      return NextResponse.json(
        { error: 'Account identity reconciliation must finish before rejection' },
        { status: 409 }
      );
    }
    if (accessRequest.facultyNotificationState === 'sending') {
      return NextResponse.json(
        { error: 'Faculty delivery is in progress; its outcome must settle before rejection' },
        { status: 409 }
      );
    }
    if (accessRequest.provisioningState === 'reconciliation_pending') {
      return NextResponse.json(
        { error: 'Directory reconciliation is in progress; wait for it to finish before rejecting this request.' },
        { status: 409 }
      );
    }

    // Governance: rejecting a request under review requires the reviewer role
    // of the stage it currently sits in. Statuses outside any review stage
    // (e.g. pre-verification) remain administrator actions.
    {
      const workflow = await resolveWorkflowForRequest(accessRequest);
      const workflowConflict = workflowIntegrityConflict(workflow);
      if (workflowConflict) {
        return NextResponse.json({ error: workflowConflict, code: 'WORKFLOW_RECONCILIATION_REQUIRED' }, { status: 409 });
      }
      const stageIndex = findStageIndexByStatus(workflow.stages, accessRequest.status);
      const requiredRoleKey = stageIndex >= 0 ? workflow.stages[stageIndex].reviewerRoleKey : null;
      if (requiredRoleKey && !actorCanActOnStage(admin, requiredRoleKey)) {
        return NextResponse.json(
          {
            error: 'You do not have the reviewer role required to reject requests at this stage.',
            code: 'MISSING_STAGE_ROLE',
          },
          { status: 403 }
        );
      }
    }

    const vpnModuleEnabled = await isModuleEnabled('vpn.management');

    const claimResult = await prisma.accessRequest.updateMany({
      where: {
        id: resolvedParams.id,
        version: accessRequest.version,
        status: { notIn: ['approved', 'rejected'] },
        AND: [
          {
            OR: [
              { provisioningState: null },
              {
                provisioningState: {
                  notIn: [
                    APPROVAL_STATE_IN_PROGRESS,
                    REJECTION_STATE_IN_PROGRESS,
                    ACCOUNT_CREATION_IN_PROGRESS,
                    'reconciliation_pending',
                  ],
                },
              },
            ],
          },
          {
            OR: [
              { accountUpdateState: null },
              { accountUpdateState: { in: ['failed', 'succeeded'] } },
            ],
          },
          {
            OR: [
              { facultyNotificationState: null },
              { facultyNotificationState: { not: 'sending' } },
            ],
          },
        ],
      },
      data: {
        provisioningState: REJECTION_STATE_IN_PROGRESS,
        provisioningStartedAt: new Date(),
        provisioningCompletedAt: null,
        provisioningError: null,
        version: { increment: 1 },
      },
    });

    if (claimResult.count !== 1) {
      throw new HttpError(
        'Another administrator is currently processing this request. Please refresh and try again.',
        409
      );
    }
    claimedRejection = true;
    const lockedVersion = accessRequest.version + 1;

    // AUTOMATIC CLEANUP: Roll back directory provisioning and revoke VPN records.
    // VPN rows and credentials are retained until the separately authorized,
    // confirmed lifecycle deletion path is used.
    // This enables clean retry and prevents orphaned accounts
    // SAFETY: Only deletes accounts that belong to THIS request (verified by request ID)
    const needsLdapCleanup = accessRequest.accountCreatedAt !== null;
    const cleanupResults: Array<{ username: string; success: boolean; method?: string; error?: string }> = [];

    // VPN Account Cleanup
    // Revoke and retain any VPN record associated with this request. Request
    // rejection must never be an alternate permanent-deletion authority.
    let vpnAccountRevoked: { username: string; status: string } | null = null;
    if (vpnModuleEnabled) {
      vpnAccountRevoked = await revokeLinkedVpnForRejection({
        requestId: resolvedParams.id,
        requestVersion: lockedVersion,
        actor: admin.username,
      });
    }

    if (needsLdapCleanup) {
      const accountsToCleanup: string[] = [];
      
      if (accessRequest.ldapUsername) {
        accountsToCleanup.push(accessRequest.ldapUsername);
      }
      
      if (accessRequest.vpnUsername && accessRequest.vpnUsername !== accessRequest.ldapUsername) {
        accountsToCleanup.push(accessRequest.vpnUsername);
      }

      // SAFETY CHECK: Only cleanup if request is not approved
      // Approved accounts should NEVER be automatically deleted
      if (accessRequest.status === 'approved') {
        console.error(`[Rejection Cleanup] BLOCKED: Cannot cleanup approved request ${resolvedParams.id}`);
        throw new Error('Cannot reject an approved request. Approved accounts must be manually disabled if needed.');
      }

      for (const username of accountsToCleanup) {
        try {
          // Try deletion first (cleanest approach)
          // Pass request ID for safety verification - will only delete if account belongs to this request
          await deleteLDAPUser(username, accessRequest.id);
          cleanupResults.push({ username, success: true, method: 'deleted' });
          console.log(`[Rejection Cleanup] Successfully deleted LDAP account: ${username} (request: ${accessRequest.id})`);
        } catch (deleteError) {
          console.warn(`[Rejection Cleanup] Delete failed for ${username}, attempting disable`, deleteError);
          
          try {
            // Fallback: disable and expire
            await disableLDAPUser(username);
            await setLDAPUserExpiration(username, new Date());
            cleanupResults.push({ username, success: true, method: 'disabled' });
            console.log(`[Rejection Cleanup] Successfully disabled LDAP account: ${username}`);
          } catch (disableError) {
            const errorMsg = disableError instanceof Error ? disableError.message : 'Unknown error';
            cleanupResults.push({ username, success: false, error: errorMsg });
            console.error(`[Rejection Cleanup] Failed to cleanup ${username}:`, disableError);
          }
        }
      }

      // If any cleanup failed, log it but continue with rejection
      const failedCleanups = cleanupResults.filter(r => !r.success);
      if (failedCleanups.length > 0) {
        console.error('[Rejection Cleanup] Some directory accounts could not be cleaned up:', failedCleanups);
        
        // Log to database for manual follow-up
        await prisma.requestComment.create({
          data: {
            requestId: resolvedParams.id,
            comment: `Directory cleanup partially failed during rejection. Manual verification is needed for: ${
              failedCleanups.map(f => `${f.username} (${f.error})`).join(', ')
            }`,
            author: 'System',
            type: 'system',
          },
        }).catch((commentError: unknown) => {
          console.error('Failed to log cleanup failure:', commentError);
        });
      }
    }

    const result = await prisma.accessRequest.updateMany({
      where: { 
        id: resolvedParams.id,
        version: lockedVersion,
        status: { notIn: ['approved', 'rejected'] },
        provisioningState: REJECTION_STATE_IN_PROGRESS,
      },
      data: {
        status: 'rejected',
        rejectionReason,
        rejectedBy: admin.username,
        rejectedAt: new Date(),
        provisioningState: null,
        provisioningCompletedAt: new Date(),
        provisioningError: null,
        version: { increment: 1 },
      },
    });

    if (result.count === 0) {
      const current = await prisma.accessRequest.findUnique({
        where: { id: resolvedParams.id },
        select: { status: true }
      });
      
      return NextResponse.json({ 
        error: `Cannot reject request. Current status: ${current?.status}` 
      }, { status: 409 });
    }
    claimedRejection = false;

    const updatedRequest = await prisma.accessRequest.findUnique({
      where: { id: resolvedParams.id },
    });

    if (!updatedRequest) {
      return NextResponse.json({ error: 'Request not found after update' }, { status: 404 });
    }

    // Create a rejection comment for tracking
    let commentText = `Request rejected.\n\nReason: ${rejectionReason}`;
    
    // Add VPN cleanup info to comment
    if (vpnAccountRevoked) {
      commentText += `\n\nVPN account automatically revoked and retained for governed lifecycle review: ${vpnAccountRevoked.username} (status was: ${vpnAccountRevoked.status})`;
    }
    
    // Add directory cleanup info to comment
    if (cleanupResults.length > 0) {
      const successfulCleanups = cleanupResults.filter(r => r.success);
      if (successfulCleanups.length > 0) {
        commentText += `\n\nDirectory accounts automatically cleaned up: ${
          successfulCleanups.map(r => `${r.username} (${r.method})`).join(', ')
        }`;
      }
    }
    
    await prisma.requestComment.create({
      data: {
        requestId: resolvedParams.id,
        comment: commentText,
        author: admin.username,
        type: 'rejection',
      },
    });

    // Send rejection email to user
    try {
      await sendRejectionEmail(
        updatedRequest.email,
        updatedRequest.name,
        rejectionReason
      );
    } catch (emailError) {
      await prisma.accessRequest.update({
        where: { id: resolvedParams.id },
        data: {
          provisioningState: REJECTION_EMAIL_PENDING,
          provisioningCompletedAt: new Date(),
          provisioningError: errorMessage(emailError),
        },
      });

      await prisma.requestComment.create({
        data: {
          requestId: resolvedParams.id,
          comment: `Rejection email failed after the request was rejected. Manual follow-up required. Error: ${errorMessage(emailError)}`,
          author: 'System',
          type: 'system',
        },
      });

      await logAuditAction({
        action: AuditActions.REJECT_REQUEST,
        category: AuditCategories.ACCESS_REQUEST,
        username: admin.username,
        targetId: resolvedParams.id,
        targetType: 'AccessRequest',
        details: {
          requestName: updatedRequest.name,
          requestEmail: updatedRequest.email,
          rejectionReason,
          vpnAccountRevoked: vpnAccountRevoked?.username ?? null,
          ldapCleanup: cleanupResults,
          emailSent: false,
          emailFailureState: REJECTION_EMAIL_PENDING,
        },
        ipAddress: getIpAddress(request),
        userAgent: getUserAgent(request),
      });

      const requestWithFailureState = await prisma.accessRequest.findUnique({
        where: { id: resolvedParams.id },
      });

      return NextResponse.json(
        {
          success: true,
          warning: 'Request rejected, but the rejection email failed. Manual follow-up is required.',
          request: toSafeAccessRequestResponse(requestWithFailureState),
        },
        { status: 202 }
      );
    }

    // Log the rejection action
    await logAuditAction({
      action: AuditActions.REJECT_REQUEST,
      category: AuditCategories.ACCESS_REQUEST,
      username: admin.username,
      targetId: resolvedParams.id,
      targetType: 'AccessRequest',
      details: {
        requestName: updatedRequest.name,
        requestEmail: updatedRequest.email,
        rejectionReason,
          vpnAccountRevoked: vpnAccountRevoked?.username ?? null,
          ldapCleanup: cleanupResults,
          emailSent: true,
      },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    return NextResponse.json({ 
      success: true, 
      request: toSafeAccessRequestResponse(updatedRequest)
    });
  } catch (error) {
    if (isJsonBodyError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }

    if (error instanceof HttpError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof VpnRejectionConflictError) {
      if (claimedRejection && requestId) {
        await prisma.accessRequest.updateMany({
          where: { id: requestId, provisioningState: REJECTION_STATE_IN_PROGRESS },
          data: {
            provisioningState: REJECTION_STATE_FAILED,
            provisioningCompletedAt: new Date(),
            provisioningError: error.message,
            version: { increment: 1 },
          },
        }).catch((markError: unknown) => {
          console.error('Failed to mark rejection as failed after VPN conflict:', markError);
        });
      }
      return NextResponse.json({ error: error.message }, { status: 409 });
    }

    console.error('Error rejecting request:', error);

    if (claimedRejection && requestId) {
      await prisma.accessRequest.updateMany({
        where: {
          id: requestId,
          provisioningState: REJECTION_STATE_IN_PROGRESS,
        },
        data: {
          provisioningState: REJECTION_STATE_FAILED,
          provisioningCompletedAt: new Date(),
          provisioningError: errorMessage(error),
          version: { increment: 1 },
        },
      }).catch((markError: unknown) => {
        console.error('Failed to mark rejection as failed:', markError);
      });
    }

    if (requestId && adminUsername) {
      await logAuditAction({
        action: AuditActions.REJECT_REQUEST,
        category: AuditCategories.ACCESS_REQUEST,
        username: adminUsername,
        targetId: requestId,
        targetType: 'AccessRequest',
        success: false,
        errorMessage: errorMessage(error),
        ipAddress: getIpAddress(request),
        userAgent: getUserAgent(request),
      }).catch((logError) => {
        console.error('Failed to log rejection failure:', logError);
      });
    }
    
    return NextResponse.json(
      { error: 'Failed to reject request' },
      { status: 500 }
    );
  }
}
