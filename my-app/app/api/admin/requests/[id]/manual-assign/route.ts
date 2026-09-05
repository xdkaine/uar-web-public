import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { actorCanActOnStage, actorHasPermission } from '@/lib/rbac/core';
import { logAuditAction, AuditActions, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';
import { searchLDAPUser } from '@/lib/ldap';
import { sendManualAssignmentLinkedEmail, sendWorkflowStageNotification } from '@/lib/email';
import { getEmailConfig, getStudentDirectorEmails } from '@/lib/email-config';
import { extractBronconame } from '@/lib/validation';
import { appLogger } from '@/lib/logger';
import { isModuleEnabled } from '@/lib/modules/core';
import { toSafeAccessRequestResponse } from '@/lib/access-request-response';
import { isProductionCloneReadOnly } from '@/lib/clone-safety';
import {
  acquireDirectoryOwnershipFence,
  directoryObjectIdentity,
  directoryObjectIdentityMatches,
  findBatchDirectoryOwnershipClaims,
  type DirectoryObjectIdentity,
} from '@/lib/directory-ownership-fence';
import {
  findStageIndexByStatus,
  nextReviewStatusAfter,
  resolveStageNotificationRecipients,
  resolveWorkflowForRequest,
  workflowIntegrityConflict,
} from '@/lib/workflow/core';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);

    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!actorHasPermission(admin, 'access_requests.provision')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (isProductionCloneReadOnly()) {
      return NextResponse.json({
        error: 'Manual directory assignment is disabled in this production-clone environment.',
        code: 'CLONE_READ_ONLY',
      }, { status: 409 });
    }

    const vpnModuleEnabled = await isModuleEnabled('vpn.management');

    const resolvedParams = await params;
    const body = await request.json();
    const { linkedAdUsername, linkedVpnUsername, notes, forceAssignment } = body;

    if (!linkedAdUsername || linkedAdUsername.trim() === '') {
      return NextResponse.json(
        { error: 'Active Directory username is required' },
        { status: 400 }
      );
    }

    const accessRequest = await prisma.accessRequest.findUnique({
      where: { id: resolvedParams.id },
    });

    if (!accessRequest) {
      return NextResponse.json({ error: 'Request not found' }, { status: 404 });
    }

    if (!accessRequest.isVerified) {
      return NextResponse.json(
        { error: 'Cannot manually assign unverified request' },
        { status: 400 }
      );
    }

    if (accessRequest.status === 'approved') {
      return NextResponse.json(
        { error: 'Request has already been approved' },
        { status: 400 }
      );
    }

    if (accessRequest.status === 'rejected') {
      return NextResponse.json(
        { error: 'Cannot manually assign a rejected request' },
        { status: 400 }
      );
    }

    if (accessRequest.isManuallyAssigned) {
      return NextResponse.json(
        { 
          error: `Request was already manually assigned to "${accessRequest.linkedAdUsername}" by ${accessRequest.manuallyAssignedBy} on ${new Date(accessRequest.manuallyAssignedAt!).toLocaleString()}` 
        },
        { status: 400 }
      );
    }

    if (['in_progress', 'reconciliation_required'].includes(accessRequest.accountUpdateState || '')) {
      return NextResponse.json(
        { error: 'Account identity reconciliation must finish before manual assignment can change this request' },
        { status: 409 }
      );
    }
    if (accessRequest.facultyNotificationState === 'sending') {
      return NextResponse.json(
        { error: 'Faculty delivery is in progress; its outcome must settle before manual assignment' },
        { status: 409 }
      );
    }

    const workflow = await resolveWorkflowForRequest(accessRequest);
    const workflowConflict = workflowIntegrityConflict(workflow);
    if (workflowConflict) {
      return NextResponse.json({ error: workflowConflict, code: 'WORKFLOW_RECONCILIATION_REQUIRED' }, { status: 409 });
    }
    const currentStageIndex = findStageIndexByStatus(workflow.stages, accessRequest.status);
    const currentStage = currentStageIndex >= 0 ? workflow.stages[currentStageIndex] : null;
    if (!currentStage || !actorCanActOnStage(admin, currentStage.reviewerRoleKey)) {
      return NextResponse.json({ error: 'Manual assignment is unavailable at the current configured review stage.' }, { status: 403 });
    }
    const nextStatus = nextReviewStatusAfter(workflow.stages, accessRequest.status);
    const isFinalStage = nextStatus === null;
    const nextStage = isFinalStage ? null : workflow.stages[currentStageIndex + 1];
    const targetStatus = nextStatus ?? 'approved';
    const vpnTrackingStatus = isFinalStage ? 'active' : targetStatus;

    // This stays as a warning because manual assignment is the escape hatch for legacy account mismatches.
    if (accessRequest.isInternal && accessRequest.email && !forceAssignment) {
      const expectedUsername = extractBronconame(accessRequest.email);
      if (expectedUsername && expectedUsername !== linkedAdUsername.toLowerCase()) {
        appLogger.warn('Manual assignment username mismatch with email bronconame', {
          requestId: resolvedParams.id,
          email: accessRequest.email,
          expectedUsername,
          providedUsername: linkedAdUsername,
          assignedBy: admin.username,
        });

        return NextResponse.json(
          { 
            warning: true,
            error: `Username mismatch detected: Email "${accessRequest.email}" suggests username should be "${expectedUsername}", but you entered "${linkedAdUsername}". This may be intentional for existing accounts.`,
            suggestion: expectedUsername,
            providedUsername: linkedAdUsername,
            message: 'If this is correct (e.g., linking to a pre-existing account with different username), please confirm to proceed with force assignment.',
            requiresConfirmation: true,
          },
          { status: 409 }
        );
      }
    }

    let adDisplayName: string | null = null;
    let verifiedAdIdentity: DirectoryObjectIdentity | null = null;
    try {
      const adUser = await searchLDAPUser(linkedAdUsername);
      if (!adUser) {
        return NextResponse.json(
          { error: `Directory account "${linkedAdUsername}" was not found in Active Directory` },
          { status: 404 }
        );
      }
      const displayNameAttr = adUser.attributes.find(attr => attr.type === 'cn' || attr.type === 'displayName');
      adDisplayName = displayNameAttr?.values[0] || null;
      verifiedAdIdentity = directoryObjectIdentity(adUser);
      if (!verifiedAdIdentity) {
        return NextResponse.json(
          { error: 'The Active Directory account has no immutable identity evidence and cannot be linked safely.' },
          { status: 409 }
        );
      }
    } catch (ldapError) {
      console.error('LDAP search error:', ldapError);
      return NextResponse.json(
        { error: 'Failed to verify Active Directory account. Please check the username and try again.' },
        { status: 500 }
      );
    }

    if (vpnModuleEnabled && !accessRequest.isInternal && linkedVpnUsername && linkedVpnUsername.trim() !== '') {
      try {
        const vpnUser = await searchLDAPUser(linkedVpnUsername);
        if (!vpnUser) {
          return NextResponse.json(
            { error: `VPN account "${linkedVpnUsername}" was not found in Active Directory` },
            { status: 404 }
          );
        }
      } catch (ldapError) {
        console.error('LDAP search error for VPN:', ldapError);
        return NextResponse.json(
          { error: 'Failed to verify VPN account. Please check the username and try again.' },
          { status: 500 }
        );
      }
    }

    let updatedRequest;
    
    try {
      const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        console.log(`[Manual Assignment] Starting transaction for request ${resolvedParams.id}`);
        const canonicalAdUsername = linkedAdUsername.trim().toLowerCase();
        await acquireDirectoryOwnershipFence(tx, canonicalAdUsername);
        const currentAdUser = await searchLDAPUser(canonicalAdUsername);
        if (!verifiedAdIdentity || !directoryObjectIdentityMatches(verifiedAdIdentity, currentAdUser)) {
          throw new Error(`Active Directory identity "${linkedAdUsername}" changed before portal ownership was reserved.`);
        }
        const existingAdOwner = await tx.accessRequest.findFirst({
          where: {
            id: { not: resolvedParams.id },
            status: { notIn: ['rejected', 'offboarded'] },
            OR: [
              { ldapUsername: { equals: linkedAdUsername.trim(), mode: 'insensitive' } },
              { linkedAdUsername: { equals: linkedAdUsername.trim(), mode: 'insensitive' } },
            ],
          },
          select: { id: true },
        });
        if (existingAdOwner) {
          throw new Error(`Active Directory username "${linkedAdUsername}" already has an active portal owner.`);
        }
        const batchAdOwners = await findBatchDirectoryOwnershipClaims(tx, canonicalAdUsername, 'AD');
        if (batchAdOwners.length > 0) {
          throw new Error(`Active Directory username "${linkedAdUsername}" already has an active batch run owner.`);
        }

        if (vpnModuleEnabled && !accessRequest.isInternal) {
          const vpnUsername = linkedVpnUsername?.trim() || linkedAdUsername.trim();
          const canonicalVpnUsername = vpnUsername.toLowerCase();
          await tx.$queryRaw<Array<{ lock_acquired: string }>>`
            SELECT 'locked'::text AS lock_acquired
            FROM pg_advisory_xact_lock(hashtextextended(${canonicalVpnUsername}, 873212))
          `;
          const existingVpnOwner = await tx.accessRequest.findFirst({
            where: {
              id: { not: resolvedParams.id },
              status: { notIn: ['rejected', 'offboarded'] },
              OR: [
                { vpnUsername: { equals: vpnUsername, mode: 'insensitive' } },
                { linkedVpnUsername: { equals: vpnUsername, mode: 'insensitive' } },
              ],
            },
            select: { id: true },
          });
          if (existingVpnOwner) {
            throw new Error(`VPN username "${vpnUsername}" already has an active portal owner.`);
          }
          const batchVpnOwners = await findBatchDirectoryOwnershipClaims(tx, canonicalVpnUsername, 'VPN');
          if (batchVpnOwners.length > 0) {
            throw new Error(`VPN username "${vpnUsername}" already has an active batch run owner.`);
          }
        }
        
        const updateData: Prisma.AccessRequestUpdateManyMutationInput = {
          isManuallyAssigned: true,
          manuallyAssignedAt: new Date(),
          manuallyAssignedBy: admin.username,
          linkedAdUsername: linkedAdUsername.trim(),
          manualAssignmentNotes: notes?.trim() || null,
          status: targetStatus,
          ...(isFinalStage
            ? { approvedAt: new Date(), approvedBy: admin.username }
            : {
                acknowledgedByDirector: true,
                acknowledgedAt: new Date(),
                acknowledgedBy: admin.username,
                stageNotificationState: 'delivery_unknown',
                stageNotificationStageKey: nextStage!.key,
                stageNotificationError: `Delivery to ${nextStage!.label} has not been confirmed.`,
                stageNotificationStateChangedAt: new Date(),
              }),
          accountCreatedAt: new Date(),
          ldapUsername: linkedAdUsername.trim(),
          provisioningState: 'reconciliation_pending',
          provisioningStartedAt: new Date(),
          provisioningCompletedAt: null,
          provisioningError: null,
          version: { increment: 1 },
        };

        if (vpnModuleEnabled && !accessRequest.isInternal) {
          updateData.linkedVpnUsername = linkedVpnUsername?.trim() || linkedAdUsername.trim();
          updateData.vpnUsername = linkedVpnUsername?.trim() || linkedAdUsername.trim();
        }

        // The write must fail if another admin changed the request after this page loaded.
        console.log(`[Manual Assignment] Updating AccessRequest with optimistic locking (version: ${accessRequest.version})`);
        const updatedRequestResult = await tx.accessRequest.updateMany({
          where: { 
            id: resolvedParams.id,
            version: accessRequest.version,
            status: accessRequest.status,
            AND: [{
              OR: [
                { accountUpdateState: null },
                { accountUpdateState: { in: ['failed', 'succeeded'] } },
              ],
            }, {
              OR: [
                { facultyNotificationState: null },
                { facultyNotificationState: { not: 'sending' } },
              ],
            }],
          },
          data: updateData,
        });

        if (updatedRequestResult.count === 0) {
          const currentRequest = await tx.accessRequest.findUnique({
            where: { id: resolvedParams.id },
            select: { status: true, version: true, isManuallyAssigned: true, manuallyAssignedBy: true },
          });
          
          console.error(`[Manual Assignment] ROLLBACK - Update failed. Current state:`, currentRequest);
          
          if (currentRequest?.isManuallyAssigned) {
            throw new Error(`Request was already manually assigned by ${currentRequest.manuallyAssignedBy}. Transaction rolled back.`);
          }
          
          if (currentRequest?.version !== accessRequest.version) {
            throw new Error(`Request was modified by another administrator (version mismatch). Transaction rolled back.`);
          }
          
          throw new Error(`Request status has changed to "${currentRequest?.status}". Please refresh and try again. Transaction rolled back.`);
        }

        console.log(`[Manual Assignment] AccessRequest updated successfully`);

        const finalRequest = await tx.accessRequest.findUnique({
          where: { id: resolvedParams.id },
        });

        if (!finalRequest) {
          console.error(`[Manual Assignment] ROLLBACK - Could not fetch updated request`);
          throw new Error('Failed to fetch updated request. Transaction rolled back.');
        }

        console.log(`[Manual Assignment] Creating comment for audit trail`);
        let commentText = `Request manually assigned to existing Active Directory account: ${linkedAdUsername}`;
        if (vpnModuleEnabled && accessRequest.isInternal) {
          const vpnUsername = extractBronconame(accessRequest.email) || linkedAdUsername.trim();
          commentText += `\nVPN account created/updated: ${vpnUsername} (Internal - Limited Portal)`;
          commentText += `\nLinked AD account: ${linkedAdUsername}`;
          const expectedUsername = extractBronconame(accessRequest.email);
          if (expectedUsername && expectedUsername !== linkedAdUsername.toLowerCase()) {
            commentText += `\nNote: Request email (${accessRequest.email}) bronconame differs from AD username (${linkedAdUsername})`;
            commentText += `\nThis is a manual assignment to an existing account.`;
          }
        } else if (vpnModuleEnabled && !accessRequest.isInternal && linkedVpnUsername && linkedVpnUsername.trim() !== '') {
          commentText += `\nLinked VPN account: ${linkedVpnUsername}`;
        }
        if (notes && notes.trim()) {
          commentText += `\n\nNotes: ${notes.trim()}`;
        }
        commentText += `\n\nAssigned by: ${admin.username}`;

        await tx.requestComment.create({
          data: {
            requestId: resolvedParams.id,
            comment: commentText,
            author: admin.username,
            type: 'system',
          },
        });

        // VPN tracking updates: skipped entirely when VPN management is
        // disabled; historical records stay untouched.
        if (vpnModuleEnabled && !accessRequest.isInternal) {
          const vpnAccountUsername = linkedVpnUsername?.trim() || linkedAdUsername.trim();
          
          console.log(`[Manual Assignment] Checking for VPN account: ${vpnAccountUsername}`);
          const vpnAccount = await tx.vPNAccount.findUnique({
            where: { username: vpnAccountUsername },
          });

          if (vpnAccount) {
            console.log(`[Manual Assignment] Updating VPN account status to active`);
            await tx.vPNAccount.update({
              where: { id: vpnAccount.id },
              data: {
                email: accessRequest.email,
                name: accessRequest.name,
                status: vpnTrackingStatus,
                ...(isFinalStage ? { createdByFaculty: true, facultyCreatedAt: new Date() } : {}),
                adUsername: linkedAdUsername.trim(),
              },
            });

            await tx.vPNAccountStatusLog.create({
              data: {
                accountId: vpnAccount.id,
                liveAccountId: vpnAccount.id,
                oldStatus: vpnAccount.status,
                newStatus: vpnTrackingStatus,
                changedBy: admin.username,
                reason: 'Manually assigned to access request',
              },
            });
            console.log(`[Manual Assignment] VPN account updated successfully`);
          } else {
            console.log(`[Manual Assignment] No VPN account found for ${vpnAccountUsername}, skipping VPN update`);
          }
        }

        if (vpnModuleEnabled && accessRequest.isInternal) {
          console.log(`[Manual Assignment] Creating VPN account record for internal user`);
          try {
            const vpnUsername = extractBronconame(accessRequest.email) || linkedAdUsername.trim();
            const vpnAccountName = adDisplayName || accessRequest.name;
            
            console.log(`[Manual Assignment] Using VPN username: ${vpnUsername} (from email: ${accessRequest.email})`);
            console.log(`[Manual Assignment] Using VPN name: ${vpnAccountName} (AD displayName)`);
            console.log(`[Manual Assignment] Linked AD account: ${linkedAdUsername}`);
            
            const existingVpnAccount = await tx.vPNAccount.findUnique({
              where: { username: vpnUsername },
            });

            if (existingVpnAccount) {
              console.log(`[Manual Assignment] VPN account already exists for ${vpnUsername}, updating status`);
              await tx.vPNAccount.update({
                where: { id: existingVpnAccount.id },
                data: {
                  email: accessRequest.email,
                  name: vpnAccountName,
                  status: vpnTrackingStatus,
                  portalType: 'Limited',
                  isInternal: true,
                  ...(isFinalStage ? { createdByFaculty: true, facultyCreatedAt: new Date() } : {}),
                  adUsername: linkedAdUsername.trim(),
                },
              });

              await tx.vPNAccountStatusLog.create({
                data: {
                  accountId: existingVpnAccount.id,
                  liveAccountId: existingVpnAccount.id,
                  oldStatus: existingVpnAccount.status,
                  newStatus: vpnTrackingStatus,
                  changedBy: admin.username,
                  reason: 'Manually assigned to access request',
                },
              });
            } else {
              console.log(`[Manual Assignment] Creating new VPN account for ${vpnUsername}`);
              
              const newVpnAccount = await tx.vPNAccount.create({
                data: {
                  username: vpnUsername,
                  name: vpnAccountName,
                  email: accessRequest.email,
                  portalType: 'Limited',
                  isInternal: true,
                  status: vpnTrackingStatus,
                  password: '',
                  createdBy: admin.username,
                  createdByFaculty: isFinalStage,
                  ...(isFinalStage ? { facultyCreatedAt: new Date() } : {}),
                  adUsername: linkedAdUsername.trim(),
                },
              });

              await tx.vPNAccountStatusLog.create({
                data: {
                  accountId: newVpnAccount.id,
                  liveAccountId: newVpnAccount.id,
                  oldStatus: null,
                  newStatus: vpnTrackingStatus,
                  changedBy: admin.username,
                  reason: 'Created via manual assignment of access request',
                },
              });

              console.log(`[Manual Assignment] VPN account created successfully: ${newVpnAccount.id}`);
            }
          } catch (vpnCreateError) {
            console.error(`[Manual Assignment] Failed to create/update VPN account:`, vpnCreateError);
            throw new Error(`Failed to create VPN account: ${vpnCreateError instanceof Error ? vpnCreateError.message : 'Unknown error'}. Transaction rolled back.`);
          }
        }

        console.log(`[Manual Assignment] Transaction completed successfully - COMMIT`);
        return finalRequest;
      }, {
        maxWait: 5000,
        timeout: 30000,
        isolationLevel: 'Serializable',
      });

      updatedRequest = result;
      
    } catch (transactionError) {
      console.error('[Manual Assignment] Transaction ROLLED BACK due to error:', transactionError);

      await logAuditAction({
        action: AuditActions.MANUAL_ASSIGN_REQUEST,
        category: AuditCategories.ACCESS_REQUEST,
        username: admin.username,
        actorType: 'admin',
        targetId: resolvedParams.id,
        targetType: 'AccessRequest',
        subjectUsername: linkedAdUsername.trim(),
        subjectEmail: accessRequest.email,
        relatedRequestId: resolvedParams.id,
        eventKind: 'write',
        outcome: 'rollback',
        details: {
          manuallyAssigned: true,
          failed: true,
          error: transactionError instanceof Error ? transactionError.message : 'Unknown error',
          linkedAdUsername: linkedAdUsername.trim(),
          linkedVpnUsername: linkedVpnUsername?.trim() || null,
        },
        ipAddress: getIpAddress(request),
        userAgent: getUserAgent(request),
        success: false,
        errorMessage: transactionError instanceof Error ? transactionError.message : 'Unknown error',
      });

      throw transactionError;
    }

    const finalized = await prisma.accessRequest.updateMany({
      where: {
        id: resolvedParams.id,
        version: updatedRequest.version,
        status: targetStatus,
        provisioningState: 'reconciliation_pending',
      },
      data: {
        provisioningState: 'completed',
        provisioningCompletedAt: new Date(),
        provisioningError: null,
        version: { increment: 1 },
      },
    });
    if (finalized.count !== 1) {
      await logAuditAction({
        action: AuditActions.MANUAL_ASSIGN_REQUEST,
        category: AuditCategories.ACCESS_REQUEST,
        username: admin.username,
        actorType: 'admin',
        targetId: resolvedParams.id,
        targetType: 'AccessRequest',
        subjectUsername: linkedAdUsername.trim(),
        subjectEmail: updatedRequest.email,
        relatedRequestId: resolvedParams.id,
        eventKind: 'write',
        outcome: 'failure',
        details: { directoryAccountObserved: true, reconciliationConflict: true },
        ipAddress: getIpAddress(request),
        userAgent: getUserAgent(request),
        success: false,
        errorMessage: 'Request changed before directory reconciliation could be finalized',
      });
      return NextResponse.json({
        success: false,
        code: 'RECONCILIATION_CONFLICT',
        error: 'The directory identity was confirmed, but the request changed before finalization. Refresh and reconcile its current state.',
      }, { status: 409 });
    }
    const finalizedRequest = await prisma.accessRequest.findUnique({ where: { id: resolvedParams.id } });
    if (!finalizedRequest) {
      return NextResponse.json({ error: 'The finalized request could not be loaded.' }, { status: 409 });
    }
    updatedRequest = finalizedRequest;

    let stageNotificationStatus = isFinalStage ? 'not_applicable' : 'delivery_unknown';
    if (nextStage) {
      let stageRecipients: string[] = [];
      try {
        stageRecipients = await resolveStageNotificationRecipients(nextStage, async () => {
          if (nextStage.reviewerRoleKey === 'faculty') {
            const emailConfig = await getEmailConfig();
            return emailConfig.facultyEmail ? [emailConfig.facultyEmail] : [];
          }
          return getStudentDirectorEmails();
        });
        if (stageRecipients.length === 0) {
          stageNotificationStatus = 'not_configured';
        } else {
          await sendWorkflowStageNotification({
            recipients: stageRecipients,
            requestId: resolvedParams.id,
            requestName: updatedRequest.name,
            requestEmail: updatedRequest.email,
            stageLabel: nextStage.label,
            advancedBy: admin.username,
          });
          stageNotificationStatus = 'delivered';
        }
      } catch (emailError) {
        console.error('[Manual Assignment] Configured stage notification outcome is unknown:', emailError);
        stageNotificationStatus = stageRecipients.length > 0 ? 'delivery_unknown' : 'not_configured';
      }

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
          version: updatedRequest.version,
          status: targetStatus,
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
        updatedRequest = await prisma.accessRequest.findUnique({ where: { id: resolvedParams.id } }) || updatedRequest;
      } else {
        stageNotificationStatus = 'delivery_unknown';
      }
    }

    await logAuditAction({
      action: AuditActions.MANUAL_ASSIGN_REQUEST,
      category: AuditCategories.ACCESS_REQUEST,
      username: admin.username,
      actorType: 'admin',
      targetId: resolvedParams.id,
      targetType: 'AccessRequest',
      subjectUsername: linkedAdUsername.trim(),
      subjectEmail: updatedRequest.email,
      relatedRequestId: resolvedParams.id,
      eventKind: 'write',
      outcome: 'success',
      details: {
        requestName: updatedRequest.name,
        requestEmail: updatedRequest.email,
        linkedAdUsername: linkedAdUsername.trim(),
        linkedVpnUsername: linkedVpnUsername?.trim() || null,
        isInternal: accessRequest.isInternal,
        manuallyAssigned: true,
        notes: notes?.trim() || null,
        directoryAccountObserved: true,
        stageNotificationStatus,
        stageNotificationStageKey: nextStage?.key || null,
      },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
      success: true,
    });

    if (accessRequest.isInternal && isFinalStage) {
      console.log('[Manual Assignment] Sending linkage confirmation email to internal requester');
      try {
        await sendManualAssignmentLinkedEmail({
          email: updatedRequest.email,
          name: updatedRequest.name,
          ldapUsername: linkedAdUsername.trim(),
          linkedBy: admin.username,
          notes: notes?.trim() || null,
          isGrandfathered: Boolean(accessRequest.isGrandfatheredAccount),
        });
        console.log('[Manual Assignment] Link confirmation email sent');
      } catch (emailError) {
        console.error('[Manual Assignment] Failed to send link confirmation email:', emailError);
      }
    }

    return NextResponse.json({
      message: isFinalStage
        ? 'Request linked to the existing account and approved at its final review stage'
        : `Request linked to the existing account and moved to ${workflow.stages[currentStageIndex + 1]?.label || 'the next review stage'}`,
      request: toSafeAccessRequestResponse(updatedRequest),
      partial: !isFinalStage && stageNotificationStatus !== 'delivered',
      stageNotificationStatus,
    }, { status: stageNotificationStatus === 'delivery_unknown' ? 202 : 200 });
  } catch (error) {
    console.error('[Manual Assignment] Fatal error:', error);
    
    let errorMessage = 'An unexpected error occurred';
    let statusCode = 500;
    
    if (error instanceof Error) {
      errorMessage = error.message;
      
      if (errorMessage.includes('already manually assigned')) {
        statusCode = 409;
      } else if (errorMessage.includes('modified by another administrator')) {
        statusCode = 409;
      } else if (errorMessage.includes('status has changed')) {
        statusCode = 409;
      } else if (errorMessage.includes('Transaction rolled back')) {
        statusCode = 409;
      } else if (errorMessage.includes('already has an active portal owner')) {
        statusCode = 409;
      } else if (errorMessage.includes('already has an active batch run owner')) {
        statusCode = 409;
      }
    }
    
    return NextResponse.json(
      { 
        error: errorMessage,
        rollback: true,
      },
      { status: statusCode }
    );
  }
}
