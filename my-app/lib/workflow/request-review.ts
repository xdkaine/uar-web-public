import type { ActorAuthorization } from '@/lib/rbac/core';
import { actorCanActOnStage } from '@/lib/rbac/core';
import {
  findStageIndexByStatus,
  getActiveWorkflow,
  resolveWorkflowForRequest,
  stageStatus,
  supportsFacultyHandoffActions,
  type ResolvedWorkflow,
} from './core';
import { prisma } from '@/lib/prisma';
import { validateWorkflowStages } from './schema';

export interface RequestReviewProjection {
  workflow: {
    id: string | null;
    requestTypeKey: string;
    version: number;
    source: ResolvedWorkflow['source'];
    integrity: ResolvedWorkflow['integrity'] | 'current_stage_missing';
    warning: string | null;
    stages: Array<{
      key: string;
      status: string;
      label: string;
      reviewerRoleKey: string;
      order: number;
    }>;
  };
  currentStage: {
    key: string;
    status: string;
    label: string;
    reviewerRoleKey: string;
    order: number;
    total: number;
    isFinal: boolean;
  } | null;
  actions: {
    canAcknowledge: boolean;
    canApprove: boolean;
    canReject: boolean;
    supportsFacultyHandoff: boolean;
  };
}

const REVIEW_STATUSES = new Set(['pending_student_directors', 'pending_faculty']);

export function projectRequestReview(
  request: { status: string },
  workflow: ResolvedWorkflow,
  actor: ActorAuthorization | null
): RequestReviewProjection {
  const stages = workflow.stages.map((stage, order) => ({
    key: stage.key,
    status: stageStatus(stage),
    label: stage.label,
    reviewerRoleKey: stage.reviewerRoleKey,
    order,
  }));
  const stageIndex = findStageIndexByStatus(workflow.stages, request.status);
  const stage = stageIndex >= 0 ? stages[stageIndex] : null;
  const missingCurrentStage =
    workflow.integrity === 'valid' && REVIEW_STATUSES.has(request.status) && !stage;
  const integrity = missingCurrentStage ? 'current_stage_missing' : workflow.integrity;
  const warning = missingCurrentStage
    ? 'The request status is not represented by its pinned review workflow. Reconcile this request before taking action.'
    : workflow.integrityMessage || null;
  const canAct = integrity === 'valid' && !!stage && actorCanActOnStage(actor, stage.reviewerRoleKey);

  return {
    workflow: {
      id: workflow.id,
      requestTypeKey: workflow.requestTypeKey,
      version: workflow.version,
      source: workflow.source,
      integrity,
      warning,
      stages,
    },
    currentStage: stage
      ? {
          ...stage,
          total: stages.length,
          isFinal: stageIndex === stages.length - 1,
        }
      : null,
    actions: {
      canAcknowledge: canAct && stageIndex < stages.length - 1,
      canApprove: canAct && stageIndex === stages.length - 1,
      canReject: canAct,
      supportsFacultyHandoff:
        integrity === 'valid' && supportsFacultyHandoffActions(workflow.stages),
    },
  };
}

export async function resolveRequestReview(
  request: {
    status: string;
    workflowVersionId?: string | null;
    requestTypeKey?: string | null;
  },
  actor: ActorAuthorization | null
): Promise<RequestReviewProjection> {
  return projectRequestReview(request, await resolveWorkflowForRequest(request), actor);
}

export async function resolveRequestReviews<T extends {
  status: string;
  workflowVersionId?: string | null;
  requestTypeKey?: string | null;
}>(requests: T[], actor: ActorAuthorization | null): Promise<RequestReviewProjection[]> {
  const pinnedIds = Array.from(new Set(requests.map((item) => item.workflowVersionId).filter((id): id is string => !!id)));
  const definitions = pinnedIds.length > 0
    ? await prisma.workflowDefinition.findMany({ where: { id: { in: pinnedIds } } })
    : [];
  const definitionsById = new Map(definitions.map((definition) => [definition.id, definition]));
  const legacyTypes = Array.from(new Set(
    requests.filter((item) => !item.workflowVersionId).map((item) => item.requestTypeKey || 'standard_access')
  ));
  const activeEntries = await Promise.all(legacyTypes.map(async (requestTypeKey) => [
    requestTypeKey,
    await getActiveWorkflow(requestTypeKey),
  ] as const));
  const activeByType = new Map(activeEntries);

  return requests.map((request) => {
    let workflow: ResolvedWorkflow;
    if (!request.workflowVersionId) {
      workflow = activeByType.get(request.requestTypeKey || 'standard_access')!;
    } else {
      const definition = definitionsById.get(request.workflowVersionId);
      if (!definition) {
        workflow = {
          id: request.workflowVersionId,
          requestTypeKey: request.requestTypeKey || 'standard_access',
          version: 0,
          stages: [],
          source: 'pinned',
          integrity: 'missing_definition',
          integrityMessage: 'The pinned review workflow is unavailable. Reconcile this request before taking action.',
        };
      } else {
        const parsed = validateWorkflowStages(definition.stages);
        const typeMismatch = !!request.requestTypeKey && request.requestTypeKey !== definition.requestTypeKey;
        const invalidStatus = !['published', 'archived'].includes(definition.status);
        workflow = {
          id: definition.id,
          requestTypeKey: definition.requestTypeKey,
          version: definition.version,
          stages: parsed.ok && !typeMismatch && !invalidStatus ? parsed.stages : [],
          source: 'pinned',
          integrity: invalidStatus ? 'invalid_definition_status' : typeMismatch ? 'request_type_mismatch' : parsed.ok ? 'valid' : 'corrupt_definition',
          integrityMessage: invalidStatus
            ? 'The pinned review workflow is not an immutable published version. Reconcile this request before taking action.'
            : typeMismatch
            ? 'The pinned review workflow does not match this request type. Reconcile this request before taking action.'
            : parsed.ok ? undefined : 'The pinned review workflow is unreadable. Reconcile this request before taking action.',
        };
      }
    }
    return projectRequestReview(request, workflow, actor);
  });
}
