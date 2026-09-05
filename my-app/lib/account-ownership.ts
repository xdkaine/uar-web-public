import type { LifecycleAccountInventoryItem } from './lifecycle-account-inventory';

/** Display provenance only. Lifecycle authorization always revalidates its own evidence. */
export interface AccountOwnershipSummary {
  ownerType: 'access_request' | 'batch_account' | null;
  ownerId: string | null;
  requestId: string | null;
  batchItemId: string | null;
  batchRunId: string | null;
  readiness: 'ready' | 'needs_review' | 'unowned' | 'unavailable';
  expectedSystems: Array<'AD' | 'VPN'> | null;
  requestHref: string | null;
  batchHref: string | null;
}

export interface OwnershipLinkAccess {
  requests: boolean;
  batches: boolean;
}

export function unavailableAccountOwnership(): AccountOwnershipSummary {
  return {
    ownerType: null, ownerId: null, requestId: null, batchItemId: null,
    batchRunId: null, readiness: 'unavailable', expectedSystems: null,
    requestHref: null, batchHref: null,
  };
}

export function summarizeAccountOwnership(
  account: Pick<LifecycleAccountInventoryItem, 'governance' | 'batchProvenance'>,
  access: OwnershipLinkAccess,
): AccountOwnershipSummary {
  const { governance, batchProvenance } = account;
  const batchRunId = batchProvenance?.batchId ?? null;
  const requestId = governance.requestId;
  const accountTypes = batchProvenance?.accountTypes ?? [];
  const expectedSystems: AccountOwnershipSummary['expectedSystems'] = governance.ownerType === 'batch_account'
    ? (['AD', 'VPN'] as const).filter((system) => accountTypes.includes(system) || accountTypes.includes('BOTH'))
    : null;
  return {
    ownerType: governance.ownerType,
    ownerId: governance.ownerId,
    requestId,
    batchItemId: governance.batchAccountItemId,
    batchRunId,
    readiness: governance.bindingPosture === 'conflict' ? 'needs_review'
      : governance.ownerType ? 'ready' : 'unowned',
    expectedSystems,
    requestHref: requestId && access.requests ? `/admin/requests/${encodeURIComponent(requestId)}` : null,
    batchHref: batchRunId && access.batches ? `/admin/batch-accounts/${encodeURIComponent(batchRunId)}` : null,
  };
}
