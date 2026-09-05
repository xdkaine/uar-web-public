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
      return NextResponse.json({ error: 'Faculty delivery is in progress; its outcome must settle before changing request stage.' }, { status: 409 });
    }

    const workflow = await resolveWorkflowForRequest(accessRequest);
    const workflowConflict = workflowIntegrityConflict(workflow);
    if (workflowConflict) return NextResponse.json({ error: workflowConflict, code: 'WORKFLOW_RECONCILIATION_REQUIRED' }, { status: 409 });
    if (!supportsFacultyHandoffActions(workflow.stages)) {
      return NextResponse.json(
        { error: 'Move-back is not available under the configured review workflow for this request.' },
        { status: 409 }
      );
    }

    if (!actorCanActOnStage(admin, workflow.stages[1].reviewerRoleKey)) {
      return NextResponse.json(
        { error: 'You do not have the reviewer role required for this action.', code: 'MISSING_STAGE_ROLE' },
        { status: 403 }
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
        status: 'pending_student_directors',
        acknowledgedByDirector: false,
        acknowledgedAt: null,
        acknowledgedBy: null,
        sentToFacultyAt: null,
        sentToFacultyBy: null,
        // Keep the existing usernames and expiration, but force a new password before re-submission.
        accountPassword: null,
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
        comment: `Request moved back to the first configured review stage by ${admin.username}. Credentials preserved for editing (password cleared - new password required). ${accessRequest.accountCreatedAt ? 'The directory account was already created and can be updated if needed.' : ''}`,
        author: admin.username,
        type: 'system',
      },
    });

    await logAuditAction({
      action: AuditActions.MOVE_BACK_REQUEST,
      category: AuditCategories.ACCESS_REQUEST,
      username: admin.username,
      targetId: resolvedParams.id,
      targetType: 'AccessRequest',
      details: {
        fromStatus: 'pending_faculty',
        toStatus: 'pending_student_directors',
        preservedCredentials: true,
        hadAccountCreated: !!accessRequest.accountCreatedAt
      },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    return NextResponse.json({
      success: true,
      request: toSafeAccessRequestResponse(updatedRequest),
      message: 'Request moved back to Student Directors stage. Username preserved but password cleared - new password required.'
    });
  } catch (error) {
    console.error('Error moving request back:', error);

    const resolvedParams = await params;
    const { admin } = await checkReviewAccessWithRateLimit(request);
    if (admin) {
      await logAuditAction({
        action: AuditActions.MOVE_BACK_REQUEST,
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
      { error: 'Failed to move request back to previous stage' },
      { status: 500 }
    );
  }
}
