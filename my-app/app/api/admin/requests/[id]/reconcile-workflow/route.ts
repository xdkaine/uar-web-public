import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { actorHasPermission } from '@/lib/rbac/core';
import { parseAdminJson, isJsonBodyError, MAX_REQUEST_BODY_SIZE } from '@/lib/admin-json-parser';
import { AuditActions, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';
import { STANDARD_REQUEST_TYPE_KEY, findStageIndexByStatus } from '@/lib/workflow/core';
import { DEFAULT_STANDARD_WORKFLOW_STAGES, validateWorkflowStages } from '@/lib/workflow/schema';

type ReconcileBody = {
  targetWorkflowDefinitionId?: string;
  expectedRequestVersion?: number;
  expectedWorkflowVersionId?: string | null;
  expectedStatus?: string;
  reason?: string;
};

class ReconcileError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { admin, response } = await checkAdminAuthWithRateLimit(request);
  if (!admin || response) return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!actorHasPermission(admin, 'governance.configure')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await parseAdminJson<ReconcileBody>(request, MAX_REQUEST_BODY_SIZE.SMALL);
    const reason = body.reason?.trim() || '';
    const hasExpectedPin = Object.prototype.hasOwnProperty.call(body, 'expectedWorkflowVersionId');
    if (
      !body.targetWorkflowDefinitionId ||
      !Number.isInteger(body.expectedRequestVersion) ||
      !hasExpectedPin ||
      !body.expectedStatus ||
      reason.length < 10 ||
      reason.length > 500
    ) {
      return NextResponse.json(
        { error: 'Target workflow, complete expected request state, and a 10-500 character reconciliation reason are required.' },
        { status: 400 }
      );
    }

    const { id } = await params;
    const result = await prisma.$transaction(async (tx) => {
      const [accessRequest, target] = await Promise.all([
        tx.accessRequest.findUnique({ where: { id } }),
        tx.workflowDefinition.findUnique({ where: { id: body.targetWorkflowDefinitionId! } }),
      ]);
      if (!accessRequest) throw new ReconcileError('Request not found', 404);
      if (!target || !['published', 'archived'].includes(target.status)) {
        throw new ReconcileError('The replacement workflow definition is unavailable or mutable.', 400);
      }
      const parsedTarget = validateWorkflowStages(target.stages);
      if (!parsedTarget.ok) throw new ReconcileError(`The replacement workflow is invalid: ${parsedTarget.error}`, 400);

      const requestTypeKey = accessRequest.requestTypeKey || STANDARD_REQUEST_TYPE_KEY;
      if (target.requestTypeKey !== requestTypeKey) {
        throw new ReconcileError('The replacement workflow does not match this request type.', 400);
      }
      if (target.id === accessRequest.workflowVersionId) {
        throw new ReconcileError('The request is already pinned to that workflow definition.', 409);
      }
      if (findStageIndexByStatus(parsedTarget.stages, accessRequest.status) < 0) {
        throw new ReconcileError('The replacement workflow does not contain the request current review stage.', 400);
      }

      const currentDefinition = accessRequest.workflowVersionId
        ? await tx.workflowDefinition.findUnique({ where: { id: accessRequest.workflowVersionId } })
        : null;
      const legacyActiveDefinition = !accessRequest.workflowVersionId
        ? await tx.workflowDefinition.findFirst({
            where: { requestTypeKey, status: 'published' },
            orderBy: { version: 'desc' },
          })
        : null;
      const parsedCurrent = currentDefinition ? validateWorkflowStages(currentDefinition.stages) : null;
      const parsedLegacyActive = legacyActiveDefinition
        ? validateWorkflowStages(legacyActiveDefinition.stages)
        : { ok: true as const, stages: DEFAULT_STANDARD_WORKFLOW_STAGES };
      const currentIsInvalid = accessRequest.workflowVersionId
        ? !currentDefinition
          || !['published', 'archived'].includes(currentDefinition.status)
          || !parsedCurrent?.ok
          || currentDefinition.requestTypeKey !== requestTypeKey
          || findStageIndexByStatus(parsedCurrent.stages, accessRequest.status) < 0
        : !parsedLegacyActive.ok
          || findStageIndexByStatus(parsedLegacyActive.stages, accessRequest.status) < 0;
      if (!currentIsInvalid) {
        throw new ReconcileError('This request has a valid workflow pin and does not require reconciliation.', 409);
      }

      const updated = await tx.accessRequest.updateMany({
        where: {
          id,
          version: body.expectedRequestVersion,
          status: body.expectedStatus,
          workflowVersionId: body.expectedWorkflowVersionId,
        },
        data: {
          workflowVersionId: target.id,
          requestTypeKey: target.requestTypeKey,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) throw new ReconcileError('The request changed. Reload before reconciling its workflow.', 409);

      await tx.auditLog.create({
        data: {
          action: AuditActions.RECONCILE_REQUEST_WORKFLOW,
          category: AuditCategories.ACCESS_REQUEST,
          username: admin.username,
          actorType: 'admin',
          targetId: id,
          targetType: 'AccessRequest',
          relatedRequestId: id,
          eventKind: 'write',
          outcome: 'success',
          success: true,
          ipAddress: getIpAddress(request),
          userAgent: getUserAgent(request),
          details: JSON.stringify({
            sourceWorkflowDefinitionId: accessRequest.workflowVersionId,
            sourceWorkflowVersion: currentDefinition?.version ?? null,
            targetWorkflowDefinitionId: target.id,
            targetWorkflowVersion: target.version,
            requestStatus: accessRequest.status,
            reason,
          }),
        },
      });
      return { version: accessRequest.version + 1, workflowVersionId: target.id };
    }, { isolationLevel: 'Serializable' });

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    if (isJsonBodyError(error)) return NextResponse.json({ error: error.message }, { status: error.statusCode });
    if (error instanceof ReconcileError) return NextResponse.json({ error: error.message }, { status: error.status });
    const code = (error as { code?: string })?.code;
    if (code === 'P2002' || code === 'P2034') {
      return NextResponse.json({ error: 'The request or workflow changed. Reload and try again.' }, { status: 409 });
    }
    console.error('Failed to reconcile request workflow:', error);
    return NextResponse.json({ error: 'Failed to reconcile request workflow' }, { status: 500 });
  }
}
