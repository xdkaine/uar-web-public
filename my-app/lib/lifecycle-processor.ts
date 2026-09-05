import { Prisma, type AccessRequest, type AccountLifecycleAction, type AccountLifecycleBatch, type BatchAccountItem, type OffboardCampaign, type VPNAccount } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  disableConfirmedLDAPUser,
  enableConfirmedLDAPUser,
  deleteConfirmedDisabledLDAPUser,
  appendADDescription,
  searchLDAPUser,
  addLDAPGroupMember,
  removeLDAPGroupMember,
  getLDAPGroupMembers,
  getLDAPGroupIdentity,
} from '@/lib/ldap';
import { appLogger } from '@/lib/logger';
import { logActionHistoryEvent } from '@/lib/action-history';
import { AuditActions, AuditCategories } from '@/lib/audit-log';
import { isModuleEnabled, MODULE_STATE_LOCK_NAMESPACE } from '@/lib/modules/core';
import { revokeUserSessionsEverywhere } from '@/lib/auth/provider-logout-audit';
import { randomUUID } from 'crypto';
import { assertExternalSideEffectAllowed } from '@/lib/clone-safety';
import { isLifecycleProvisioningReady } from '@/lib/access-request-lifecycle-readiness';
import { isAccessRequestDirectoryIdentityConsistent } from '@/lib/access-request-directory-identity';
import { acquireVpnOwnershipFence } from '@/lib/vpn-ownership-fence';
import { ldapAccountIsEnabled } from '@/lib/ldap/account-status';
import { assertLifecycleAccountNotProtected, assertLifecycleGroupNotProtected } from '@/lib/lifecycle-protection';
import { refreshReviewedDeletionPlanAggregate, REVIEWED_DELETION_PLAN_POLICY_VERSION } from '@/lib/lifecycle-deletion-plan';
import {
  BATCH_GOVERNED_DIRECTORY_DELETE_POLICY_VERSION,
  DIRECTORY_DELETE_METHOD,
  DIRECTORY_DELETE_METHOD_EVIDENCE_KEY,
  expectedDirectoryDeletePolicyVersion,
  GOVERNED_DIRECTORY_DELETE_POLICY_VERSION,
  hasCurrentDirectoryDeleteMethod,
  planContainsDirectoryDeletion,
  UNMANAGED_DIRECTORY_DELETE_POLICY_VERSION,
} from '@/lib/lifecycle-directory-deletion-policy';

/**
 * Workflow-graph emission for lifecycle outcomes (ADR-0013): completed and
 * failed actions feed trigger_lifecycle_action_* nodes. Fire-and-forget by
 * contract - a broken workflow engine must never fail a lifecycle action.
 */
async function emitLifecycleOutcome(
  action: LifecycleAction,
  status: 'completed' | 'failed',
  error?: string | null
): Promise<void> {
  try {
    const { emitLifecycleActionEvent } = await import('@/lib/flow/engine');
    await emitLifecycleActionEvent({
      actionType: action.actionType,
      username: action.targetUsername,
      status,
      actionId: action.id,
      batchId: action.batchId ?? null,
      error: status === 'failed' ? error ?? null : null,
    });
  } catch (flowError) {
    appLogger.warn('Workflow lifecycle-event emission failed', {
      actionId: action.id,
      error: flowError instanceof Error ? flowError.message : 'Unknown',
    });
  }
}

/**
 * Standalone VPN lifecycle actions fail explicitly (and are recorded as
 * failures) when the VPN module is disabled. New VPN-only actions are already
 * blocked at intake, so this only affects legacy queued work.
 */
async function assertVpnModuleAvailable(actionType: string): Promise<void> {
  if (!(await isModuleEnabled('vpn.management'))) {
    throw new Error(`VPN management is disabled; ${actionType} cannot be processed`);
  }
}

export interface ProcessResult {
  success: boolean;
  actionId: string;
  error?: string;
  adCompleted?: boolean;
  vpnCompleted?: boolean;
  reconciliationRequired?: boolean;
}

type VpnOperation = 'revoke' | 'restore';

interface CombinedVpnResult {
  username: string | null;
  skippedReason?: string;
}

type LifecycleAction = AccountLifecycleAction & {
  batch?: AccountLifecycleBatch | null;
  offboardCampaign?: OffboardCampaign | null;
};

type LdapErrorLike = {
  code?: number | string;
};

class LifecycleReconciliationRequiredError extends Error {
  readonly code = 'LIFECYCLE_RECONCILIATION_REQUIRED';
}

const INACTIVE_VPN_STATUSES = new Set(['revoked', 'disabled']);
const DIRECTORY_EXECUTION_ACTIONS = new Set([
  'disable_ad', 'enable_ad', 'delete_ad', 'disable_both', 'enable_both',
  'add_group_member', 'add_to_group', 'remove_from_group',
]);
const DIRECTORY_EXECUTION_LOCK_NAMESPACE = 873211;
const VPN_EXECUTION_LOCK_NAMESPACE = 904771;
const BATCH_GOVERNED_DIRECTORY_IDENTITY_POLICY_VERSION = 'batch-governed-directory-identity-v1';
const ACTIVE_BATCH_OWNERSHIP_STATUSES = ['processing', 'completed', 'reconciliation_required'];

type VpnBatchOwnershipClaim = BatchAccountItem;

async function findActiveVpnBatchOwnershipClaims(
  tx: Prisma.TransactionClient,
  username: string
): Promise<VpnBatchOwnershipClaim[]> {
  return tx.batchAccountItem.findMany({
    where: {
      lifecycleOwnerKind: 'batch_item',
      accessRequestId: null,
      accountType: { in: ['VPN', 'BOTH'] },
      status: { in: ACTIVE_BATCH_OWNERSHIP_STATUSES },
      OR: [
        { vpnUsername: { equals: username, mode: 'insensitive' } },
        { ldapUsername: { equals: username, mode: 'insensitive' } },
      ],
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 2,
  });
}

function sameVpnUsername(left: string | null | undefined, right: string): boolean {
  return Boolean(left?.trim()) && left!.trim().toLowerCase() === right.trim().toLowerCase();
}

async function withDirectoryExecutionLock<T>(
  action: LifecycleAction,
  claimId: string,
  operation: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  const canonicalUsername = action.targetUsername.trim().toLowerCase();
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$queryRaw<Array<{ lock_acquired: string }>>`
      SELECT 'locked'::text AS lock_acquired
      FROM pg_advisory_xact_lock(hashtextextended(${canonicalUsername}, ${DIRECTORY_EXECUTION_LOCK_NAMESPACE}))
    `;
    const current = await tx.accountLifecycleAction.findUnique({
      where: { id: action.id },
      select: { status: true, claimId: true, claimedUntil: true },
    });
    if (
      current?.status !== 'processing'
      || current.claimId !== claimId
      || !current.claimedUntil
      || current.claimedUntil.getTime() <= Date.now()
    ) {
      throw new Error(`Processing claim for action ${action.id} expired before directory execution`);
    }
    if (action.actionType === 'delete_ad') {
      await tx.$queryRaw<Array<{ lock_acquired: string }>>`
        SELECT 'locked'::text AS lock_acquired
        FROM pg_advisory_xact_lock(hashtextextended(${canonicalUsername}, 771921))
      `;
    }
    return operation(tx);
  }, { maxWait: 30_000, timeout: 15 * 60 * 1000 });
}

async function withVpnExecutionLock<T>(
  action: LifecycleAction,
  claimId: string,
  operation: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  if (!action.targetUserId) {
    throw new Error(`VPN lifecycle action ${action.id} is missing its immutable target ID`);
  }
  const canonicalUsername = action.targetUsername.trim().toLowerCase();
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    if (action.actionType === 'delete_vpn_record') {
      await acquireVpnOwnershipFence(tx, canonicalUsername);
    }
    await tx.$queryRaw<Array<{ lock_acquired: string }>>`
      SELECT 'locked'::text AS lock_acquired
      FROM pg_advisory_xact_lock(hashtextextended(${canonicalUsername}, ${VPN_EXECUTION_LOCK_NAMESPACE}))
    `;
    if (action.actionType === 'delete_vpn_record') {
      await tx.$queryRaw<Array<{ lock_acquired: string }>>`
        SELECT 'locked'::text AS lock_acquired
        FROM pg_advisory_xact_lock(hashtextextended(${'vpn.management'}, ${MODULE_STATE_LOCK_NAMESPACE}))
      `;
      const moduleState = await tx.moduleState.findUnique({ where: { moduleId: 'vpn.management' } });
      if (moduleState?.enabled === false) {
        throw new Error('VPN management is disabled; delete_vpn_record cannot be processed');
      }
    }
    const lockedRows = await tx.$queryRaw<Array<{ locked_id: string }>>`
      SELECT "id"::text AS locked_id
      FROM "VPNAccount"
      WHERE "id" = ${action.targetUserId}
      FOR UPDATE
    `;
    if (lockedRows.length !== 1) {
      throw new Error(`VPN account ${action.targetUsername} no longer exists for target ID ${action.targetUserId}`);
    }
    const current = await tx.accountLifecycleAction.findUnique({
      where: { id: action.id },
      select: { status: true, claimId: true, claimedUntil: true },
    });
    if (
      current?.status !== 'processing'
      || current.claimId !== claimId
      || !current.claimedUntil
      || current.claimedUntil.getTime() <= Date.now()
    ) {
      throw new Error(`Processing claim for action ${action.id} expired before VPN execution`);
    }
    return operation(tx);
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    maxWait: 30_000,
    timeout: 60_000,
  });
}

function auditActionForLifecycleType(actionType: string): string {
  switch (actionType) {
    case 'disable_ad':
    case 'disable_both':
      return AuditActions.DISABLE_AD_ACCOUNT;
    case 'enable_ad':
    case 'enable_both':
      return AuditActions.ENABLE_AD_ACCOUNT;
    case 'delete_ad':
      return AuditActions.DELETE_USER;
    case 'revoke_vpn':
      return AuditActions.REVOKE_VPN_ACCESS;
    case 'restore_vpn':
      return AuditActions.RESTORE_VPN_ACCESS;
    case 'delete_vpn_record':
      return AuditActions.DELETE_VPN_ACCOUNT;
    case 'promote_vpn_role':
      return AuditActions.PROMOTE_VPN_ROLE;
    case 'demote_vpn_role':
      return AuditActions.DEMOTE_VPN_ROLE;
    case 'add_group_member':
    case 'add_to_group':
      return AuditActions.ADD_GROUP_MEMBER;
    case 'remove_from_group':
      return AuditActions.REMOVE_GROUP_MEMBER;
    default:
      return AuditActions.PROCESS_LIFECYCLE_ACTION;
  }
}

async function logLifecycleActionHistory(
  action: LifecycleAction,
  lifecycleEvent: 'processing' | 'completed' | 'failed',
  outcome: 'pending' | 'success' | 'failure',
  details: Record<string, unknown>,
  errorMessage?: string
) {
  await logActionHistoryEvent({
    action: auditActionForLifecycleType(action.actionType),
    category: AuditCategories.LIFECYCLE,
    username: 'system',
    actorType: 'system',
    targetId: action.id,
    targetType: 'AccountLifecycleAction',
    subjectUsername: action.targetUsername,
    relatedRequestId: action.relatedRequestId,
    relatedVpnAccountId: action.targetAccountType === 'VPN' ? action.targetUserId : null,
    relatedLifecycleActionId: action.id,
    eventKind: 'lifecycle',
    outcome,
    success: outcome !== 'failure',
    errorMessage,
    details: {
      lifecycleEvent,
      actionType: action.actionType,
      targetAccountType: action.targetAccountType,
      requestedBy: action.requestedBy,
      reason: action.reason,
      operationMode: action.operationMode,
      bindingFailureCode: action.bindingFailureCode,
      policyVersion: action.policyVersion,
      batchId: action.batchId,
      offboardCampaignId: action.offboardCampaignId,
      ...details,
    },
    correlationId: `lifecycle:${action.id}`,
  });
}

export async function processLifecycleAction(actionId: string): Promise<ProcessResult> {
  const claimId = randomUUID();
  const now = new Date();
  const claimedUntil = new Date(now.getTime() + 10 * 60 * 1000);
  const claimed = await prisma.accountLifecycleAction.updateMany({
    where: {
      id: actionId,
      OR: [
        {
          status: 'queued',
          AND: [
            { OR: [{ scheduledFor: null }, { scheduledFor: { lte: now } }] },
          ],
        },
      ],
    },
    data: {
      status: 'processing',
      claimId,
      claimedUntil,
      attempts: { increment: 1 },
      processedAt: now,
      processedBy: 'system',
    },
  });

  if (claimed.count !== 1) {
    const current = await prisma.accountLifecycleAction.findUnique({ where: { id: actionId } });
    if (!current) {
      throw new Error(`Action ${actionId} not found`);
    }
    throw new Error(`Action ${actionId} is not ready for processing: ${current.status}`);
  }

  const action = await prisma.accountLifecycleAction.findUnique({
    where: { id: actionId },
    include: { batch: true, offboardCampaign: true },
  });

  if (!action || action.claimId !== claimId) {
    throw new Error(`Action ${actionId} could not be loaded after queue claim`);
  }

  const originalStatus = 'queued';
  let adCompleted = false;
  let vpnCompleted = false;
  let completionDetails: Record<string, unknown> = {};
  let resultSnapshot: Prisma.InputJsonValue | undefined;
  let errorMessage: string | undefined;
  let externalMutationStarted = false;
  const markExternalMutationStarted = () => { externalMutationStarted = true; };

  try {
    assertReviewedDeletionPlanUsesCurrentDirectoryMethod(action);
    ensureOffboardLifecycleActionAllowed(action);

    await prisma.accountLifecycleHistory.create({
      data: {
        actionId,
        event: 'processing',
        performedBy: 'system',
        previousStatus: originalStatus,
        newStatus: 'processing',
      },
    });

    await logLifecycleActionHistory(action, 'processing', 'pending', { previousStatus: originalStatus });

    const executeClaimedAction = async (executionTx?: Prisma.TransactionClient) => {
      switch (action.actionType) {
      case 'disable_ad':
        if (action.operationMode === 'directory_override') {
          if (!executionTx) throw new Error('Directory override requires a directory execution transaction');
          resultSnapshot = await processDirectoryOverride(action, false, markExternalMutationStarted, executionTx);
          completionDetails = { ...completionDetails, directoryOverride: true, resultSnapshot };
        } else if (action.operationMode === 'batch_governed') {
          resultSnapshot = await disableBatchADAccount(action, markExternalMutationStarted);
          completionDetails = { ...completionDetails, batchGoverned: true, resultSnapshot };
        } else {
          await disableADAccount(action, markExternalMutationStarted);
        }
        adCompleted = true;
        completionDetails = {
          ...completionDetails,
          sessionCleanup: await cleanupManualDisabledAdSessions(action),
        };
        break;

      case 'disable_both': {
        const accessRequest = await disableADAccount(action, markExternalMutationStarted);
        adCompleted = true;

        const vpnResult = await revokeLinkedVPNForCombinedAction(action, accessRequest);
        vpnCompleted = Boolean(vpnResult.username && !vpnResult.skippedReason);

        completionDetails = {
          ...completionDetails,
          linkedVpnUsername: vpnResult.username,
          linkedVpnSkippedReason: vpnResult.skippedReason,
          manualOffboard: await markManualAccessRequestOffboarded(action, accessRequest),
          sessionCleanup: await cleanupManualDisabledAdSessions(action),
        };
        break;
      }

      case 'enable_ad':
        if (action.operationMode === 'directory_override') {
          if (!executionTx) throw new Error('Directory override requires a directory execution transaction');
          resultSnapshot = await processDirectoryOverride(action, true, markExternalMutationStarted, executionTx);
          completionDetails = { ...completionDetails, directoryOverride: true, resultSnapshot };
        } else if (action.operationMode === 'batch_governed') {
          resultSnapshot = await enableBatchADAccount(action, markExternalMutationStarted);
          completionDetails = { ...completionDetails, batchGoverned: true, resultSnapshot };
        } else {
          await enableADAccount(action, markExternalMutationStarted);
        }
        adCompleted = true;
        break;

      case 'enable_both': {
        const accessRequest = await enableADAccount(action, markExternalMutationStarted);
        adCompleted = true;

        const vpnResult = await restoreLinkedVPNForCombinedAction(action, accessRequest);
        vpnCompleted = Boolean(vpnResult.username && !vpnResult.skippedReason);

        completionDetails = {
          ...completionDetails,
          linkedVpnUsername: vpnResult.username,
          linkedVpnSkippedReason: vpnResult.skippedReason,
        };
        break;
      }

      case 'delete_ad':
        if (!executionTx) throw new Error('Permanent deletion requires a directory execution transaction');
        resultSnapshot = await deleteADAccount(
          action,
          markExternalMutationStarted,
          executionTx,
          async (snapshot) => {
            resultSnapshot = snapshot;
            const persisted = await prisma.accountLifecycleAction.updateMany({
              where: { id: action.id, status: 'processing', claimId },
              data: { resultSnapshot: snapshot },
            });
            if (persisted.count !== 1) {
              throw new Error('Deletion safety checkpoint could not be persisted before LDAP execution');
            }
          }
        );
        completionDetails = {
          ...completionDetails,
          permanentlyDeleted: true,
          deletionSafetyChecks: resultSnapshot.safetyChecks,
        };
        adCompleted = true;
        break;

      case 'revoke_vpn':
        await assertVpnModuleAvailable(action.actionType);
        await revokeVPNAccess(action);
        vpnCompleted = true;
        break;

      case 'restore_vpn':
        await assertVpnModuleAvailable(action.actionType);
        await restoreVPNAccess(action);
        vpnCompleted = true;
        break;

      case 'delete_vpn_record':
        if (!executionTx) throw new Error('Permanent VPN record deletion requires a VPN execution transaction');
        resultSnapshot = await deleteVPNRecord(action, executionTx);
        completionDetails = {
          ...completionDetails,
          permanentlyDeleted: true,
          retainedHistory: true,
          deletedVpnAccountId: action.targetUserId,
        };
        vpnCompleted = true;
        break;

      case 'promote_vpn_role':
        await assertVpnModuleAvailable(action.actionType);
        await promoteVPNRole(action);
        vpnCompleted = true;
        break;

      case 'demote_vpn_role':
        await assertVpnModuleAvailable(action.actionType);
        await demoteVPNRole(action);
        vpnCompleted = true;
        break;

      case 'add_group_member':
      case 'add_to_group':
        completionDetails = await addADGroupMember(action, markExternalMutationStarted);
        resultSnapshot = completionDetails as Prisma.InputJsonObject;
        adCompleted = true;
        break;

      case 'remove_from_group':
        completionDetails = await removeADGroupMember(action, markExternalMutationStarted);
        resultSnapshot = completionDetails as Prisma.InputJsonObject;
        adCompleted = true;
        break;

        default:
          throw new Error(`Unknown action type: ${action.actionType}`);
      }
    };

    const finalizeCompletedAction = async (tx: Prisma.TransactionClient) => {
      const finalized = await tx.accountLifecycleAction.updateMany({
        where: { id: actionId, status: 'processing', claimId },
        data: {
          status: 'completed',
          completedAt: new Date(),
          adDisabled: adCompleted,
          vpnDisabled: vpnCompleted,
          resultSnapshot,
          claimId: null,
          claimedUntil: null,
        },
      });
      if (finalized.count !== 1) {
        throw new Error(`Processing claim for action ${actionId} was lost before completion`);
      }

      await tx.accountLifecycleHistory.create({
        data: {
          actionId,
          event: 'completed',
          performedBy: 'system',
          previousStatus: 'processing',
          newStatus: 'completed',
          details: JSON.stringify({ adCompleted, vpnCompleted, ...completionDetails }),
        },
      });

      if (action.batchId) {
        const reviewedPlan = await refreshReviewedDeletionPlanAggregate(tx, action.batchId);
        if (!reviewedPlan) {
          const batch = await tx.accountLifecycleBatch.findUnique({ where: { id: action.batchId } });
          if (batch) {
            const completedActions = batch.completedActions + 1;
            const finished = completedActions >= batch.totalActions;
            await tx.accountLifecycleBatch.update({
              where: { id: action.batchId },
              data: {
                completedActions: { increment: 1 },
                status: finished ? (batch.failedActions > 0 ? 'partial' : 'completed') : 'processing',
                completedAt: finished ? new Date() : null,
              },
            });
          }
        }
      }
    };

    if (DIRECTORY_EXECUTION_ACTIONS.has(action.actionType)) {
      await withDirectoryExecutionLock(action, claimId, executeClaimedAction);
      await prisma.$transaction(finalizeCompletedAction);
    } else if (action.actionType === 'delete_vpn_record') {
      await withVpnExecutionLock(action, claimId, async (tx) => {
        await executeClaimedAction(tx);
        await finalizeCompletedAction(tx);
      });
    } else {
      await executeClaimedAction();
      await prisma.$transaction(finalizeCompletedAction);
    }

    appLogger.info('Lifecycle action completed', {
      actionId,
      actionType: action.actionType,
      targetUsername: action.targetUsername,
    });

    try {
      await logLifecycleActionHistory(action, 'completed', 'success', { adCompleted, vpnCompleted, ...completionDetails });
    } catch (historyError) {
      // The lifecycle row and its transactional history are already finalized.
      // A secondary unified-audit failure must not reinterpret an irreversible
      // deletion (or any other completed external mutation) as uncertain.
      appLogger.error('Lifecycle completion audit emission failed after finalization', historyError instanceof Error ? historyError : undefined, {
        actionId,
        actionType: action.actionType,
      });
    }
    await emitLifecycleOutcome(action, 'completed');

    return { success: true, actionId, adCompleted, vpnCompleted };
  } catch (error) {
    if (action.actionType === 'delete_vpn_record') {
      const committed = await prisma.accountLifecycleAction.findUnique({
        where: { id: actionId },
        select: { status: true },
      });
      if (committed?.status === 'completed') {
        appLogger.warn('VPN deletion transaction committed although the processor response was interrupted', {
          actionId,
          targetUsername: action.targetUsername,
        });
        return { success: true, actionId, vpnCompleted: true };
      }
    }
    errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const reconciliationRequired = externalMutationStarted
      || error instanceof LifecycleReconciliationRequiredError
      || (error as { code?: string }).code === 'LIFECYCLE_RECONCILIATION_REQUIRED';

    // PostgreSQL rejects some control characters in error text, so strip them before persisting.
    errorMessage = errorMessage
      .replace(/\0/g, '')
      .replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '')
      .substring(0, 5000);
    
    try {
      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const failureStatus = reconciliationRequired
          ? 'reconciliation_required'
          : 'failed';
        const finalized = await tx.accountLifecycleAction.updateMany({
          where: { id: actionId, status: 'processing', claimId },
          data: {
            status: failureStatus,
            errorMessage,
            completedAt: new Date(),
            adDisabled: adCompleted,
            vpnDisabled: vpnCompleted,
            resultSnapshot,
            claimId: null,
            claimedUntil: null,
          },
        });
        if (finalized.count !== 1) {
          throw new Error(`Processing claim for action ${actionId} was lost before failure recording`);
        }

        await tx.accountLifecycleHistory.create({
          data: {
            actionId,
            event: failureStatus,
            performedBy: 'system',
            previousStatus: 'processing',
            newStatus: failureStatus,
            details: JSON.stringify({ error: errorMessage, adCompleted, vpnCompleted, externalMutationStarted }),
          },
        });

        if (action.batchId) {
          const reviewedPlan = await refreshReviewedDeletionPlanAggregate(tx, action.batchId);
          if (!reviewedPlan) {
            const batch = await tx.accountLifecycleBatch.findUnique({ where: { id: action.batchId } });
            if (batch) {
              if (reconciliationRequired) {
                await tx.accountLifecycleBatch.update({ where: { id: action.batchId }, data: { status: 'reconciliation_required' } });
              } else {
                const completedActions = batch.completedActions + 1;
                const failedActions = batch.failedActions + 1;
                const finished = completedActions >= batch.totalActions;
                await tx.accountLifecycleBatch.update({
                  where: { id: action.batchId },
                  data: {
                    failedActions: { increment: 1 },
                    completedActions: { increment: 1 },
                    status: finished ? (completedActions === failedActions ? 'failed' : 'partial') : 'processing',
                    completedAt: finished ? new Date() : null,
                  },
                });
              }
            }
          }
        }
      });
    } catch (txError) {
      appLogger.error('Failed to record action failure in database', {
        actionId,
        originalError: errorMessage,
        transactionError: txError instanceof Error ? txError.message : 'Unknown',
      });
      
      try {
        await prisma.accountLifecycleAction.updateMany({
          where: { id: actionId, claimId },
          data: {
            status: 'reconciliation_required',
            claimId: null,
            claimedUntil: null,
            resultSnapshot,
            errorMessage: `Database finalization failed after an external action may have run: ${errorMessage}`.slice(0, 5000),
          },
        });
      } catch (rollbackError) {
        appLogger.error('Failed to rollback action state', {
          actionId,
          error: rollbackError instanceof Error ? rollbackError.message : 'Unknown',
        });
      }
    }

    appLogger.error('Lifecycle action failed', {
      actionId,
      actionType: action.actionType,
      targetUsername: action.targetUsername,
      error: errorMessage,
    });

    await logLifecycleActionHistory(action, 'failed', 'failure', { adCompleted, vpnCompleted }, errorMessage);
    await emitLifecycleOutcome(action, 'failed', errorMessage);

    return {
      success: false,
      actionId,
      error: errorMessage,
      adCompleted,
      vpnCompleted,
      reconciliationRequired,
    };
  }
}

type LifecycleDirectorySnapshot = Prisma.InputJsonObject & {
  dn: string;
  username: string | null;
  enabled: boolean;
  objectGuid: string;
};

function directorySnapshot(
  user: NonNullable<Awaited<ReturnType<typeof searchLDAPUser>>>,
  expectedUsername: string
): LifecycleDirectorySnapshot {
  const value = (name: string) => user.attributes.find(
    (attribute) => attribute.type.toLowerCase() === name.toLowerCase()
  )?.values?.[0] ?? null;
  const rawUserAccountControl = value('userAccountControl');
  if (!rawUserAccountControl || !/^\d+$/.test(rawUserAccountControl)) {
    throw new Error(`Directory account ${expectedUsername} has an unreadable account-control state`);
  }
  const objectGuid = value('objectGUID');
  if (!objectGuid) {
    throw new Error(`Directory account ${expectedUsername} has no readable immutable object identity`);
  }
  return {
    observedAt: new Date().toISOString(),
    dn: user.objectName,
    username: value('sAMAccountName'),
    enabled: ldapAccountIsEnabled(user.attributes),
    userAccountControl: Number(rawUserAccountControl),
    objectGuid,
  };
}

async function processDirectoryOverride(
  action: LifecycleAction,
  shouldBeEnabled: boolean,
  onExternalMutationStart: () => void,
  tx: Prisma.TransactionClient
): Promise<Prisma.InputJsonObject> {
  if (!['disable_ad', 'enable_ad'].includes(action.actionType)) {
    throw new Error(`Directory override cannot process ${action.actionType}`);
  }
  if (!action.targetDirectoryDn || !action.authorizationEvidence || !action.bindingFailureCode || action.relatedBatchAccountItemId) {
    throw new Error('Directory override is missing required confirmation evidence');
  }
  const [currentOwners, batchOwners] = await Promise.all([
    tx.accessRequest.findMany({
      where: {
        status: { not: 'rejected' },
        OR: [
          { ldapUsername: { equals: action.targetUsername, mode: 'insensitive' } },
          { linkedAdUsername: { equals: action.targetUsername, mode: 'insensitive' } },
        ],
      },
      take: 1,
      select: { id: true },
    }),
    tx.batchAccountItem.findMany({
      where: {
        lifecycleOwnerKind: 'batch_item',
        accessRequestId: null,
        accountType: { in: ['AD', 'BOTH'] },
        status: { in: ['processing', 'completed', 'reconciliation_required'] },
        ldapUsername: { equals: action.targetUsername, mode: 'insensitive' },
        OR: [{ adAccountStatus: null }, { adAccountStatus: { not: 'deleted' } }],
      },
      take: 1,
      select: { id: true },
    }),
  ]);
  if (currentOwners.length > 0 || batchOwners.length > 0) {
    throw new Error('Directory override target gained a portal request or batch owner after confirmation; create a governed lifecycle plan');
  }
  const beforeUser = await searchLDAPUser(action.targetUsername);
  if (!beforeUser) throw new Error(`AD account ${action.targetUsername} was not found`);
  await assertLifecycleAccountNotProtected(beforeUser);
  if (beforeUser.objectName.toLowerCase() !== action.targetDirectoryDn.toLowerCase()) {
    throw new Error('Directory target changed after confirmation; create a new lifecycle plan');
  }
  const before = directorySnapshot(beforeUser, action.targetUsername);
  const confirmedObjectGuid = action.preflightSnapshot
    && typeof action.preflightSnapshot === 'object'
    && !Array.isArray(action.preflightSnapshot)
    && typeof action.preflightSnapshot.objectGuid === 'string'
      ? action.preflightSnapshot.objectGuid
      : null;
  if (!confirmedObjectGuid || before.objectGuid !== confirmedObjectGuid) {
    throw new Error('Directory object identity changed after confirmation; create a new lifecycle plan');
  }
  if (before.enabled === shouldBeEnabled) {
    throw new Error(`Directory account is already ${shouldBeEnabled ? 'enabled' : 'disabled'}`);
  }

  assertExternalSideEffectAllowed('ldap-write');
  onExternalMutationStart();
  if (shouldBeEnabled) {
    await enableConfirmedLDAPUser(action.targetUsername, {
      dn: action.targetDirectoryDn,
      objectGuid: confirmedObjectGuid,
    });
  } else {
    await disableConfirmedLDAPUser(action.targetUsername, {
      dn: action.targetDirectoryDn,
      objectGuid: confirmedObjectGuid,
    });
  }
  await appendADDescription(
    action.targetUsername,
    `Directory-only lifecycle ${shouldBeEnabled ? 'enable' : 'disable'}; reference ${action.relatedTicketId}; action ${action.id}`
  );

  const afterUser = await searchLDAPUser(action.targetUsername);
  if (!afterUser) throw new Error('Directory account could not be read back after lifecycle override');
  const after = directorySnapshot(afterUser, action.targetUsername);
  if (after.objectGuid !== confirmedObjectGuid || after.dn !== before.dn) {
    throw new Error('Directory readback resolved a different object than the confirmed target');
  }
  if (after.enabled !== shouldBeEnabled) {
    throw new Error(`Directory readback did not confirm account ${shouldBeEnabled ? 'enablement' : 'disablement'}`);
  }
  return { before, after };
}

function ensureOffboardLifecycleActionAllowed(action: LifecycleAction): void {
  const campaign = action.offboardCampaign;
  if (!campaign) {
    return;
  }

  const rollbackActions = new Set(['enable_ad', 'enable_both', 'restore_vpn']);
  if (rollbackActions.has(action.actionType)) {
    return;
  }

  if (campaign.cancelledAt || campaign.status === 'cancelled') {
    throw new Error(`Campaign-linked lifecycle action blocked because campaign ${campaign.id} is cancelled`);
  }

  if (campaign.emergencyStoppedAt) {
    throw new Error(`Campaign-linked lifecycle action blocked because campaign ${campaign.id} is emergency-stopped`);
  }

  const enforcementActions = new Set(['disable_ad', 'disable_both', 'revoke_vpn']);
  if (campaign.enforcementPaused && enforcementActions.has(action.actionType)) {
    throw new Error(`Campaign-linked enforcement action blocked because campaign ${campaign.id} enforcement is paused`);
  }
}

async function findAccessRequestForADAction(action: LifecycleAction, includeOffboarded = false): Promise<AccessRequest | null> {
  if (action.relatedRequestId) {
    return await prisma.accessRequest.findUnique({
      where: { id: action.relatedRequestId },
    });
  }

  return await prisma.accessRequest.findFirst({
    where: {
      OR: [
        { ldapUsername: { equals: action.targetUsername, mode: 'insensitive' } },
        { linkedAdUsername: { equals: action.targetUsername, mode: 'insensitive' } },
      ],
      status: includeOffboarded ? { not: 'rejected' } : { notIn: ['rejected', 'offboarded'] },
    },
    orderBy: { createdAt: 'desc' },
  });
}

async function findLinkedVPNAccountForADAction(
  action: LifecycleAction,
  accessRequest: AccessRequest | null,
  operation: VpnOperation
): Promise<VPNAccount | null> {
  const candidateUsernames = Array.from(new Set([
    accessRequest?.linkedVpnUsername,
    accessRequest?.vpnUsername,
    action.targetUsername,
  ].filter((value): value is string => typeof value === 'string' && value.length > 0)));

  for (const username of candidateUsernames) {
    const vpnAccount = await prisma.vPNAccount.findUnique({
      where: { username },
    });

    if (vpnAccount) {
      return vpnAccount;
    }
  }

  const linkedWhere: Prisma.VPNAccountWhereInput[] = [];
  if (accessRequest?.id) {
    linkedWhere.push({ accessRequestId: accessRequest.id });
  }
  linkedWhere.push({ adUsername: action.targetUsername });

  if (linkedWhere.length === 0) {
    return null;
  }

  const linkedAccounts = await prisma.vPNAccount.findMany({
    where: { OR: linkedWhere },
    orderBy: { updatedAt: 'desc' },
    take: 10,
  });

  const preferred = linkedAccounts.find((vpnAccount: VPNAccount) => {
    if (operation === 'revoke') {
      return !INACTIVE_VPN_STATUSES.has(vpnAccount.status);
    }
    return vpnAccount.status === 'revoked';
  });

  return preferred || linkedAccounts[0] || null;
}

async function revokeLinkedVPNForCombinedAction(action: LifecycleAction, accessRequest: AccessRequest | null): Promise<CombinedVpnResult> {
  // VPN management disabled: combined actions degrade to their AD portion and
  // record the skip explicitly instead of touching historical VPN records.
  if (!(await isModuleEnabled('vpn.management'))) {
    return { username: null, skippedReason: 'vpn_module_disabled' };
  }

  const vpnAccount = await findLinkedVPNAccountForADAction(action, accessRequest, 'revoke');
  if (!vpnAccount) {
    return { username: null, skippedReason: 'no_linked_vpn_account' };
  }

  if (INACTIVE_VPN_STATUSES.has(vpnAccount.status)) {
    return { username: vpnAccount.username, skippedReason: `vpn_already_${vpnAccount.status}` };
  }

  await revokeVPNAccess(action, vpnAccount.username, accessRequest?.id || null);
  return { username: vpnAccount.username };
}

async function restoreLinkedVPNForCombinedAction(action: LifecycleAction, accessRequest: AccessRequest | null): Promise<CombinedVpnResult> {
  if (!(await isModuleEnabled('vpn.management'))) {
    return { username: null, skippedReason: 'vpn_module_disabled' };
  }

  const vpnAccount = await findLinkedVPNAccountForADAction(action, accessRequest, 'restore');
  if (!vpnAccount) {
    return { username: null, skippedReason: 'no_linked_vpn_account' };
  }

  if (vpnAccount.status !== 'revoked') {
    return { username: vpnAccount.username, skippedReason: `vpn_not_revoked_${vpnAccount.status}` };
  }

  await restoreVPNAccess(action, vpnAccount.username, accessRequest?.id || null);
  return { username: vpnAccount.username };
}

function isManualAction(action: LifecycleAction): boolean {
  return !action.offboardCampaignId;
}

type GovernedDirectoryEvidence = {
  directoryDn: string;
  objectGuid: string;
};

type DeletionAuthorizationEvidence = Prisma.JsonObject & {
  safetyChecks: Prisma.JsonObject;
};

function assertDeletionAuthorizationEvidence(action: LifecycleAction): DeletionAuthorizationEvidence {
  const evidence = action.authorizationEvidence;
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    throw new Error('Permanent directory deletion is missing irreversible-action confirmation evidence');
  }
  const safetyChecks = evidence.safetyChecks;
  if (!safetyChecks || typeof safetyChecks !== 'object' || Array.isArray(safetyChecks)) {
    throw new Error('Permanent directory deletion is missing its recorded safety checklist');
  }
  const unmanaged = action.operationMode === 'directory_override';
  const batchGoverned = action.operationMode === 'batch_governed';
  const bulkPlan = typeof evidence.bulkPlanId === 'string';
  const requiredChecks = unmanaged
    ? ['unmanagedOperation', 'noPortalOwnerVerified', 'liveDirectoryDisabledVerified', 'protectedAccountPolicyPassed', 'immutableIdentityCaptured', 'irreversibleImpactAcknowledged']
    : batchGoverned
      ? ['batchGovernedOperation', 'uniqueBatchOwnerVerified', 'batchLifecycleReady', 'portalDisabledVerified', 'liveDirectoryDisabledVerified', 'protectedAccountPolicyPassed', 'immutableIdentityCaptured', 'irreversibleImpactAcknowledged']
    : ['governedOperation', 'uniqueRequestOwnerVerified', 'requestLifecycleReady', 'portalDisabledVerified', 'liveDirectoryDisabledVerified', 'protectedAccountPolicyPassed', 'immutableIdentityCaptured', 'irreversibleImpactAcknowledged'];
  const expectedConfirmation = `DELETE ${action.targetUsername}`;
  if (
    evidence.destructiveAction !== 'delete_ad'
    || evidence[DIRECTORY_DELETE_METHOD_EVIDENCE_KEY] !== DIRECTORY_DELETE_METHOD
    || (bulkPlan
      ? evidence.bulkPlanId !== action.batchId
        || typeof evidence.selectionDigest !== 'string'
        || typeof evidence.targetCount !== 'number'
        || typeof evidence.recordCount !== 'number'
        || evidence.typedAcknowledgement !== `DELETE ${evidence.targetCount} ${evidence.targetCount === 1 ? 'ACCOUNT' : 'ACCOUNTS'} / ${evidence.recordCount} ${evidence.recordCount === 1 ? 'RECORD' : 'RECORDS'}`
        || safetyChecks.reviewedPlan !== true
      : evidence.typedAcknowledgement !== expectedConfirmation || safetyChecks.singleAccountOnly !== true)
    || evidence.irreversibleImpactAcknowledged !== true
    || evidence.actor !== action.requestedBy
    || typeof evidence.ticketReference !== 'string'
    || evidence.ticketReference !== action.relatedTicketId
    || requiredChecks.some((check) => safetyChecks[check] !== true)
  ) {
    throw new Error('Permanent directory deletion was reviewed using an earlier deletion method. Refresh the account state and create a new deletion confirmation.');
  }
  return evidence as DeletionAuthorizationEvidence;
}

function assertReviewedDeletionPlanUsesCurrentDirectoryMethod(action: LifecycleAction): void {
  const plan = action.batch;
  const evidence = plan?.authorizationEvidence;
  const plannedAction = evidence && typeof evidence === 'object' && !Array.isArray(evidence)
    ? evidence.action
    : null;
  if (
    plan?.policyVersion === REVIEWED_DELETION_PLAN_POLICY_VERSION
    && planContainsDirectoryDeletion(plannedAction)
    && !hasCurrentDirectoryDeleteMethod(evidence)
  ) {
    throw new Error('This reviewed deletion plan uses an earlier AD deletion method. Refresh the account state and create a new deletion plan before any child action can run.');
  }
}

async function assertBatchDirectoryBinding(
  action: LifecycleAction,
  db: Prisma.TransactionClient | typeof prisma = prisma
): Promise<{ owner: BatchAccountItem; evidence: GovernedDirectoryEvidence }> {
  if (!action.relatedBatchAccountItemId || action.relatedRequestId) {
    throw new Error('Batch-governed lifecycle action is missing its batch-item owner');
  }
  const expectedPolicyVersion = action.actionType === 'delete_ad'
    ? BATCH_GOVERNED_DIRECTORY_DELETE_POLICY_VERSION
    : BATCH_GOVERNED_DIRECTORY_IDENTITY_POLICY_VERSION;
  if (action.policyVersion !== expectedPolicyVersion || !action.targetDirectoryDn || !action.targetDirectoryObjectGuid) {
    throw new Error('Batch-governed lifecycle action is missing immutable identity evidence');
  }
  const owner = await db.batchAccountItem.findUnique({ where: { id: action.relatedBatchAccountItemId } });
  if (
    !owner
    || owner.lifecycleOwnerKind !== 'batch_item'
    || owner.accessRequestId
    || owner.status !== 'completed'
    || !['AD', 'BOTH'].includes(owner.accountType)
    || owner.ldapUsername.trim().toLowerCase() !== action.targetUsername.trim().toLowerCase()
    || owner.targetDirectoryDn?.toLowerCase() !== action.targetDirectoryDn.toLowerCase()
    || owner.targetDirectoryObjectGuid !== action.targetDirectoryObjectGuid
  ) throw new Error('Batch account ownership or immutable directory identity changed after confirmation');
  const preflight = action.preflightSnapshot;
  if (!preflight || typeof preflight !== 'object' || Array.isArray(preflight)
    || preflight.relatedBatchAccountItemId !== owner.id
    || preflight.sourceBatchId !== owner.batchId
    || preflight.batchItemVersion !== owner.version) {
    throw new Error('Batch account lifecycle state changed after confirmation');
  }
  const [requestOwners, batchOwners] = await Promise.all([
    db.accessRequest.findMany({
      where: { status: { not: 'rejected' }, OR: [
        { ldapUsername: { equals: action.targetUsername, mode: 'insensitive' } },
        { linkedAdUsername: { equals: action.targetUsername, mode: 'insensitive' } },
      ] }, select: { id: true }, take: 2,
    }),
    db.batchAccountItem.findMany({
      where: {
        lifecycleOwnerKind: 'batch_item', accessRequestId: null,
        accountType: { in: ['AD', 'BOTH'] }, status: { in: ['processing', 'completed', 'reconciliation_required'] },
        ldapUsername: { equals: action.targetUsername, mode: 'insensitive' },
        OR: [{ adAccountStatus: null }, { adAccountStatus: { not: 'deleted' } }],
      }, select: { id: true }, take: 2,
    }),
  ]);
  if (requestOwners.length > 0 || batchOwners.length !== 1 || batchOwners[0].id !== owner.id) {
    throw new Error(`AD username ${action.targetUsername} no longer has one unambiguous batch owner`);
  }
  const directoryUser = await searchLDAPUser(action.targetUsername);
  if (!directoryUser) {
    if (action.actionType === 'delete_ad') throw new LifecycleReconciliationRequiredError(`AD account ${action.targetUsername} was absent before permanent deletion; reconcile the captured object GUID`);
    throw new Error(`AD account ${action.targetUsername} was not found`);
  }
  await assertLifecycleAccountNotProtected(directoryUser);
  const current = directorySnapshot(directoryUser, action.targetUsername);
  const expectedEnabled = preflight.enabled;
  if (
    current.dn.toLowerCase() !== action.targetDirectoryDn.toLowerCase()
    || current.objectGuid !== action.targetDirectoryObjectGuid
    || current.username?.toLowerCase() !== action.targetUsername.toLowerCase()
    || current.enabled !== expectedEnabled
  ) throw new Error('Batch owner or directory identity changed after confirmation');
  return { owner, evidence: { directoryDn: action.targetDirectoryDn, objectGuid: action.targetDirectoryObjectGuid } };
}

async function assertDirectoryRequestBinding(
  action: LifecycleAction,
  accessRequest: AccessRequest,
  allowedStatuses: string[],
  db: Prisma.TransactionClient | typeof prisma = prisma
): Promise<GovernedDirectoryEvidence> {
  if (!isAccessRequestDirectoryIdentityConsistent(accessRequest)) {
    throw new Error(`Access request ${accessRequest.id} contains conflicting AD identity aliases`);
  }
  if (!allowedStatuses.includes(accessRequest.status)) {
    throw new Error(`Access request ${accessRequest.id} is not in a lifecycle-eligible state`);
  }
  if (!isLifecycleProvisioningReady(accessRequest.provisioningState)) {
    throw new Error(`Access request ${accessRequest.id} has not completed governed provisioning or reconciliation`);
  }
  const expectedPolicyVersion = action.actionType === 'delete_ad'
    ? GOVERNED_DIRECTORY_DELETE_POLICY_VERSION
    : 'governed-directory-identity-v1';
  if (
    action.policyVersion !== expectedPolicyVersion
    || !action.targetDirectoryDn
    || !action.targetDirectoryObjectGuid
  ) {
    throw new Error(`Directory identity evidence is missing for access request ${accessRequest.id}`);
  }

  const requestUsernames = [accessRequest.ldapUsername, accessRequest.linkedAdUsername]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.trim().toLowerCase());
  if (!requestUsernames.includes(action.targetUsername.trim().toLowerCase())) {
    throw new Error(`Access request ${accessRequest.id} no longer claims AD username ${action.targetUsername}`);
  }

  const ownershipWhere = { OR: [
    { ldapUsername: { equals: action.targetUsername, mode: 'insensitive' as const } },
    { linkedAdUsername: { equals: action.targetUsername, mode: 'insensitive' as const } },
  ] };
  let ownershipMatches = await db.accessRequest.findMany({
    where: { ...ownershipWhere, status: { notIn: ['rejected', 'offboarded'] } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 2,
  });
  if (ownershipMatches.length === 0 && allowedStatuses.includes('offboarded')) {
    ownershipMatches = await db.accessRequest.findMany({
      where: { ...ownershipWhere, status: 'offboarded' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 2,
    });
  }
  if (ownershipMatches.length !== 1 || ownershipMatches[0].id !== accessRequest.id) {
    throw new Error(`AD username ${action.targetUsername} no longer has one unambiguous lifecycle request`);
  }

  const directoryUser = await searchLDAPUser(action.targetUsername);
  if (!directoryUser) {
    if (action.actionType === 'delete_ad') {
      throw new LifecycleReconciliationRequiredError(
        `AD account ${action.targetUsername} was absent before permanent deletion; reconcile the captured object GUID`
      );
    }
    throw new Error(`AD account ${action.targetUsername} was not found`);
  }
  await assertLifecycleAccountNotProtected(directoryUser);
  const current = directorySnapshot(directoryUser, action.targetUsername);
  const preflight = action.preflightSnapshot;
  const expectedRequestId = preflight && typeof preflight === 'object' && !Array.isArray(preflight)
    ? preflight.relatedRequestId
    : undefined;
  const expectedEnabled = preflight && typeof preflight === 'object' && !Array.isArray(preflight)
    ? preflight.enabled
    : undefined;
  const expectedRequestVersion = preflight && typeof preflight === 'object' && !Array.isArray(preflight)
    ? preflight.requestVersion
    : undefined;
  if (
    expectedRequestId !== accessRequest.id
    || ((action.actionType === 'delete_ad' || action.offboardCampaign?.workflowMode === 'direct')
      && expectedRequestVersion !== accessRequest.version)
    || current.dn.toLowerCase() !== action.targetDirectoryDn.toLowerCase()
    || current.objectGuid !== action.targetDirectoryObjectGuid
    || current.username?.toLowerCase() !== action.targetUsername.toLowerCase()
    || current.enabled !== expectedEnabled
  ) {
    throw new Error('Portal request ownership or directory identity changed after confirmation');
  }

  return {
    directoryDn: action.targetDirectoryDn,
    objectGuid: action.targetDirectoryObjectGuid,
  };
}

async function assertDeletionSessionsRevoked(
  action: LifecycleAction,
  tx: Prisma.TransactionClient
): Promise<void> {
  const [liveSessions, providerTasks] = await Promise.all([
    tx.session.count({ where: { username: { equals: action.targetUsername, mode: 'insensitive' } } }),
    tx.providerLogoutTask.findMany({
      where: { username: { equals: action.targetUsername, mode: 'insensitive' } },
      select: { status: true },
    }),
  ]);
  if (liveSessions > 0 || providerTasks.some((task) => task.status !== 'completed')) {
    throw new Error('Permanent deletion requires all portal sessions and provider logout tasks to be completed first');
  }
}

async function deleteUnmanagedADAccount(
  action: LifecycleAction,
  onExternalMutationStart: () => void,
  tx: Prisma.TransactionClient,
  onStageEvidence: (snapshot: Prisma.InputJsonObject) => Promise<void>
): Promise<Prisma.InputJsonObject> {
  if (action.policyVersion !== UNMANAGED_DIRECTORY_DELETE_POLICY_VERSION || action.relatedRequestId || action.relatedBatchAccountItemId) {
    throw new Error('Unmanaged directory deletion is missing its supported no-owner policy evidence');
  }
  if (action.canRestore || !action.targetDirectoryDn || !action.targetDirectoryObjectGuid) {
    throw new Error('Unmanaged directory deletion is missing irreversible identity evidence');
  }
  const authorizationEvidence = assertDeletionAuthorizationEvidence(action);
  const [owners, batchOwners] = await Promise.all([
    tx.accessRequest.findMany({
      where: {
        status: { not: 'rejected' },
        OR: [
          { ldapUsername: { equals: action.targetUsername, mode: 'insensitive' } },
          { linkedAdUsername: { equals: action.targetUsername, mode: 'insensitive' } },
        ],
      },
      select: { id: true },
      take: 2,
    }),
    tx.batchAccountItem.findMany({
      where: {
        lifecycleOwnerKind: 'batch_item',
        accessRequestId: null,
        accountType: { in: ['AD', 'BOTH'] },
        status: { in: ['processing', 'completed', 'reconciliation_required'] },
        ldapUsername: { equals: action.targetUsername, mode: 'insensitive' },
        OR: [{ adAccountStatus: null }, { adAccountStatus: { not: 'deleted' } }],
      },
      select: { id: true },
      take: 2,
    }),
  ]);
  if (owners.length > 0 || batchOwners.length > 0) {
    throw new Error('A portal request or batch item now owns this directory username; unmanaged deletion is blocked');
  }
  const competingDelete = await tx.accountLifecycleAction.findFirst({
    where: {
      id: { not: action.id },
      actionType: 'delete_ad',
      targetDirectoryObjectGuid: action.targetDirectoryObjectGuid,
      status: { in: ['queued', 'processing', 'reconciliation_required'] },
    },
    select: { id: true, status: true },
  });
  if (competingDelete) throw new Error(`Permanent deletion is blocked by lifecycle action ${competingDelete.id} in ${competingDelete.status}`);

  const beforeUser = await searchLDAPUser(action.targetUsername);
  if (!beforeUser) {
    throw new LifecycleReconciliationRequiredError(
      `AD account ${action.targetUsername} was absent before permanent deletion; reconcile the captured object GUID`
    );
  }
  await assertLifecycleAccountNotProtected(beforeUser);
  const before = directorySnapshot(beforeUser, action.targetUsername);
  if (before.enabled) throw new Error('AD account became enabled after deletion confirmation');
  if (
    before.dn.toLowerCase() !== action.targetDirectoryDn.toLowerCase()
    || before.objectGuid !== action.targetDirectoryObjectGuid
  ) {
    throw new Error('Directory object identity changed before permanent deletion');
  }
  await assertDeletionSessionsRevoked(action, tx);
  const portalPreflightSafetyChecks: Prisma.InputJsonObject = {
    confirmationEvidenceValidated: true,
    noPortalOwnerRevalidated: true,
    noCompetingDelete: true,
    directoryIdentityRevalidated: true,
    directoryDisabledRevalidated: true,
    protectedAccountPolicyRevalidated: true,
    sessionsAndProviderLogoutsSettled: true,
  };
  await onStageEvidence({ stage: 'unmanaged_portal_preflight_passed', observedAt: new Date().toISOString(), safetyChecks: portalPreflightSafetyChecks });
  assertExternalSideEffectAllowed('ldap-write');
  let deletedIdentity;
  try {
    deletedIdentity = await deleteConfirmedDisabledLDAPUser(
      action.targetUsername,
      { dn: action.targetDirectoryDn, objectGuid: action.targetDirectoryObjectGuid },
      async () => {
        await onStageEvidence({
          stage: 'ldap_delete_boundary_entered_outcome_unknown',
          boundaryEnteredAt: new Date().toISOString(),
          safetyChecks: { ...portalPreflightSafetyChecks, boundDirectoryPreDeleteChecksPassed: true, finalDirectoryPreflightPassed: true, immutableGuidDeleteTargetPrepared: true, externalDirectoryWriterRaceAccepted: true },
        });
        onExternalMutationStart();
      },
      assertLifecycleAccountNotProtected
    );
  } catch (error) {
    if ((error as LdapErrorLike).code === 'LDAP_DELETE_TARGET_ABSENT') {
      throw new LifecycleReconciliationRequiredError(
        `AD account ${action.targetUsername} disappeared before the portal delete call; reconcile the captured object GUID`
      );
    }
    throw error;
  }
  return {
    stage: 'unmanaged_delete_confirmed',
    before,
    after: { exists: false, deletedAt: new Date().toISOString(), objectGuid: deletedIdentity.objectGuid },
    authorizationConfirmedAt: authorizationEvidence.confirmedAt ?? null,
    safetyChecks: {
      ...portalPreflightSafetyChecks,
      boundDirectoryPreDeleteChecksPassed: true,
      finalDirectoryPreflightPassed: true,
      immutableGuidDeleteTargetApplied: true,
      externalDirectoryWriterRaceAccepted: true,
      capturedGuidAbsentAfterDelete: true,
    },
  };
}

async function deleteBatchGovernedADAccount(
  action: LifecycleAction,
  onExternalMutationStart: () => void,
  tx: Prisma.TransactionClient,
  onStageEvidence: (snapshot: Prisma.InputJsonObject) => Promise<void>
): Promise<Prisma.InputJsonObject> {
  if (action.canRestore) throw new Error('Permanent directory deletion is missing irreversible-action confirmation evidence');
  const authorizationEvidence = assertDeletionAuthorizationEvidence(action);
  if (!action.relatedBatchAccountItemId) throw new Error('Permanent batch-account deletion is missing its batch-item owner');
  await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"::text AS id FROM "BatchAccountItem"
    WHERE "id" = ${action.relatedBatchAccountItemId} FOR UPDATE
  `;
  const { owner, evidence } = await assertBatchDirectoryBinding(action, tx);
  if (owner.adAccountStatus !== 'disabled') throw new Error('Batch account record no longer confirms the AD account is disabled');
  const competingDelete = await tx.accountLifecycleAction.findFirst({
    where: { id: { not: action.id }, actionType: 'delete_ad', targetDirectoryObjectGuid: action.targetDirectoryObjectGuid, status: { in: ['queued', 'processing', 'reconciliation_required'] } },
    select: { id: true, status: true },
  });
  if (competingDelete) throw new Error(`Permanent deletion is blocked by lifecycle action ${competingDelete.id} in ${competingDelete.status}`);
  const beforeUser = await searchLDAPUser(action.targetUsername);
  if (!beforeUser) throw new LifecycleReconciliationRequiredError(`AD account ${action.targetUsername} was absent before permanent deletion; reconcile the captured object GUID`);
  await assertLifecycleAccountNotProtected(beforeUser);
  const before = directorySnapshot(beforeUser, action.targetUsername);
  if (before.enabled) throw new Error('AD account became enabled after deletion confirmation');
  if (before.dn.toLowerCase() !== evidence.directoryDn.toLowerCase() || before.objectGuid !== evidence.objectGuid) {
    throw new Error('Directory object identity changed before permanent deletion');
  }
  await assertDeletionSessionsRevoked(action, tx);
  assertExternalSideEffectAllowed('ldap-write');
  const safetyChecks: Prisma.InputJsonObject = {
    confirmationEvidenceValidated: true, batchOwnerRowLocked: true, batchOwnerRevalidated: true,
    batchItemVersionRevalidated: true, noCompetingDelete: true, portalDisabledRevalidated: true,
    directoryIdentityRevalidated: true, directoryDisabledRevalidated: true,
    protectedAccountPolicyRevalidated: true, sessionsAndProviderLogoutsSettled: true,
  };
  await onStageEvidence({ stage: 'batch_portal_preflight_passed', observedAt: new Date().toISOString(), safetyChecks });
  let deletedIdentity;
  try {
    deletedIdentity = await deleteConfirmedDisabledLDAPUser(
      action.targetUsername,
      { dn: evidence.directoryDn, objectGuid: evidence.objectGuid },
      async () => {
        await onStageEvidence({
          stage: 'ldap_delete_boundary_entered_outcome_unknown', boundaryEnteredAt: new Date().toISOString(),
          safetyChecks: { ...safetyChecks, boundDirectoryPreDeleteChecksPassed: true, finalDirectoryPreflightPassed: true, immutableGuidDeleteTargetPrepared: true, externalDirectoryWriterRaceAccepted: true },
        });
        onExternalMutationStart();
      },
      assertLifecycleAccountNotProtected
    );
  } catch (error) {
    if ((error as LdapErrorLike).code === 'LDAP_DELETE_TARGET_ABSENT') {
      throw new LifecycleReconciliationRequiredError(`AD account ${action.targetUsername} disappeared before the portal delete call; reconcile the captured object GUID`);
    }
    throw error;
  }
  const deletedAt = new Date();
  const projected = await tx.batchAccountItem.updateMany({
    where: { id: owner.id, version: owner.version, adAccountStatus: 'disabled' },
    data: { adAccountStatus: 'deleted', version: { increment: 1 } },
  });
  if (projected.count !== 1) throw new Error('Batch account state changed while directory deletion was being finalized');
  await tx.aDAccountActivityLog.create({
    data: {
      accountId: owner.id, accountUsername: action.targetUsername, accountName: owner.name,
      accountEmail: owner.email, actionType: 'deleted', performedBy: action.requestedBy,
      reason: action.reason, lifecycleActionId: action.id, notes: action.notes, ldapSuccess: true,
    },
  });
  await tx.batchAuditLog.create({
    data: {
      batchId: owner.batchId, action: 'ad_account_deleted',
      details: `AD account "${action.targetUsername}" permanently deleted through lifecycle action ${action.id}; reference ${action.relatedTicketId}.`,
      performedBy: action.requestedBy, accountName: action.targetUsername, success: true,
    },
  });
  return {
    stage: 'batch_delete_confirmed', before,
    after: { exists: false, deletedAt: deletedAt.toISOString(), objectGuid: deletedIdentity.objectGuid },
    authorizationConfirmedAt: authorizationEvidence.confirmedAt ?? null,
    safetyChecks: { ...safetyChecks, boundDirectoryPreDeleteChecksPassed: true, finalDirectoryPreflightPassed: true, immutableGuidDeleteTargetApplied: true, externalDirectoryWriterRaceAccepted: true, capturedGuidAbsentAfterDelete: true },
  };
}

async function deleteADAccount(
  action: LifecycleAction,
  onExternalMutationStart: () => void,
  tx: Prisma.TransactionClient,
  onStageEvidence: (snapshot: Prisma.InputJsonObject) => Promise<void>
): Promise<Prisma.InputJsonObject> {
  if (
    action.policyVersion !== expectedDirectoryDeletePolicyVersion(action.operationMode)
    || !hasCurrentDirectoryDeleteMethod(action.authorizationEvidence)
  ) {
    throw new Error('Permanent directory deletion was reviewed using an earlier deletion method. Refresh the account state and create a new deletion confirmation.');
  }
  if (action.operationMode === 'directory_override') {
    return deleteUnmanagedADAccount(action, onExternalMutationStart, tx, onStageEvidence);
  }
  if (action.operationMode === 'batch_governed') {
    return deleteBatchGovernedADAccount(action, onExternalMutationStart, tx, onStageEvidence);
  }
  if (action.operationMode !== 'governed') {
    throw new Error('Permanent directory deletion has an unsupported operation mode');
  }
  if (action.canRestore) {
    throw new Error('Permanent directory deletion is missing irreversible-action confirmation evidence');
  }
  const authorizationEvidence = assertDeletionAuthorizationEvidence(action);

  if (!action.relatedRequestId) {
    throw new Error('Permanent directory deletion is missing its governing access request');
  }
  const canonicalUsername = action.targetUsername.trim().toLowerCase();
  const lockedRequests = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"::text AS id
    FROM "AccessRequest"
    WHERE "id" = ${action.relatedRequestId}
       OR LOWER("ldapUsername") = ${canonicalUsername}
       OR LOWER("linkedAdUsername") = ${canonicalUsername}
    ORDER BY "id"
    FOR UPDATE
  `;
  if (!lockedRequests.some((request) => request.id === action.relatedRequestId)) {
    throw new Error('The governing access request disappeared before permanent deletion');
  }
  const accessRequest = await tx.accessRequest.findUnique({ where: { id: action.relatedRequestId } });
  if (!accessRequest) {
    throw new Error(`No AccessRequest found for AD username: ${action.targetUsername}`);
  }
  if (accessRequest.adAccountStatus !== 'disabled') {
    throw new Error('Portal account record no longer confirms the AD account is disabled');
  }

  const directoryEvidence = await assertDirectoryRequestBinding(
    action,
    accessRequest,
    ['approved', 'offboarded'],
    tx
  );
  const competingDelete = await tx.accountLifecycleAction.findFirst({
    where: {
      id: { not: action.id },
      actionType: 'delete_ad',
      targetDirectoryObjectGuid: action.targetDirectoryObjectGuid,
      status: { in: ['queued', 'processing', 'reconciliation_required'] },
    },
    select: { id: true, status: true },
  });
  if (competingDelete) {
    throw new Error(`Permanent deletion is blocked by lifecycle action ${competingDelete.id} in ${competingDelete.status}`);
  }
  const beforeUser = await searchLDAPUser(action.targetUsername);
  if (!beforeUser) {
    throw new LifecycleReconciliationRequiredError(
      `AD account ${action.targetUsername} was absent before permanent deletion; reconcile the captured object GUID`
    );
  }
  await assertLifecycleAccountNotProtected(beforeUser);
  const before = directorySnapshot(beforeUser, action.targetUsername);
  if (before.enabled) {
    throw new Error('AD account became enabled after deletion confirmation');
  }
  if (
    before.dn.toLowerCase() !== directoryEvidence.directoryDn.toLowerCase()
    || before.objectGuid !== directoryEvidence.objectGuid
  ) {
    throw new Error('Directory object identity changed before permanent deletion');
  }
  await assertDeletionSessionsRevoked(action, tx);
  assertExternalSideEffectAllowed('ldap-write');

  const portalPreflightSafetyChecks: Prisma.InputJsonObject = {
    confirmationEvidenceValidated: true,
    governingRequestRowLocked: true,
    governedOwnerRevalidated: true,
    requestVersionRevalidated: true,
    noCompetingDelete: true,
    portalDisabledRevalidated: true,
    directoryIdentityRevalidated: true,
    directoryDisabledRevalidated: true,
    protectedAccountPolicyRevalidated: true,
    sessionsAndProviderLogoutsSettled: true,
  };
  await onStageEvidence({
    stage: 'portal_preflight_passed',
    observedAt: new Date().toISOString(),
    safetyChecks: portalPreflightSafetyChecks,
  });

  let deletedIdentity;
  try {
    deletedIdentity = await deleteConfirmedDisabledLDAPUser(
      action.targetUsername,
      { dn: directoryEvidence.directoryDn, objectGuid: directoryEvidence.objectGuid },
      async () => {
        await onStageEvidence({
          stage: 'ldap_delete_boundary_entered_outcome_unknown',
          boundaryEnteredAt: new Date().toISOString(),
          safetyChecks: {
            ...portalPreflightSafetyChecks,
            boundDirectoryPreDeleteChecksPassed: true,
            finalDirectoryPreflightPassed: true,
            immutableGuidDeleteTargetPrepared: true,
            externalDirectoryWriterRaceAccepted: true,
          },
        });
        onExternalMutationStart();
      },
      assertLifecycleAccountNotProtected
    );
  } catch (error) {
    if ((error as LdapErrorLike).code === 'LDAP_DELETE_TARGET_ABSENT') {
      throw new LifecycleReconciliationRequiredError(
        `AD account ${action.targetUsername} disappeared before the portal delete call; reconcile the captured object GUID`
      );
    }
    throw error;
  }
  const deletedAt = new Date();

  const projected = await tx.accessRequest.updateMany({
    where: {
      id: accessRequest.id,
      adAccountStatus: 'disabled',
      version: accessRequest.version,
    },
    data: {
      adAccountStatus: 'deleted',
      version: { increment: 1 },
    },
  });
  if (projected.count !== 1) {
    throw new Error('Portal account state changed while the directory deletion was being finalized');
  }
  await tx.aDAccountActivityLog.create({
    data: {
      accountId: accessRequest.id,
      accountUsername: action.targetUsername,
      accountName: accessRequest.name,
      accountEmail: accessRequest.email,
      actionType: 'deleted',
      performedBy: action.requestedBy,
      reason: action.reason,
      lifecycleActionId: action.id,
      notes: action.notes,
      ldapSuccess: true,
    },
  });
  await tx.requestComment.create({
    data: {
      requestId: accessRequest.id,
      author: action.requestedBy,
      type: 'ad_account_deleted',
      comment: `Active Directory account ${action.targetUsername} was permanently deleted through lifecycle action ${action.id}; reference ${action.relatedTicketId}.`,
    },
  });

  const executionSafetyChecks: Prisma.InputJsonObject = {
    ...portalPreflightSafetyChecks,
    boundDirectoryPreDeleteChecksPassed: true,
    finalDirectoryPreflightPassed: true,
    immutableGuidDeleteTargetApplied: true,
    externalDirectoryWriterRaceAccepted: true,
    capturedGuidAbsentAfterDelete: true,
  };
  return {
    stage: 'delete_confirmed',
    before,
    after: {
      exists: false,
      deletedAt: deletedAt.toISOString(),
      objectGuid: deletedIdentity.objectGuid,
    },
    authorizationConfirmedAt: authorizationEvidence.confirmedAt ?? null,
    safetyChecks: executionSafetyChecks,
  };
}

async function verifyGovernedDirectoryReadback(
  action: LifecycleAction,
  evidence: GovernedDirectoryEvidence,
  shouldBeEnabled: boolean
): Promise<void> {
  const directoryUser = await searchLDAPUser(action.targetUsername);
  if (!directoryUser) throw new Error('Directory account could not be read back after lifecycle action');
  const after = directorySnapshot(directoryUser, action.targetUsername);
  if (
    after.dn.toLowerCase() !== evidence.directoryDn.toLowerCase()
    || after.objectGuid !== evidence.objectGuid
    || after.enabled !== shouldBeEnabled
  ) {
    throw new Error('Directory readback did not confirm the governed action');
  }
}

async function cleanupManualDisabledAdSessions(action: LifecycleAction): Promise<Record<string, unknown> | null> {
  if (!isManualAction(action) || !['disable_ad', 'disable_both'].includes(action.actionType)) {
    return null;
  }

  try {
    // Full-logout parity (ADR-0014): route through the shared helper so the
    // IdP sessions die with the portal rows - a plain deleteMany would leave
    // disabled users silently SSO-ing back in.
    const result = await revokeUserSessionsEverywhere(action.targetUsername, {
      actor: 'system:lifecycle',
      actorType: 'system',
      reason: 'lifecycle_disable',
    });
    if (result.providerLogoutsReconciliationRequired > 0) {
      throw new Error(`${result.providerLogoutsReconciliationRequired} provider logout(s) require reconciliation`);
    }
    return {
      deletedSessions: result.portalSessionsRevoked,
      providerLogoutsAttempted: result.providerLogoutsAttempted,
      providerSessionsDestroyed: result.providerSessionsDestroyed,
      providerLogoutsReconciliationRequired: result.providerLogoutsReconciliationRequired,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown session cleanup failure';
    appLogger.error('Manual lifecycle session cleanup requires reconciliation', error instanceof Error ? error : undefined, {
      actionId: action.id,
      username: action.targetUsername,
      error: message,
    });
    throw new Error(`Session revocation failed after account disable: ${message}`);
  }
}

async function markManualAccessRequestOffboarded(action: LifecycleAction, accessRequest: AccessRequest | null): Promise<Record<string, unknown> | null> {
  if (!isManualAction(action) || action.actionType !== 'disable_both') {
    return null;
  }

  if (!accessRequest?.id) {
    return { requestMarkedOffboarded: false, skippedReason: 'no_access_request' };
  }

  const offboardedAt = new Date();
  const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const update = await tx.accessRequest.updateMany({
      where: {
        id: accessRequest.id,
        status: 'approved',
      },
      data: {
        status: 'offboarded',
        accountExpiresAt: offboardedAt,
        version: { increment: 1 },
      },
    });

    if (update.count !== 1) {
      return false;
    }

    await tx.requestComment.create({
      data: {
        requestId: accessRequest.id,
        author: action.requestedBy,
        type: 'manual_offboard',
        comment: `Manual account lifecycle offboard completed for ${action.targetUsername}. Access was disabled/revoked, but this does not block future re-enrollment unless the email is on the block list.`,
      },
    });

    return true;
  });

  return {
    requestMarkedOffboarded: result,
    accessRequestId: accessRequest.id,
    skippedReason: result ? undefined : `request_status_${accessRequest.status || 'unknown'}`,
  };
}

async function disableADAccount(action: LifecycleAction, onExternalMutationStart: () => void): Promise<AccessRequest> {
  const username = action.targetUsername;
  
  const accessRequest = await findAccessRequestForADAction(action);

  if (!accessRequest) {
    throw new Error(`No AccessRequest found for AD username: ${username}`);
  }

  const directoryEvidence = await assertDirectoryRequestBinding(action, accessRequest, ['approved']);

  let ldapSuccess = false;
  let ldapErrorMsg: string | undefined;

  try {
    assertExternalSideEffectAllowed('ldap-write');
    onExternalMutationStart();
    await disableConfirmedLDAPUser(username, {
      dn: directoryEvidence.directoryDn,
      objectGuid: directoryEvidence.objectGuid,
    });
    
    const noteDetails = [];
    if (action.relatedTicketId) {
      noteDetails.push(`Ticket #${action.relatedTicketId}`);
    }
    if (action.relatedRequestId) {
      noteDetails.push(`Request ${action.relatedRequestId}`);
    }
    const ticketInfo = noteDetails.length > 0 ? ` - ${noteDetails.join(', ')}` : '';
    await appendADDescription(username, `Disabled by UAR${ticketInfo}`);
    await verifyGovernedDirectoryReadback(action, directoryEvidence, false);
    
    ldapSuccess = true;
    appLogger.info('Successfully disabled AD account in LDAP', { username });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const ldapError = error as LdapErrorLike;
    const isNotFoundError = 
      errorMessage.includes('not found in directory') ||
      errorMessage.includes('NO_OBJECT') ||
      errorMessage.includes('problem 2001') ||
      ldapError?.code === 32 ||
      ldapError?.code === '32';
    
    if (isNotFoundError && !directoryEvidence) {
      appLogger.warn('AD account not found in LDAP, updating database status only', { 
        username, 
        error: errorMessage 
      });
      ldapErrorMsg = errorMessage;
    } else {
      throw error;
    }
  }

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.accessRequest.update({
      where: { id: accessRequest.id },
      data: {
        adAccountStatus: 'disabled',
        adDisabledAt: new Date(),
        adDisabledBy: action.requestedBy,
        adDisabledReason: action.reason,
      },
    });

    await tx.aDAccountActivityLog.create({
      data: {
        accountId: accessRequest.id,
        accountUsername: username,
        accountName: accessRequest.name,
        accountEmail: accessRequest.email,
        actionType: 'disabled',
        performedBy: action.requestedBy,
        reason: action.reason,
        lifecycleActionId: action.id,
        notes: action.notes,
        ldapSuccess,
        ldapError: ldapErrorMsg,
      },
    });
  });

  appLogger.info('AD account disabled', { username, reason: action.reason });
  return accessRequest;
}

async function disableBatchADAccount(
  action: LifecycleAction,
  onExternalMutationStart: () => void
): Promise<Prisma.InputJsonObject> {
  const { owner, evidence } = await assertBatchDirectoryBinding(action);
  if (owner.adAccountStatus !== 'active') {
    throw new Error('Batch account record no longer confirms the AD account is active');
  }

  assertExternalSideEffectAllowed('ldap-write');
  onExternalMutationStart();
  await disableConfirmedLDAPUser(action.targetUsername, {
    dn: evidence.directoryDn,
    objectGuid: evidence.objectGuid,
  });
  await appendADDescription(
    action.targetUsername,
    `Disabled by UAR - Batch ${owner.batchId} - Lifecycle action ${action.id}`
  );
  await verifyGovernedDirectoryReadback(action, evidence, false);

  const disabledAt = new Date();
  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const projected = await tx.batchAccountItem.updateMany({
      where: { id: owner.id, version: owner.version, adAccountStatus: 'active' },
      data: {
        adAccountStatus: 'disabled',
        adDisabledAt: disabledAt,
        adDisabledBy: action.requestedBy,
        adDisabledReason: action.reason,
        version: { increment: 1 },
      },
    });
    if (projected.count !== 1) {
      throw new LifecycleReconciliationRequiredError(
        'The batch account changed while its directory disablement was being finalized'
      );
    }
    await tx.aDAccountActivityLog.create({
      data: {
        accountId: owner.id,
        accountUsername: action.targetUsername,
        accountName: owner.name,
        accountEmail: owner.email,
        actionType: 'disabled',
        performedBy: action.requestedBy,
        reason: action.reason,
        lifecycleActionId: action.id,
        notes: action.notes,
        ldapSuccess: true,
      },
    });
    await tx.batchAuditLog.create({
      data: {
        batchId: owner.batchId,
        action: 'ad_account_disabled',
        details: `AD account "${action.targetUsername}" disabled through lifecycle action ${action.id}.`,
        performedBy: action.requestedBy,
        accountName: action.targetUsername,
        success: true,
      },
    });
  });

  return {
    stage: 'batch_disable_confirmed',
    batchAccountItemId: owner.id,
    batchId: owner.batchId,
    directoryDn: evidence.directoryDn,
    objectGuid: evidence.objectGuid,
    enabled: false,
    disabledAt: disabledAt.toISOString(),
  };
}

async function enableADAccount(action: LifecycleAction, onExternalMutationStart: () => void): Promise<AccessRequest> {
  const username = action.targetUsername;
  
  const accessRequest = await findAccessRequestForADAction(action, true);

  if (!accessRequest) {
    throw new Error(`No AccessRequest found for AD username: ${username}`);
  }

  const directoryEvidence = await assertDirectoryRequestBinding(action, accessRequest, ['approved', 'offboarded']);

  if (accessRequest.adAccountStatus !== 'disabled') {
    // Keep going so a stale DB flag does not block recovery of the live directory account.
    appLogger.warn('Account not in disabled state in database, attempting enable anyway', { 
      username, 
      currentStatus: accessRequest.adAccountStatus 
    });
  }

  let ldapSuccess = false;
  let ldapErrorMsg: string | undefined;

  try {
    assertExternalSideEffectAllowed('ldap-write');
    onExternalMutationStart();
    await enableConfirmedLDAPUser(username, {
      dn: directoryEvidence.directoryDn,
      objectGuid: directoryEvidence.objectGuid,
    });
    
    const noteDetails = [];
    if (action.relatedTicketId) {
      noteDetails.push(`Ticket #${action.relatedTicketId}`);
    }
    if (action.relatedRequestId) {
      noteDetails.push(`Request ${action.relatedRequestId}`);
    }
    const ticketInfo = noteDetails.length > 0 ? ` - ${noteDetails.join(', ')}` : '';
    await appendADDescription(username, `Enabled by UAR${ticketInfo}`);
    await verifyGovernedDirectoryReadback(action, directoryEvidence, true);
    
    ldapSuccess = true;
    appLogger.info('Successfully enabled AD account in LDAP', { username });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const ldapError = error as LdapErrorLike;
    const isNotFoundError = 
      errorMessage.includes('not found in directory') ||
      errorMessage.includes('NO_OBJECT') ||
      errorMessage.includes('problem 2001') ||
      ldapError?.code === 32 ||
      ldapError?.code === '32';
    
    if (isNotFoundError) {
      ldapErrorMsg = `Cannot enable account - AD user '${username}' does not exist in LDAP directory (NO_OBJECT error)`;
      throw new Error(ldapErrorMsg);
    }
    throw error;
  }

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.accessRequest.update({
      where: { id: accessRequest.id },
      data: {
        adAccountStatus: 'active',
        adEnabledAt: new Date(),
        adEnabledBy: action.requestedBy,
      },
    });

    await tx.aDAccountActivityLog.create({
      data: {
        accountId: accessRequest.id,
        accountUsername: username,
        accountName: accessRequest.name,
        accountEmail: accessRequest.email,
        actionType: 'enabled',
        performedBy: action.requestedBy,
        reason: action.reason,
        lifecycleActionId: action.id,
        notes: action.notes,
        ldapSuccess,
        ldapError: ldapErrorMsg,
      },
    });
  });

  appLogger.info('AD account enabled', { username });
  return accessRequest;
}

async function enableBatchADAccount(
  action: LifecycleAction,
  onExternalMutationStart: () => void
): Promise<Prisma.InputJsonObject> {
  const { owner, evidence } = await assertBatchDirectoryBinding(action);
  if (owner.adAccountStatus !== 'disabled') {
    throw new Error('Batch account record no longer confirms the AD account is disabled');
  }

  assertExternalSideEffectAllowed('ldap-write');
  onExternalMutationStart();
  await enableConfirmedLDAPUser(action.targetUsername, {
    dn: evidence.directoryDn,
    objectGuid: evidence.objectGuid,
  });
  await appendADDescription(
    action.targetUsername,
    `Enabled by UAR - Batch ${owner.batchId} - Lifecycle action ${action.id}`
  );
  await verifyGovernedDirectoryReadback(action, evidence, true);

  const enabledAt = new Date();
  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const projected = await tx.batchAccountItem.updateMany({
      where: { id: owner.id, version: owner.version, adAccountStatus: 'disabled' },
      data: {
        adAccountStatus: 'active',
        adEnabledAt: enabledAt,
        adEnabledBy: action.requestedBy,
        version: { increment: 1 },
      },
    });
    if (projected.count !== 1) {
      throw new LifecycleReconciliationRequiredError(
        'The batch account changed while its directory enablement was being finalized'
      );
    }
    await tx.aDAccountActivityLog.create({
      data: {
        accountId: owner.id,
        accountUsername: action.targetUsername,
        accountName: owner.name,
        accountEmail: owner.email,
        actionType: 'enabled',
        performedBy: action.requestedBy,
        reason: action.reason,
        lifecycleActionId: action.id,
        notes: action.notes,
        ldapSuccess: true,
      },
    });
    await tx.batchAuditLog.create({
      data: {
        batchId: owner.batchId,
        action: 'ad_account_enabled',
        details: `AD account "${action.targetUsername}" enabled through lifecycle action ${action.id}.`,
        performedBy: action.requestedBy,
        accountName: action.targetUsername,
        success: true,
      },
    });
  });

  return {
    stage: 'batch_enable_confirmed',
    batchAccountItemId: owner.id,
    batchId: owner.batchId,
    directoryDn: evidence.directoryDn,
    objectGuid: evidence.objectGuid,
    enabled: true,
    enabledAt: enabledAt.toISOString(),
  };
}

async function deleteVPNRecord(
  action: LifecycleAction,
  tx: Prisma.TransactionClient
): Promise<Prisma.InputJsonObject> {
  if (!action.targetUserId) {
    throw new Error('Permanent VPN record deletion requires an immutable target ID');
  }
  if (action.policyVersion !== 'vpn-record-delete-v1') {
    throw new Error('Permanent VPN record deletion is missing the supported policy contract');
  }
  if (!action.relatedTicketId?.trim() || !action.authorizationEvidence) {
    throw new Error('Permanent VPN record deletion is missing confirmation evidence');
  }
  const confirmed = action.preflightSnapshot;
  if (!confirmed || typeof confirmed !== 'object' || Array.isArray(confirmed)) {
    throw new Error('Permanent VPN record deletion is missing its confirmation snapshot');
  }

  const vpnAccount = await tx.vPNAccount.findUnique({ where: { id: action.targetUserId } });
  if (!vpnAccount) {
    throw new Error(`VPN account ${action.targetUsername} no longer exists for target ID ${action.targetUserId}`);
  }
  if (vpnAccount.username.trim().toLowerCase() !== action.targetUsername.trim().toLowerCase()) {
    throw new Error('VPN account username no longer matches the confirmed deletion target');
  }
  if (
    vpnAccount.status !== 'revoked'
    || !vpnAccount.revokedAt
    || !vpnAccount.revokedBy?.trim()
    || !vpnAccount.revokedReason?.trim()
  ) {
    throw new Error('VPN account is not in a completely evidenced revoked state');
  }

  const latestStatusLog = await tx.vPNAccountStatusLog.findFirst({
    where: { accountId: vpnAccount.id },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
  let linkedBatchItem = action.relatedBatchAccountItemId
    ? await tx.batchAccountItem.findUnique({ where: { id: action.relatedBatchAccountItemId } })
    : vpnAccount.batchAccountItemId
      ? await tx.batchAccountItem.findUnique({ where: { id: vpnAccount.batchAccountItemId } })
      : vpnAccount.accessRequestId
        ? await tx.batchAccountItem.findUnique({ where: { accessRequestId: vpnAccount.accessRequestId } })
        : null;
  if (!latestStatusLog || latestStatusLog.newStatus !== 'revoked') {
    throw new Error('Latest VPN status history does not confirm revocation');
  }

  const activeRequestClaimants = await tx.accessRequest.findMany({
    where: {
      status: { notIn: ['rejected', 'offboarded'] },
      OR: [
        { vpnUsername: { equals: vpnAccount.username, mode: 'insensitive' } },
        { linkedVpnUsername: { equals: vpnAccount.username, mode: 'insensitive' } },
      ],
    },
    select: { id: true, version: true },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 2,
  });
  const vpnBatchOwners = await findActiveVpnBatchOwnershipClaims(tx, vpnAccount.username);
  const explicitLegacyBatchValid = Boolean(
    linkedBatchItem && vpnAccount.accessRequestId
    && linkedBatchItem.lifecycleOwnerKind === 'access_request_legacy'
    && linkedBatchItem.accessRequestId === vpnAccount.accessRequestId
    && (!linkedBatchItem.vpnUsername || sameVpnUsername(linkedBatchItem.vpnUsername, vpnAccount.username))
    && (!vpnAccount.batchId || linkedBatchItem.batchId === vpnAccount.batchId)
  );
  const explicitBatchOwner = vpnAccount.batchAccountItemId
    ? vpnBatchOwners.find((item) => item.id === vpnAccount.batchAccountItemId && sameVpnUsername(item.vpnUsername, vpnAccount.username)) ?? null
    : null;
  const legacyBatchOwners = !vpnAccount.batchAccountItemId && vpnAccount.batchId
    ? vpnBatchOwners.filter((item) => item.batchId === vpnAccount.batchId && sameVpnUsername(item.vpnUsername, vpnAccount.username))
    : [];
  const vpnBatchOwner = explicitBatchOwner ?? legacyBatchOwners[0] ?? null;
  if (
    vpnBatchOwners.length > 1
    || (vpnAccount.batchAccountItemId && !explicitLegacyBatchValid && (!explicitBatchOwner || vpnBatchOwners.length !== 1))
    || (!vpnAccount.batchAccountItemId && vpnAccount.batchId && vpnBatchOwners.length > 0 && legacyBatchOwners.length !== 1)
    || (vpnBatchOwners.length > 0 && vpnAccount.accessRequestId !== null)
    || (vpnBatchOwners.length > 0 && !vpnBatchOwner)
    || (vpnBatchOwner !== null && vpnBatchOwner.status !== 'completed')
  ) {
    throw new Error('VPN batch ownership is incomplete, conflicting, or not ready for deletion');
  }
  if (
    action.relatedBatchAccountItemId
    && linkedBatchItem?.lifecycleOwnerKind === 'batch_item'
    && (!vpnBatchOwner || vpnBatchOwner.id !== linkedBatchItem.id)
  ) {
    throw new Error('VPN deletion batch ownership changed after confirmation');
  }
  if (vpnBatchOwner) {
    if (action.relatedBatchAccountItemId !== vpnBatchOwner.id) {
      throw new Error('VPN deletion action no longer names the active batch owner');
    }
    linkedBatchItem = vpnBatchOwner;
  }
  const confirmedClaimantIds = Array.isArray(confirmed.activeRequestClaimantIds)
    ? confirmed.activeRequestClaimantIds
    : [];
  if (
    confirmed.vpnAccountId !== vpnAccount.id
    || confirmed.username !== vpnAccount.username
    || confirmed.status !== vpnAccount.status
    || confirmed.revokedAt !== vpnAccount.revokedAt.toISOString()
    || confirmed.revokedBy !== vpnAccount.revokedBy
    || confirmed.revokedReason !== vpnAccount.revokedReason
    || confirmed.latestStatusLogId !== latestStatusLog.id
    || confirmed.latestStatus !== latestStatusLog.newStatus
    || (confirmed.accessRequestId ?? null) !== (vpnAccount.accessRequestId ?? null)
    || (action.relatedRequestId ?? null) !== (vpnAccount.accessRequestId ?? null)
    || (confirmed.batchAccountItemId ?? null) !== (linkedBatchItem?.id ?? null)
    || (confirmed.batchAccountItemVersion ?? null) !== (linkedBatchItem?.version ?? null)
    || (confirmed.sourceBatchId ?? null) !== (linkedBatchItem?.batchId ?? vpnAccount.batchId ?? null)
    || (vpnAccount.batchAccountItemId && vpnAccount.batchAccountItemId !== linkedBatchItem?.id)
    || activeRequestClaimants.length !== confirmedClaimantIds.length
    || activeRequestClaimants.some((claimant, index) => claimant.id !== confirmedClaimantIds[index])
  ) {
    throw new Error('VPN deletion confirmation is stale; refresh the account and confirm the current revoked state');
  }

  let linkedRequest: AccessRequest | null = null;
  if (vpnAccount.accessRequestId) {
    linkedRequest = await tx.accessRequest.findUnique({ where: { id: vpnAccount.accessRequestId } });
    if (!linkedRequest) {
      throw new Error('Linked access request no longer exists; reconcile the VPN linkage before deletion');
    }
    const linkedVpnUsernames = [linkedRequest.vpnUsername, linkedRequest.linkedVpnUsername]
      .filter((value): value is string => Boolean(value))
      .map((value) => value.trim().toLowerCase());
    if (
      linkedVpnUsernames.length > 0
      && !linkedVpnUsernames.includes(vpnAccount.username.trim().toLowerCase())
    ) {
      throw new Error('Linked access request no longer identifies the confirmed VPN username');
    }
    if (action.relatedRequestId && action.relatedRequestId !== linkedRequest.id) {
      throw new Error('Lifecycle request linkage no longer matches the VPN account');
    }
    if (confirmed.accessRequestVersion !== linkedRequest.version) {
      throw new Error('Linked access request changed after VPN deletion was confirmed');
    }
  } else if (action.relatedRequestId) {
    throw new Error('Lifecycle action names a request that is not linked to the VPN account');
  } else if ((confirmed.accessRequestVersion ?? null) !== null) {
    throw new Error('VPN deletion confirmation contains stale request-version evidence');
  }

  const deletedAt = new Date();
  await tx.vPNAccountStatusLog.create({
    data: {
      accountId: vpnAccount.id,
      liveAccountId: vpnAccount.id,
      oldStatus: 'revoked',
      newStatus: 'deleted',
      changedBy: action.requestedBy,
      reason: `${action.reason} - ${action.relatedTicketId}`,
      lifecycleActionId: action.id,
    },
  });
  await tx.vPNAccountActivityLog.create({
    data: {
      accountId: vpnAccount.id,
      accountUsername: vpnAccount.username,
      accountName: vpnAccount.name,
      accountEmail: vpnAccount.email,
      actionType: 'deleted',
      performedBy: action.requestedBy,
      reason: action.reason,
      lifecycleActionId: action.id,
      notes: action.notes,
    },
  });
  if (linkedRequest) {
    const requestProjection = await tx.accessRequest.updateMany({
      where: {
        id: linkedRequest.id,
        version: linkedRequest.version,
        OR: [
          { vpnUsername: { equals: vpnAccount.username, mode: 'insensitive' } },
          { linkedVpnUsername: { equals: vpnAccount.username, mode: 'insensitive' } },
        ],
      },
      data: { vpnAccountStatus: 'deleted', version: { increment: 1 } },
    });
    if (requestProjection.count !== 1) {
      throw new Error('Linked access request changed during VPN deletion');
    }
  }
  await tx.auditLog.create({
    data: {
      action: AuditActions.DELETE_VPN_ACCOUNT,
      category: AuditCategories.VPN,
      username: action.requestedBy,
      actorType: 'admin',
      targetId: vpnAccount.id,
      targetType: 'VPNAccount',
      subjectUsername: vpnAccount.username,
      subjectEmail: vpnAccount.email,
      relatedRequestId: linkedRequest?.id ?? null,
      relatedVpnAccountId: vpnAccount.id,
      relatedLifecycleActionId: action.id,
      eventKind: 'lifecycle',
      outcome: 'success',
      success: true,
      details: JSON.stringify({
        policyVersion: action.policyVersion,
        ticketReference: action.relatedTicketId,
        deletedAt: deletedAt.toISOString(),
        priorStatus: vpnAccount.status,
        retainedHistory: true,
        credentialRemovedWithLiveRecord: true,
      }),
    },
  });
  await tx.vPNAccount.delete({ where: { id: vpnAccount.id } });

  return {
    deletedAt: deletedAt.toISOString(),
    vpnAccountId: vpnAccount.id,
    username: vpnAccount.username,
    priorStatus: vpnAccount.status,
    revokedAt: vpnAccount.revokedAt.toISOString(),
    latestRevokedStatusLogId: latestStatusLog.id,
    relatedRequestId: linkedRequest?.id ?? null,
    retainedHistory: true,
    credentialRemovedWithLiveRecord: true,
  };
}

async function revokeVPNAccess(action: LifecycleAction, usernameOverride?: string | null, accessRequestIdOverride?: string | null): Promise<void> {
  const username = usernameOverride || action.targetUsername;
  const relatedRequestId = accessRequestIdOverride || action.relatedRequestId || null;
  
  if (!usernameOverride && !action.targetUserId) {
    throw new Error(`VPN lifecycle action ${action.id} is missing its immutable target ID`);
  }
  const vpnAccount = await prisma.vPNAccount.findUnique({
    where: usernameOverride ? { username } : { id: action.targetUserId! },
  });

  if (!vpnAccount) {
    throw new Error(`No VPN account found for username: ${username}`);
  }
  if (vpnAccount.username.trim().toLowerCase() !== username.trim().toLowerCase()) {
    throw new Error(`VPN account identity changed for lifecycle action ${action.id}`);
  }

  if (vpnAccount.status === 'revoked') {
    throw new Error(`VPN account ${username} is already revoked`);
  }

  const noteDetails = [];
  if (action.relatedTicketId) {
    noteDetails.push(`Ticket #${action.relatedTicketId}`);
  }
  if (relatedRequestId) {
    noteDetails.push(`Request ${relatedRequestId}`);
  }
  const ticketInfo = noteDetails.length > 0 ? ` - ${noteDetails.join(', ')}` : '';
  const detailedReason = `${action.reason}${ticketInfo}`;

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.vPNAccount.update({
      where: { id: vpnAccount.id },
      data: {
        status: 'revoked',
        revokedAt: new Date(),
        revokedBy: action.requestedBy,
        revokedReason: detailedReason,
        canRestore: action.canRestore ?? true,
      },
    });

    await tx.vPNAccountStatusLog.create({
      data: {
        accountId: vpnAccount.id,
        liveAccountId: vpnAccount.id,
        oldStatus: vpnAccount.status,
        newStatus: 'revoked',
        changedBy: action.requestedBy,
        reason: detailedReason,
        lifecycleActionId: action.id,
      },
    });

    await tx.vPNAccountActivityLog.create({
      data: {
        accountId: vpnAccount.id,
        accountUsername: username,
        accountName: vpnAccount.name,
        accountEmail: vpnAccount.email,
        actionType: 'revoked',
        performedBy: action.requestedBy,
        reason: action.reason,
        lifecycleActionId: action.id,
        notes: action.notes,
      },
    });

    const accessRequestId = vpnAccount.accessRequestId || relatedRequestId;
    if (accessRequestId) {
      await tx.accessRequest.update({
        where: { id: accessRequestId },
        data: {
          vpnAccountStatus: 'revoked',
          vpnRevokedAt: new Date(),
          vpnRevokedBy: action.requestedBy,
          vpnRevokedReason: detailedReason,
        },
      });
    }
  });

  appLogger.info('VPN access revoked', { username, reason: detailedReason });
}

async function restoreVPNAccess(action: LifecycleAction, usernameOverride?: string | null, accessRequestIdOverride?: string | null): Promise<void> {
  const username = usernameOverride || action.targetUsername;
  const relatedRequestId = accessRequestIdOverride || action.relatedRequestId || null;
  
  if (!usernameOverride && !action.targetUserId) {
    throw new Error(`VPN lifecycle action ${action.id} is missing its immutable target ID`);
  }
  const vpnAccount = await prisma.vPNAccount.findUnique({
    where: usernameOverride ? { username } : { id: action.targetUserId! },
  });

  if (!vpnAccount) {
    throw new Error(`No VPN account found for username: ${username}`);
  }
  if (vpnAccount.username.trim().toLowerCase() !== username.trim().toLowerCase()) {
    throw new Error(`VPN account identity changed for lifecycle action ${action.id}`);
  }

  if (vpnAccount.status !== 'revoked') {
    throw new Error(`VPN account ${username} is not in revoked state, current status: ${vpnAccount.status}`);
  }

  if (!vpnAccount.canRestore) {
    throw new Error(`VPN account ${username} cannot be restored`);
  }

  const noteDetails = [];
  if (action.relatedTicketId) {
    noteDetails.push(`Ticket #${action.relatedTicketId}`);
  }
  if (relatedRequestId) {
    noteDetails.push(`Request ${relatedRequestId}`);
  }
  const ticketInfo = noteDetails.length > 0 ? ` - ${noteDetails.join(', ')}` : '';
  const detailedReason = `Restored: ${action.reason}${ticketInfo}`;

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.vPNAccount.update({
      where: { id: vpnAccount.id },
      data: {
        status: 'active',
        restoredAt: new Date(),
        restoredBy: action.requestedBy,
      },
    });

    await tx.vPNAccountStatusLog.create({
      data: {
        accountId: vpnAccount.id,
        liveAccountId: vpnAccount.id,
        oldStatus: 'revoked',
        newStatus: 'active',
        changedBy: action.requestedBy,
        reason: detailedReason,
        lifecycleActionId: action.id,
      },
    });

    await tx.vPNAccountActivityLog.create({
      data: {
        accountId: vpnAccount.id,
        accountUsername: username,
        accountName: vpnAccount.name,
        accountEmail: vpnAccount.email,
        actionType: 'restored',
        performedBy: action.requestedBy,
        reason: action.reason,
        lifecycleActionId: action.id,
        notes: action.notes,
      },
    });

    const accessRequestId = vpnAccount.accessRequestId || relatedRequestId;
    if (accessRequestId) {
      await tx.accessRequest.update({
        where: { id: accessRequestId },
        data: {
          vpnAccountStatus: 'active',
          vpnRestoredAt: new Date(),
          vpnRestoredBy: action.requestedBy,
        },
      });
    }
  });

  appLogger.info('VPN access restored', { username });
}

async function addADGroupMember(action: LifecycleAction, onExternalMutationStart: () => void): Promise<Record<string, unknown>> {
  let groupDn: string | null = action.targetGroupDn?.trim() || null;
  if (!groupDn && action.notes) {
    try {
      const parsed = JSON.parse(action.notes) as { groupDn?: unknown };
      if (typeof parsed.groupDn === 'string' && parsed.groupDn.trim()) {
        groupDn = parsed.groupDn.trim();
      }
    } catch {
      groupDn = null;
    }
  }

  if (!groupDn) {
    throw new Error('add_group_member action is missing a valid groupDn in notes');
  }
  if (!action.targetGroupObjectGuid || !action.targetDirectoryDn || !action.targetDirectoryObjectGuid) {
    throw new Error('Group lifecycle action is missing immutable directory identity evidence');
  }
  const beforeGroup = await getLDAPGroupIdentity(groupDn);
  if (
    beforeGroup.dn.toLowerCase() !== groupDn.toLowerCase()
    || beforeGroup.objectGuid !== action.targetGroupObjectGuid
  ) {
    throw new Error('Directory group identity changed after confirmation; create a new lifecycle action');
  }
  await assertLifecycleGroupNotProtected(groupDn);

  const directoryUser = await searchLDAPUser(action.targetUsername);
  const userDn = directoryUser?.objectName;
  if (!userDn) {
    throw new Error(`Could not resolve directory DN for username: ${action.targetUsername}`);
  }
  const userObjectGuid = directoryUser.attributes.find(
    (attribute) => attribute.type.toLowerCase() === 'objectguid'
  )?.values?.[0];
  if (
    userDn.toLowerCase() !== action.targetDirectoryDn.toLowerCase()
    || !userObjectGuid
    || userObjectGuid !== action.targetDirectoryObjectGuid
  ) {
    throw new Error('Directory member identity changed after confirmation; create a new lifecycle action');
  }

  assertExternalSideEffectAllowed('ldap-write');
  onExternalMutationStart();
  await addLDAPGroupMember(groupDn, userDn);
  const members = await getLDAPGroupMembers(groupDn);
  if (!members.some((member) => member.dn.toLowerCase() === userDn.toLowerCase())) {
    throw new Error(`Directory readback did not confirm ${action.targetUsername} in ${groupDn}`);
  }
  const afterUser = await searchLDAPUser(action.targetUsername);
  const afterUserObjectGuid = afterUser?.attributes.find(
    (attribute) => attribute.type.toLowerCase() === 'objectguid'
  )?.values?.[0];
  if (
    !afterUser
    || afterUser.objectName.toLowerCase() !== action.targetDirectoryDn.toLowerCase()
    || afterUserObjectGuid !== action.targetDirectoryObjectGuid
  ) {
    throw new Error('Directory readback resolved a different member than the confirmed target');
  }
  const afterGroup = await getLDAPGroupIdentity(groupDn);
  if (afterGroup.dn.toLowerCase() !== beforeGroup.dn.toLowerCase() || afterGroup.objectGuid !== beforeGroup.objectGuid) {
    throw new Error('Directory readback resolved a different group than the confirmed target');
  }

  return { groupDn, groupObjectGuid: beforeGroup.objectGuid, userDn, userObjectGuid };
}

async function removeADGroupMember(action: LifecycleAction, onExternalMutationStart: () => void): Promise<Record<string, unknown>> {
  let groupDn: string | null = action.targetGroupDn?.trim() || null;
  if (!groupDn && action.notes) {
    try {
      const parsed = JSON.parse(action.notes) as { groupDn?: unknown };
      if (typeof parsed.groupDn === 'string' && parsed.groupDn.trim()) {
        groupDn = parsed.groupDn.trim();
      }
    } catch {
      groupDn = null;
    }
  }

  if (!groupDn) {
    throw new Error('remove_from_group action is missing a valid groupDn in notes');
  }
  if (!action.targetGroupObjectGuid || !action.targetDirectoryDn || !action.targetDirectoryObjectGuid) {
    throw new Error('Group lifecycle action is missing immutable directory identity evidence');
  }
  const beforeGroup = await getLDAPGroupIdentity(groupDn);
  if (
    beforeGroup.dn.toLowerCase() !== groupDn.toLowerCase()
    || beforeGroup.objectGuid !== action.targetGroupObjectGuid
  ) {
    throw new Error('Directory group identity changed after confirmation; create a new lifecycle action');
  }
  await assertLifecycleGroupNotProtected(groupDn);

  const directoryUser = await searchLDAPUser(action.targetUsername);
  const userDn = directoryUser?.objectName;
  if (!userDn) {
    throw new Error(`Could not resolve directory DN for username: ${action.targetUsername}`);
  }
  const userObjectGuid = directoryUser.attributes.find(
    (attribute) => attribute.type.toLowerCase() === 'objectguid'
  )?.values?.[0];
  if (
    userDn.toLowerCase() !== action.targetDirectoryDn.toLowerCase()
    || !userObjectGuid
    || userObjectGuid !== action.targetDirectoryObjectGuid
  ) {
    throw new Error('Directory member identity changed after confirmation; create a new lifecycle action');
  }

  assertExternalSideEffectAllowed('ldap-write');
  onExternalMutationStart();
  const removed = await removeLDAPGroupMember(groupDn, userDn);
  if (!removed) {
    throw new Error(`Directory refused removal of ${action.targetUsername} from ${groupDn}`);
  }
  const members = await getLDAPGroupMembers(groupDn);
  if (members.some((member) => member.dn.toLowerCase() === userDn.toLowerCase())) {
    throw new Error(`Directory readback still includes ${action.targetUsername} in ${groupDn}`);
  }
  const afterUser = await searchLDAPUser(action.targetUsername);
  const afterUserObjectGuid = afterUser?.attributes.find(
    (attribute) => attribute.type.toLowerCase() === 'objectguid'
  )?.values?.[0];
  if (
    !afterUser
    || afterUser.objectName.toLowerCase() !== action.targetDirectoryDn.toLowerCase()
    || afterUserObjectGuid !== action.targetDirectoryObjectGuid
  ) {
    throw new Error('Directory readback resolved a different member than the confirmed target');
  }
  const afterGroup = await getLDAPGroupIdentity(groupDn);
  if (afterGroup.dn.toLowerCase() !== beforeGroup.dn.toLowerCase() || afterGroup.objectGuid !== beforeGroup.objectGuid) {
    throw new Error('Directory readback resolved a different group than the confirmed target');
  }

  return { groupDn, groupObjectGuid: beforeGroup.objectGuid, userDn, userObjectGuid };
}

async function promoteVPNRole(action: LifecycleAction): Promise<void> {
  const username = action.targetUsername;
  if (!action.targetUserId) throw new Error(`VPN lifecycle action ${action.id} is missing its immutable target ID`);
  
  const vpnAccount = await prisma.vPNAccount.findUnique({
    where: { id: action.targetUserId },
  });

  if (!vpnAccount) {
    throw new Error(`No VPN account found for username: ${username}`);
  }
  if (vpnAccount.username.trim().toLowerCase() !== username.trim().toLowerCase()) {
    throw new Error(`VPN account identity changed for lifecycle action ${action.id}`);
  }

  if (vpnAccount.portalType === 'Management') {
    throw new Error(`VPN account ${username} is already in Management portal`);
  }

  if (vpnAccount.portalType === 'External') {
    throw new Error(`Cannot promote External portal accounts to Management`);
  }

  const previousRole = vpnAccount.portalType;

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.vPNAccount.update({
      where: { id: vpnAccount.id },
      data: {
        portalType: 'Management',
        expiresAt: null,
      },
    });

    await tx.vPNRoleChange.create({
      data: {
        vpnAccountId: vpnAccount.id,
        username,
        previousRole,
        newRole: 'Management',
        changedBy: action.requestedBy,
        reason: action.reason,
        relatedActionId: action.id,
        notes: action.notes,
      },
    });

    await tx.vPNAccountStatusLog.create({
      data: {
        accountId: vpnAccount.id,
        liveAccountId: vpnAccount.id,
        oldStatus: vpnAccount.status,
        newStatus: vpnAccount.status,
        changedBy: action.requestedBy,
        reason: `Role promoted: ${previousRole} -> Management. ${action.reason}`,
        lifecycleActionId: action.id,
      },
    });

    await tx.vPNAccountActivityLog.create({
      data: {
        accountId: vpnAccount.id,
        accountUsername: username,
        accountName: vpnAccount.name,
        accountEmail: vpnAccount.email,
        actionType: 'role_promoted',
        performedBy: action.requestedBy,
        reason: action.reason,
        lifecycleActionId: action.id,
        oldPortalType: previousRole,
        newPortalType: 'Management',
        notes: action.notes,
      },
    });
  });

  appLogger.info('VPN role promoted', { username, from: previousRole, to: 'Management' });
}

async function demoteVPNRole(action: LifecycleAction): Promise<void> {
  const username = action.targetUsername;
  if (!action.targetUserId) throw new Error(`VPN lifecycle action ${action.id} is missing its immutable target ID`);
  
  const vpnAccount = await prisma.vPNAccount.findUnique({
    where: { id: action.targetUserId },
  });

  if (!vpnAccount) {
    throw new Error(`No VPN account found for username: ${username}`);
  }
  if (vpnAccount.username.trim().toLowerCase() !== username.trim().toLowerCase()) {
    throw new Error(`VPN account identity changed for lifecycle action ${action.id}`);
  }

  if (vpnAccount.portalType !== 'Management') {
    throw new Error(`VPN account ${username} is not in Management portal, current: ${vpnAccount.portalType}`);
  }

  const previousRole = vpnAccount.portalType;

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.vPNAccount.update({
      where: { id: vpnAccount.id },
      data: {
        portalType: 'Limited',
      },
    });

    await tx.vPNRoleChange.create({
      data: {
        vpnAccountId: vpnAccount.id,
        username,
        previousRole,
        newRole: 'Limited',
        changedBy: action.requestedBy,
        reason: action.reason,
        relatedActionId: action.id,
        notes: action.notes,
      },
    });

    await tx.vPNAccountStatusLog.create({
      data: {
        accountId: vpnAccount.id,
        liveAccountId: vpnAccount.id,
        oldStatus: vpnAccount.status,
        newStatus: vpnAccount.status,
        changedBy: action.requestedBy,
        reason: `Role demoted: ${previousRole} -> Limited. ${action.reason}`,
        lifecycleActionId: action.id,
      },
    });

    await tx.vPNAccountActivityLog.create({
      data: {
        accountId: vpnAccount.id,
        accountUsername: username,
        accountName: vpnAccount.name,
        accountEmail: vpnAccount.email,
        actionType: 'role_demoted',
        performedBy: action.requestedBy,
        reason: action.reason,
        lifecycleActionId: action.id,
        oldPortalType: previousRole,
        newPortalType: 'Limited',
        notes: action.notes,
      },
    });
  });

  appLogger.info('VPN role demoted', { username, from: previousRole, to: 'Limited' });
}

export async function processNextQueuedAction(): Promise<ProcessResult | null> {
  const now = new Date();
  // A worker may have crashed after an external side effect. Never replay that
  // work automatically: surface it for read-before-write reconciliation. AD
  // claims are recovered only while holding the same execution fence as their
  // worker, so a paused worker cannot resume after its claim has been revoked.
  const staleClaims = await prisma.accountLifecycleAction.findMany({
    where: { status: 'processing', claimedUntil: { lte: now } },
    select: { id: true, actionType: true, targetUsername: true, targetUserId: true, batchId: true },
  });
  for (const staleClaim of staleClaims) {
    const recoveryData = {
      status: 'reconciliation_required',
      claimId: null,
      claimedUntil: null,
      errorMessage: 'Processing claim expired; verify AD/VPN state before retrying',
    } as const;
    if (staleClaim.actionType === 'delete_vpn_record') {
      const canonicalUsername = staleClaim.targetUsername.trim().toLowerCase();
      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const lock = await tx.$queryRaw<Array<{ lock_acquired: boolean }>>`
          SELECT pg_try_advisory_xact_lock(hashtextextended(${canonicalUsername}, ${VPN_EXECUTION_LOCK_NAMESPACE})) AS lock_acquired
        `;
        if (!lock[0]?.lock_acquired) return;
        const liveAccount = staleClaim.targetUserId
          ? await tx.vPNAccount.findUnique({ where: { id: staleClaim.targetUserId } })
          : null;
        const nextStatus = liveAccount ? 'failed' : 'reconciliation_required';
        const errorMessage = liveAccount
          ? 'Expired VPN deletion claim did not commit; the live revoked record remains. Refresh and create a new confirmation before retrying.'
          : 'Expired VPN deletion claim found no live record; retained completion evidence must be reconciled objectively.';
        const recovered = await tx.accountLifecycleAction.updateMany({
          where: { id: staleClaim.id, status: 'processing', claimedUntil: { lte: now } },
          data: {
            status: nextStatus,
            claimId: null,
            claimedUntil: null,
            completedAt: new Date(),
            errorMessage,
          },
        });
        if (recovered.count === 1) {
          await tx.accountLifecycleHistory.create({
            data: {
              actionId: staleClaim.id,
              event: nextStatus,
              performedBy: 'system',
              previousStatus: 'processing',
              newStatus: nextStatus,
              details: JSON.stringify({ objectiveRecovery: true, liveVpnRecordPresent: Boolean(liveAccount) }),
            },
          });
          await refreshReviewedDeletionPlanAggregate(tx, staleClaim.batchId);
        }
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 30_000,
        timeout: 60_000,
      });
      continue;
    }
    if (!DIRECTORY_EXECUTION_ACTIONS.has(staleClaim.actionType)) {
      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const recovered = await tx.accountLifecycleAction.updateMany({
          where: { id: staleClaim.id, status: 'processing', claimedUntil: { lte: now } },
          data: recoveryData,
        });
        if (recovered.count === 1) await refreshReviewedDeletionPlanAggregate(tx, staleClaim.batchId);
      });
      continue;
    }
    const canonicalUsername = staleClaim.targetUsername.trim().toLowerCase();
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const lock = await tx.$queryRaw<Array<{ lock_acquired: boolean }>>`
        SELECT pg_try_advisory_xact_lock(hashtextextended(${canonicalUsername}, ${DIRECTORY_EXECUTION_LOCK_NAMESPACE})) AS lock_acquired
      `;
      if (!lock[0]?.lock_acquired) return;
      const recovered = await tx.accountLifecycleAction.updateMany({
        where: { id: staleClaim.id, status: 'processing', claimedUntil: { lte: now } },
        data: recoveryData,
      });
      if (recovered.count === 1) await refreshReviewedDeletionPlanAggregate(tx, staleClaim.batchId);
    });
  }
  const nextAction = await prisma.accountLifecycleAction.findFirst({
    where: {
      status: 'queued',
      AND: [{ OR: [{ scheduledFor: null }, { scheduledFor: { lte: now } }] }],
    },
    orderBy: [
      { createdAt: 'asc' },
    ],
  });

  if (!nextAction) {
    return null;
  }

  try {
    return await processLifecycleAction(nextAction.id);
  } catch (error) {
    if (error instanceof Error && error.message.includes('is not ready for processing')) {
      return null;
    }
    throw error;
  }
}

export async function processAllQueuedActions(): Promise<ProcessResult[]> {
  const results: ProcessResult[] = [];
  
  let nextResult = await processNextQueuedAction();
  while (nextResult) {
    results.push(nextResult);
    
    await new Promise(resolve => setTimeout(resolve, 500));
    
    nextResult = await processNextQueuedAction();
  }

  return results;
}

export async function retryFailedAction(actionId: string): Promise<boolean> {
  try {
    const action = await prisma.accountLifecycleAction.findUnique({
      where: { id: actionId },
    });

    if (!action) {
      throw new Error(`Action ${actionId} not found`);
    }

    if (action.status !== 'failed') {
      throw new Error(`Action ${actionId} is not in failed state (current: ${action.status})`);
    }
    if (action.actionType === 'delete_vpn_record') {
      throw new Error(`Action ${actionId} is a permanent VPN deletion and must be reviewed and recreated from current revocation evidence`);
    }
    if (
      action.actionType === 'delete_ad'
      && (
        action.policyVersion !== expectedDirectoryDeletePolicyVersion(action.operationMode)
        || !hasCurrentDirectoryDeleteMethod(action.authorizationEvidence)
      )
    ) {
      throw new Error(`Action ${actionId} was reviewed using an earlier AD deletion method. Refresh the account state and create a new deletion confirmation.`);
    }
    const governedAdAction = action.operationMode === 'governed'
      && ['disable_ad', 'enable_ad', 'delete_ad', 'disable_both', 'enable_both'].includes(action.actionType);
    const governedPolicyVersion = action.actionType === 'delete_ad'
      ? GOVERNED_DIRECTORY_DELETE_POLICY_VERSION
      : 'governed-directory-identity-v1';
    const batchGovernedAdAction = action.operationMode === 'batch_governed'
      && ['disable_ad', 'enable_ad', 'delete_ad'].includes(action.actionType);
    const batchGovernedPolicyVersion = action.actionType === 'delete_ad'
      ? BATCH_GOVERNED_DIRECTORY_DELETE_POLICY_VERSION
      : BATCH_GOVERNED_DIRECTORY_IDENTITY_POLICY_VERSION;
    const unmanagedDelete = action.actionType === 'delete_ad' && action.operationMode === 'directory_override';
    const groupAction = ['add_group_member', 'add_to_group', 'remove_from_group'].includes(action.actionType);
    if (
      (governedAdAction && (
        action.policyVersion !== governedPolicyVersion
        || !action.targetDirectoryDn
        || !action.targetDirectoryObjectGuid
        || !action.preflightSnapshot
      ))
      || (batchGovernedAdAction && (
        action.policyVersion !== batchGovernedPolicyVersion
        || !action.relatedBatchAccountItemId
        || Boolean(action.relatedRequestId)
        || !action.targetDirectoryDn
        || !action.targetDirectoryObjectGuid
        || !action.preflightSnapshot
      ))
      || (unmanagedDelete && (
        action.policyVersion !== UNMANAGED_DIRECTORY_DELETE_POLICY_VERSION
        || !action.targetDirectoryDn
        || !action.targetDirectoryObjectGuid
        || !action.preflightSnapshot
        || action.relatedRequestId
      ))
      || (groupAction && (
        !action.targetDirectoryDn
        || !action.targetDirectoryObjectGuid
        || !action.targetGroupDn
        || !action.targetGroupObjectGuid
      ))
    ) {
      throw new Error(`Action ${actionId} lacks immutable identity evidence and must be cancelled and recreated`);
    }
    if (action.actionType === 'delete_ad') {
      assertDeletionAuthorizationEvidence(action);
    }

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      if (action.actionType === 'delete_ad') {
        const canonicalUsername = action.targetUsername.trim().toLowerCase();
        await tx.$queryRaw<Array<{ lock_acquired: string }>>`
          SELECT 'locked'::text AS lock_acquired
          FROM pg_advisory_xact_lock(hashtextextended(${canonicalUsername}, ${DIRECTORY_EXECUTION_LOCK_NAMESPACE}))
        `;
        const lockedAction = await tx.accountLifecycleAction.findUnique({ where: { id: actionId } });
        if (!lockedAction || lockedAction.status !== 'failed') {
          throw new Error(`Action ${actionId} changed before retry could acquire the deletion fence`);
        }
        if (
          lockedAction.policyVersion !== expectedDirectoryDeletePolicyVersion(lockedAction.operationMode)
          || !hasCurrentDirectoryDeleteMethod(lockedAction.authorizationEvidence)
        ) {
          throw new Error(`Action ${actionId} was reviewed using an earlier AD deletion method. Refresh the account state and create a new deletion confirmation.`);
        }
        assertDeletionAuthorizationEvidence(lockedAction);
        const competingDelete = await tx.accountLifecycleAction.findFirst({
          where: {
            id: { not: actionId },
            actionType: 'delete_ad',
            targetDirectoryObjectGuid: lockedAction.targetDirectoryObjectGuid,
            status: { in: ['queued', 'processing', 'reconciliation_required'] },
          },
          select: { id: true, status: true },
        });
        if (competingDelete) {
          throw new Error(`Action ${actionId} cannot be retried while deletion ${competingDelete.id} is ${competingDelete.status}`);
        }
      }
      const retried = await tx.accountLifecycleAction.updateMany({
        where: { id: actionId, status: 'failed', claimId: null },
        data: {
          claimId: null,
          claimedUntil: null,
          status: 'queued',
          errorMessage: null,
          processedAt: null,
          processedBy: null,
          completedAt: null,
        },
      });
      if (retried.count !== 1) throw new Error(`Action ${actionId} changed before retry could be recorded`);

      await tx.accountLifecycleHistory.create({
        data: {
          actionId,
          event: 'retry',
          performedBy: 'system',
          previousStatus: 'failed',
          newStatus: 'queued',
          details: JSON.stringify({ retryReason: 'Manual retry requested' }),
        },
      });
      await refreshReviewedDeletionPlanAggregate(tx, action.batchId);
    });

    appLogger.info('Lifecycle action reset for retry', { actionId });
    return true;
  } catch (error) {
    appLogger.error('Failed to retry action', {
      actionId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return false;
  }
}

export async function cancelLifecycleAction(actionId: string, cancelledBy: string): Promise<boolean> {
  try {
    const action = await prisma.accountLifecycleAction.findUnique({
      where: { id: actionId },
    });

    if (!action) {
      throw new Error(`Action ${actionId} not found`);
    }

    if (action.status !== 'pending' && action.status !== 'queued') {
      throw new Error(`Action ${actionId} cannot be cancelled (current: ${action.status})`);
    }

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const cancelled = await tx.accountLifecycleAction.updateMany({
        where: { id: actionId, status: { in: ['pending', 'queued'] }, claimId: null },
        data: {
          status: 'cancelled',
          completedAt: new Date(),
          notes: `${action.notes || ''}\n[Cancelled by ${cancelledBy}]`.trim(),
        },
      });
      if (cancelled.count !== 1) throw new Error(`Action ${actionId} changed before cancellation could be recorded`);

      await tx.accountLifecycleHistory.create({
        data: {
          actionId,
          event: 'cancelled',
          performedBy: cancelledBy,
          previousStatus: action.status,
          newStatus: 'cancelled',
        },
      });
      await refreshReviewedDeletionPlanAggregate(tx, action.batchId);
    });

    appLogger.info('Lifecycle action cancelled', { actionId, cancelledBy });
    return true;
  } catch (error) {
    appLogger.error('Failed to cancel action', {
      actionId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return false;
  }
}
