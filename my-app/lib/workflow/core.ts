import { prisma } from '@/lib/prisma';
import {
  DEFAULT_STANDARD_WORKFLOW_STAGES,
  validateWorkflowStages,
  WORKFLOW_STAGE_CATALOG,
  type WorkflowStageConfig,
} from './schema';

export const STANDARD_REQUEST_TYPE_KEY = 'standard_access';

export interface ResolvedWorkflow {
  /** Database definition id, or null when running on built-in defaults. */
  id: string | null;
  requestTypeKey: string;
  version: number;
  stages: WorkflowStageConfig[];
  source: 'pinned' | 'legacy_active' | 'builtin';
  integrity: 'valid' | 'missing_definition' | 'corrupt_definition' | 'request_type_mismatch' | 'invalid_definition_status';
  integrityMessage?: string;
}

const BUILTIN_WORKFLOW: ResolvedWorkflow = {
  id: null,
  requestTypeKey: STANDARD_REQUEST_TYPE_KEY,
  version: 0,
  stages: DEFAULT_STANDARD_WORKFLOW_STAGES,
  source: 'builtin',
  integrity: 'valid',
};

let cachedActive: { workflow: ResolvedWorkflow; at: number } | null = null;
const CACHE_TTL = 30000;

export function clearWorkflowCache(): void {
  cachedActive = null;
}

/**
 * The published workflow currently used for NEW requests. Falls back to the
 * built-in default (identical to migration seed v1) when no configuration
 * exists yet or the store is unreadable, preserving pre-migration behavior.
 */
export async function getActiveWorkflow(
  requestTypeKey: string = STANDARD_REQUEST_TYPE_KEY
): Promise<ResolvedWorkflow> {
  if (
    requestTypeKey === STANDARD_REQUEST_TYPE_KEY &&
    cachedActive &&
    Date.now() - cachedActive.at < CACHE_TTL
  ) {
    return cachedActive.workflow;
  }

  try {
    const definition = await prisma.workflowDefinition.findFirst({
      where: { requestTypeKey, status: 'published' },
      orderBy: { version: 'desc' },
    });

    // Only PUBLISHED definitions may govern new requests. Archived history
    // alone must never resurrect as active; with no published version we run
    // on the built-in defaults (identical to migration seed v1).

    const parsed = definition ? validateWorkflowStages(definition.stages) : null;
    const resolved: ResolvedWorkflow = definition && parsed?.ok
      ? {
          id: definition.id,
          requestTypeKey,
          version: definition.version,
          stages: parsed.stages,
          source: 'legacy_active',
          integrity: 'valid',
        }
      : BUILTIN_WORKFLOW;

    if (requestTypeKey === STANDARD_REQUEST_TYPE_KEY) {
      cachedActive = { workflow: resolved, at: Date.now() };
    }
    return resolved;
  } catch (error) {
    console.error('[Workflow] Failed to resolve active workflow, using defaults:', error);
    return BUILTIN_WORKFLOW;
  }
}

/**
 * Resolve the workflow a specific request is governed by. Requests created
 * before workflow pinning existed have workflowVersionId = null and run on
 * the active/built-in default - which matches what governed them originally.
 * A non-null pin is never substituted: missing, corrupt, or incompatible
 * definitions return an empty-stage integrity result so callers fail closed.
 */
export async function resolveWorkflowForRequest(request: {
  workflowVersionId?: string | null;
  requestTypeKey?: string | null;
}): Promise<ResolvedWorkflow> {
  if (!request.workflowVersionId) {
    return getActiveWorkflow();
  }

  try {
    const definition = await prisma.workflowDefinition.findUnique({
      where: { id: request.workflowVersionId },
    });
    if (definition) {
      if (!['published', 'archived'].includes(definition.status)) {
        return {
          id: definition.id,
          requestTypeKey: definition.requestTypeKey,
          version: definition.version,
          stages: [],
          source: 'pinned',
          integrity: 'invalid_definition_status',
          integrityMessage: 'The pinned review workflow is not an immutable published version. Reconcile this request before taking action.',
        };
      }
      const parsed = validateWorkflowStages(definition.stages);
      if (!parsed.ok) {
        return {
          id: definition.id,
          requestTypeKey: definition.requestTypeKey,
          version: definition.version,
          stages: [],
          source: 'pinned',
          integrity: 'corrupt_definition',
          integrityMessage: 'The pinned review workflow is unreadable. Reconcile this request before taking action.',
        };
      }
      if (
        request.requestTypeKey &&
        request.requestTypeKey !== definition.requestTypeKey
      ) {
        return {
          id: definition.id,
          requestTypeKey: definition.requestTypeKey,
          version: definition.version,
          stages: [],
          source: 'pinned',
          integrity: 'request_type_mismatch',
          integrityMessage: 'The pinned review workflow does not match this request type. Reconcile this request before taking action.',
        };
      }
      return {
        id: definition.id,
        requestTypeKey: definition.requestTypeKey,
        version: definition.version,
        stages: parsed.stages,
        source: 'pinned',
        integrity: 'valid',
      };
    }
  } catch (error) {
    console.error('[Workflow] Failed to load pinned workflow:', error);
  }

  return {
    id: request.workflowVersionId,
    requestTypeKey: request.requestTypeKey || STANDARD_REQUEST_TYPE_KEY,
    version: 0,
    stages: [],
    source: 'pinned',
    integrity: 'missing_definition',
    integrityMessage: 'The pinned review workflow is unavailable. Reconcile this request before taking action.',
  };
}

export function workflowIntegrityConflict(workflow: ResolvedWorkflow): string | null {
  return !workflow.integrity || workflow.integrity === 'valid'
    ? null
    : workflow.integrityMessage || 'The pinned review workflow requires reconciliation before taking action.';
}

export function stageStatus(stage: WorkflowStageConfig): string {
  return WORKFLOW_STAGE_CATALOG[stage.key].status;
}

/** The status requests land in after email verification. */
export function firstReviewStatus(stages: WorkflowStageConfig[]): string {
  return stageStatus(stages[0]);
}

export function findStageIndexByStatus(
  stages: WorkflowStageConfig[],
  status: string
): number {
  return stages.findIndex((stage) => stageStatus(stage) === status);
}

export function isFinalStageStatus(stages: WorkflowStageConfig[], status: string): boolean {
  return stages.length > 0 && findStageIndexByStatus(stages, status) === stages.length - 1;
}

/** Status of the stage following `status`; null when it is the final stage. */
export function nextReviewStatusAfter(
  stages: WorkflowStageConfig[],
  status: string
): string | null {
  const index = findStageIndexByStatus(stages, status);
  if (index === -1 || index + 1 >= stages.length) {
    return null;
  }
  return stageStatus(stages[index + 1]);
}

/**
 * Whether the legacy two-stage handoff actions (send-to-faculty,
 * notify-faculty, return-to-faculty, move-back) apply to this workflow. They
 * require the exact directors -> faculty shape.
 */
export function supportsFacultyHandoffActions(stages: WorkflowStageConfig[]): boolean {
  return (
    stages.length === 2 &&
    stages[0].key === 'student_directors' &&
    stages[1].key === 'faculty'
  );
}

/**
 * Stage-level notification recipients (ADR-0002): a stage's explicit
 * notifyEmails list wins; otherwise the caller's fallback (the global email
 * configuration) applies. Results are deduplicated and lowercased.
 */
export async function resolveStageNotificationRecipients(
  stage: WorkflowStageConfig | undefined,
  fallback: () => Promise<string[]>
): Promise<string[]> {
  const explicit = (stage?.notifyEmails ?? [])
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  if (explicit.length > 0) {
    return Array.from(new Set(explicit));
  }
  return fallback();
}
