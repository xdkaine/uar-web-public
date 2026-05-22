import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import {
  searchLDAPUserForProvisioning,
  createLDAPUser,
  setLDAPUserPassword,
  setLDAPUserExpiration,
  deleteLDAPUser,
  disableLDAPUser,
  descriptionMatchesRequestTag,
} from '@/lib/ldap';
import { prisma } from '@/lib/prisma';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { decryptPassword } from '@/lib/encryption';

import { logAuditAction, AuditActions, AuditCategories, getIpAddress, getUserAgent, sanitizeDatabaseText } from '@/lib/audit-log';
import { extractBronconame } from '@/lib/validation';
import { findReusableOffboardedRequest } from '@/lib/offboard-reenrollment';

const PROVISIONING_STATE_IN_PROGRESS = 'in_progress';
const PROVISIONING_STATE_SUCCEEDED = 'succeeded';
const PROVISIONING_STATE_FAILED = 'failed';
const PROVISIONING_LOCK_STALE_AFTER_MS = 15 * 60 * 1000;

class HttpError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

async function cleanupProvisionedAccounts(
  usernames: Iterable<string>,
  requestId: string
): Promise<{
  successful: string[];
  failed: Array<{ username: string; error: string }>;
}> {
  const uniqueUsernames = Array.from(new Set(usernames));
  const successful: string[] = [];
  const failed: Array<{ username: string; error: string }> = [];

  await Promise.all(
    uniqueUsernames.map(async (username) => {
      try {
        await deleteLDAPUser(username, requestId);
        successful.push(username);
        console.log(`[LDAP Cleanup] Successfully deleted account: ${username}`);
      } catch (deleteError) {
        console.warn(`[LDAP Cleanup] Delete failed for ${username}, attempting disable+expire`, deleteError);
        
        try {
          await disableLDAPUser(username);
          await setLDAPUserExpiration(username, new Date());
          successful.push(username);
          console.log(`[LDAP Cleanup] Successfully disabled account: ${username}`);
        } catch (disableError) {
          const errorMsg = disableError instanceof Error ? disableError.message : 'Unknown error';
          failed.push({ username, error: errorMsg });
          console.error(`[LDAP Cleanup] Failed to cleanup account ${username}:`, disableError);
        }
      }
    })
  );

  return { successful, failed };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const provisionedAccounts = new Set<string>();
  const reusedOffboardedAccounts = new Set<string>();
  let provisioningLockVersion: number | null = null;
  let requestId: string | null = null;

  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);

    if (!admin || response) {
      if (response) return response;
      throw new HttpError('Unauthorized', 401);
    }

    const resolvedParams = await params;
    requestId = resolvedParams.id;

    const { accessRequest, lockedVersion } = await prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        const staleProvisioningStartedBefore = new Date(Date.now() - PROVISIONING_LOCK_STALE_AFTER_MS);
        const requestRecord = await tx.accessRequest.findUnique({
          where: { id: resolvedParams.id },
        });

        if (!requestRecord) {
          throw new HttpError('Request not found', 404);
        }

        if (!requestRecord.isVerified) {
          throw new HttpError('Cannot create account for unverified request');
        }

        if (requestRecord.status !== 'pending_student_directors') {
          throw new HttpError(
            `Request status is ${requestRecord.status}, expected pending_student_directors`
          );
        }

        if (requestRecord.accountCreatedAt) {
          throw new HttpError(
            'Account has already been provisioned for this request.',
            409
          );
        }

        const hasActiveProvisioningLock =
          requestRecord.provisioningState === PROVISIONING_STATE_IN_PROGRESS &&
          (!requestRecord.provisioningStartedAt || requestRecord.provisioningStartedAt >= staleProvisioningStartedBefore);

        if (hasActiveProvisioningLock) {
          throw new HttpError(
            'Another administrator is currently provisioning this request. Please refresh and try again.',
            409
          );
        }

        if (!requestRecord.ldapUsername || !requestRecord.accountPassword) {
          throw new HttpError(
            'LDAP username and password must be set before creating account'
          );
        }

        if (!requestRecord.isInternal) {
          if (!requestRecord.vpnUsername) {
            throw new HttpError('VPN username required for external users');
          }
          if (!requestRecord.accountExpiresAt) {
            throw new HttpError('Expiration date required for external users');
          }
        }

        const duplicate = await tx.accessRequest.findFirst({
          where: {
            OR: [
              { ldapUsername: requestRecord.ldapUsername },
              ...(!requestRecord.isInternal && requestRecord.vpnUsername
                ? [{ vpnUsername: requestRecord.vpnUsername }]
                : []),
            ],
            id: { not: resolvedParams.id },
            accountCreatedAt: { not: null },
            status: { notIn: ['rejected', 'offboarded'] },
          },
        });

        if (duplicate) {
          throw new HttpError('Username is already in use by another request');
        }

        const lockResult = await tx.accessRequest.updateMany({
          where: {
            id: resolvedParams.id,
            version: requestRecord.version,
            status: 'pending_student_directors',
            OR: [
              { provisioningState: null },
              { provisioningState: PROVISIONING_STATE_FAILED },
              {
                provisioningState: PROVISIONING_STATE_IN_PROGRESS,
                provisioningStartedAt: { lt: staleProvisioningStartedBefore },
              },
            ],
          },
          data: {
            provisioningState: PROVISIONING_STATE_IN_PROGRESS,
            provisioningStartedAt: new Date(),
            provisioningCompletedAt: null,
            provisioningError: null,
            version: { increment: 1 },
          },
        });

        if (lockResult.count === 0) {
          throw new HttpError(
            'Another administrator is currently processing this request. Please refresh and try again.',
            409
          );
        }

        return {
          accessRequest: requestRecord,
          lockedVersion: requestRecord.version + 1,
        };
      },
      {
        isolationLevel: 'Serializable',
        maxWait: 5000,
        timeout: 30000,
      }
    );

    provisioningLockVersion = lockedVersion;

    const ldapUsername = accessRequest.ldapUsername!;
    const vpnUsername =
      !accessRequest.isInternal && accessRequest.vpnUsername
        ? accessRequest.vpnUsername
        : null;
    let reusingOffboardedAd = false;
    let reusingOffboardedVpn = false;
    let reusableOffboardedRequestId: string | null = null;

    // Retry cleanup only touches accounts that still carry this request's description tag.
    try {
      const existingUser = await searchLDAPUserForProvisioning(ldapUsername);
      if (existingUser) {
        console.log(`[Retry Safety] Found existing LDAP account ${ldapUsername} - checking if from failed attempt`);
        const descAttr = existingUser.attributes.find((attr: { type: string }) => attr.type === 'description');
        const description = descAttr?.values?.[0] || '';
        
        if (descriptionMatchesRequestTag(description, accessRequest.id)) {
          console.log(`[Retry Safety] LDAP account matches this request ID - cleaning up for retry`);
          await deleteLDAPUser(ldapUsername, accessRequest.id);
          console.log(`[Retry Safety] Successfully cleaned up ${ldapUsername} for retry`);
        } else {
          const reusableRequest = await findReusableOffboardedRequest({
            username: ldapUsername,
            email: accessRequest.email,
          });

          if (!reusableRequest) {
            throw new HttpError('LDAP username already exists in Active Directory');
          }

          reusingOffboardedAd = true;
          reusableOffboardedRequestId = reusableRequest.id;
          reusedOffboardedAccounts.add(ldapUsername);
          console.log(`[Re-enrollment] Reusing campaign-offboarded AD account ${ldapUsername}`);
        }
      }
    } catch (ldapError) {
      if (ldapError instanceof HttpError) {
        throw ldapError;
      }

      console.error('LDAP search error during provisioning:', ldapError);
      throw new HttpError(
        'Failed to verify LDAP username availability. Please try again.',
        500
      );
    }

    if (vpnUsername && vpnUsername !== ldapUsername) {
      try {
        const existingVpnUser = await searchLDAPUserForProvisioning(vpnUsername);
        if (existingVpnUser) {
          console.log(`[Retry Safety] Found existing VPN account ${vpnUsername} - checking if from failed attempt`);
          
          const descAttr = existingVpnUser.attributes.find((attr: { type: string }) => attr.type === 'description');
          const description = descAttr?.values?.[0] || '';
          
          if (descriptionMatchesRequestTag(description, accessRequest.id)) {
            console.log(`[Retry Safety] Account matches this request ID - cleaning up for retry`);
            await deleteLDAPUser(ldapUsername, accessRequest.id);
            console.log(`[Retry Safety] Successfully cleaned up ${ldapUsername} for retry`);
          } else {
            const reusableRequest = await findReusableOffboardedRequest({
              username: vpnUsername,
              email: accessRequest.email,
            });

            if (!reusableRequest) {
              throw new HttpError('LDAP username already exists in Active Directory');
            }

            reusingOffboardedVpn = true;
            reusableOffboardedRequestId = reusableOffboardedRequestId || reusableRequest.id;
            reusedOffboardedAccounts.add(vpnUsername);
            console.log(`[Re-enrollment] Reusing campaign-offboarded VPN account ${vpnUsername}`);
          }
        }
      } catch (ldapError) {
        if (ldapError instanceof HttpError) {
          throw ldapError;
        }

        console.error('LDAP VPN search error during provisioning:', ldapError);
        throw new HttpError(
          'Failed to verify VPN username availability. Please try again.',
          500
        );
      }
    }

    if (!accessRequest.accountPassword) {
      throw new HttpError('Account password is required');
    }

    const plainPassword = decryptPassword(accessRequest.accountPassword);

    if (!reusingOffboardedAd) {
      console.log(`[Account Creation] Creating LDAP account: ${ldapUsername}`);
      await createLDAPUser(
        ldapUsername,
        accessRequest.email,
        accessRequest.name,
        !accessRequest.isInternal,
        accessRequest.id,
        accessRequest.accountExpiresAt || undefined
      );
      provisionedAccounts.add(ldapUsername);
      console.log(`[Account Creation] LDAP account created successfully: ${ldapUsername}`);
    } else {
      console.log(`[Re-enrollment] Preparing existing offboarded LDAP account for reactivation: ${ldapUsername}`);
    }

    await setLDAPUserPassword(ldapUsername, plainPassword);

    if (!accessRequest.isInternal && accessRequest.accountExpiresAt) {
      console.log(`[Account Creation] Setting expiration for: ${ldapUsername} to ${accessRequest.accountExpiresAt}`);
      await setLDAPUserExpiration(
        ldapUsername,
        accessRequest.accountExpiresAt
      );
      console.log(`[Account Creation] Expiration set successfully for: ${ldapUsername}`);
    }

    if (vpnUsername && vpnUsername !== ldapUsername) {
      if (!reusingOffboardedVpn) {
        console.log(`[Account Creation] Creating VPN account: ${vpnUsername}`);
        await createLDAPUser(
          vpnUsername,
          accessRequest.email,
          accessRequest.name,
          true,
          accessRequest.id,
          accessRequest.accountExpiresAt || undefined
        );
        provisionedAccounts.add(vpnUsername);
        console.log(`[Account Creation] VPN account created successfully: ${vpnUsername}`);
      } else {
        console.log(`[Re-enrollment] Preparing existing offboarded VPN account for reactivation: ${vpnUsername}`);
      }

      await setLDAPUserPassword(vpnUsername, plainPassword);

      if (accessRequest.accountExpiresAt) {
        console.log(`[Account Creation] Setting expiration for VPN account: ${vpnUsername}`);
        await setLDAPUserExpiration(vpnUsername, accessRequest.accountExpiresAt);
        console.log(`[Account Creation] VPN expiration set successfully: ${vpnUsername}`);
      }
    }

    // Database state changes only happen after every LDAP call succeeds.
    const updatedRequest = await prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        const completionTime = new Date();

        const updateResult = await tx.accessRequest.updateMany({
          where: {
            id: resolvedParams.id,
            version: lockedVersion,
            status: 'pending_student_directors',
            provisioningState: PROVISIONING_STATE_IN_PROGRESS,
          },
          data: {
            accountCreatedAt: completionTime,
            acknowledgedByDirector: true,
            acknowledgedAt: completionTime,
            acknowledgedBy: admin.username,
            status: 'pending_faculty',
            ...(reusingOffboardedAd || reusingOffboardedVpn
              ? {
                  isManuallyAssigned: true,
                  manuallyAssignedAt: completionTime,
                  manuallyAssignedBy: admin.username,
                  linkedAdUsername: ldapUsername,
                  linkedVpnUsername: vpnUsername || ldapUsername,
                  manualAssignmentNotes: `Prepared for reactivation from campaign-offboarded request ${reusableOffboardedRequestId}`,
                }
              : {}),
            version: { increment: 1 },
            provisioningState: PROVISIONING_STATE_SUCCEEDED,
            provisioningCompletedAt: completionTime,
            provisioningError: null,
          },
        });

        if (updateResult.count === 0) {
          throw new HttpError(
            'Another administrator is currently processing this request. Please refresh and try again.',
            409
          );
        }

        const freshRequest = await tx.accessRequest.findUniqueOrThrow({
          where: { id: resolvedParams.id },
        });

        let vpnAccountUsername: string;
        if (accessRequest.isInternal) {
          vpnAccountUsername = extractBronconame(accessRequest.email) || accessRequest.ldapUsername!;
        } else {
          vpnAccountUsername = accessRequest.vpnUsername || accessRequest.ldapUsername!;
        }
        const portalType = accessRequest.isInternal ? 'Limited' : 'External';

        const existingVpnAccount = await tx.vPNAccount.findUnique({
          where: { username: vpnAccountUsername },
        });

        if (existingVpnAccount) {
          const vpnAccount = await tx.vPNAccount.update({
            where: { username: vpnAccountUsername },
            data: {
              name: accessRequest.name,
              email: accessRequest.email,
              portalType,
              isInternal: accessRequest.isInternal,
              status: 'pending_faculty',
              password: accessRequest.accountPassword!,
              expiresAt: accessRequest.accountExpiresAt,
              accessRequestId: resolvedParams.id,
              adUsername: accessRequest.ldapUsername!,
            },
          });

          await tx.vPNAccountStatusLog.create({
            data: {
              accountId: vpnAccount.id,
              oldStatus: existingVpnAccount.status,
              newStatus: 'pending_faculty',
              changedBy: admin.username,
              reason:
                'Updated from access request with LDAP account creation',
            },
          });
        } else {
          const vpnAccount = await tx.vPNAccount.create({
            data: {
              username: vpnAccountUsername,
              name: accessRequest.name,
              email: accessRequest.email,
              portalType,
              isInternal: accessRequest.isInternal,
              status: 'pending_faculty',
              password: accessRequest.accountPassword!,
              expiresAt: accessRequest.accountExpiresAt,
              createdBy: admin.username,
              createdByFaculty: false,
              accessRequestId: resolvedParams.id,
              adUsername: accessRequest.ldapUsername!,
            },
          });

          await tx.vPNAccountStatusLog.create({
            data: {
              accountId: vpnAccount.id,
              oldStatus: null,
              newStatus: 'pending_faculty',
              changedBy: admin.username,
              reason: 'Created from access request with LDAP account',
            },
          });
        }

        let commentText = reusingOffboardedAd || reusingOffboardedVpn
          ? `Campaign-offboarded LDAP account prepared for reactivation by ${admin.username}. Username: ${accessRequest.ldapUsername}`
          : `LDAP account created by ${admin.username} in Active Directory. Username: ${accessRequest.ldapUsername}`;
        if (
          !accessRequest.isInternal &&
          accessRequest.vpnUsername &&
          accessRequest.vpnUsername !== accessRequest.ldapUsername
        ) {
          commentText += `, VPN username: ${accessRequest.vpnUsername}`;
        }
        if (!accessRequest.isInternal && accessRequest.accountExpiresAt) {
          const disableDate = new Date(
            accessRequest.accountExpiresAt
          ).toLocaleString();
          commentText += `. Account will be automatically disabled on: ${disableDate}`;
        }
        commentText +=
          reusingOffboardedAd || reusingOffboardedVpn
            ? '. Request moved to Pending Faculty. The account remains disabled until faculty approval re-enables access.'
            : '. Request moved to Pending Faculty. VPN account entry created for tracking.';

        await tx.requestComment.create({
          data: {
            requestId: resolvedParams.id,
            comment: commentText,
            author: admin.username,
            type: 'system',
          },
        });

        return freshRequest;
      },
      {
        isolationLevel: 'Serializable',
        maxWait: 5000,
        timeout: 30000,
      }
    );

    provisioningLockVersion = null;

    await logAuditAction({
      action: AuditActions.CREATE_ACCOUNT,
      category: AuditCategories.ACCESS_REQUEST,
      username: admin.username,
      actorType: 'admin',
      targetId: requestId!,
      targetType: 'AccessRequest',
      subjectUsername: updatedRequest.ldapUsername || updatedRequest.vpnUsername,
      subjectEmail: updatedRequest.email,
      relatedRequestId: requestId!,
      eventKind: 'write',
      outcome: 'success',
      details: { 
        ldapUsername: updatedRequest.ldapUsername,
        vpnUsername: updatedRequest.vpnUsername,
        isInternal: updatedRequest.isInternal,
        hasExpiration: !!updatedRequest.accountExpiresAt,
        reactivatedOffboardedAccounts: Array.from(reusedOffboardedAccounts),
      },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    return NextResponse.json({
      success: true,
      message: reusedOffboardedAccounts.size > 0
        ? 'Offboarded account prepared for reactivation and moved to Faculty Review'
        : 'Account created successfully in Active Directory and moved to Faculty Review',
      request: updatedRequest,
    });
  } catch (error) {
    const rawErrorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorMessage = sanitizeDatabaseText(rawErrorMessage) || 'Unknown error';
    const errorDetails = {
      requestId,
      provisionedAccounts: Array.from(provisionedAccounts),
      reusedOffboardedAccounts: Array.from(reusedOffboardedAccounts),
      error: errorMessage,
      timestamp: new Date().toISOString()
    };
    
    console.error('[Account Creation] FAILED - Starting cleanup process', errorDetails);

    if (provisionedAccounts.size > 0 && requestId) {
      console.log(`[LDAP Cleanup] Starting cleanup for ${provisionedAccounts.size} provisioned accounts`);
      const cleanupResult = await cleanupProvisionedAccounts(provisionedAccounts, requestId);
      
      if (cleanupResult.successful.length > 0) {
        console.log(`[LDAP Cleanup] Successfully cleaned up accounts: ${cleanupResult.successful.join(', ')}`);
      }
      
      if (cleanupResult.failed.length > 0) {
        console.error('[CRITICAL] LDAP cleanup failed for some accounts. Manual intervention required:', 
          cleanupResult.failed);

        if (requestId) {
          try {
            await prisma.requestComment.create({
              data: {
                requestId,
                comment: sanitizeDatabaseText(`CRITICAL: Automatic LDAP cleanup failed. Manual deletion required for: ${
                  cleanupResult.failed.map(f => `${f.username} (${sanitizeDatabaseText(f.error)})`).join(', ')
                }. Original error: ${errorMessage}`),
                author: 'System',
                type: 'system',
              },
            }).catch((commentError: unknown) => {
              console.error('Failed to log cleanup failure to database:', commentError);
            });
          } catch (logError) {
            console.error('Failed to create comment for cleanup failure:', logError);
          }
        }
      } else {
        console.log('[LDAP Cleanup] All provisioned accounts cleaned up successfully. Retry is safe.');

        if (requestId) {
          try {
            await prisma.requestComment.create({
              data: {
                requestId,
                comment: sanitizeDatabaseText(`Account creation failed but cleanup was successful. You can safely retry. Error: ${errorMessage}`),
                author: 'System',
                type: 'system',
              },
            }).catch((commentError: unknown) => {
              console.error('Failed to log cleanup success to database:', commentError);
            });
          } catch (logError) {
            console.error('Failed to create comment for cleanup success:', logError);
          }
        }
      }
    }

    if (requestId && provisioningLockVersion !== null) {
      try {
        console.log(`[Account Creation] Marking provisioning as failed in database for request: ${requestId}`);
        await prisma.accessRequest.updateMany({
          where: {
            id: requestId,
            version: provisioningLockVersion,
            provisioningState: PROVISIONING_STATE_IN_PROGRESS,
          },
          data: {
            provisioningState: PROVISIONING_STATE_FAILED,
            provisioningCompletedAt: new Date(),
            provisioningError: errorMessage || 'Unknown provisioning error',
            version: { increment: 1 },
          },
        });
        console.log(`[Account Creation] Successfully marked provisioning as failed in database`);
      } catch (markError) {
        console.error('Failed to flag provisioning failure:', markError);
      }
    }

    console.error('[Account Creation] Error creating account:', error);

    if (requestId) {
      try {
        const { admin } = await checkAdminAuthWithRateLimit(request);
        if (admin) {
          await logAuditAction({
            action: AuditActions.CREATE_ACCOUNT,
            category: AuditCategories.ACCESS_REQUEST,
            username: admin.username,
            actorType: 'admin',
            targetId: requestId,
            targetType: 'AccessRequest',
            success: false,
            errorMessage,
            relatedRequestId: requestId,
            eventKind: 'write',
            outcome: provisionedAccounts.size > 0 ? 'rollback' : 'failure',
            details: { 
              cleanedUpAccounts: Array.from(provisionedAccounts),
              reusedOffboardedAccounts: Array.from(reusedOffboardedAccounts),
              provisioningState: 'failed'
            },
            ipAddress: getIpAddress(request),
            userAgent: getUserAgent(request),
          });
        }
      } catch (logError) {
        console.error('Failed to log account creation failure:', logError);
      }
    }

    if (error instanceof HttpError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    if (error && typeof error === 'object' && 'code' in error) {
      const prismaError = error as { code: string };
      if (prismaError.code === 'P2034') {
        return NextResponse.json(
          {
            error:
              'Another administrator is currently processing this request. Please refresh and try again.',
          },
          { status: 409 }
        );
      }

      if (prismaError.code === 'P2025') {
        return NextResponse.json(
          {
            error:
              'This request was modified by another administrator. Please refresh and try again.',
          },
          { status: 409 }
        );
      }
    }

    return NextResponse.json(
      { error: 'Failed to create account' },
      { status: 500 }
    );
  }
}
