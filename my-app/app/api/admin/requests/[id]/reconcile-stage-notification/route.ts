import { NextRequest, NextResponse } from 'next/server';

import { checkReviewAccessWithRateLimit } from '@/lib/adminAuth';
import {
  AuditActions,
  AuditCategories,
  emitAuditActionLog,
  getIpAddress,
  getUserAgent,
  logAuditAction,
} from '@/lib/audit-log';
import { prisma } from '@/lib/prisma';
import { actorCanActOnStage } from '@/lib/rbac/core';
import { findStageIndexByStatus, resolveWorkflowForRequest, workflowIntegrityConflict } from '@/lib/workflow/core';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { admin, response } = await checkReviewAccessWithRateLimit(request);
  if (!admin || response) return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json() as { resolution?: unknown; evidence?: unknown };
  if (body.resolution !== 'delivered' && body.resolution !== 'not_delivered') {
    return NextResponse.json({ error: 'resolution must be delivered or not_delivered' }, { status: 400 });
  }
  const evidence = typeof body.evidence === 'string' ? body.evidence.trim() : '';
  if (evidence.length < 10) {
    return NextResponse.json({ error: 'Reconciliation evidence must contain at least 10 characters' }, { status: 400 });
  }

  const accessRequest = await prisma.accessRequest.findUnique({ where: { id } });
  if (!accessRequest) return NextResponse.json({ error: 'Request not found' }, { status: 404 });

  const workflow = await resolveWorkflowForRequest(accessRequest);
  const workflowConflict = workflowIntegrityConflict(workflow);
  if (workflowConflict) {
    return NextResponse.json({ error: workflowConflict, code: 'WORKFLOW_RECONCILIATION_REQUIRED' }, { status: 409 });
  }
  const currentStageIndex = findStageIndexByStatus(workflow.stages, accessRequest.status);
  const currentStage = currentStageIndex >= 0 ? workflow.stages[currentStageIndex] : null;
  if (!currentStage || accessRequest.stageNotificationStageKey !== currentStage.key) {
    return NextResponse.json({ error: 'The saved notification does not belong to the current configured stage' }, { status: 409 });
  }
  if (!actorCanActOnStage(admin, currentStage.reviewerRoleKey)) {
    return NextResponse.json({ error: `You do not have the reviewer role required for the "${currentStage.label}" stage.` }, { status: 403 });
  }
  if (accessRequest.stageNotificationState !== 'delivery_unknown') {
    return NextResponse.json({ error: 'Stage notification delivery is not awaiting reconciliation' }, { status: 409 });
  }

  const auditEntry = {
    action: AuditActions.RECONCILE_STAGE_NOTIFICATION,
    category: AuditCategories.ACCESS_REQUEST,
    username: admin.username,
    targetId: id,
    targetType: 'AccessRequest',
    details: {
      stageKey: currentStage.key,
      stageLabel: currentStage.label,
      resolution: body.resolution,
      evidence,
    },
    ipAddress: getIpAddress(request),
    userAgent: getUserAgent(request),
  };

  const reconciled = await prisma.$transaction(async (tx) => {
    const updated = await tx.accessRequest.updateMany({
      where: {
        id,
        version: accessRequest.version,
        status: accessRequest.status,
        stageNotificationStageKey: currentStage.key,
        stageNotificationState: 'delivery_unknown',
      },
      data: {
        stageNotificationState: body.resolution === 'delivered' ? 'delivered' : 'failed',
        stageNotificationError: body.resolution === 'delivered'
          ? null
          : `Operator confirmed non-delivery: ${evidence}`,
        stageNotificationStateChangedAt: new Date(),
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) return false;

    await tx.requestComment.create({
      data: {
        requestId: id,
        author: admin.username,
        type: 'system',
        comment: `${currentStage.label} notification reconciled as ${body.resolution} by ${admin.username}. Evidence: ${evidence}`,
      },
    });
    await logAuditAction(auditEntry, tx, { emitOperationalLog: false });
    return true;
  }, { isolationLevel: 'Serializable' });

  if (!reconciled) {
    return NextResponse.json({ error: 'Stage notification changed concurrently' }, { status: 409 });
  }
  emitAuditActionLog(auditEntry);

  return NextResponse.json({ success: true, resolution: body.resolution });
}
