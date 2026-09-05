import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  new URL('../../prisma/migrations/20260831140000_fix_default_faculty_handoff_copy/migration.sql', import.meta.url),
  'utf8'
);

describe('faculty handoff default copy migration', () => {
  it('uses exact full-body equality and never rewrites customized or archived revisions', () => {
    expect(sql).toContain('template."body" = legacy_default.body');
    expect(sql).toContain('revision."body" = legacy_default.body');
    expect(sql).toContain('revision."status" IN (\'published\', \'draft\')');
    expect(sql).not.toMatch(/\bLIKE\b/i);
    expect(sql).not.toContain("'archived'");
  });

  it('adds the conditional completion request to both the body and variable catalog', () => {
    expect(sql).toContain('{{completionRequest}}');
    expect(sql).toContain('"completionRequest"');
  });
});
