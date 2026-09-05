import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { randomBytes, createHash } from 'crypto';
import { sendAccountReadyEmail, sendAccountActivationEmail } from '@/lib/email';
import { disableLDAPUser, enableLDAPUser, setLDAPUserExpiration } from '@/lib/ldap';
import { prisma } from '@/lib/prisma';
import { checkReviewAccessWithRateLimit } from '@/lib/adminAuth';
import { decryptPassword } from '@/lib/encryption';
import { logAuditAction, AuditActions, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';
import { isModuleEnabled } from '@/lib/modules/core';
import { actorCanActOnStage } from '@/lib/rbac/core';
import {
  findStageIndexByStatus,
  isFinalStageStatus,
  resolveWorkflowForRequest,
  workflowIntegrityConflict,
} from '@/lib/workflow/core';
import { evaluateApprovalSeparationOfDuties } from '@/lib/workflow/sod';
import { extractBronconame, isJsonBodyError, MAX_REQUEST_BODY_SIZE, parseJsonWithLimit } from '@/lib/validation';
import { toSafeAccessRequestResponse } from '@/lib/access-request-response';

const APPROVAL_STATE_IN_PROGRESS = 'approval_in_progress';
const APPROVAL_STATE_FAILED = 'approval_failed';
const APPROVAL_EMAIL_SENDING = 'approval_email_sending';
const ACTIVATION_EMAIL_PENDING = 'activation_email_pending';
const CREDENTIALS_EMAIL_PENDING = 'credentials_email_pending';
const REJECTION_STATE_IN_PROGRESS = 'rejection_in_progress';
const ACCOUNT_CREATION_IN_PROGRESS = 'in_progress';

class HttpError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

interface ApproveRequestBody {
  message?: unknown;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

async function rollbackExternalEnablement(accessRequest: {
  isInternal: boolean;
  ldapUsername: string | null;
  vpnUsername: string | null;
}) {
  if (accessRequest.isInternal) {
    return;
  }

  const usernames = Array.from(new Set([
    accessRequest.ldapUsername,
    accessRequest.vpnUsername,
  ].filter((username): username is string => !!username)));

  for (const username of usernames) {
    try {
      await disableLDAPUser(username);
      await setLDAPUserExpiration(username, new Date());
    } catch (rollbackError) {
      console.error('Failed to roll back externally enabled LDAP account:', {
        username,
        error: errorMessage(rollbackError),
      });
    }
  }
}

async function markApprovalState(
  requestId: string,
  state: string | null,
  error?: unknown
) {
  await prisma.accessRequest.update({
    where: { id: requestId },
    data: {
      provisioningState: state,
      provisioningCompletedAt: new Date(),
      provisioningError: error ? errorMessage(error) : null,
    },
  });
}

async function activateVpnAccount(
  accessRequest: {
    id: string;
    email: string;
    isInternal: boolean;
    ldapUsername: string | null;
    vpnUsername: string | null;
  },
  adminUsername: string
) {
  let vpnAccountUsername: string;
  if (accessRequest.isInternal) {
    vpnAccountUsername = extractBronconame(accessRequest.email) || accessRequest.ldapUsername!;
  } else {
    vpnAccountUsername = accessRequest.vpnUsername || accessRequest.ldapUsername!;
  }

  try {
    const vpnAccount = await prisma.vPNAccount.findUnique({
      where: { username: vpnAccountUsername },
    });

    if (!vpnAccount) {
      if (!accessRequest.isInternal) {
        throw new Error(`VPN account record not found for external username ${vpnAccountUsername}`);
      }
      return;
    }

    await prisma.vPNAccount.update({
      where: { id: vpnAccount.id },
      data: {
        status: 'active',
        createdByFaculty: true,
        facultyCreatedAt: new Date(),
      },
    });

    await prisma.vPNAccountStatusLog.create({
      data: {
        accountId: vpnAccount.id,
        liveAccountId: vpnAccount.id,
        oldStatus: vpnAccount.status,
        newStatus: 'active',
        changedBy: adminUsername,
        reason: 'Faculty approved request',
      },
    });
  } catch (vpnError) {
    console.error('Error updating VPN account status:', vpnError);
    throw vpnError;
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let requestId: string | null = null;
  let adminUsername: string | null = null;
  let approvalStageRoleKey: string | null = null;

  try {
    const { admin, response } = await checkReviewAccessWithRateLimit(request);

    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    adminUsername = admin.username;
    const resolvedParams = await params;
    requestId = resolvedParams.id;

    const body = await parseJsonWithLimit<ApproveRequestBody>(request, MAX_REQUEST_BODY_SIZE.SMALL);
    if (body.message !== undefined && typeof body.message !== 'string') {
      return NextResponse.json({ error: 'Approval message must be a string' }, { status: 400 });
    }
    const approvalMessage = typeof body.message === 'string' ? body.message.trim() : '';

    const vpnModuleEnabled = await isModuleEnabled('vpn.management');

    // Governance precheck OUTSIDE the serializable section: a denial must not
    // leave a claimed (approval_in_progress) request behind.
    let sodEvaluation: Awaited<ReturnType<typeof evaluateApprovalSeparationOfDuties>> | null = null;
    {
      const preCheck = await prisma.accessRequest.findUnique({
        where: { id: resolvedParams.id },
        select: {
          status: true,
          workflowVersionId: true,
          acknowledgedBy: true,
          acknowledgedAt: true,
          sentToFacultyBy: true,
          sentToFacultyAt: true,
          manuallyAssignedBy: true,
          manuallyAssignedAt: true,
        },
      });
      if (!preCheck) {
        throw new HttpError('Request not found', 404);
      }
      const preWorkflow = await resolveWorkflowForRequest(preCheck);
      const preWorkflowConflict = workflowIntegrityConflict(preWorkflow);
      if (preWorkflowConflict) throw new HttpError(preWorkflowConflict, 409);
      if (!isFinalStageStatus(preWorkflow.stages, preCheck.status)) {
        throw new HttpError(
          `Request status is ${preCheck.status}, expected the final review stage of workflow v${preWorkflow.version}`,
          409
        );
      }
      approvalStageRoleKey =
        preWorkflow.stages[
          findStageIndexByStatus(preWorkflow.stages, preCheck.status)
        ].reviewerRoleKey;

      if (!actorCanActOnStage(admin, approvalStageRoleKey)) {
        return NextResponse.json(
          {
            error: 'You do not have the reviewer role required to approve requests at this stage.',
            code: 'MISSING_STAGE_ROLE',
          },
          { status: 403 }
        );
      }

      // Segregation-of-duties evaluation happens BEFORE any claim or external
      // side effect, so "block" mode leaves the request untouched.
      sodEvaluation = await evaluateApprovalSeparationOfDuties(preCheck, admin.username);
      if (sodEvaluation.mode === 'block' && sodEvaluation.violated) {
        return NextResponse.json(
          {
            error:
              'Blocked by segregation-of-duties policy: this request was acknowledged/assigned by you at an earlier stage. Another reviewer must perform the final approval.',
            code: 'SOD_BLOCKED',
            priorActions: sodEvaluation.priorActions,
          },
          { status: 403 }
        );
      }
    }

      const { accessRequest, lockedVersion } = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const requestRecord = await tx.accessRequest.findUnique({
        where: { id: resolvedParams.id },
      });

      if (!requestRecord) {
        throw new HttpError('Request not found', 404);
      }

      if (!requestRecord.isVerified) {
        throw new HttpError('Cannot approve unverified request');
      }
      if (['in_progress', 'reconciliation_required'].includes(requestRecord.accountUpdateState || '')) {
        throw new HttpError('Account identity reconciliation must finish before approval', 409);
      }
      if (requestRecord.facultyNotificationState === 'sending') {
        throw new HttpError('Faculty delivery is in progress; its outcome must settle before approval', 409);
      }
      if (requestRecord.provisioningState === 'reconciliation_pending') {
        throw new HttpError('Directory reconciliation is in progress; wait for it to finish before approval', 409);
      }

      // Resolve the governance workflow this request is pinned to. Approval
      // happens at the final configured review stage, whatever its label is.
      const workflow = await resolveWorkflowForRequest(requestRecord);
      const workflowConflict = workflowIntegrityConflict(workflow);
      if (workflowConflict) throw new HttpError(workflowConflict, 409);

      if (!isFinalStageStatus(workflow.stages, requestRecord.status)) {
        throw new HttpError(
          `Request status is ${requestRecord.status}, expected the final review stage of workflow v${workflow.version}`,
          409
        );
      }

      approvalStageRoleKey =
        workflow.stages[findStageIndexByStatus(workflow.stages, requestRecord.status)].reviewerRoleKey;

      if (!requestRecord.ldapUsername) {
        throw new HttpError('A directory username must be set before approval');
      }

      if (!requestRecord.isInternal && !requestRecord.accountPassword) {
        throw new HttpError('Account credentials must be set by Student Directors before approval for external users');
      }

      if (vpnModuleEnabled && !requestRecord.isInternal && !requestRecord.vpnUsername) {
        throw new HttpError('VPN Username must be set for external users before approval');
      }

      const claim = await tx.accessRequest.updateMany({
        where: {
          id: resolvedParams.id,
          version: requestRecord.version,
          status: requestRecord.status,
          isVerified: true,
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
          provisioningState: APPROVAL_STATE_IN_PROGRESS,
          provisioningStartedAt: new Date(),
          provisioningCompletedAt: null,
          provisioningError: null,
          version: { increment: 1 },
        },
      });

      if (claim.count !== 1) {
        throw new HttpError(
          'Another administrator is currently processing this request. Please refresh and try again.',
          409
        );
      }

      return {
        accessRequest: requestRecord,
        lockedVersion: requestRecord.version + 1,
      };
    }, {
      isolationLevel: 'Serializable',
      timeout: 10000,
    });

    const ldapUsername = accessRequest.ldapUsername;
    if (!ldapUsername) {
      throw new HttpError('A directory username must be set before approval');
    }

    try {
      await enableLDAPUser(ldapUsername);

      if (
        vpnModuleEnabled &&
        !accessRequest.isInternal &&
        accessRequest.vpnUsername &&
        accessRequest.vpnUsername !== ldapUsername
      ) {
        await enableLDAPUser(accessRequest.vpnUsername);
      }
    } catch (ldapError) {
      console.error('Error enabling LDAP accounts:', ldapError);
      await prisma.accessRequest.updateMany({
        where: {
          id: resolvedParams.id,
          version: lockedVersion,
          provisioningState: APPROVAL_STATE_IN_PROGRESS,
        },
        data: {
          provisioningState: APPROVAL_STATE_FAILED,
          provisioningCompletedAt: new Date(),
          provisioningError: errorMessage(ldapError),
          version: { increment: 1 },
        },
      });

      return NextResponse.json(
        { error: 'Failed to enable account(s) in Active Directory' },
        { status: 500 }
      );
    }

    const approvalTime = new Date();
    let approvalResult: { count: number };

    try {
      approvalResult = await prisma.accessRequest.updateMany({
        where: {
          id: resolvedParams.id,
          version: lockedVersion,
          status: accessRequest.status,
          provisioningState: APPROVAL_STATE_IN_PROGRESS,
        },
        data: {
          status: 'approved',
          approvedAt: approvalTime,
          approvedBy: admin.username,
          approvalMessage: approvalMessage || null,
          accountCreatedAt: approvalTime,
          provisioningState: APPROVAL_EMAIL_SENDING,
          provisioningError: null,
          version: { increment: 1 },
        },
      });
    } catch (approvalUpdateError) {
      await rollbackExternalEnablement(accessRequest);
      await prisma.accessRequest.updateMany({
        where: {
          id: resolvedParams.id,
          version: lockedVersion,
          provisioningState: APPROVAL_STATE_IN_PROGRESS,
        },
        data: {
          provisioningState: APPROVAL_STATE_FAILED,
          provisioningCompletedAt: new Date(),
          provisioningError: `Approval database update failed after LDAP enablement; external account enablement rollback attempted. Error: ${errorMessage(approvalUpdateError)}`,
          version: { increment: 1 },
        },
      }).catch((markError: unknown) => {
        console.error('Failed to mark approval failed after database update error:', markError);
      });

      throw approvalUpdateError;
    }

    if (approvalResult.count !== 1) {
      await rollbackExternalEnablement(accessRequest);
      await prisma.accessRequest.updateMany({
        where: {
          id: resolvedParams.id,
          version: lockedVersion,
          provisioningState: APPROVAL_STATE_IN_PROGRESS,
        },
        data: {
          provisioningState: APPROVAL_STATE_FAILED,
          provisioningCompletedAt: new Date(),
          provisioningError: 'Approval state was moved after LDAP enablement; external account enablement rollback attempted.',
          version: { increment: 1 },
        },
      });

      throw new HttpError(
        'Another administrator moved this request after it was claimed. Manual review may be required.',
        409
      );
    }

    const updatedRequest = await prisma.accessRequest.findUnique({
      where: { id: resolvedParams.id },
    });

    if (!updatedRequest) {
      throw new HttpError('Request not found after update', 404);
    }

    // Activate the VPN tracking record only while VPN management is enabled.
    // With the module disabled, approval completes as an AD-only flow and no
    // VPN records are written; historical data is untouched.
    if (vpnModuleEnabled) {
      try {
        await activateVpnAccount(updatedRequest, admin.username);
      } catch (vpnError) {
      await rollbackExternalEnablement(updatedRequest);
      await markApprovalState(updatedRequest.id, APPROVAL_STATE_FAILED, vpnError);

      await prisma.requestComment.create({
        data: {
          requestId: resolvedParams.id,
          comment: `Request was marked approved, but VPN account activation failed before the user notification was sent. Manual review required. Error: ${errorMessage(vpnError)}`,
          author: admin.username,
          type: 'system',
        },
      });

      await logAuditAction({
        action: AuditActions.APPROVE_REQUEST,
        category: AuditCategories.ACCESS_REQUEST,
        username: admin.username,
        actorType: 'admin',
        targetId: resolvedParams.id,
        targetType: 'AccessRequest',
        subjectUsername: updatedRequest.ldapUsername || updatedRequest.vpnUsername,
        subjectEmail: updatedRequest.email,
        relatedRequestId: resolvedParams.id,
        eventKind: 'write',
        outcome: 'rollback',
        success: false,
        errorMessage: errorMessage(vpnError),
        details: {
          requestName: updatedRequest.name,
          requestEmail: updatedRequest.email,
          ldapUsername: updatedRequest.ldapUsername,
          vpnUsername: updatedRequest.vpnUsername,
          isInternal: updatedRequest.isInternal,
          vpnActivationFailed: true,
        },
        ipAddress: getIpAddress(request),
        userAgent: getUserAgent(request),
      });

      return NextResponse.json(
        {
          error: 'Request was approved, but VPN account activation failed. Manual review is required before notifying the user.',
        },
        { status: 500 }
      );
      }
    }

    try {
      if (updatedRequest.isInternal) {
        const activationToken = randomBytes(32).toString('hex');
        const tokenHash = createHash('sha256').update(activationToken).digest('hex');
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

        await prisma.accountActivationToken.upsert({
          where: { accessRequestId: updatedRequest.id },
          update: {
            tokenHash,
            expiresAt,
            used: false,
            usedAt: null,
            attempts: 0,
            ipAddress: null,
            userAgent: null,
            createdAt: new Date(),
          },
          create: {
            accessRequestId: updatedRequest.id,
            tokenHash,
            expiresAt,
          },
        });

        await sendAccountActivationEmail(
          updatedRequest.email,
          updatedRequest.name,
          updatedRequest.ldapUsername!,
          activationToken,
          expiresAt
        );
      } else {
        const decryptedPassword = decryptPassword(updatedRequest.accountPassword!);

        await sendAccountReadyEmail(
          updatedRequest.email,
          updatedRequest.name,
          updatedRequest.ldapUsername!,
          decryptedPassword,
          true,
          approvalMessage || undefined
        );
      }
    } catch (emailError) {
      const pendingState = updatedRequest.isInternal
        ? ACTIVATION_EMAIL_PENDING
        : CREDENTIALS_EMAIL_PENDING;

      await markApprovalState(updatedRequest.id, pendingState, emailError);

      await prisma.requestComment.create({
        data: {
          requestId: resolvedParams.id,
          comment: `Request approved by ${admin.username}, but the notification email failed. Use the resend action to recover. Error: ${errorMessage(emailError)}`,
          author: admin.username,
          type: 'system',
        },
      });

      await logAuditAction({
        action: AuditActions.APPROVE_REQUEST,
        category: AuditCategories.ACCESS_REQUEST,
        username: admin.username,
        actorType: 'admin',
        targetId: resolvedParams.id,
        targetType: 'AccessRequest',
        subjectUsername: updatedRequest.ldapUsername || updatedRequest.vpnUsername,
        subjectEmail: updatedRequest.email,
        relatedRequestId: resolvedParams.id,
        eventKind: 'notification',
        outcome: 'pending',
        details: {
          requestName: updatedRequest.name,
          requestEmail: updatedRequest.email,
          ldapUsername: updatedRequest.ldapUsername,
          vpnUsername: updatedRequest.vpnUsername,
          isInternal: updatedRequest.isInternal,
          approvalMessage,
          emailSent: false,
          emailFailureState: pendingState,
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
          warning: 'Request approved, but the notification email failed. Use the resend action to recover.',
          request: toSafeAccessRequestResponse(requestWithFailureState),
        },
        { status: 202 }
      );
    }

    await markApprovalState(updatedRequest.id, null);

    let commentText: string;
    if (updatedRequest.isInternal) {
      commentText = `Request approved by ${admin.username}. Directory account enabled in Active Directory. Activation link sent to ${updatedRequest.email}.`;
    } else {
      commentText = `Request approved by ${admin.username}. Directory account(s) enabled in Active Directory. Credentials sent to ${updatedRequest.email}.`;
    }
    if (approvalMessage) {
      commentText += `\n\nFollow-up message: ${approvalMessage}`;
    }

    await prisma.requestComment.create({
      data: {
        requestId: resolvedParams.id,
        comment: commentText,
        author: admin.username,
        type: 'system',
      },
    });

    await logAuditAction({
      action: AuditActions.APPROVE_REQUEST,
      category: AuditCategories.ACCESS_REQUEST,
      username: admin.username,
      actorType: 'admin',
      targetId: resolvedParams.id,
      targetType: 'AccessRequest',
      subjectUsername: updatedRequest.ldapUsername || updatedRequest.vpnUsername,
      subjectEmail: updatedRequest.email,
      relatedRequestId: resolvedParams.id,
      eventKind: 'write',
      outcome: 'success',
      details: {
        requestName: updatedRequest.name,
        requestEmail: updatedRequest.email,
        ldapUsername: updatedRequest.ldapUsername,
        vpnUsername: updatedRequest.vpnUsername,
        isInternal: updatedRequest.isInternal,
        approvalMessage,
        emailSent: true,
        vpnModuleEnabled,
        // SoD evidence (roadmap §8): flag mode annotates same-actor approvals
        // without blocking them; off mode records nothing.
        ...(sodEvaluation?.mode === 'flag' && sodEvaluation.violated
          ? {
              sodFlagged: true,
              sodPriorActions: sodEvaluation.priorActions,
            }
          : {}),
      },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    const finalRequest = await prisma.accessRequest.findUnique({
      where: { id: resolvedParams.id },
    });

    return NextResponse.json({
      success: true,
      request: toSafeAccessRequestResponse(finalRequest),
    });
  } catch (error) {
    if (isJsonBodyError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }

    if (error instanceof HttpError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    console.error('Error approving request:', error);

    if (requestId && adminUsername) {
      await logAuditAction({
        action: AuditActions.APPROVE_REQUEST,
        category: AuditCategories.ACCESS_REQUEST,
        username: adminUsername,
        actorType: 'admin',
        targetId: requestId,
        targetType: 'AccessRequest',
        relatedRequestId: requestId,
        eventKind: 'write',
        outcome: 'failure',
        success: false,
        errorMessage: errorMessage(error),
        ipAddress: getIpAddress(request),
        userAgent: getUserAgent(request),
      }).catch((logError) => {
        console.error('Failed to log approval failure:', logError);
      });
    }

    return NextResponse.json(
      { error: 'Failed to approve request' },
      { status: 500 }
    );
  }
}
