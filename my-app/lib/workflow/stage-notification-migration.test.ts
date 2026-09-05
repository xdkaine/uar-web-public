import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  new URL('../../prisma/migrations/20260831150000_add_stage_notification_reconciliation/migration.sql', import.meta.url),
  'utf8'
);

describe('configured stage notification reconciliation migration', () => {
  it('is additive and leaves existing requests unchanged', () => {
    expect(sql).toContain('ADD COLUMN "stageNotificationState" TEXT');
    expect(sql).toContain('ADD COLUMN "stageNotificationStageKey" TEXT');
    expect(sql).toContain('ADD COLUMN "stageNotificationError" TEXT');
    expect(sql).toContain('ADD COLUMN "stageNotificationStateChangedAt" TIMESTAMP(3)');
    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(sql).not.toMatch(/\bUPDATE\b/i);
    expect(sql).not.toMatch(/\bDEFAULT\b/i);
  });

  it('indexes unresolved notification state for operator recovery queries', () => {
    expect(sql).toContain('CREATE INDEX "AccessRequest_stageNotificationState_idx"');
  });
});
