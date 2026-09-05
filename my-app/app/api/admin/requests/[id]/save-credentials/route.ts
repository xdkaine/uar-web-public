import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { searchLDAPUserForProvisioning } from '@/lib/ldap';
import { checkReviewAccessWithRateLimit } from '@/lib/adminAuth';
import { actorCanActOnStage, actorHasPermission } from '@/lib/rbac/core';
import { encryptPassword } from '@/lib/encryption';

import { logAuditAction, AuditActions, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';
import { findReusableOffboardedRequest } from '@/lib/offboard-reenrollment';
import { toSafeAccessRequestResponse } from '@/lib/access-request-response';
import {
  acquireDirectoryOwnershipFence,
  findBatchDirectoryOwnershipClaims,
} from '@/lib/directory-ownership-fence';
import {
  findStageIndexByStatus,
  resolveWorkflowForRequest,
  workflowIntegrityConflict,
} from '@/lib/workflow/core';

type ReusableOffboardedRequest = { id: string } | null;

class BatchOwnershipConflict extends Error {
  readonly code = 'BATCH_ACCOUNT_OWNER';
}

// Retry configuration for handling unique constraint violations
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 100;

/**
 * Delay execution for exponential backoff
 */
async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { admin, response } = await checkReviewAccessWithRateLimit(request);

    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!actorHasPermission(admin, 'access_requests.provision')) {
      try {
        await logAuditAction({
          action: AuditActions.SAVE_REQUEST_CREDENTIALS,
          category: AuditCategories.ACCESS_REQUEST,
          username: admin.username,
          actorType: 'admin',
          targetType: 'AccessRequest',
          eventKind: 'security',
          outcome: 'denied',
          success: false,
          details: {
            reason: 'permission_denied',
            missingPermission: 'access_requests.provision',
            route: request.nextUrl.pathname,
          },
          ipAddress: getIpAddress(request),
          userAgent: getUserAgent(request),
        });
      } catch (auditError) {
        console.error('Failed to audit credential-save permission denial:', auditError);
      }
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
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
      return NextResponse.json(
        { error: 'Account identity reconciliation must finish before credentials can change' },
        { status: 409 }
      );
    }
    const workflow = await resolveWorkflowForRequest(accessRequest);
    const workflowConflict = workflowIntegrityConflict(workflow);
    if (workflowConflict) {
      return NextResponse.json({ error: workflowConflict, code: 'WORKFLOW_RECONCILIATION_REQUIRED' }, { status: 409 });
    }
    const stageIndex = findStageIndexByStatus(workflow.stages, accessRequest.status);
    const currentStage = stageIndex >= 0 ? workflow.stages[stageIndex] : null;
    if (!currentStage) {
      return NextResponse.json(
        { error: 'The current request status is not represented by its configured review workflow.' },
        { status: 409 }
      );
    }
    if (!actorCanActOnStage(admin, currentStage.reviewerRoleKey)) {
      return NextResponse.json({ error: 'Forbidden for the current configured review stage.' }, { status: 403 });
    }

    // Validate required fields based on account type
    if (!ldapUsername || !password) {
      return NextResponse.json(
        { error: 'Directory username and password are required' },
        { status: 400 }
      );
    }

    // VPN username is only required for external users
    if (!accessRequest.isInternal && !vpnUsername) {
      return NextResponse.json(
        { error: 'VPN username is required for external users' },
        { status: 400 }
      );
    }

    if (!accessRequest.isVerified) {
      return NextResponse.json(
        { error: 'Cannot save credentials for unverified request' },
        { status: 400 }
      );
    }

    // Only check Active Directory if the account hasn't been created yet
    // If accountCreatedAt is set, we're updating an existing account (e.g., after moving back)
    let reusableAdRequest: ReusableOffboardedRequest = null;
    let reusableVpnRequest: ReusableOffboardedRequest = null;
    if (!accessRequest.accountCreatedAt) {
      // Pre-check: Ensure username isn't in use by another active request.
      const usernameConflict = await prisma.accessRequest.findFirst({
        where: {
          OR: [
            { ldapUsername },
            ...(!accessRequest.isInternal && vpnUsername ? [{ vpnUsername }] : []),
          ],
          id: { not: resolvedParams.id },
          status: { notIn: ['rejected', 'offboarded'] },
        },
        select: { id: true, ldapUsername: true, vpnUsername: true, status: true },
      });

      if (usernameConflict) {
        const conflictingUsername = usernameConflict.ldapUsername === ldapUsername 
          ? ldapUsername 
          : vpnUsername;
        return NextResponse.json(
          { error: `Username "${conflictingUsername}" is already in use by another active request (${usernameConflict.status})` },
          { status: 409 }
        );
      }

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
        console.error('LDAP search error during credential save:', ldapError);
        return NextResponse.json(
          { error: 'Failed to verify directory username availability. Please try again.' },
          { status: 500 }
        );
      }

      // Check if VPN username already exists in Active Directory (for external users)
      if (!accessRequest.isInternal && vpnUsername) {
        try {
          const vpnUser = await searchLDAPUserForProvisioning(vpnUsername);
          
          if (vpnUser) {
            reusableVpnRequest = await findReusableOffboardedRequest({
              username: vpnUsername,
              email: accessRequest.email,
            });

            if (!reusableVpnRequest) {
              return NextResponse.json(
                { error: `VPN username "${vpnUsername}" already exists in Active Directory` },
                { status: 400 }
              );
            }
          }
        } catch (ldapError) {
          console.error('LDAP search error for VPN username:', ldapError);
          return NextResponse.json(
            { error: 'Failed to verify VPN username availability. Please try again.' },
            { status: 500 }
          );
        }
      }
    }

    // Retry logic for handling unique constraint violations due to race conditions
    let retryCount = 0;
    let lastError: Error | null = null;

    while (retryCount < MAX_RETRIES) {
      try {
        const reusableRequest = reusableAdRequest || reusableVpnRequest;

        // Use a transaction to ensure atomicity and leverage database-level unique constraints
        const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
          await acquireDirectoryOwnershipFence(tx, ldapUsername);
          const batchAdOwners = await findBatchDirectoryOwnershipClaims(tx, ldapUsername, 'AD');
          if (batchAdOwners.length > 0) {
            throw new BatchOwnershipConflict(
              `Directory username "${ldapUsername}" is governed by batch ${batchAdOwners[0].batchId}`
            );
          }
          if (reusableAdRequest && !await searchLDAPUserForProvisioning(ldapUsername)) {
            throw new Error('The reusable Active Directory account disappeared before ownership was reserved');
          }
          // Re-fetch the request within transaction to get latest state
          const currentRequest = await tx.accessRequest.findUnique({
            where: { id: resolvedParams.id },
            select: { 
              status: true, 
              ldapUsername: true, 
              vpnUsername: true,
              accountExpiresAt: true,
              isInternal: true
            }
          });

          if (!currentRequest) {
            throw new Error('Request not found');
          }

          if (currentRequest.status !== accessRequest.status) {
            throw new Error(
              `Request status changed from ${accessRequest.status} to ${currentRequest.status}`
            );
          }

          // Build update data
          const updateData: {
            ldapUsername: string;
            accountPassword: string;
            vpnUsername?: string | null;
            accountExpiresAt?: Date | null;
            linkedAdUsername?: string | null;
            linkedVpnUsername?: string | null;
            isManuallyAssigned?: boolean;
            manuallyAssignedAt?: Date;
            manuallyAssignedBy?: string;
            manualAssignmentNotes?: string | null;
            version: { increment: number };
          } = {
            ldapUsername,
            accountPassword: encryptPassword(password),
            version: { increment: 1 }, // Increment version for optimistic locking
          };

          if (reusableRequest) {
            updateData.linkedAdUsername = ldapUsername;
            updateData.linkedVpnUsername = vpnUsername || ldapUsername;
            updateData.isManuallyAssigned = true;
            updateData.manuallyAssignedAt = new Date();
            updateData.manuallyAssignedBy = admin.username;
            updateData.manualAssignmentNotes = `Prepared for reactivation from campaign-offboarded request ${reusableRequest.id}`;
          }

          // Only set VPN username for external users
          if (!accessRequest.isInternal) {
            updateData.vpnUsername = vpnUsername;
          } else {
            // Clear VPN username for internal users
            updateData.vpnUsername = null;
          }

          // Add expiration date for external users
          if (!accessRequest.isInternal && expirationDate) {
            updateData.accountExpiresAt = new Date(expirationDate);
          } else if (accessRequest.isInternal) {
            // Clear expiration for internal users
            updateData.accountExpiresAt = null;
          }

          // Update with the version check to prevent concurrent modifications
          const updatedRequest = await tx.accessRequest.update({
            where: { 
              id: resolvedParams.id,
              // Include version check for optimistic locking
              version: accessRequest.version
            },
            data: updateData,
          });

          // Track what credentials were changed
          const changes: string[] = [];
          if (currentRequest.ldapUsername !== ldapUsername) {
            changes.push(`AD username: ${currentRequest.ldapUsername || '(not set)'} → ${ldapUsername}`);
          }
          if (!accessRequest.isInternal) {
            if (currentRequest.vpnUsername !== vpnUsername) {
              changes.push(`VPN username: ${currentRequest.vpnUsername || '(not set)'} → ${vpnUsername}`);
            }
            if (expirationDate) {
              const newExpDate = new Date(expirationDate).toLocaleDateString();
              const oldExpDate = currentRequest.accountExpiresAt ? new Date(currentRequest.accountExpiresAt).toLocaleDateString() : '(not set)';
              if (oldExpDate !== newExpDate) {
                changes.push(`Expiration date: ${oldExpDate} → ${newExpDate}`);
              }
            }
          }
          // Always note if password was updated (don't show actual passwords)
          changes.push('Password was updated');
          if (reusableRequest) {
            changes.push(`Prepared for reactivation from campaign-offboarded request ${reusableRequest.id}`);
          }

          // Create a comment if credentials were changed
          if (changes.length > 0) {
            await tx.requestComment.create({
              data: {
                requestId: resolvedParams.id,
                comment: `Credentials updated by ${admin.username}:\n${changes.join('\n')}`,
                author: admin.username,
                type: 'system',
              },
            });
          }

          return updatedRequest;
        }, {
          // Use serializable isolation level to prevent race conditions
          isolationLevel: 'Serializable' as const,
          maxWait: 5000, // 5 seconds max wait time
          timeout: 10000, // 10 seconds timeout
        });

        // Success - log and return the result
        await logAuditAction({
          action: AuditActions.SAVE_REQUEST_CREDENTIALS,
          category: AuditCategories.ACCESS_REQUEST,
          username: admin.username,
          targetId: resolvedParams.id,
          targetType: 'AccessRequest',
          details: { ldapUsername, vpnUsername, hasExpirationDate: !!expirationDate },
          ipAddress: getIpAddress(request),
          userAgent: getUserAgent(request),
        });
        
        return NextResponse.json({ 
          success: true, 
          message: 'Credentials saved successfully',
          request: toSafeAccessRequestResponse(result)
        });

      } catch (error) {
        lastError = error as Error;

        // Check if it's a unique constraint violation
        if (error && typeof error === 'object' && 'code' in error) {
          const prismaError = error as { code: string; meta?: { target?: string[] } };
          if (prismaError.code === 'BATCH_ACCOUNT_OWNER') {
            return NextResponse.json(
              { error: error instanceof Error ? error.message : 'Directory username is governed by a batch run' },
              { status: 409 }
            );
          }
          if (prismaError.code === 'P2002') {
            // Unique constraint violation - username already taken
            const target = prismaError.meta?.target;
            if (target?.includes('ldapUsername')) {
              return NextResponse.json(
                { error: `Directory username "${ldapUsername}" is already in use by another request` },
                { status: 409 }
              );
            }
            if (target?.includes('vpnUsername')) {
              return NextResponse.json(
                { error: `VPN username "${vpnUsername}" is already in use by another request` },
                { status: 409 }
              );
            }
            return NextResponse.json(
              { error: 'Username is already in use by another request' },
              { status: 409 }
            );
          } else if (prismaError.code === 'P2025') {
            // Record not found or version mismatch (optimistic locking failure)
            // Retry with exponential backoff
            retryCount++;
            if (retryCount < MAX_RETRIES) {
              await delay(RETRY_DELAY_MS * Math.pow(2, retryCount - 1));
              continue;
            }
            return NextResponse.json(
              { error: 'Request was modified by another user. Please refresh and try again.' },
              { status: 409 }
            );
          }
        }

        // For other errors, check if it's a transaction error that might be retryable
        if (error instanceof Error && error.message.includes('Request status is')) {
          return NextResponse.json({ error: error.message }, { status: 400 });
        }

        // Unknown error - retry if we haven't exceeded max retries
        retryCount++;
        if (retryCount < MAX_RETRIES) {
          await delay(RETRY_DELAY_MS * Math.pow(2, retryCount - 1));
          continue;
        }

        // Max retries exceeded - throw the error
        throw error;
      }
    }

    // If we get here, we've exhausted all retries
    throw lastError || new Error('Failed to save credentials after multiple retries');

  } catch (error) {
    console.error('Error saving credentials:', error);
    
    // Log the failure
    const resolvedParams = await params;
    const { admin } = await checkReviewAccessWithRateLimit(request);
    if (admin) {
      await logAuditAction({
        action: AuditActions.SAVE_REQUEST_CREDENTIALS,
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
    
    // Check for specific error types
    if (error && typeof error === 'object' && 'code' in error) {
      const prismaError = error as { code: string };
      if (prismaError.code === 'P2002') {
        return NextResponse.json(
          { error: 'Username is already in use' },
          { status: 409 }
        );
      }
    }
    
    return NextResponse.json(
      { error: 'Failed to save credentials' },
      { status: 500 }
    );
  }
}
