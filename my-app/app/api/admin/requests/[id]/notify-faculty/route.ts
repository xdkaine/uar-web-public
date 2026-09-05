import { NextRequest, NextResponse } from 'next/server';

import { checkReviewAccessWithRateLimit } from '@/lib/adminAuth';
import { toSafeAccessRequestResponse } from '@/lib/access-request-response';
import {
  AuditActions,
  AuditCategories,
  getIpAddress,
  getUserAgent,
  logAuditAction,
} from '@/lib/audit-log';
import { sendStudentDirectorNotification } from '@/lib/email';
import { getEmailConfig, getStudentDirectorEmails } from '@/lib/email-config';
import { deliverFacultyNotification } from '@/lib/faculty-notification';
import { isModuleEnabled } from '@/lib/modules/core';
import { prisma } from '@/lib/prisma';
import { actorCanActOnStage } from '@/lib/rbac/core';
import {
  resolveStageNotificationRecipients,
  resolveWorkflowForRequest,
  stageStatus,
  supportsFacultyHandoffActions,
  workflowIntegrityConflict,
} from '@/lib/workflow/core';

const FACULTY_DELIVERY_FAILURE_MESSAGES = {
  already_delivered: 'Faculty notification has already been delivered for this request.',
  in_progress: 'Faculty notification delivery is already in progress.',
  delivery_unknown: 'The faculty delivery outcome is unknown and must be reconciled before retrying.',
  conflict: 'Request changed before faculty delivery could start.',
} as const;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { admin, response } = await checkReviewAccessWithRateLimit(request);
  if (!admin || response) {
    return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const accessRequest = await prisma.accessRequest.findUnique({ where: { id } });
  if (!accessRequest) return NextResponse.json({ error: 'Request not found' }, { status: 404 });

  const workflow = await resolveWorkflowForRequest(accessRequest);
  const workflowConflict = workflowIntegrityConflict(workflow);
  if (workflowConflict) return NextResponse.json({ error: workflowConflict, code: 'WORKFLOW_RECONCILIATION_REQUIRED' }, { status: 409 });
  if (!supportsFacultyHandoffActions(workflow.stages)) {
    return NextResponse.json(
      { error: 'Notify-faculty is not available under the configured review workflow for this request.' },
      { status: 409 }
    );
  }

  const facultyStage = workflow.stages[1];
  const expectedStatus = stageStatus(facultyStage);
  if (!actorCanActOnStage(admin, facultyStage.reviewerRoleKey)) {
    return NextResponse.json(
      { error: 'You do not have the reviewer role required for this action.', code: 'MISSING_STAGE_ROLE' },
      { status: 403 }
    );
  }
  if (accessRequest.status !== expectedStatus || !accessRequest.isVerified) {
    return NextResponse.json(
      { error: 'Request is not eligible for faculty notification in its current state.' },
      { status: 409 }
    );
  }

  const vpnModuleEnabled = await isModuleEnabled('vpn.management');
  const stageRecipients = await resolveStageNotificationRecipients(facultyStage, async () => {
    const emailConfig = await getEmailConfig();
    return emailConfig.facultyEmail ? [emailConfig.facultyEmail] : [];
  });
  if (stageRecipients.length === 0) {
    return NextResponse.json({ error: 'No faculty delivery recipient is configured' }, { status: 409 });
  }

  const delivery = await deliverFacultyNotification({
    requestId: id,
    actor: admin.username,
    recipients: stageRecipients,
    vpnModuleEnabled,
    expectedStatus,
  });
  if (delivery.status !== 'delivered') {
    await logAuditAction({
      action: AuditActions.SEND_TO_FACULTY,
      category: AuditCategories.ACCESS_REQUEST,
      username: admin.username,
      targetId: id,
      targetType: 'AccessRequest',
      success: false,
      outcome: 'failure',
      errorMessage: FACULTY_DELIVERY_FAILURE_MESSAGES[delivery.status],
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    }).catch(() => undefined);
    return NextResponse.json(
      { partial: delivery.status === 'delivery_unknown', error: FACULTY_DELIVERY_FAILURE_MESSAGES[delivery.status] },
      { status: delivery.status === 'delivery_unknown' ? 202 : 409 }
    );
  }

  const updatedRequest = delivery.request;
  try {
    const directorEmails = await resolveStageNotificationRecipients(workflow.stages[0], getStudentDirectorEmails);
    if (directorEmails.length > 0) {
      await sendStudentDirectorNotification(
        'New Request Pending Faculty Approval',
        'A new access request has been delivered to faculty and requires attention.',
        {
          'Request ID': id,
          Name: updatedRequest.name,
          Email: updatedRequest.email,
          Type: updatedRequest.isInternal ? 'Internal Student' : 'External Student',
          'Sent By': admin.username,
          'Sent At': new Date().toLocaleString(),
        },
        directorEmails
      );
    }
  } catch (error) {
    console.error('[Notify Faculty] Student-director notification failed:', error);
  }

  await logAuditAction({
    action: AuditActions.SEND_TO_FACULTY,
    category: AuditCategories.ACCESS_REQUEST,
    username: admin.username,
    targetId: id,
    targetType: 'AccessRequest',
    outcome: 'success',
    details: { requestName: updatedRequest.name, requestEmail: updatedRequest.email },
    ipAddress: getIpAddress(request),
    userAgent: getUserAgent(request),
  }).catch(() => undefined);

  return NextResponse.json({ success: true, request: toSafeAccessRequestResponse(updatedRequest) });
}
