import { NextRequest, NextResponse } from 'next/server';

import { checkReviewAccessWithRateLimit } from '@/lib/adminAuth';
import { AuditActions, AuditCategories, getIpAddress, getUserAgent, logAuditAction } from '@/lib/audit-log';
import { prisma } from '@/lib/prisma';
import { actorCanActOnStage } from '@/lib/rbac/core';
import { resolveWorkflowForRequest, stageStatus, supportsFacultyHandoffActions, workflowIntegrityConflict } from '@/lib/workflow/core';

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
  if (workflowConflict) return NextResponse.json({ error: workflowConflict, code: 'WORKFLOW_RECONCILIATION_REQUIRED' }, { status: 409 });
  if (!supportsFacultyHandoffActions(workflow.stages)) {
    return NextResponse.json({ error: 'Faculty delivery recovery is unavailable for this workflow' }, { status: 409 });
  }
  const facultyStage = workflow.stages[1];
  const expectedStatus = stageStatus(facultyStage);
  if (!actorCanActOnStage(admin, facultyStage.reviewerRoleKey)) {
    return NextResponse.json({ error: 'You do not have the faculty-stage reviewer role required for recovery' }, { status: 403 });
  }
  if (accessRequest.status !== expectedStatus || accessRequest.facultyNotificationState !== 'delivery_unknown') {
    return NextResponse.json({ error: 'Faculty delivery is not awaiting reconciliation in the faculty stage' }, { status: 409 });
  }

  const updated = await prisma.accessRequest.updateMany({
    where: {
      id,
      version: accessRequest.version,
      status: expectedStatus,
      facultyNotificationState: 'delivery_unknown',
    },
    data: body.resolution === 'delivered'
      ? {
          facultyNotificationState: 'delivered',
          facultyNotificationClaimId: null,
          facultyNotificationClaimedUntil: null,
          facultyNotificationError: null,
          sentToFacultyAt: new Date(),
          sentToFacultyBy: admin.username,
          version: { increment: 1 },
        }
      : {
          facultyNotificationState: 'failed',
          facultyNotificationClaimId: null,
          facultyNotificationClaimedUntil: null,
          facultyNotificationError: `Operator confirmed non-delivery: ${evidence}`,
          sentToFacultyAt: null,
          sentToFacultyBy: null,
          version: { increment: 1 },
        },
  });
  if (updated.count !== 1) {
    return NextResponse.json({ error: 'Faculty delivery is not awaiting reconciliation or changed concurrently' }, { status: 409 });
  }

  await prisma.requestComment.create({
    data: {
      requestId: id,
      author: admin.username,
      type: 'system',
      comment: `Faculty delivery reconciled as ${body.resolution} by ${admin.username}. Evidence: ${evidence}`,
    },
  });
  await logAuditAction({
    action: AuditActions.RECONCILE_FACULTY_DELIVERY,
    category: AuditCategories.ACCESS_REQUEST,
    username: admin.username,
    targetId: id,
    targetType: 'AccessRequest',
    details: { resolution: body.resolution, evidence },
    ipAddress: getIpAddress(request),
    userAgent: getUserAgent(request),
  });

  return NextResponse.json({ success: true, resolution: body.resolution });
}
