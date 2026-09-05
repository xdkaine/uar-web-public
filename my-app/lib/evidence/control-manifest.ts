/**
 * Control self-test catalog (roadmap §11 control assertions, bounded slice).
 *
 * Each entry maps a named ITGC/ITAC-relevant control to the executable
 * regression tests that continuously verify its design. This is a
 * documentation-of-design artifact: it does NOT execute tests at runtime and
 * grants no permissions. The Evidence & Operations panel renders it so an
 * auditor can trace "how do we know this control works?" to concrete,
 * always-run test files instead of screenshots.
 *
 * Rules:
 * - Every control id is stable once published; never rename, only add.
 * - testFiles are repository paths relative to my-app/ and must exist
 *   (enforced by control-manifest.test.ts).
 * - Assertions describe what the tests prove in control language.
 */

export type ControlClass = 'itgc_access' | 'itgc_change' | 'itac_governance';

export interface ControlManifestEntry {
  /** Stable control identifier, e.g. ITGC-AC-01. Never reused. */
  id: string;
  name: string;
  /** What the control asserts, in walkthrough language. */
  assertion: string;
  /** Executable proof: regression test files that must keep passing. */
  testFiles: string[];
  controlClass: ControlClass;
}

export const CONTROL_MANIFEST: ControlManifestEntry[] = [
  {
    id: 'ITGC-AC-01',
    name: 'Session cookie protection',
    assertion:
      'Session cookies are always issued with Secure, HttpOnly, and SameSite protections and never weakened on any code path.',
    testFiles: ['lib/session-cookie-policy.test.ts'],
    controlClass: 'itgc_access',
  },
  {
    id: 'ITGC-AC-02',
    name: 'CSRF cookie policy',
    assertion:
      'CSRF cookies carry equivalent protections to session cookies and are refreshed under the documented policy.',
    testFiles: ['lib/csrf-cookie-policy.test.ts'],
    controlClass: 'itgc_access',
  },
  {
    id: 'ITGC-AC-03',
    name: 'CSRF validation coverage',
    assertion:
      'State-changing requests require CSRF validation except for explicitly enumerated exempt paths; exemptions cannot silently widen.',
    testFiles: ['lib/csrf-config.test.ts', 'middleware.test.ts'],
    controlClass: 'itgc_access',
  },
  {
    id: 'ITGC-AC-04',
    name: 'Open-redirect prevention',
    assertion:
      'Post-authentication redirects accept only same-origin, allowlisted destinations; absolute and protocol-relative URLs are rejected.',
    testFiles: ['lib/safe-redirect.test.ts'],
    controlClass: 'itgc_access',
  },
  {
    id: 'ITGC-AU-01',
    name: 'Audit log redaction',
    assertion:
      'Audit details are sanitized before persistence: passwords, tokens, secrets, and authorization headers never reach durable evidence.',
    testFiles: ['lib/audit-log.test.ts'],
    controlClass: 'itgc_change',
  },
  {
    id: 'ITGC-AU-02',
    name: 'CSV injection protection',
    assertion:
      'Generated CSV content neutralizes formula injection and honors RFC 4180 escaping for exported evidence.',
    testFiles: ['lib/csv-security.test.ts'],
    controlClass: 'itgc_change',
  },
  {
    id: 'ITGC-CM-01',
    name: 'Configuration secret isolation',
    assertion:
      'Secret credentials resolve only from encrypted storage or environment fallback; ordinary configuration rows can never hold plaintext secrets.',
    testFiles: ['lib/config/resolver.test.ts', 'lib/config/revisions.test.ts'],
    controlClass: 'itgc_change',
  },
  {
    id: 'ITGC-CM-02',
    name: 'Module registry integrity',
    assertion:
      'Capability modules are code-defined with dependency metadata; runtime state defaults to enabled and unknown ids fail open to current behavior.',
    testFiles: ['lib/modules/core.test.ts', 'lib/modules/registry.test.ts'],
    controlClass: 'itgc_change',
  },
  {
    id: 'ITAC-GV-01',
    name: 'Permission catalog integrity',
    assertion:
      'Role definitions may only grant permissions registered in the code-defined catalog; stored roles referencing unknown keys are filtered before authorization decisions.',
    testFiles: ['lib/rbac/core.test.ts'],
    controlClass: 'itac_governance',
  },
  {
    id: 'ITAC-GV-02',
    name: 'Workflow version pinning',
    assertion:
      'Requests remain governed by the workflow version they were submitted under; publishing new versions cannot alter in-flight governance.',
    testFiles: ['lib/workflow/core.test.ts'],
    controlClass: 'itac_governance',
  },
];

/** Validates manifest integrity; used by tests and the read endpoint. */
export function validateControlManifest(
  manifest: ControlManifestEntry[] = CONTROL_MANIFEST
): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const seenIds = new Set<string>();

  for (const entry of manifest) {
    if (!entry.id || seenIds.has(entry.id)) {
      errors.push(`Duplicate or missing control id: ${entry.id}`);
    }
    seenIds.add(entry.id);
    if (entry.testFiles.length === 0) {
      errors.push(`Control ${entry.id} has no executable proof (testFiles)`);
    }
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}
