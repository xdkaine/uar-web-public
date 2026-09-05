import type { Prisma } from '@prisma/client';

export const REVIEWED_DELETION_PLAN_POLICY_VERSION = 'reviewed-lifecycle-deletion-plan-v1';

export async function refreshReviewedDeletionPlanAggregate(
  tx: Prisma.TransactionClient,
  batchId: string | null,
  options: { finalizationRequested?: boolean } = {}
) {
  if (!batchId) return null;
  await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"::text AS id
    FROM "AccountLifecycleBatch"
    WHERE "id" = ${batchId}
    FOR UPDATE
  `;
  const batch = await tx.accountLifecycleBatch.findUnique({ where: { id: batchId } });
  if (!batch || batch.policyVersion !== REVIEWED_DELETION_PLAN_POLICY_VERSION) return null;
  const actions = await tx.accountLifecycleAction.findMany({
    where: { batchId },
    select: { status: true, planOrdinal: true, planTargetKey: true, actionType: true },
  });
  const completed = actions.filter((item) => item.status === 'completed').length;
  const failed = actions.filter((item) => ['failed', 'cancelled'].includes(item.status)).length;
  const reconciliationRequired = actions.filter((item) => item.status === 'reconciliation_required').length;
  const queuedOrProcessing = actions.filter((item) => ['pending', 'queued', 'processing'].includes(item.status)).length;
  const notAttempted = Math.max(batch.totalActions - actions.length, 0);
  const previous = batch.resultSummary && typeof batch.resultSummary === 'object' && !Array.isArray(batch.resultSummary)
    ? batch.resultSummary
    : {};
  const finalizationRequested = options.finalizationRequested === true || previous.finalizationRequested === true;
  const everyPlannedActionExists = actions.length === batch.totalActions;
  const shouldSettle = queuedOrProcessing === 0
    && reconciliationRequired === 0
    && (finalizationRequested || everyPlannedActionExists);
  const status = reconciliationRequired > 0
    ? 'reconciliation_required'
    : queuedOrProcessing > 0
      ? 'processing'
      : !shouldSettle
        ? 'processing'
        : completed === batch.totalActions
          ? 'completed'
          : completed === 0
            ? 'failed'
            : 'partial';
  const terminal = ['completed', 'failed', 'partial'].includes(status);
  const resultSummary: Prisma.InputJsonObject = {
    completed,
    failed,
    reconciliationRequired,
    queuedOrProcessing,
    notAttempted,
    finalizationRequested,
    derivedFromPersistedActions: true,
    calculatedAt: new Date().toISOString(),
  };
  return tx.accountLifecycleBatch.update({
    where: { id: batchId },
    data: {
      completedActions: completed + failed,
      failedActions: failed,
      status,
      resultSummary,
      completedAt: terminal ? batch.completedAt ?? new Date() : null,
    },
  });
}
