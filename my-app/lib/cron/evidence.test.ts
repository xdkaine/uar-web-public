import { describe, expect, it } from 'vitest';

import { projectCronRunForAudit, projectSafeCronDetail } from './evidence';

describe('cron audit evidence projection', () => {
  it('keeps only bounded structured result fields', () => {
    const detail = projectSafeCronDetail({
      outcome: 'success',
      itemsProcessed: 3,
      correlationId: 'a9b3a0d4-1f26-4f4f-80a0-83346be52383',
      detail: {
        retentionDays: 7,
        reachable: false,
        target: 'ldaps://private.example:636',
        error: 'bind failed for CN=Real User,OU=Secret',
        emitted: { summaries: [{ ruleName: 'private' }] },
        outbox: { processed: 2, failed: 0, lastError: 'secret' },
      },
    });

    expect(detail).toEqual({
      evidenceVersion: 1,
      summary: 'Scheduled job completed and processed 3 item(s).',
      correlationId: 'a9b3a0d4-1f26-4f4f-80a0-83346be52383',
      retentionDays: 7,
      reachable: false,
      outbox: { processed: 2, failed: 0 },
    });
    expect(JSON.stringify(detail)).not.toMatch(/private|CN=|bind failed|ruleName|lastError/);
  });

  it('reprojects legacy rows instead of trusting stored JSON', () => {
    const projected = projectCronRunForAudit({
      id: 'run-1',
      outcome: 'failed',
      itemsProcessed: 0,
      errorClass: 'ldap_error',
      detail: { error: 'raw LDAP detail', summary: 'unsafe override', token: 'secret' },
    });

    expect(projected.detail).toEqual({
      evidenceVersion: 1,
      summary: 'Scheduled job failed with ldap_error.',
    });
  });
});
