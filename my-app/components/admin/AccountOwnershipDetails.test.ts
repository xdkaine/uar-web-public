import { describe, expect, it } from 'vitest';

import { ownershipPresentation } from './accountOwnershipPresentation';

describe('ownershipPresentation', () => {
  it('fails closed when an older response omits ownership', () => {
    expect(ownershipPresentation(undefined)).toMatchObject({
      label: 'Ownership unavailable',
      tone: 'muted',
      primaryId: null,
    });
  });

  it('shows a standalone batch owner without fabricating a request', () => {
    expect(ownershipPresentation({
      ownerType: 'batch_account',
      ownerId: 'batch-item-7',
      requestId: null,
      batchItemId: 'batch-item-7',
      batchRunId: 'batch-run-3',
      readiness: 'ready',
      expectedSystems: ['AD', 'VPN'],
      requestHref: null,
      batchHref: '/admin/batch-accounts/batch-run-3',
    })).toMatchObject({
      label: 'Batch account',
      primaryId: 'batch-run-3',
      secondaryId: 'batch-item-7',
      primaryLabel: 'Batch run ID',
    });
  });

  it('treats an explicitly unowned directory account as informational', () => {
    expect(ownershipPresentation({
      ownerType: null, ownerId: null, requestId: null, batchItemId: null, batchRunId: null,
      readiness: 'unowned', expectedSystems: null, requestHref: null, batchHref: null,
    })).toMatchObject({ label: 'No portal owner', tone: 'muted' });
  });
});
