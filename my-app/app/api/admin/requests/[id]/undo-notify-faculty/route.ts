import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkReviewAccessWithRateLimit } from '@/lib/adminAuth';
import { logAuditAction, AuditActions, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';
import { resolveWorkflowForRequest, supportsFacultyHandoffActions, workflowIntegrityConflict } from '@/lib/workflow/core';
import { actorCanActOnStage } from '@/lib/rbac/core';
import { toSafeAccessRequestResponse } from '@/lib/access-request-response';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { admin, response } = await checkReviewAccessWithRateLimit(request);

    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const resolvedParams = await params;

    const accessRequest = await prisma.accessRequest.findUnique({
      where: { id: resolvedParams.id },
    });

    if (!accessRequest) {
      return NextResponse.json({ error: 'Request not found' }, { status: 404 });
    }
    if (['in_progress', 'reconciliation_required'].includes(accessRequest.accountUpdateState || '')) {
      return NextResponse.json({ error: 'Account update ownership must be resolved before changing request stage.' }, { status: 409 });
    }
    if (accessRequest.facultyNotificationState === 'sending') {
      return NextResponse.json({ error: 'Faculty delivery is in progress; its outcome must settle before changing request state.' }, { status: 409 });
    }

    const workflow = await resolveWorkflowForRequest(accessRequest);
    const workflowConflict = workflowIntegrityConflict(workflow);
    if (workflowConflict) return NextResponse.json({ error: workflowConflict, code: 'WORKFLOW_RECONCILIATION_REQUIRED' }, { status: 409 });
    if (!supportsFacultyHandoffActions(workflow.stages)) {
      return NextResponse.json(
        { error: 'Undo faculty notification is not available under the configured review workflow for this request.' },
        { status: 409 }
      );
    }

    if (!actorCanActOnStage(admin, workflow.stages[1].reviewerRoleKey)) {
      return NextResponse.json(
        { error: 'You do not have the reviewer role required for this action.', code: 'MISSING_STAGE_ROLE' },
        { status: 403 }
      );
    }

    if (!accessRequest.sentToFacultyAt) {
      return NextResponse.json(
        { error: 'This request has not been marked as sent to faculty yet' },
        { status: 400 }
      );
    }

    const result = await prisma.accessRequest.updateMany({
      where: {
        id: resolvedParams.id,
        status: accessRequest.status,
        version: accessRequest.version,
        OR: [
          { facultyNotificationState: null },
          { facultyNotificationState: { not: 'sending' } },
        ],
      },
      data: {
        sentToFacultyAt: null,
        sentToFacultyBy: null,
        version: { increment: 1 },
      },
    });

    if (result.count === 0) {
      const current = await prisma.accessRequest.findUnique({
        where: { id: resolvedParams.id },
        select: { status: true }
      });

      return NextResponse.json({
        error: `Request status is ${current?.status}, expected ${accessRequest.status}`
      }, { status: 400 });
    }

    const updatedRequest = await prisma.accessRequest.findUnique({
      where: { id: resolvedParams.id },
    });

    if (!updatedRequest) {
      return NextResponse.json({ error: 'Request not found after update' }, { status: 404 });
    }

    await prisma.requestComment.create({
      data: {
        requestId: resolvedParams.id,
        comment: `Faculty notification undone by ${admin.username}. The 'sent to faculty' status was cleared.`,
        author: admin.username,
        type: 'system',
      },
    });

    await logAuditAction({
      action: AuditActions.UNDO_FACULTY_NOTIFICATION,
      category: AuditCategories.ACCESS_REQUEST,
      username: admin.username,
      targetId: resolvedParams.id,
      targetType: 'AccessRequest',
      details: {
        clearedSentToFacultyStatus: true
      },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    return NextResponse.json({
      success: true,
      request: toSafeAccessRequestResponse(updatedRequest)
    });
  } catch (error) {
    console.error('Error undoing faculty notification:', error);

    const resolvedParams = await params;
    const { admin } = await checkReviewAccessWithRateLimit(request);
    if (admin) {
      await logAuditAction({
        action: AuditActions.UNDO_FACULTY_NOTIFICATION,
        category: AuditCategories.ACCESS_REQUEST,
        username: admin.username,
        targetId: resolvedParams.id,
        targetType: 'AccessRequest',
        success: false,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        ipAddress: getIpAddress(request),
        userAgent: getUserAgent(request),
      });
    }

    return NextResponse.json(
      { error: 'Failed to undo faculty notification' },
      { status: 500 }
    );
  }
}
