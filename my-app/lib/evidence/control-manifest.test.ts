import { existsSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { CONTROL_MANIFEST, validateControlManifest } from './control-manifest';

describe('CONTROL_MANIFEST', () => {
  it('is internally consistent', () => {
    const result = validateControlManifest();
    expect(result).toEqual({ ok: true });
  });

  it('has unique stable control ids', () => {
    const ids = CONTROL_MANIFEST.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      // Stable id format keeps cross-release references meaningful.
      expect(id).toMatch(/^IT(GC|AC)-[A-Z]{2}-\d{2}$/);
    }
  });

  it('maps every control to test files that exist in the repository', () => {
    // my-app root: lib/, app/, components/ all resolve relative to here.
    const repoRoot = process.cwd();

    for (const entry of CONTROL_MANIFEST) {
      for (const testFile of entry.testFiles) {
        const absolute = join(repoRoot, testFile);
        expect(
          existsSync(absolute),
          `${entry.id} references missing proof file ${testFile}`
        ).toBe(true);
      }
    }
  });

  it('covers the protected security boundaries with named controls', () => {
    const names = CONTROL_MANIFEST.map((entry) => entry.name);
    expect(names.some((name) => name.toLowerCase().includes('session cookie'))).toBe(true);
    expect(names.some((name) => name.toLowerCase().includes('csrf'))).toBe(true);
    expect(names.some((name) => name.toLowerCase().includes('audit log'))).toBe(true);
  });

  it('classifies every entry into a known control class', () => {
    const validClasses = new Set(['itgc_access', 'itgc_change', 'itac_governance']);
    for (const entry of CONTROL_MANIFEST) {
      expect(validClasses.has(entry.controlClass)).toBe(true);
    }
  });
});
