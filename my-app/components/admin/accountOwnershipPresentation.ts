import type { AccountOwnershipSummary } from '@/lib/account-ownership';

export type OwnershipTone = 'positive' | 'muted' | 'danger';

export interface OwnershipPresentation {
  label: string;
  tone: OwnershipTone;
  primaryLabel: 'Request ID' | 'Batch run ID' | null;
  primaryId: string | null;
  secondaryLabel: 'Batch item ID' | 'Batch run ID' | null;
  secondaryId: string | null;
}

export function ownershipPresentation(
  ownership: AccountOwnershipSummary | null | undefined,
): OwnershipPresentation {
  if (!ownership || ownership.readiness === 'unavailable') {
    return { label: 'Ownership unavailable', tone: 'muted', primaryLabel: null, primaryId: null, secondaryLabel: null, secondaryId: null };
  }
  if (ownership.readiness === 'needs_review') {
    return { label: 'Needs ownership review', tone: 'danger', primaryLabel: ownership.requestId ? 'Request ID' : ownership.batchRunId ? 'Batch run ID' : null, primaryId: ownership.requestId ?? ownership.batchRunId, secondaryLabel: ownership.batchItemId ? 'Batch item ID' : null, secondaryId: ownership.batchItemId };
  }
  if (ownership.ownerType === 'access_request') {
    return { label: 'Access request', tone: 'positive', primaryLabel: ownership.requestId ? 'Request ID' : null, primaryId: ownership.requestId, secondaryLabel: ownership.batchRunId ? 'Batch run ID' : null, secondaryId: ownership.batchRunId };
  }
  if (ownership.ownerType === 'batch_account') {
    return { label: 'Batch account', tone: 'positive', primaryLabel: ownership.batchRunId ? 'Batch run ID' : null, primaryId: ownership.batchRunId, secondaryLabel: ownership.batchItemId ? 'Batch item ID' : null, secondaryId: ownership.batchItemId };
  }
  return { label: 'No portal owner', tone: 'muted', primaryLabel: null, primaryId: null, secondaryLabel: null, secondaryId: null };
}
