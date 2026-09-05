import { describe, expect, it } from 'vitest';

import { BATCH_OWNERSHIP_CONFIRMATION } from './batchAccountConfirmation';

describe('batch ownership confirmation', () => {
  it('names batch-item ownership without claiming a request is created', () => {
    expect(BATCH_OWNERSHIP_CONFIRMATION).toContain('creation batch');
    expect(BATCH_OWNERSHIP_CONFIRMATION).toContain('completed account item');
    expect(BATCH_OWNERSHIP_CONFIRMATION).not.toContain('request ID');
  });
});
