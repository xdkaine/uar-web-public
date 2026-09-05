import { describe, expect, it } from 'vitest';

import { isLifecycleProvisioningReady } from './access-request-lifecycle-readiness';

describe('isLifecycleProvisioningReady', () => {
  it.each([
    null,
    'succeeded',
    'completed',
    'activation_email_pending',
    'credentials_email_pending',
  ])('accepts terminal state %s', (state) => {
    expect(isLifecycleProvisioningReady(state)).toBe(true);
  });

  it.each([
    'in_progress',
    'approval_in_progress',
    'reconciliation_pending',
    'reconciliation_required',
    'approval_failed',
    'approval_email_sending',
  ])('rejects active or failed state %s', (state) => {
    expect(isLifecycleProvisioningReady(state)).toBe(false);
  });
});
