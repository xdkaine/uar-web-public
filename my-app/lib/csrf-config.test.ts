import { describe, expect, it } from 'vitest';
import { isCsrfExempt, requiresCsrfValidation } from './csrf-config';

describe('cron CSRF policy', () => {
  it('lets bearer-authenticated cron routes bypass browser CSRF validation', () => {
    expect(isCsrfExempt('/api/cron/process-offboard-campaigns')).toBe(true);
    expect(requiresCsrfValidation('POST')).toBe(true);
  });
});
