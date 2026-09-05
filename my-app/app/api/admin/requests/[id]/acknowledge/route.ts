import { NextRequest, NextResponse } from 'next/server';
import { searchLDAPUserForProvisioning } from '@/lib/ldap';
import { prisma } from '@/lib/prisma';
import { checkReviewAccessWithRateLimit } from '@/lib/adminAuth';
import { encryptPassword } from '@/lib/encryption';
import { logAuditAction, AuditActions, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';
import { sendStudentDirectorNotification, sendWorkflowStageNotification } from '@/lib/email';
import { getEmailConfig, getStudentDirectorEmails } from '@/lib/email-config';
import { deliverFacultyNotification } from '@/lib/faculty-notification';
import { isModuleEnabled } from '@/lib/modules/core';
import { actorCanActOnStage, actorHasPermission } from '@/lib/rbac/core';
import {
  findStageIndexByStatus,
  nextReviewStatusAfter,
  resolveStageNotificationRecipients,
  resolveWorkflowForRequest,
  supportsFacultyHandoffActions,
  workflowIntegrityConflict,
} from '@/lib/workflow/core';
import { extractBronconame } from '@/lib/validation';
import { findReusableOffboardedRequest } from '@/lib/offboard-reenrollment';
import { toSafeAccessRequestResponse } from '@/lib/access-request-response';

type ReusableOffboardedRequest = { id: string } | null;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { admin, response } = await checkReviewAccessWithRateLimit(request);

    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const resolvedParams = await params;
    const body = await request.json();
    const { ldapUsername, vpnUsername, password, expirationDate } = body;

    // First, get the request to check if it's internal or external
    const accessRequest = await prisma.accessRequest.findUnique({
      where: { id: resolvedParams.id },
    });

    if (!accessRequest) {
      return NextResponse.json({ error: 'Request not found' }, { status: 404 });
    }
    if (['in_progress', 'reconciliation_required'].includes(accessRequest.accountUpdateState || '')) {
      return NextResponse.json({ error: 'Account update ownership must be resolved before changing request stage.' }, { status: 409 });
    }

    // Resolve the governance workflow this request is pinned to and verify the
    // request is at a preparable (non-final) review stage.
    const workflow = await resolveWorkflowForRequest(accessRequest);
    const workflowConflict = workflowIntegrityConflict(workflow);
    if (workflowConflict) {
      return NextResponse.json({ error: workflowConflict, code: 'WORKFLOW_RECONCILIATION_REQUIRED' }, { status: 409 });
    }
    const currentStageIndex = findStageIndexByStatus(workflow.stages, accessRequest.status);

    if (currentStageIndex === -1 || currentStageIndex >= workflow.stages.length - 1) {
      return NextResponse.json(
        {
          error:
            'Acknowledgement is not available for this request under its configured review workflow. Requests at their final review stage are approved directly.',
        },
        { status: 409 }
      );
    }

    const currentStage = workflow.stages[currentStageIndex];
    if (!actorCanActOnStage(admin, currentStage.reviewerRoleKey)) {
      return NextResponse.json(
        {
          error: `You do not have the reviewer role required for the "${currentStage.label}" stage.`,
          code: 'MISSING_STAGE_ROLE',
        },
        { status: 403 }
      );
    }
    if (!actorHasPermission(admin, 'access_requests.provision')) {
      return NextResponse.json(
        { error: 'Provisioning permission is required to prepare directory credentials.' },
        { status: 403 }
      );
    }

    const nextStatus = nextReviewStatusAfter(workflow.stages, accessRequest.status);
    if (!nextStatus) {
      return NextResponse.json(
        { error: 'No subsequent review stage is configured for this request.' },
        { status: 409 }
      );
    }
    const legacyFacultyHandoff = supportsFacultyHandoffActions(workflow.stages);

    const vpnModuleEnabled = await isModuleEnabled('vpn.management');

    // Validate required fields based on account type
    if (!ldapUsername || !password) {
      return NextResponse.json(
        { error: 'Directory username and password are required' },
        { status: 400 }
      );
    }

    // VPN username is only required for external users when VPN management is enabled
    if (vpnModuleEnabled && !accessRequest.isInternal && !vpnUsername) {
      return NextResponse.json(
        { error: 'VPN username is required for external users' },
        { status: 400 }
      );
    }

    if (!accessRequest) {
      return NextResponse.json({ error: 'Request not found' }, { status: 404 });
    }

    if (!accessRequest.isVerified) {
      return NextResponse.json(
        { error: 'Cannot acknowledge unverified request' },
        { status: 400 }
      );
    }

    // Check Active Directory only when credentials have not already been prepared.
    // An existing accountCreatedAt means this route is handling an existing identity.
    let reusableAdRequest: ReusableOffboardedRequest = null;
    let reusableVpnRequest: ReusableOffboardedRequest = null;
    if (!accessRequest.accountCreatedAt) {
      // Check if LDAP username already exists in Active Directory
      try {
        const ldapUser = await searchLDAPUserForProvisioning(ldapUsername);
        
        if (ldapUser) {
          reusableAdRequest = await findReusableOffboardedRequest({
            username: ldapUsername,
            email: accessRequest.email,
          });

          if (!reusableAdRequest) {
            return NextResponse.json(
              { error: `Directory username "${ldapUsername}" already exists in Active Directory` },
              { status: 400 }
            );
          }
        }
      } catch (ldapError) {
        console.error('LDAP search error during acknowledgment:', ldapError);
        return NextResponse.json(
          { error: 'Failed to verify directory username availability. Please try again.' },
          { status: 500 }
        );
      }

      // Check if username already exists in Active Directory (for external users, VPN module only)
      if (vpnModuleEnabled && !accessRequest.isInternal && vpnUsername) {
        try {
          const vpnUser = await searchLDAPUserForProvisioning(vpnUsername);
          
          if (vpnUser) {
            reusableVpnRequest = await findReusableOffboardedRequest({
              username: vpnUsername,
              email: accessRequest.email,
            });

            if (!reusableVpnRequest) {
              return NextResponse.json(
                { error: `username "${vpnUsername}" already exists in Active Directory` },
                { status: 400 }
              );
            }
          }
        } catch (ldapError) {
          console.error('LDAP search error for username:', ldapError);
          return NextResponse.json(
            { error: 'Failed to verify username availability. Please try again.' },
            { status: 500 }
          );
        }
      }
    }

    // Check if LDAP username is already in use in database
    // NOTE: We exclude reusable terminal requests so usernames can be reused after denial or campaign offboarding.
    const usernameChecks: Array<{ ldapUsername?: string; vpnUsername?: string }> = [{ ldapUsername }];

    // Only check VPN username for external users when the VPN module is enabled
    if (vpnModuleEnabled && !accessRequest.isInternal && vpnUsername) {
      usernameChecks.push({ vpnUsername });
    }
    
    const existingUser = await prisma.accessRequest.findFirst({
      where: {
        OR: usernameChecks,
        id: { not: resolvedParams.id },
        status: { notIn: ['rejected', 'offboarded'] },
      },
    });

    if (existingUser) {
      return NextResponse.json(
        { error: 'Username is already in use by another request' },
        { status: 400 }
      );
    }

    const updateData: {
      acknowledgedByDirector: boolean;
      acknowledgedAt: Date;
      acknowledgedBy: string;
      status: string;
      ldapUsername: string;
      accountPassword: string;
      expirationDate?: Date;
      vpnUsername?: string;
      accountExpiresAt?: Date;
      linkedAdUsername?: string;
      linkedVpnUsername?: string;
      isManuallyAssigned?: boolean;
      manuallyAssignedAt?: Date;
      manuallyAssignedBy?: string;
      manualAssignmentNotes?: string;
      sentToFacultyAt?: null;
      sentToFacultyBy?: null;
      facultyNotificationState?: null;
      facultyNotificationClaimId?: null;
      facultyNotificationClaimedUntil?: null;
      facultyNotificationError?: null;
      stageNotificationState?: string;
      stageNotificationStageKey?: string;
      stageNotificationError?: string;
      stageNotificationStateChangedAt?: Date;
      version: { increment: number };
    } = {
      acknowledgedByDirector: true,
      acknowledgedAt: new Date(),
      acknowledgedBy: admin.username,
      status: nextStatus,
      ldapUsername,
      accountPassword: encryptPassword(password),
      version: { increment: 1 },
    };
    if (legacyFacultyHandoff) {
      updateData.sentToFacultyAt = null;
      updateData.sentToFacultyBy = null;
      updateData.facultyNotificationState = null;
      updateData.facultyNotificationClaimId = null;
      updateData.facultyNotificationClaimedUntil = null;
      updateData.facultyNotificationError = null;
    } else {
      const nextStage = workflow.stages[currentStageIndex + 1];
      updateData.stageNotificationState = 'delivery_unknown';
      updateData.stageNotificationStageKey = nextStage.key;
      updateData.stageNotificationError = `Delivery to ${nextStage.label} has not been confirmed.`;
      updateData.stageNotificationStateChangedAt = new Date();
    }

    const reusableRequest = reusableAdRequest || reusableVpnRequest;

    if (reusableRequest) {
      updateData.linkedAdUsername = ldapUsername;
      if (vpnModuleEnabled) {
        updateData.linkedVpnUsername = vpnUsername || ldapUsername;
      }
      updateData.isManuallyAssigned = true;
      updateData.manuallyAssignedAt = new Date();
      updateData.manuallyAssignedBy = admin.username;
      updateData.manualAssignmentNotes = `Prepared for reactivation from campaign-offboarded request ${reusableRequest.id}`;
    }

    // Only set VPN username for external users when the VPN module is enabled
    if (vpnModuleEnabled && !accessRequest.isInternal) {
      updateData.vpnUsername = vpnUsername;
    }

    // Add expiration date for external users
    if (!accessRequest.isInternal && expirationDate) {
      updateData.accountExpiresAt = new Date(expirationDate);
    }

    const result = await prisma.accessRequest.updateMany({
      where: {
        id: resolvedParams.id,
        status: accessRequest.status,
        version: accessRequest.version,
      },
      data: updateData,
    });

    if (result.count === 0) {
      const current = await prisma.accessRequest.findUnique({
        where: { id: resolvedParams.id },
        select: { status: true }
      });

      return NextResponse.json({
        error: `Request status is ${current?.status}, expected ${accessRequest.status}`
      }, { status: 400 });
    }

    const updatedRequest = await prisma.accessRequest.findUnique({
      where: { id: resolvedParams.id },
    });

    if (!updatedRequest) {
      return NextResponse.json({ error: 'Request not found after update' }, { status: 404 });
    }

    if (reusableRequest) {
      await prisma.requestComment.create({
        data: {
          requestId: resolvedParams.id,
          comment: `Prepared for reactivation from campaign-offboarded request ${reusableRequest.id}. The existing account remains disabled until final approval re-enables access.`,
          author: admin.username,
          type: 'system',
        },
      });
    }

    // Create or update VPN account entry for tracking in VPN Management tab.
    // Skipped entirely when the VPN module is disabled: no records are written,
    // and historical data remains untouched (compatibility contract #4).
    // For internal users with @cpp.edu email, extract bronconame from email for VPN username
    const vpnAccountUsername = accessRequest.isInternal
      ? extractBronconame(accessRequest.email) || ldapUsername
      : vpnUsername || ldapUsername;
    const portalType = accessRequest.isInternal ? 'Limited' : 'External';
    let vpnEntryCreated = false;

    if (vpnModuleEnabled) {
      try {
        // Check if VPN account already exists
        const existingVpnAccount = await prisma.vPNAccount.findUnique({
          where: { username: vpnAccountUsername },
        });

        let vpnAccount;
        const encryptedPassword = encryptPassword(password);

        if (existingVpnAccount) {
          // Update existing VPN account
          vpnAccount = await prisma.vPNAccount.update({
            where: { username: vpnAccountUsername },
            data: {
              name: accessRequest.name,
              email: accessRequest.email,
              portalType: portalType,
              isInternal: accessRequest.isInternal,
              status: nextStatus,
              password: encryptedPassword,
              expiresAt: !accessRequest.isInternal && expirationDate ? new Date(expirationDate) : undefined,
              accessRequestId: resolvedParams.id,
              adUsername: ldapUsername, // Link to AD account
            },
          });

          // Create status log for the update
          await prisma.vPNAccountStatusLog.create({
            data: {
              accountId: vpnAccount.id,
              liveAccountId: vpnAccount.id,
              oldStatus: existingVpnAccount.status,
              newStatus: nextStatus,
              changedBy: admin.username,
              reason: 'Updated from access request acknowledgment',
            },
          });
        } else {
          // Create new VPN account
          vpnAccount = await prisma.vPNAccount.create({
            data: {
              username: vpnAccountUsername,
              name: accessRequest.name,
              email: accessRequest.email,
              portalType: portalType,
              isInternal: accessRequest.isInternal,
              status: nextStatus,
              password: encryptedPassword,
              expiresAt: !accessRequest.isInternal && expirationDate ? new Date(expirationDate) : undefined,
              createdBy: admin.username,
              createdByFaculty: false,
              accessRequestId: resolvedParams.id,
              adUsername: ldapUsername, // Link to AD account
            },
          });

          // Create initial status log for the new VPN account
          await prisma.vPNAccountStatusLog.create({
            data: {
              accountId: vpnAccount.id,
              liveAccountId: vpnAccount.id,
              oldStatus: null,
              newStatus: nextStatus,
              changedBy: admin.username,
              reason: 'Created from access request',
            },
          });
        }
        vpnEntryCreated = true;
      } catch (vpnError) {
        console.error('Error creating/updating VPN account entry:', vpnError);
        // Continue even if VPN account creation fails - this is for tracking only
      }
    }

    // adding comments at steps - report only what actually happened
    let commentText = `Request acknowledged by ${admin.username} and moved to ${workflow.stages[currentStageIndex + 1].label}. Credentials set: directory username: ${ldapUsername}`;
    if (vpnModuleEnabled && !accessRequest.isInternal && vpnUsername) {
      commentText += `, Username: ${vpnUsername}`;
    }
    if (!accessRequest.isInternal && expirationDate) {
      const expDate = new Date(expirationDate).toLocaleDateString();
      commentText += `, Expiration: ${expDate}`;
    }
    if (vpnModuleEnabled) {
      commentText += vpnEntryCreated
        ? '. VPN account entry created for tracking.'
        : '. VPN tracking entry could not be created.';
    } else {
      commentText += '. VPN management is disabled; no VPN entry was created.';
    }

    await prisma.requestComment.create({
      data: {
        requestId: resolvedParams.id,
        comment: commentText,
        author: admin.username,
        type: 'system',
      },
    });

    const nextStage = workflow.stages[currentStageIndex + 1];
    const stageRecipients = await resolveStageNotificationRecipients(nextStage, async () => {
      if (nextStage.reviewerRoleKey === 'faculty') {
        const emailConfig = await getEmailConfig();
        return emailConfig.facultyEmail ? [emailConfig.facultyEmail] : [];
      }
      return getStudentDirectorEmails();
    });
    let responseRequest = updatedRequest;
    let stageNotificationStatus = stageRecipients.length > 0 ? 'failed' : 'not_configured';
    if (legacyFacultyHandoff) {
      // The exact Directors-to-Faculty compatibility workflow retains its
      // durable provider-outcome state and legacy templates.
      if (stageRecipients.length === 0) {
        await prisma.accessRequest.updateMany({
          where: { id: resolvedParams.id, status: nextStatus, facultyNotificationState: null },
          data: {
            facultyNotificationState: 'failed',
            facultyNotificationError: 'No faculty delivery recipient is configured',
          },
        });
      } else {
        const delivery = await deliverFacultyNotification({
          requestId: resolvedParams.id,
          actor: admin.username,
          recipients: stageRecipients,
          vpnModuleEnabled,
          expectedStatus: nextStatus,
        });
        stageNotificationStatus = delivery.status;
        if (delivery.status === 'delivered') responseRequest = delivery.request;
      }

      try {
        const directorEmails = await resolveStageNotificationRecipients(currentStage, getStudentDirectorEmails);
        if (directorEmails.length > 0) {
          await sendStudentDirectorNotification(
            'Request moved to Faculty review',
            'An access request has been acknowledged and moved to the configured Faculty review stage.',
            {
              'Request ID': resolvedParams.id,
              'Name': updatedRequest.name,
              'Email': updatedRequest.email,
              'Directory Username': ldapUsername,
              'VPN Username': vpnUsername || 'N/A',
              'Type': accessRequest.isInternal ? 'Internal requester' : 'External requester',
              'Portal Type': portalType,
              'Acknowledged By': admin.username,
              'Acknowledged At': new Date().toLocaleString(),
            },
            directorEmails
          );
        }
      } catch (emailError) {
        console.error('[Acknowledge] Failed to send legacy-stage confirmation:', emailError);
      }
    } else if (stageRecipients.length > 0) {
      try {
        await sendWorkflowStageNotification({
          recipients: stageRecipients,
          requestId: resolvedParams.id,
          requestName: updatedRequest.name,
          requestEmail: updatedRequest.email,
          stageLabel: nextStage.label,
          advancedBy: admin.username,
        });
        stageNotificationStatus = 'delivered';
      } catch (emailError) {
        console.error('[Acknowledge] Configured stage notification outcome is unknown:', emailError);
        stageNotificationStatus = 'delivery_unknown';
      }
    }

    if (!legacyFacultyHandoff) {
      const persistedState = stageNotificationStatus === 'delivered'
        ? 'delivered'
        : stageNotificationStatus === 'not_configured'
          ? 'failed'
          : 'delivery_unknown';
      const persistedError = persistedState === 'delivered'
        ? null
        : persistedState === 'failed'
          ? `No notification recipient is configured for ${nextStage.label}.`
          : `Delivery to ${nextStage.label} could not be confirmed. Reconcile the provider outcome before retrying.`;
      const notificationUpdate = await prisma.accessRequest.updateMany({
        where: {
          id: resolvedParams.id,
          status: nextStatus,
          stageNotificationStageKey: nextStage.key,
          stageNotificationState: 'delivery_unknown',
        },
        data: {
          stageNotificationState: persistedState,
          stageNotificationError: persistedError,
          stageNotificationStateChangedAt: new Date(),
          version: { increment: 1 },
        },
      });
      if (notificationUpdate.count === 1) {
        responseRequest = await prisma.accessRequest.findUnique({ where: { id: resolvedParams.id } }) || responseRequest;
      } else {
        stageNotificationStatus = 'delivery_unknown';
      }
    }

    // Log the acknowledgment action
    await logAuditAction({
      action: AuditActions.ACKNOWLEDGE_REQUEST,
      category: AuditCategories.ACCESS_REQUEST,
      username: admin.username,
      targetId: resolvedParams.id,
      targetType: 'AccessRequest',
      details: {
        requestName: updatedRequest.name,
        requestEmail: updatedRequest.email,
        ldapUsername,
        vpnUsername,
        isInternal: accessRequest.isInternal,
        expirationDate,
        vpnAccountCreated: vpnEntryCreated,
        vpnModuleEnabled,
        workflowVersionId: workflow.id,
        workflowVersion: workflow.version,
        stageNotificationStatus,
        legacyFacultyHandoff,
      },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    return NextResponse.json(
      {
        success: stageNotificationStatus === 'delivered',
        partial: stageNotificationStatus !== 'delivered',
        stageNotificationStatus,
        ...(legacyFacultyHandoff ? { facultyDeliveryStatus: stageNotificationStatus } : {}),
        request: toSafeAccessRequestResponse(responseRequest),
      },
      { status: stageNotificationStatus === 'delivery_unknown' ? 202 : 200 }
    );
  } catch (error) {
    console.error('Error acknowledging request:', error);
    
    // Log the failed acknowledgment
    const resolvedParams = await params;
    const { admin } = await checkReviewAccessWithRateLimit(request);
    if (admin) {
      await logAuditAction({
        action: AuditActions.ACKNOWLEDGE_REQUEST,
        category: AuditCategories.ACCESS_REQUEST,
        username: admin.username,
        targetId: resolvedParams.id,
        targetType: 'AccessRequest',
        success: false,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        ipAddress: getIpAddress(request),
        userAgent: getUserAgent(request),
      });
    }
    
    return NextResponse.json(
      { error: 'Failed to acknowledge request' },
      { status: 500 }
    );
  }
}
