import { describe, expect, it, vi } from 'vitest';

import { refreshReviewedDeletionPlanAggregate } from './lifecycle-deletion-plan';

function transaction(batch: Record<string, unknown>, actions: Array<Record<string, unknown>>) {
  return {
    $queryRaw: vi.fn().mockResolvedValue([{ id: batch.id }]),
    accountLifecycleBatch: {
      findUnique: vi.fn().mockResolvedValue(batch),
      update: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...batch, ...data })),
    },
    accountLifecycleAction: { findMany: vi.fn().mockResolvedValue(actions) },
  };
}

describe('reviewed deletion plan aggregate', () => {
  it('derives not-attempted records from the immutable total, not caller input', async () => {
    const tx = transaction({
      id: 'plan-1', policyVersion: 'reviewed-lifecycle-deletion-plan-v1', totalActions: 3, resultSummary: null, completedAt: null,
    }, [{ status: 'completed', planOrdinal: 0, planTargetKey: 'a', actionType: 'delete_ad' }]);

    const result = await refreshReviewedDeletionPlanAggregate(tx as never, 'plan-1', { finalizationRequested: true });

    expect(result).toEqual(expect.objectContaining({ status: 'partial' }));
    expect(tx.accountLifecycleBatch.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        completedActions: 1,
        failedActions: 0,
        resultSummary: expect.objectContaining({ notAttempted: 2, derivedFromPersistedActions: true }),
      }),
    }));
  });

  it('keeps a plan paused while any child requires reconciliation', async () => {
    const tx = transaction({
      id: 'plan-1', policyVersion: 'reviewed-lifecycle-deletion-plan-v1', totalActions: 2, resultSummary: { finalizationRequested: true }, completedAt: null,
    }, [
      { status: 'completed', planOrdinal: 0, planTargetKey: 'a', actionType: 'delete_vpn_record' },
      { status: 'reconciliation_required', planOrdinal: 1, planTargetKey: 'a', actionType: 'delete_ad' },
    ]);

    const result = await refreshReviewedDeletionPlanAggregate(tx as never, 'plan-1');

    expect(result).toEqual(expect.objectContaining({ status: 'reconciliation_required' }));
  });

  it('recomputes a successful retry without incrementing stale failure counters', async () => {
    const tx = transaction({
      id: 'plan-1', policyVersion: 'reviewed-lifecycle-deletion-plan-v1', totalActions: 1,
      completedActions: 2, failedActions: 1, resultSummary: { finalizationRequested: true }, completedAt: new Date(),
    }, [{ status: 'completed', planOrdinal: 0, planTargetKey: 'a', actionType: 'delete_ad' }]);

    const result = await refreshReviewedDeletionPlanAggregate(tx as never, 'plan-1');

    expect(result).toEqual(expect.objectContaining({ status: 'completed', completedActions: 1, failedActions: 0 }));
  });
});
