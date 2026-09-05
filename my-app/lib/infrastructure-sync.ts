import { listUsersInOU, searchLDAPUser } from './ldap';
import type { Prisma } from '@prisma/client';
import { extractBronconame } from './validation';
import { prisma } from './prisma';
import { appLogger } from './logger';
import { logActionHistoryEvent } from '@/lib/action-history';
import { AuditActions, AuditCategories } from '@/lib/audit-log';
import { isModuleEnabled } from '@/lib/modules/core';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  acquireDirectoryOwnershipFence,
  findBatchDirectoryOwnershipClaims,
} from './directory-ownership-fence';

export interface InfrastructureSyncResult {
  syncId: string;
  status: 'completed' | 'partial' | 'failed';
  stats: {
    totalADAccounts: number;
    newAccessRequests: number;
    newVPNAccounts: number;
    skippedDuplicates: number;
    errors: number;
  };
  records: Array<{
    adUsername: string;
    adEmail: string;
    adDisplayName: string;
    action: 'created' | 'skipped_duplicate' | 'error';
    accessRequestId: string | null;
    vpnAccountId: string | null;
    syncMatchId?: string | null;
    errorMessage?: string;
  }>;
  tagging?: { completed: number; failed: number };
  error?: string;
}

export interface InfrastructureSyncOptions {
  triggeredBy: string;
  dryRun?: boolean;
}

export async function syncInfrastructureAccounts(
  options: InfrastructureSyncOptions
): Promise<InfrastructureSyncResult> {
  const { triggeredBy, dryRun = false } = options;

  appLogger.info('Starting infrastructure sync', { triggeredBy, dryRun });

  const leaseOwner = randomUUID();
  const leaseStartedAt = new Date();
  const acquired = await prisma.$queryRaw<Array<{ owner: string }>>`
    INSERT INTO "OperationalLease" ("key", "owner", "expiresAt", "updatedAt")
    VALUES ('infrastructure-sync', ${leaseOwner}, ${new Date(leaseStartedAt.getTime() + 5 * 60_000)}, ${leaseStartedAt})
    ON CONFLICT ("key") DO UPDATE SET
      "owner" = EXCLUDED."owner", "expiresAt" = EXCLUDED."expiresAt", "updatedAt" = EXCLUDED."updatedAt"
    WHERE "OperationalLease"."expiresAt" <= ${leaseStartedAt}
    RETURNING "owner"
  `;
  if (acquired.length !== 1) {
    throw new Error('Another infrastructure sync is already running');
  }

  const syncRecord = await prisma.aDAccountSync.create({
    data: {
      triggeredBy,
      status: 'running',
      notes: dryRun ? 'Dry run - no records created' : 'Infrastructure sync - creating AccessRequest and VPNAccount records',
    },
  });
  const correlationId = `infrastructure-sync:${syncRecord.id}`;

  await logActionHistoryEvent({
    action: AuditActions.SYNC_INFRASTRUCTURE,
    category: AuditCategories.SYNC_STATUS,
    username: triggeredBy,
    actorType: triggeredBy === 'system' ? 'system' : 'admin',
    targetId: syncRecord.id,
    targetType: 'ADAccountSync',
    eventKind: 'sync',
    outcome: 'pending',
    success: true,
    details: { dryRun, status: 'running' },
    correlationId,
  });

  try {
    appLogger.info('Fetching all AD users with @cpp.edu emails');
    const adUsers = await listUsersInOU();
    const cppAdUsers = adUsers.filter(
      (user) => user.email && user.email.toLowerCase().endsWith('@cpp.edu')
    );

    appLogger.info(`Found ${cppAdUsers.length} AD accounts with @cpp.edu emails`);

    if (cppAdUsers.length === 0) {
      await prisma.aDAccountSync.update({
        where: { id: syncRecord.id },
        data: {
          status: 'completed',
          completedAt: new Date(),
          totalADAccounts: 0,
          notes: 'No AD accounts found with @cpp.edu emails',
        },
      });

      await logActionHistoryEvent({
        action: AuditActions.SYNC_INFRASTRUCTURE,
        category: AuditCategories.SYNC_STATUS,
        username: triggeredBy,
        actorType: triggeredBy === 'system' ? 'system' : 'admin',
        targetId: syncRecord.id,
        targetType: 'ADAccountSync',
        eventKind: 'sync',
        outcome: 'success',
        success: true,
        details: { dryRun, totalADAccounts: 0, note: 'No AD accounts found with @cpp.edu emails' },
        correlationId,
      });

      await prisma.operationalLease.deleteMany({ where: { key: 'infrastructure-sync', owner: leaseOwner } }).catch(() => undefined);
      return {
        syncId: syncRecord.id,
        status: 'completed',
        stats: {
          totalADAccounts: 0,
          newAccessRequests: 0,
          newVPNAccounts: 0,
          skippedDuplicates: 0,
          errors: 0,
        },
        records: [],
      };
    }

    const result = await prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        const records: InfrastructureSyncResult['records'] = [];
        let newAccessRequests = 0;
        let newVPNAccounts = 0;
        let skippedDuplicates = 0;
        let errors = 0;

        for (let userIndex = 0; userIndex < cppAdUsers.length; userIndex += 1) {
          const adUser = cppAdUsers[userIndex];
          if (userIndex > 0 && userIndex % 25 === 0) {
            const renewedAt = new Date();
            const renewed = await tx.operationalLease.updateMany({
              where: { key: 'infrastructure-sync', owner: leaseOwner },
              data: { expiresAt: new Date(renewedAt.getTime() + 5 * 60_000) },
            });
            if (renewed.count !== 1) throw new Error('Infrastructure sync lease was lost');
          }
          try {
            const bronconame = extractBronconame(adUser.email);
            
            if (!bronconame) {
              appLogger.warn(`Could not extract bronconame from ${adUser.email}`);
              records.push({
                adUsername: 'unknown',
                adEmail: adUser.email,
                adDisplayName: adUser.displayName,
                action: 'error',
                accessRequestId: null,
                vpnAccountId: null,
                errorMessage: 'Could not extract bronconame from email',
              });
              errors++;
              continue;
            }

            if (!dryRun) {
              const canonicalAdUsername = bronconame.trim().toLowerCase();
              await acquireDirectoryOwnershipFence(tx, canonicalAdUsername);
              const currentDirectoryUser = await searchLDAPUser(bronconame);
              if (!currentDirectoryUser) {
                appLogger.warn(`Skipping ${bronconame} - directory account disappeared after inventory`);
                records.push({
                  adUsername: bronconame,
                  adEmail: adUser.email,
                  adDisplayName: adUser.displayName,
                  action: 'error',
                  accessRequestId: null,
                  vpnAccountId: null,
                  errorMessage: 'Directory account disappeared after inventory; no portal ownership record was created',
                });
                errors++;
                continue;
              }
            }

            const existingAccessRequest = await tx.accessRequest.findFirst({
              where: {
                OR: [
                  { email: { equals: adUser.email.toLowerCase(), mode: 'insensitive' } },
                  { ldapUsername: { equals: bronconame, mode: 'insensitive' } },
                  { vpnUsername: { equals: bronconame, mode: 'insensitive' } },
                  { linkedAdUsername: { equals: bronconame, mode: 'insensitive' } },
                ],
                status: { not: 'rejected' },
              },
            });

            const batchAdOwners = dryRun
              ? await tx.batchAccountItem.findMany({
                  where: {
                    accountType: 'AD',
                    lifecycleOwnerKind: 'batch_item',
                    accessRequestId: null,
                    status: { in: ['processing', 'completed', 'reconciliation_required'] },
                    ldapUsername: { equals: bronconame, mode: 'insensitive' },
                    OR: [{ adAccountStatus: null }, { adAccountStatus: { not: 'deleted' } }],
                  },
                  select: { id: true, batchId: true, accountType: true, status: true },
                  take: 2,
                })
              : await findBatchDirectoryOwnershipClaims(tx, bronconame, 'AD');

            if (batchAdOwners.length > 0) {
              appLogger.info(`Skipping ${bronconame} - account is governed by batch ${batchAdOwners[0].batchId}`);
              records.push({
                adUsername: bronconame,
                adEmail: adUser.email,
                adDisplayName: adUser.displayName,
                action: 'skipped_duplicate',
                accessRequestId: null,
                vpnAccountId: null,
              });
              skippedDuplicates++;
              continue;
            }

            const existingVPNAccount = await tx.vPNAccount.findFirst({
              where: {
                username: bronconame,
              },
            });

            // VPN record creation only happens while VPN management is
            // enabled; otherwise sync reconciles AD-only.
            const vpnModuleEnabled = await isModuleEnabled('vpn.management');

            // Offboarding is durable lifecycle state, not an absent onboarding
            // record. Never recreate active portal/VPN state for that identity.
            if (existingAccessRequest?.status === 'offboarded') {
              appLogger.info(`Skipping ${bronconame} - access request is offboarded`);
              records.push({
                adUsername: bronconame,
                adEmail: adUser.email,
                adDisplayName: adUser.displayName,
                action: 'skipped_duplicate',
                accessRequestId: existingAccessRequest.id,
                vpnAccountId: existingVPNAccount?.id || null,
              });
              skippedDuplicates++;
              continue;
            }

            if (existingAccessRequest && existingVPNAccount) {
              appLogger.info(`Skipping ${bronconame} - both records already exist`);
              records.push({
                adUsername: bronconame,
                adEmail: adUser.email,
                adDisplayName: adUser.displayName,
                action: 'skipped_duplicate',
                accessRequestId: existingAccessRequest.id,
                vpnAccountId: existingVPNAccount.id,
              });
              skippedDuplicates++;
              continue;
            }

            if (dryRun) {
              const wouldCreate = [];
              if (!existingAccessRequest) {
                wouldCreate.push('AccessRequest');
                newAccessRequests += 1;
              }
              if (vpnModuleEnabled && !existingVPNAccount) {
                wouldCreate.push('VPNAccount');
                newVPNAccounts += 1;
              }
              
              appLogger.info(`[DRY RUN] Would create ${wouldCreate.join(' and ')} for ${bronconame}`);
              records.push({
                adUsername: bronconame,
                adEmail: adUser.email,
                adDisplayName: adUser.displayName,
                action: 'created',
                accessRequestId: existingAccessRequest?.id || null,
                vpnAccountId: existingVPNAccount?.id || null,
              });
              continue;
            }

            let accessRequestId = existingAccessRequest?.id || null;
            if (!existingAccessRequest) {
              const newAccessRequest = await tx.accessRequest.create({
                data: {
                  name: adUser.displayName,
                  email: adUser.email.toLowerCase(),
                  isInternal: true,
                  needsDomainAccount: false,
                  status: 'approved',
                  isVerified: true,
                  verifiedAt: new Date(),
                  isManuallyAssigned: true,
                  linkedAdUsername: bronconame,
                  ...(vpnModuleEnabled ? { linkedVpnUsername: bronconame } : {}),
                  manuallyAssignedBy: triggeredBy,
                  manuallyAssignedAt: new Date(),
                  manualAssignmentNotes: `Auto-created during infrastructure sync - existing AD account ${bronconame}@cpp.edu`,
                  ldapUsername: bronconame,
                  ...(vpnModuleEnabled ? { vpnUsername: bronconame } : {}),
                  approvedAt: new Date(),
                  approvedBy: triggeredBy,
                  approvalMessage: 'Auto-approved - existing AD infrastructure account',
                  accountCreatedAt: new Date(),
                  provisioningState: 'completed',
                  provisioningCompletedAt: new Date(),
                },
              });
              accessRequestId = newAccessRequest.id;
              newAccessRequests++;
              appLogger.info(`Created AccessRequest for ${bronconame}`);

            }

            let vpnAccountId = existingVPNAccount?.id || null;
            if (vpnModuleEnabled && !existingVPNAccount) {
              const placeholderPassword = `InfraSync-${randomBytes(24).toString('base64url')}`;
              
              const newVPNAccount = await tx.vPNAccount.create({
                data: {
                  username: bronconame,
                  name: adUser.displayName,
                  email: adUser.email.toLowerCase(),
                  portalType: 'Limited',
                  isInternal: true,
                  status: 'active',
                  password: placeholderPassword,
                  createdBy: triggeredBy,
                  createdByFaculty: true,
                  facultyCreatedAt: new Date(),
                  notes: `Auto-created during infrastructure sync - existing AD account ${bronconame}@cpp.edu`,
                  accessRequestId: accessRequestId,
                  adUsername: bronconame,
                },
              });
              vpnAccountId = newVPNAccount.id;
              newVPNAccounts++;
              appLogger.info(`Created VPNAccount for ${bronconame}`);

              await tx.vPNAccountStatusLog.create({
                data: {
                  accountId: newVPNAccount.id,
                  liveAccountId: newVPNAccount.id,
                  oldStatus: null,
                  newStatus: 'active',
                  changedBy: triggeredBy,
                  reason: 'Infrastructure sync - existing AD account',
                },
              });
            }

            const syncMatch = await tx.aDAccountMatch.create({
              data: {
                syncId: syncRecord.id,
                adUsername: bronconame,
                adDisplayName: adUser.displayName,
                adEmail: adUser.email,
                vpnUsername: bronconame,
                vpnAccountId: vpnAccountId,
                accessRequestId: accessRequestId,
                requestEmail: adUser.email,
                requestName: adUser.displayName,
                matchType: 'full_match',
                wasAutoAssigned: true,
                assignedAt: new Date(),
                notes: 'Infrastructure sync - created records for existing AD account',
              },
            });

            records.push({
              adUsername: bronconame,
              adEmail: adUser.email,
              adDisplayName: adUser.displayName,
              action: 'created',
              accessRequestId,
              vpnAccountId,
              syncMatchId: syncMatch.id,
            });
          } catch (error) {
            appLogger.error(`Error processing AD user ${adUser.email}`, error);
            records.push({
              adUsername: extractBronconame(adUser.email) || 'unknown',
              adEmail: adUser.email,
              adDisplayName: adUser.displayName,
              action: 'error',
              accessRequestId: null,
              vpnAccountId: null,
              errorMessage: error instanceof Error ? error.message : String(error),
            });
            errors++;
          }
        }

        await tx.aDAccountSync.update({
          where: { id: syncRecord.id },
          data: {
            status: errors === 0 ? 'completed' : 'partial',
            completedAt: new Date(),
            totalADAccounts: cppAdUsers.length,
            autoAssigned: newAccessRequests + newVPNAccounts,
            notes: dryRun
              ? `[DRY RUN] Would create ${newAccessRequests} AccessRequests and ${newVPNAccounts} VPNAccounts`
              : `Created ${newAccessRequests} AccessRequests and ${newVPNAccounts} VPNAccounts, skipped ${skippedDuplicates} duplicates, ${errors} errors`,
          },
        });

        return {
          records,
          newAccessRequests,
          newVPNAccounts,
          skippedDuplicates,
          errors,
        };
      },
      {
        maxWait: 30000,
        timeout: 180000,
        isolationLevel: 'ReadCommitted',
      }
    );

    const tagging = { completed: 0, failed: 0 };

    appLogger.info('Infrastructure sync completed successfully', {
      syncId: syncRecord.id,
      stats: {
        totalADAccounts: cppAdUsers.length,
        newAccessRequests: result.newAccessRequests,
        newVPNAccounts: result.newVPNAccounts,
        skippedDuplicates: result.skippedDuplicates,
        errors: result.errors,
      },
    });

    await Promise.all(result.records.map((record) => logActionHistoryEvent({
      action: AuditActions.SYNC_ACCOUNT_PROCESSED,
      category: AuditCategories.SYNC_STATUS,
      username: triggeredBy,
      actorType: triggeredBy === 'system' ? 'system' : 'admin',
      targetId: record.accessRequestId || record.vpnAccountId || syncRecord.id,
      targetType: record.accessRequestId ? 'AccessRequest' : record.vpnAccountId ? 'VPNAccount' : 'ADAccountSync',
      subjectUsername: record.adUsername === 'unknown' ? null : record.adUsername,
      subjectEmail: record.adEmail,
      relatedRequestId: record.accessRequestId,
      relatedVpnAccountId: record.vpnAccountId,
      eventKind: 'sync',
      outcome: record.action === 'error' ? 'failure' : record.action === 'skipped_duplicate' ? 'skipped' : dryRun ? 'pending' : 'success',
      success: record.action !== 'error',
      errorMessage: record.errorMessage,
      details: {
        syncId: syncRecord.id,
        syncMatchId: record.syncMatchId,
        action: record.action,
        adDisplayName: record.adDisplayName,
        dryRun,
      },
      correlationId,
    })));

    await logActionHistoryEvent({
      action: AuditActions.SYNC_INFRASTRUCTURE,
      category: AuditCategories.SYNC_STATUS,
      username: triggeredBy,
      actorType: triggeredBy === 'system' ? 'system' : 'admin',
      targetId: syncRecord.id,
      targetType: 'ADAccountSync',
      eventKind: 'sync',
      outcome: result.errors === 0 ? 'success' : 'failure',
      success: result.errors === 0,
      details: {
        dryRun,
        totalADAccounts: cppAdUsers.length,
        newAccessRequests: result.newAccessRequests,
        newVPNAccounts: result.newVPNAccounts,
        skippedDuplicates: result.skippedDuplicates,
        errors: result.errors,
      },
      correlationId,
    });

    const response: InfrastructureSyncResult = {
      syncId: syncRecord.id,
      status: result.errors === 0 ? 'completed' : 'partial',
      stats: {
        totalADAccounts: cppAdUsers.length,
        newAccessRequests: result.newAccessRequests,
        newVPNAccounts: result.newVPNAccounts,
        skippedDuplicates: result.skippedDuplicates,
        errors: result.errors,
      },
      records: result.records,
      tagging,
    };
    await prisma.operationalLease.deleteMany({ where: { key: 'infrastructure-sync', owner: leaseOwner } }).catch(() => undefined);
    return response;
  } catch (error) {
    appLogger.error('Infrastructure sync database transaction failed', error);

    const errorMessage = error instanceof Error ? error.message : String(error);

    try {
      await prisma.aDAccountSync.update({
        where: { id: syncRecord.id },
        data: {
          status: 'failed',
          completedAt: new Date(),
          errorMessage: `${errorMessage} - database writes were rolled back`,
          notes: 'Database transaction failed. External directory reads are not transactional.',
        },
      });
    } catch (updateError) {
      appLogger.error('Failed to update sync record with error', updateError);
    }

    await logActionHistoryEvent({
      action: AuditActions.SYNC_INFRASTRUCTURE,
      category: AuditCategories.SYNC_STATUS,
      username: triggeredBy,
      actorType: triggeredBy === 'system' ? 'system' : 'admin',
      targetId: syncRecord.id,
      targetType: 'ADAccountSync',
      eventKind: 'sync',
      outcome: 'rollback',
      success: false,
      errorMessage,
      details: { dryRun, note: 'Database writes were rolled back; external reads are not transactional' },
      correlationId,
    });

    await prisma.operationalLease.deleteMany({ where: { key: 'infrastructure-sync', owner: leaseOwner } }).catch(() => undefined);
    return {
      syncId: syncRecord.id,
      status: 'failed',
      stats: {
        totalADAccounts: 0,
        newAccessRequests: 0,
        newVPNAccounts: 0,
        skippedDuplicates: 0,
        errors: 0,
      },
      records: [],
      error: errorMessage,
    };
  }
}

export async function getLatestInfrastructureSync() {
  return await prisma.aDAccountSync.findFirst({
    where: {
      notes: {
        contains: 'Infrastructure sync',
      },
    },
    orderBy: { createdAt: 'desc' },
    include: {
      matches: {
        orderBy: { createdAt: 'asc' },
      },
      taggingTasks: {
        orderBy: { createdAt: 'asc' },
      },
    },
  });
}

export async function getInfrastructureSyncHistory(limit = 10) {
  return await prisma.aDAccountSync.findMany({
    where: {
      notes: {
        contains: 'Infrastructure sync',
      },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      _count: {
        select: { matches: true },
      },
    },
  });
}

export async function getInfrastructureSyncById(syncId: string) {
  return await prisma.aDAccountSync.findUnique({
    where: { id: syncId },
    include: {
      matches: {
        orderBy: { createdAt: 'asc' },
      },
      taggingTasks: {
        orderBy: { createdAt: 'asc' },
      },
    },
  });
}
