import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { actorHasPermission } from '@/lib/rbac/core';
import { prisma } from '@/lib/prisma';
import { secureJsonResponse } from '@/lib/apiResponse';
import { logAuditAction, AuditActions, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';
import { actorCanOperateLifecycleAction } from '@/lib/lifecycle-authorization';
import { searchLDAPUserByObjectGuid } from '@/lib/ldap';
import { ldapAccountIsEnabled } from '@/lib/ldap/account-status';
import { assertLifecycleAccountNotProtected } from '@/lib/lifecycle-protection';
import {
  isLifecycleProvisioningReady,
} from '@/lib/access-request-lifecycle-readiness';
import { appLogger } from '@/lib/logger';
import { isAccessRequestDirectoryIdentityConsistent } from '@/lib/access-request-directory-identity';
import { refreshReviewedDeletionPlanAggregate } from '@/lib/lifecycle-deletion-plan';
import { isProductionCloneReadOnly } from '@/lib/clone-safety';

type ReconciliationOutcome = 'confirmed_completed' | 'confirmed_not_completed';

/**
 * Resolves an uncertain external outcome only after an operator records evidence.
 * This route deliberately never calls retryFailedAction or the lifecycle processor.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin || response) return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!actorHasPermission(admin, 'lifecycle.manage')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if (isProductionCloneReadOnly()) {
      return NextResponse.json({ error: 'Lifecycle mutations are disabled in this production-clone environment.', code: 'CLONE_READ_ONLY' }, { status: 409 });
    }
    const { id } = await params;
    const body = await request.json() as { outcome?: ReconciliationOutcome; evidence?: string };
    const evidence = typeof body.evidence === 'string' ? body.evidence.trim() : '';
    if ((body.outcome !== 'confirmed_completed' && body.outcome !== 'confirmed_not_completed') || evidence.length < 10 || evidence.length > 5_000) {
      return NextResponse.json({ error: 'A reconciliation outcome and at least 10 characters of external evidence are required.' }, { status: 400 });
    }
    const candidate = await prisma.accountLifecycleAction.findUnique({ where: { id } });
    if (!candidate) return NextResponse.json({ error: 'Lifecycle action not found' }, { status: 404 });
    if (!actorCanOperateLifecycleAction(admin, candidate)) {
      return NextResponse.json({ error: 'Your privileges do not allow reconciling this lifecycle action.' }, { status: 403 });
    }
    if (candidate.actionType === 'delete_vpn_record') {
      const canonicalUsername = candidate.targetUsername.trim().toLowerCase();
      const vpnReconciliation = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw<Array<{ lock_acquired: string }>>`
          SELECT 'locked'::text AS lock_acquired
          FROM pg_advisory_xact_lock(hashtextextended(${canonicalUsername}, 904771))
        `;
        const action = await tx.accountLifecycleAction.findUnique({ where: { id } });
        if (!action) return { error: 'Lifecycle action not found', status: 404 as const };
        if (action.status !== 'reconciliation_required') {
          return { error: 'This action is no longer awaiting reconciliation.', status: 409 as const };
        }
        if (!action.targetUserId || !action.preflightSnapshot || typeof action.preflightSnapshot !== 'object' || Array.isArray(action.preflightSnapshot)) {
          return { error: 'VPN deletion reconciliation is missing immutable confirmation evidence.', status: 409 as const };
        }
        const confirmed = action.preflightSnapshot;
        const liveAccount = await tx.vPNAccount.findUnique({ where: { id: action.targetUserId } });
        let nextStatus: 'completed' | 'failed';
        let resultSnapshot = action.resultSnapshot;
        if (body.outcome === 'confirmed_completed') {
          if (liveAccount) {
            return { error: 'The live VPN record and encrypted credential still exist; deletion cannot be certified complete.', status: 409 as const };
          }
          const [deletedStatus, deletedActivity, deletionAudit, completionHistory, linkedRequest] = await Promise.all([
            tx.vPNAccountStatusLog.findFirst({
              where: { accountId: action.targetUserId, newStatus: 'deleted' },
              orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            }),
            tx.vPNAccountActivityLog.findFirst({
              where: { lifecycleActionId: action.id, accountId: action.targetUserId, actionType: 'deleted' },
            }),
            tx.auditLog.findFirst({
              where: {
                action: AuditActions.DELETE_VPN_ACCOUNT,
                relatedLifecycleActionId: action.id,
                relatedVpnAccountId: action.targetUserId,
                outcome: 'success',
              },
            }),
            tx.accountLifecycleHistory.findFirst({
              where: { actionId: action.id, event: 'completed', newStatus: 'completed' },
            }),
            action.relatedRequestId
              ? tx.accessRequest.findUnique({ where: { id: action.relatedRequestId } })
              : Promise.resolve(null),
          ]);
          const result = action.resultSnapshot && typeof action.resultSnapshot === 'object' && !Array.isArray(action.resultSnapshot)
            ? action.resultSnapshot
            : null;
          if (
            !deletedStatus
            || !deletedActivity
            || !deletionAudit
            || !completionHistory
            || result?.vpnAccountId !== action.targetUserId
            || typeof result.deletedAt !== 'string'
            || (action.relatedRequestId && linkedRequest?.vpnAccountStatus !== 'deleted')
          ) {
            return { error: 'Retained status, activity, audit, request projection, and lifecycle completion evidence do not all prove deletion.', status: 409 as const };
          }
          nextStatus = 'completed';
          resultSnapshot = {
            ...result,
            reconciliation: {
              outcome: body.outcome,
              reconciledAt: new Date().toISOString(),
              objectiveEvidenceVerified: true,
            },
          };
        } else {
          if (!liveAccount) {
            return { error: 'The live VPN record is absent; deletion cannot be certified as not completed.', status: 409 as const };
          }
          const latestStatus = await tx.vPNAccountStatusLog.findFirst({
            where: { accountId: liveAccount.id },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          });
          if (
            liveAccount.username !== confirmed.username
            || liveAccount.status !== 'revoked'
            || liveAccount.revokedAt?.toISOString() !== confirmed.revokedAt
            || liveAccount.revokedBy !== confirmed.revokedBy
            || liveAccount.revokedReason !== confirmed.revokedReason
            || latestStatus?.id !== confirmed.latestStatusLogId
            || latestStatus?.newStatus !== 'revoked'
            || (liveAccount.accessRequestId ?? null) !== (confirmed.accessRequestId ?? null)
          ) {
            return { error: 'The surviving VPN record no longer matches the confirmed revoked target. Create a new lifecycle action after review.', status: 409 as const };
          }
          nextStatus = 'failed';
        }
        const updated = await tx.accountLifecycleAction.updateMany({
          where: { id, status: 'reconciliation_required' },
          data: {
            status: nextStatus,
            claimId: null,
            claimedUntil: null,
            completedAt: new Date(),
            errorMessage: nextStatus === 'failed'
              ? 'VPN deletion objectively confirmed not completed; a new confirmation is required.'
              : action.errorMessage,
            resultSnapshot: resultSnapshot === null ? Prisma.JsonNull : resultSnapshot,
          },
        });
        if (updated.count !== 1) {
          return { error: 'This action is no longer awaiting reconciliation.', status: 409 as const };
        }
        await tx.accountLifecycleHistory.create({
          data: {
            actionId: id,
            event: 'reconciled',
            performedBy: admin.username,
            previousStatus: 'reconciliation_required',
            newStatus: nextStatus,
            details: JSON.stringify({ outcome: body.outcome, evidence, objectiveEvidenceVerified: true }),
          },
        });
        await refreshReviewedDeletionPlanAggregate(tx, action.batchId);
        return { actionId: id, status: nextStatus };
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 30_000,
        timeout: 60_000,
      });

      if ('error' in vpnReconciliation) {
        const errorStatus = typeof vpnReconciliation.status === 'number' ? vpnReconciliation.status : 409;
        return NextResponse.json({ error: vpnReconciliation.error }, { status: errorStatus });
      }
      try {
        await logAuditAction({
          action: 'reconcile_lifecycle_action',
          category: AuditCategories.LIFECYCLE,
          username: admin.username,
          targetId: id,
          targetType: 'AccountLifecycleAction',
          relatedLifecycleActionId: id,
          eventKind: 'lifecycle',
          details: { operation: 'vpn_deletion_reconciliation', outcome: body.outcome, evidence },
          ipAddress: getIpAddress(request),
          userAgent: getUserAgent(request),
        });
      } catch (auditError) {
        appLogger.error('VPN deletion reconciliation audit emission failed after transactional finalization', auditError, { actionId: id });
      }
      return secureJsonResponse({ action: vpnReconciliation, message: 'VPN deletion reconciliation recorded from retained objective evidence.' });
    }
    if (candidate.actionType === 'delete_ad') {
      const canonicalUsername = candidate.targetUsername.trim().toLowerCase();
      const deleteReconciliation = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw<Array<{ lock_acquired: string }>>`
          SELECT 'locked'::text AS lock_acquired
          FROM pg_advisory_xact_lock(hashtextextended(${canonicalUsername}, 873211))
        `;
        await tx.$queryRaw<Array<{ lock_acquired: string }>>`
          SELECT 'locked'::text AS lock_acquired
          FROM pg_advisory_xact_lock(hashtextextended(${canonicalUsername}, 771921))
        `;
        const action = await tx.accountLifecycleAction.findUnique({ where: { id } });
        if (!action) return { error: 'Lifecycle action not found', status: 404 as const };
        if (action.status !== 'reconciliation_required') {
          return { error: 'This action is no longer awaiting reconciliation.', status: 409 as const };
        }
        const unmanaged = action.operationMode === 'directory_override';
        const batchGoverned = action.operationMode === 'batch_governed';
        if (
          !action.targetDirectoryObjectGuid
          || !action.targetDirectoryDn
          || (!unmanaged && !batchGoverned && !action.relatedRequestId)
          || (batchGoverned && (!action.relatedBatchAccountItemId || Boolean(action.relatedRequestId)))
        ) {
          return { error: 'Deletion reconciliation is missing immutable directory or ownership evidence.', status: 409 as const };
        }
        const [liveSessions, providerTasks, accessRequest, batchAccountItem] = await Promise.all([
          tx.session.count({ where: { username: { equals: action.targetUsername, mode: 'insensitive' } } }),
          tx.providerLogoutTask.findMany({
            where: { username: { equals: action.targetUsername, mode: 'insensitive' } },
            select: { status: true },
          }),
          action.relatedRequestId
            ? tx.accessRequest.findUnique({ where: { id: action.relatedRequestId } })
            : Promise.resolve(null),
          action.relatedBatchAccountItemId
            ? tx.batchAccountItem.findUnique({ where: { id: action.relatedBatchAccountItemId } })
            : Promise.resolve(null),
        ]);
        if (
          !(unmanaged && body.outcome === 'confirmed_completed')
          && (liveSessions > 0 || providerTasks.some((task) => task.status !== 'completed'))
        ) {
          return { error: 'Session revocation and every provider logout must be complete before deletion can be certified.', status: 409 as const };
        }
        const ownershipWhere = { OR: [
          { ldapUsername: { equals: action.targetUsername, mode: 'insensitive' as const } },
          { linkedAdUsername: { equals: action.targetUsername, mode: 'insensitive' as const } },
        ] };
        let ownershipMatches: Array<{ id: string }>;
        if (unmanaged) {
          ownershipMatches = await tx.accessRequest.findMany({
            where: { ...ownershipWhere, status: { not: 'rejected' } },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: 2,
          });
          if (ownershipMatches.length > 0 && body.outcome === 'confirmed_not_completed') {
            return { error: 'A portal request now owns this directory username; the surviving old object cannot be made retryable.', status: 409 as const };
          }
        } else if (batchGoverned) {
          if (
            !batchAccountItem
            || batchAccountItem.lifecycleOwnerKind !== 'batch_item'
            || batchAccountItem.accessRequestId
            || batchAccountItem.status !== 'completed'
            || !['AD', 'BOTH'].includes(batchAccountItem.accountType)
            || batchAccountItem.ldapUsername.trim().toLowerCase() !== canonicalUsername
            || batchAccountItem.targetDirectoryDn?.toLowerCase() !== action.targetDirectoryDn.toLowerCase()
            || batchAccountItem.targetDirectoryObjectGuid !== action.targetDirectoryObjectGuid
          ) {
            return { error: 'The owning batch item no longer has a lifecycle-ready binding to this AD account.', status: 409 as const };
          }
          ownershipMatches = await tx.batchAccountItem.findMany({
            where: {
              lifecycleOwnerKind: 'batch_item',
              accessRequestId: null,
              accountType: { in: ['AD', 'BOTH'] },
              status: { in: ['processing', 'completed', 'reconciliation_required'] },
              ldapUsername: { equals: action.targetUsername, mode: 'insensitive' },
              OR: [
                { id: batchAccountItem.id },
                { adAccountStatus: null },
                { adAccountStatus: { not: 'deleted' } },
              ],
            },
            select: { id: true },
            take: 2,
          });
          const requestMatches = await tx.accessRequest.findMany({
            where: { ...ownershipWhere, status: { not: 'rejected' } },
            select: { id: true },
            take: 1,
          });
          if (requestMatches.length > 0 || ownershipMatches.length !== 1 || ownershipMatches[0].id !== batchAccountItem.id) {
            return { error: 'This AD account no longer has one unambiguous lifecycle batch item.', status: 409 as const };
          }
        } else {
          if (!accessRequest) return { error: 'The owning access request is missing; deletion cannot be reconciled.', status: 409 as const };
          if (!isAccessRequestDirectoryIdentityConsistent(accessRequest)) {
            return { error: 'The owning access request contains conflicting AD identity aliases; deletion cannot be reconciled.', status: 409 as const };
          }
          const requestUsernames = [accessRequest.ldapUsername, accessRequest.linkedAdUsername]
            .filter((value): value is string => Boolean(value))
            .map((value) => value.trim().toLowerCase());
          if (!['approved', 'offboarded'].includes(accessRequest.status) || !isLifecycleProvisioningReady(accessRequest.provisioningState) || !requestUsernames.includes(canonicalUsername)) {
            return { error: 'The owning access request no longer has a lifecycle-ready binding to this AD account.', status: 409 as const };
          }
          ownershipMatches = await tx.accessRequest.findMany({
            where: { ...ownershipWhere, status: { notIn: ['rejected', 'offboarded'] } },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: 2,
          });
          if (ownershipMatches.length === 0) {
            ownershipMatches = await tx.accessRequest.findMany({ where: { ...ownershipWhere, status: 'offboarded' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 2 });
          }
          if (ownershipMatches.length !== 1 || ownershipMatches[0].id !== accessRequest.id) {
            return { error: 'This AD account no longer has one unambiguous lifecycle access request.', status: 409 as const };
          }
        }

        const directoryUser = await searchLDAPUserByObjectGuid(action.targetDirectoryObjectGuid);
        const previousSnapshot = action.resultSnapshot && typeof action.resultSnapshot === 'object' && !Array.isArray(action.resultSnapshot)
          ? action.resultSnapshot
          : {};
        const previousSafetyChecks = previousSnapshot.safetyChecks
          && typeof previousSnapshot.safetyChecks === 'object'
          && !Array.isArray(previousSnapshot.safetyChecks)
          ? previousSnapshot.safetyChecks
          : {};
        let resultSnapshot: Prisma.InputJsonObject;
        if (body.outcome === 'confirmed_completed') {
          if (directoryUser) {
            return { error: 'The captured directory object still exists; deletion cannot be certified complete.', status: 409 as const };
          }
          const governedState = batchGoverned ? batchAccountItem?.adAccountStatus : accessRequest?.adAccountStatus;
          if (!unmanaged && !['disabled', 'deleted'].includes(governedState ?? '')) {
            return { error: 'The portal account state changed after deletion; reconciliation will not overwrite it.', status: 409 as const };
          }
          resultSnapshot = {
            ...previousSnapshot,
            stage: 'reconciled_delete_confirmed',
            reconciliation: {
              reconciledAt: new Date().toISOString(),
              outcome: body.outcome,
              exists: false,
              objectGuid: action.targetDirectoryObjectGuid,
            },
            safetyChecks: {
              ...previousSafetyChecks,
              objectiveGuidAbsenceConfirmed: true,
              ownershipRevalidatedAtReconciliation: true,
              ...(unmanaged && ownershipMatches.length > 0 ? {
                ownershipDriftObservedAtReconciliation: true,
                supersedingOwnerSessionStateNotAppliedToCapturedGuid: true,
                observedUsernameSessionCount: liveSessions,
                observedIncompleteProviderLogoutCount: providerTasks.filter((task) => task.status !== 'completed').length,
              } : {
                sessionsAndProviderLogoutsSettledAtReconciliation: true,
                ...(unmanaged ? { ownershipDriftObservedAtReconciliation: false } : {}),
              }),
            },
          };
        } else {
          if (!directoryUser) {
            return { error: 'The captured directory object is absent; deletion cannot be certified as not completed.', status: 409 as const };
          }
          const username = directoryUser.attributes.find((attribute) => attribute.type.toLowerCase() === 'samaccountname')?.values?.[0] ?? '';
          const rawUserAccountControl = directoryUser.attributes.find(
            (attribute) => attribute.type.toLowerCase() === 'useraccountcontrol'
          )?.values?.[0] ?? '';
          if (!/^\d+$/u.test(rawUserAccountControl) || !Number.isSafeInteger(Number(rawUserAccountControl))) {
            return { error: 'The surviving directory object has an unreadable account-control state.', status: 409 as const };
          }
          if (
            directoryUser.objectName.toLowerCase() !== action.targetDirectoryDn.toLowerCase()
            || username.toLowerCase() !== action.targetUsername.toLowerCase()
            || ldapAccountIsEnabled(directoryUser.attributes)
          ) {
            return { error: 'The surviving directory object no longer matches the confirmed disabled target.', status: 409 as const };
          }
          await assertLifecycleAccountNotProtected(directoryUser);
          resultSnapshot = {
            ...previousSnapshot,
            stage: 'reconciled_delete_not_completed',
            reconciliation: {
              reconciledAt: new Date().toISOString(),
              outcome: body.outcome,
              exists: true,
              objectGuid: action.targetDirectoryObjectGuid,
              dn: action.targetDirectoryDn,
              username: action.targetUsername,
            },
            safetyChecks: {
              ...previousSafetyChecks,
              capturedGuidPresentAtExpectedIdentity: true,
              survivingObjectDisabled: true,
              survivingObjectProtectionPolicyPassed: true,
              sessionsAndProviderLogoutsSettledAtReconciliation: true,
              ownershipRevalidatedAtReconciliation: true,
            },
          };
        }

        const governedState = batchGoverned ? batchAccountItem?.adAccountStatus : accessRequest?.adAccountStatus;
        if (!unmanaged && body.outcome === 'confirmed_not_completed' && governedState !== 'disabled') {
          return { error: 'The portal account is no longer disabled; deletion cannot be made retryable.', status: 409 as const };
        }
        const ownerStateCas = unmanaged
          ? { count: 1 }
          : batchGoverned
            ? await tx.batchAccountItem.updateMany({
                where: {
                  id: batchAccountItem!.id,
                  version: batchAccountItem!.version,
                  lifecycleOwnerKind: 'batch_item',
                  accessRequestId: null,
                  status: 'completed',
                  adAccountStatus: batchAccountItem!.adAccountStatus,
                  ldapUsername: { equals: action.targetUsername, mode: 'insensitive' },
                },
                data: body.outcome === 'confirmed_completed' && batchAccountItem!.adAccountStatus === 'disabled'
                  ? { adAccountStatus: 'deleted', version: { increment: 1 } }
                  : { version: batchAccountItem!.version },
              })
            : await tx.accessRequest.updateMany({
                where: {
                  id: accessRequest!.id,
                  version: accessRequest!.version,
                  status: accessRequest!.status,
                  provisioningState: accessRequest!.provisioningState,
                  adAccountStatus: accessRequest!.adAccountStatus,
                  OR: [
                    { ldapUsername: { equals: action.targetUsername, mode: 'insensitive' } },
                    { linkedAdUsername: { equals: action.targetUsername, mode: 'insensitive' } },
                  ],
                },
                data: body.outcome === 'confirmed_completed' && accessRequest!.adAccountStatus === 'disabled'
                  ? { adAccountStatus: 'deleted', version: { increment: 1 } }
                  : { version: accessRequest!.version },
              });
        if (ownerStateCas.count !== 1) {
          return { error: 'The portal account ownership or state changed during reconciliation.', status: 409 as const };
        }

        const nextStatus = body.outcome === 'confirmed_completed' ? 'completed' : 'failed';
        const updated = await tx.accountLifecycleAction.updateMany({
          where: { id, status: 'reconciliation_required' },
          data: {
            status: nextStatus,
            claimId: null,
            claimedUntil: null,
            completedAt: nextStatus === 'completed' ? new Date() : action.completedAt,
            errorMessage: nextStatus === 'failed'
              ? 'External state confirmed not completed; action may be retried from a known state.'
              : action.errorMessage,
            resultSnapshot,
          },
        });
        if (updated.count !== 1) {
          return { error: 'This action is no longer awaiting reconciliation.', status: 409 as const };
        }
        await tx.accountLifecycleHistory.create({
          data: {
            actionId: id,
            event: 'reconciled',
            performedBy: admin.username,
            previousStatus: 'reconciliation_required',
            newStatus: nextStatus,
            details: JSON.stringify({ outcome: body.outcome, evidence, resultStage: resultSnapshot.stage }),
          },
        });
        if (!unmanaged && body.outcome === 'confirmed_completed' && (accessRequest || batchAccountItem)) {
          const activity = await tx.aDAccountActivityLog.findFirst({
            where: { lifecycleActionId: action.id, actionType: 'deleted' },
            select: { id: true },
          });
          if (!activity) {
            await tx.aDAccountActivityLog.create({
              data: {
                accountId: batchAccountItem?.id ?? accessRequest!.id,
                accountUsername: action.targetUsername,
                accountName: batchAccountItem?.name ?? accessRequest!.name,
                accountEmail: batchAccountItem?.email ?? accessRequest!.email,
                actionType: 'deleted',
                performedBy: admin.username,
                reason: action.reason,
                lifecycleActionId: action.id,
                notes: action.notes,
                ldapSuccess: true,
              },
            });
          }
          if (batchAccountItem) {
            const batchAudit = await tx.batchAuditLog.findFirst({
              where: { batchId: batchAccountItem.batchId, action: 'ad_account_deleted', details: { contains: action.id } },
              select: { id: true },
            });
            if (!batchAudit) await tx.batchAuditLog.create({
              data: {
                batchId: batchAccountItem.batchId,
                action: 'ad_account_deleted',
                details: `AD account "${action.targetUsername}" was confirmed permanently deleted during reconciliation of lifecycle action ${action.id}.`,
                performedBy: admin.username,
                accountName: action.targetUsername,
                success: true,
              },
            });
          } else if (accessRequest) {
            const comment = await tx.requestComment.findFirst({
              where: { requestId: accessRequest.id, type: 'ad_account_deleted', comment: { contains: action.id } },
              select: { id: true },
            });
            if (!comment) {
              await tx.requestComment.create({
                data: {
                  requestId: accessRequest.id,
                  author: admin.username,
                  type: 'ad_account_deleted',
                  comment: `Active Directory account ${action.targetUsername} was confirmed permanently deleted during reconciliation of lifecycle action ${action.id}.`,
                },
              });
            }
          }
        }
        await refreshReviewedDeletionPlanAggregate(tx, action.batchId);
        return { actionId: id, status: nextStatus };
      }, { maxWait: 30_000, timeout: 15 * 60 * 1000 });

      if ('error' in deleteReconciliation) {
        const httpStatus = deleteReconciliation.status === 404 ? 404 : 409;
        return NextResponse.json({ error: deleteReconciliation.error }, { status: httpStatus });
      }
      try {
        await logAuditAction({
          action: 'reconcile_lifecycle_action',
          category: AuditCategories.LIFECYCLE,
          username: admin.username,
          targetId: id,
          targetType: 'AccountLifecycleAction',
          relatedLifecycleActionId: id,
          eventKind: 'lifecycle',
          details: { operation: 'reconciliation', outcome: body.outcome, evidence },
          ipAddress: getIpAddress(request),
          userAgent: getUserAgent(request),
        });
      } catch (auditError) {
        // The deletion projection and lifecycle history committed together.
        // A secondary audit sink failure must not report that durable state as
        // failed or invite an operator to repeat reconciliation.
        appLogger.error(
          'Deletion reconciliation audit emission failed after transactional finalization',
          auditError,
          { actionId: id }
        );
      }
      return secureJsonResponse({ action: deleteReconciliation, message: 'Reconciliation outcome recorded. No external action was retried.' });
    }
    if (
      candidate.operationMode === 'batch_governed'
      && ['disable_ad', 'enable_ad'].includes(candidate.actionType)
    ) {
      const canonicalUsername = candidate.targetUsername.trim().toLowerCase();
      const batchReconciliation = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw<Array<{ lock_acquired: string }>>`
          SELECT 'locked'::text AS lock_acquired
          FROM pg_advisory_xact_lock(hashtextextended(${canonicalUsername}, 873211))
        `;
        const action = await tx.accountLifecycleAction.findUnique({ where: { id } });
        if (!action) return { error: 'Lifecycle action not found', status: 404 as const };
        if (action.status !== 'reconciliation_required') {
          return { error: 'This action is no longer awaiting reconciliation.', status: 409 as const };
        }
        if (
          !action.relatedBatchAccountItemId
          || action.relatedRequestId
          || !action.targetDirectoryObjectGuid
          || !action.targetDirectoryDn
          || !action.preflightSnapshot
          || typeof action.preflightSnapshot !== 'object'
          || Array.isArray(action.preflightSnapshot)
        ) {
          return { error: 'Batch lifecycle reconciliation is missing immutable ownership evidence.', status: 409 as const };
        }
        await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id"::text AS id FROM "BatchAccountItem"
          WHERE "id" = ${action.relatedBatchAccountItemId} FOR UPDATE
        `;
        const item = await tx.batchAccountItem.findUnique({ where: { id: action.relatedBatchAccountItemId } });
        const preflightVersion = action.preflightSnapshot.batchItemVersion;
        if (
          !item
          || item.lifecycleOwnerKind !== 'batch_item'
          || item.accessRequestId
          || item.status !== 'completed'
          || item.ldapUsername.trim().toLowerCase() !== canonicalUsername
          || item.targetDirectoryDn?.toLowerCase() !== action.targetDirectoryDn.toLowerCase()
          || item.targetDirectoryObjectGuid !== action.targetDirectoryObjectGuid
          || typeof preflightVersion !== 'number'
        ) {
          return { error: 'The batch account ownership or identity changed during reconciliation.', status: 409 as const };
        }
        const disabling = action.actionType === 'disable_ad';
        const [requestOwners, batchOwners, directoryUser, liveSessions, providerTasks] = await Promise.all([
          tx.accessRequest.findMany({
            where: { status: { not: 'rejected' }, OR: [
              { ldapUsername: { equals: action.targetUsername, mode: 'insensitive' } },
              { linkedAdUsername: { equals: action.targetUsername, mode: 'insensitive' } },
            ] },
            select: { id: true },
            take: 1,
          }),
          tx.batchAccountItem.findMany({
            where: {
              lifecycleOwnerKind: 'batch_item', accessRequestId: null,
              accountType: { in: ['AD', 'BOTH'] }, status: { in: ['processing', 'completed', 'reconciliation_required'] },
              ldapUsername: { equals: action.targetUsername, mode: 'insensitive' },
              OR: [
                { id: item.id },
                { adAccountStatus: null },
                { adAccountStatus: { not: 'deleted' } },
              ],
            },
            select: { id: true }, take: 2,
          }),
          searchLDAPUserByObjectGuid(action.targetDirectoryObjectGuid),
          tx.session.count({ where: { username: { equals: action.targetUsername, mode: 'insensitive' } } }),
          tx.providerLogoutTask.findMany({
            where: { username: { equals: action.targetUsername, mode: 'insensitive' } },
            select: { status: true },
          }),
        ]);
        if (requestOwners.length > 0 || batchOwners.length !== 1 || batchOwners[0].id !== item.id) {
          return { error: 'The batch account no longer has one unambiguous lifecycle owner.', status: 409 as const };
        }
        if (!directoryUser) {
          return { error: 'The captured directory object is absent; enable/disable reconciliation requires the same live object.', status: 409 as const };
        }
        if (
          disabling
          && body.outcome === 'confirmed_completed'
          && (liveSessions > 0 || providerTasks.some((task) => task.status !== 'completed'))
        ) {
          return { error: 'Session revocation and every provider logout must be complete before this disable action can be certified.', status: 409 as const };
        }
        await assertLifecycleAccountNotProtected(directoryUser);
        const username = directoryUser.attributes.find((attribute) => attribute.type.toLowerCase() === 'samaccountname')?.values?.[0] ?? '';
        const liveEnabled = ldapAccountIsEnabled(directoryUser.attributes);
        if (
          directoryUser.objectName.toLowerCase() !== action.targetDirectoryDn.toLowerCase()
          || username.trim().toLowerCase() !== canonicalUsername
        ) {
          return { error: 'The captured directory object no longer matches the confirmed batch account.', status: 409 as const };
        }
        const desiredEnabled = !disabling;
        const originalEnabled = disabling;
        const desiredPortalStatus = disabling ? 'disabled' : 'active';
        const originalPortalStatus = disabling ? 'active' : 'disabled';
        const confirmedComplete = body.outcome === 'confirmed_completed';
        if (liveEnabled !== (confirmedComplete ? desiredEnabled : originalEnabled)) {
          return { error: 'The live directory state does not match the selected reconciliation outcome.', status: 409 as const };
        }
        if (confirmedComplete) {
          if (item.version === preflightVersion && item.adAccountStatus === originalPortalStatus) {
            const projectedAt = new Date();
            const projected = await tx.batchAccountItem.updateMany({
              where: { id: item.id, version: preflightVersion, adAccountStatus: originalPortalStatus },
              data: disabling ? {
                adAccountStatus: 'disabled',
                adDisabledAt: projectedAt,
                adDisabledBy: admin.username,
                adDisabledReason: action.reason,
                version: { increment: 1 },
              } : {
                adAccountStatus: 'active',
                adEnabledAt: projectedAt,
                adEnabledBy: admin.username,
                version: { increment: 1 },
              },
            });
            if (projected.count !== 1) return { error: 'The batch lifecycle state changed during reconciliation.', status: 409 as const };
          } else if (!(item.version === preflightVersion + 1 && item.adAccountStatus === desiredPortalStatus)) {
            return { error: 'The batch lifecycle projection no longer matches the confirmed outcome.', status: 409 as const };
          }
        } else if (item.version !== preflightVersion || item.adAccountStatus !== originalPortalStatus) {
          return { error: 'The batch lifecycle state changed; the action cannot be made retryable.', status: 409 as const };
        }
        const nextStatus = confirmedComplete ? 'completed' : 'failed';
        const updated = await tx.accountLifecycleAction.updateMany({
          where: { id, status: 'reconciliation_required' },
          data: {
            status: nextStatus,
            claimId: null,
            claimedUntil: null,
            completedAt: confirmedComplete ? new Date() : action.completedAt,
            errorMessage: confirmedComplete
              ? action.errorMessage
              : 'External state confirmed not completed; action may be retried from a known state.',
            resultSnapshot: {
              stage: confirmedComplete ? 'batch_lifecycle_reconciled_completed' : 'batch_lifecycle_reconciled_not_completed',
              reconciliation: { outcome: body.outcome, evidence, objectGuid: action.targetDirectoryObjectGuid, enabled: liveEnabled },
            },
          },
        });
        if (updated.count !== 1) return { error: 'This action is no longer awaiting reconciliation.', status: 409 as const };
        await tx.accountLifecycleHistory.create({
          data: {
            actionId: id, event: 'reconciled', performedBy: admin.username,
            previousStatus: 'reconciliation_required', newStatus: nextStatus,
            details: JSON.stringify({ outcome: body.outcome, evidence, batchAccountItemId: item.id }),
          },
        });
        await refreshReviewedDeletionPlanAggregate(tx, action.batchId);
        return { actionId: id, status: nextStatus };
      }, { maxWait: 30_000, timeout: 15 * 60 * 1000 });

      if ('error' in batchReconciliation) {
        const errorStatus = typeof batchReconciliation.status === 'number' ? batchReconciliation.status : 409;
        return NextResponse.json({ error: batchReconciliation.error }, { status: errorStatus });
      }
      try {
        await logAuditAction({
          action: 'reconcile_lifecycle_action', category: AuditCategories.LIFECYCLE,
          username: admin.username, targetId: id, targetType: 'AccountLifecycleAction',
          relatedLifecycleActionId: id, eventKind: 'lifecycle',
          details: { operation: 'batch_directory_state_reconciliation', outcome: body.outcome, evidence },
          ipAddress: getIpAddress(request), userAgent: getUserAgent(request),
        });
      } catch (auditError) {
        appLogger.error('Batch lifecycle reconciliation audit emission failed after transactional finalization', auditError, { actionId: id });
      }
      return secureJsonResponse({ action: batchReconciliation, message: 'Batch lifecycle reconciliation recorded from the bound directory object.' });
    }
    if (body.outcome === 'confirmed_completed' && candidate.actionType === 'disable_ad') {
      const [liveSessions, providerTasks] = await Promise.all([
        prisma.session.count({ where: { username: candidate.targetUsername } }),
        prisma.providerLogoutTask.findMany({
          where: { username: candidate.targetUsername },
          select: { status: true },
        }),
      ]);
      if (liveSessions > 0 || providerTasks.some((task) => task.status !== 'completed')) {
        return NextResponse.json(
          { error: 'Session revocation and every provider logout must be complete before this disable action can be certified complete.' },
          { status: 409 }
        );
      }
    }
    const nextStatus = body.outcome === 'confirmed_completed' ? 'completed' : 'failed';
    const reconciled = await prisma.$transaction(async (tx) => {
      const action = await tx.accountLifecycleAction.findUnique({ where: { id } });
      if (!action) return null;
      if (action.status !== 'reconciliation_required') return { conflict: true as const };
      const updated = await tx.accountLifecycleAction.updateMany({
        where: { id, status: 'reconciliation_required' },
        data: {
          status: nextStatus,
          claimId: null,
          claimedUntil: null,
          completedAt: nextStatus === 'completed' ? new Date() : action.completedAt,
          errorMessage: nextStatus === 'failed' ? 'External state confirmed not completed; action may be retried from a known state.' : action.errorMessage,
        },
      });
      if (updated.count !== 1) return { conflict: true as const };
      await tx.accountLifecycleHistory.create({
        data: { actionId: id, event: 'reconciled', performedBy: admin.username, previousStatus: 'reconciliation_required', newStatus: nextStatus, details: JSON.stringify({ outcome: body.outcome, evidence }) },
      });
      if (action.batchId) {
        const batchActions = await tx.accountLifecycleAction.findMany({
          where: { batchId: action.batchId },
          select: { status: true },
        });
        const completedActions = batchActions.filter((item) => item.status === 'completed').length;
        const failedActions = batchActions.filter((item) => ['failed', 'reconciliation_required', 'cancelled'].includes(item.status)).length;
        const settled = completedActions + failedActions === batchActions.length;
        await tx.accountLifecycleBatch.update({
          where: { id: action.batchId },
          data: {
            completedActions,
            failedActions,
            status: settled
              ? (failedActions === 0 ? 'completed' : completedActions === 0 ? 'failed' : 'partial')
              : 'processing',
            completedAt: settled ? new Date() : null,
          },
        });
      }
      return { actionId: id, status: nextStatus };
    });
    if (!reconciled) return NextResponse.json({ error: 'Lifecycle action not found' }, { status: 404 });
    if ('conflict' in reconciled) return NextResponse.json({ error: 'This action is no longer awaiting reconciliation.' }, { status: 409 });
    await logAuditAction({
      action: 'reconcile_lifecycle_action',
      category: AuditCategories.LIFECYCLE,
      username: admin.username,
      targetId: id,
      targetType: 'AccountLifecycleAction',
      relatedLifecycleActionId: id,
      eventKind: 'lifecycle',
      details: { operation: 'reconciliation', outcome: body.outcome, evidence },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });
    return secureJsonResponse({ action: reconciled, message: 'Reconciliation outcome recorded. No external action was retried.' });
  } catch (error) {
    console.error('Error reconciling lifecycle action:', error);
    return NextResponse.json({ error: 'Failed to reconcile lifecycle action' }, { status: 500 });
  }
}
