import { KNOWN_REVIEWER_ROLE_KEYS } from '@/lib/rbac/permissions';

/**
 * Constrained governance workflow model (roadmap §8): not a generic engine.
 * Stages are selected from a fixed catalog keyed to the existing request
 * status machine, so configuration can choose WHICH stages run, their display
 * names, their required reviewer role, and their notification recipients -
 * while transitions remain code-enforced and auditable.
 */

export type WorkflowStageKey = 'student_directors' | 'faculty';

export interface WorkflowStageCatalogEntry {
  /** AccessRequest.status value this stage maps to. */
  status: string;
  /** Default display label (matches the pre-configuration UI wording). */
  defaultLabel: string;
  /** Role key whose holders may act on this stage (lib/rbac). */
  reviewerRoleKey: string;
}

export const WORKFLOW_STAGE_CATALOG: Record<WorkflowStageKey, WorkflowStageCatalogEntry> = {
  student_directors: {
    status: 'pending_student_directors',
    defaultLabel: 'Pending Directors',
    reviewerRoleKey: 'director',
  },
  faculty: {
    status: 'pending_faculty',
    defaultLabel: 'Pending Faculty',
    reviewerRoleKey: 'faculty',
  },
};

export interface WorkflowStageConfig {
  key: WorkflowStageKey;
  label: string;
  reviewerRoleKey: string;
  /**
   * Notification recipients for stage events. null/undefined means "resolve
   * through the legacy SystemSettings email configuration", which preserves
   * current recipient behavior until operators configure routing here.
   */
  notifyEmails?: string[] | null;
}

export const DEFAULT_STANDARD_WORKFLOW_STAGES: WorkflowStageConfig[] = [
  {
    key: 'student_directors',
    label: WORKFLOW_STAGE_CATALOG.student_directors.defaultLabel,
    reviewerRoleKey: WORKFLOW_STAGE_CATALOG.student_directors.reviewerRoleKey,
    notifyEmails: null,
  },
  {
    key: 'faculty',
    label: WORKFLOW_STAGE_CATALOG.faculty.defaultLabel,
    reviewerRoleKey: WORKFLOW_STAGE_CATALOG.faculty.reviewerRoleKey,
    notifyEmails: null,
  },
];

export interface ValidatedWorkflowStages {
  ok: true;
  stages: WorkflowStageConfig[];
}

export interface InvalidWorkflowStages {
  ok: false;
  error: string;
}

function isValidLabel(label: unknown): label is string {
  return typeof label === 'string' && label.trim().length > 0 && label.trim().length <= 80;
}

function isValidNotifyEmails(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (!Array.isArray(value)) return false;
  return value.every(
    (entry) =>
      typeof entry === 'string' &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(entry.trim().toLowerCase())
  );
}

/** Validates an untrusted stages payload against the catalog. */
export function validateWorkflowStages(raw: unknown): ValidatedWorkflowStages | InvalidWorkflowStages {
  if (!Array.isArray(raw)) {
    return { ok: false, error: 'Workflow stages must be an array' };
  }
  if (raw.length === 0 || raw.length > Object.keys(WORKFLOW_STAGE_CATALOG).length) {
    return {
      ok: false,
      error: `Workflow must contain between 1 and ${Object.keys(WORKFLOW_STAGE_CATALOG).length} stages`,
    };
  }

  const seenKeys = new Set<string>();
  const stages: WorkflowStageConfig[] = [];

  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') {
      return { ok: false, error: 'Each workflow stage must be an object' };
    }
    const candidate = entry as Record<string, unknown>;
    const key = candidate.key;
    if (typeof key !== 'string' || !Object.prototype.hasOwnProperty.call(WORKFLOW_STAGE_CATALOG, key)) {
      return { ok: false, error: `Unknown workflow stage key: ${String(key)}` };
    }
    if (seenKeys.has(key)) {
      return { ok: false, error: `Duplicate workflow stage key: ${key}` };
    }
    seenKeys.add(key);

    if (!isValidLabel(candidate.label)) {
      return { ok: false, error: `Stage "${key}" needs a display label of 1-80 characters` };
    }
    if (
      typeof candidate.reviewerRoleKey !== 'string' ||
      !KNOWN_REVIEWER_ROLE_KEYS.includes(candidate.reviewerRoleKey.trim() as never)
    ) {
      return {
        ok: false,
        error: `Stage "${key}" reviewer role must be one of: ${KNOWN_REVIEWER_ROLE_KEYS.join(', ')}`,
      };
    }
    if (!isValidNotifyEmails(candidate.notifyEmails)) {
      return { ok: false, error: `Stage "${key}" notify emails must be valid addresses` };
    }

    stages.push({
      key: key as WorkflowStageKey,
      label: candidate.label.trim(),
      reviewerRoleKey: candidate.reviewerRoleKey.trim(),
      notifyEmails: Array.isArray(candidate.notifyEmails)
        ? (candidate.notifyEmails as string[]).map((email) => email.trim().toLowerCase())
        : null,
    });
  }

  return { ok: true, stages };
}

/**
 * Parses the active default defensively for unpinned legacy requests. Pinned
 * definitions must use validateWorkflowStages directly and fail closed.
 */
export function parseStoredStages(raw: unknown): WorkflowStageConfig[] {
  const result = validateWorkflowStages(raw);
  return result.ok ? result.stages : DEFAULT_STANDARD_WORKFLOW_STAGES;
}
