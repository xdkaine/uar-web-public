import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkReviewAccessWithRateLimit } from '@/lib/adminAuth';
import { logAuditAction, AuditActions, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';
import { sendStudentDirectorNotification } from '@/lib/email';
import { getEmailConfig, getStudentDirectorEmails } from '@/lib/email-config';
import { deliverFacultyNotification } from '@/lib/faculty-notification';
import { isModuleEnabled } from '@/lib/modules/core';
import { actorCanActOnStage } from '@/lib/rbac/core';
import { findStageIndexByStatus, resolveStageNotificationRecipients, resolveWorkflowForRequest, supportsFacultyHandoffActions, workflowIntegrityConflict } from '@/lib/workflow/core';
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

        const workflow = await resolveWorkflowForRequest(accessRequest);
        const workflowConflict = workflowIntegrityConflict(workflow);
        if (workflowConflict) return NextResponse.json({ error: workflowConflict, code: 'WORKFLOW_RECONCILIATION_REQUIRED' }, { status: 409 });
        if (!supportsFacultyHandoffActions(workflow.stages)) {
            return NextResponse.json({
                error: 'Return-to-faculty is not available under the configured review workflow for this request.'
            }, { status: 409 });
        }

        // Ensure status is correct for this transition
        if (findStageIndexByStatus(workflow.stages, accessRequest.status) !== 0) {
            return NextResponse.json({
                error: `Request status is ${accessRequest.status}, expected the first review stage (${workflow.stages[0].label})`
            }, { status: 400 });
        }

        if (!actorCanActOnStage(admin, workflow.stages[0].reviewerRoleKey)) {
            return NextResponse.json(
                { error: 'You do not have the reviewer role required for this action.', code: 'MISSING_STAGE_ROLE' },
                { status: 403 }
            );
        }

        const vpnModuleEnabled = await isModuleEnabled('vpn.management');

        const result = await prisma.accessRequest.updateMany({
            where: {
                id: resolvedParams.id,
                status: accessRequest.status,
                version: accessRequest.version,
            },
            data: {
                status: 'pending_faculty',
                sentToFacultyAt: null,
                sentToFacultyBy: null,
                facultyNotificationState: null,
                facultyNotificationClaimId: null,
                facultyNotificationClaimedUntil: null,
                facultyNotificationError: null,
                // Reset acknowledgment since it's going back to faculty
                acknowledgedByDirector: false,
                acknowledgedAt: null,
                acknowledgedBy: null,
                version: { increment: 1 },
            },
        });

        if (result.count === 0) {
            return NextResponse.json({
                error: 'Failed to update request status. It may have been modified by another admin.'
            }, { status: 409 });
        }

        const updatedRequest = await prisma.accessRequest.findUnique({
            where: { id: resolvedParams.id },
        });

        if (!updatedRequest) {
            return NextResponse.json({ error: 'Request not found after update' }, { status: 404 });
        }

        // Add system comment
        await prisma.requestComment.create({
            data: {
                requestId: resolvedParams.id,
                comment: `Request returned to Pending Faculty status by ${admin.username}.${vpnModuleEnabled ? ' Faculty has been notified to review the account.' : ''}`,
                author: admin.username,
                type: 'system',
            },
        });

        const stageRecipients = await resolveStageNotificationRecipients(
            workflow.stages[1],
            async () => {
                const emailConfig = await getEmailConfig();
                return emailConfig.facultyEmail ? [emailConfig.facultyEmail] : [];
            }
        );
        let responseRequest = updatedRequest;
        let facultyDeliveryStatus = 'failed';
        if (stageRecipients.length === 0) {
            await prisma.accessRequest.updateMany({
                where: { id: resolvedParams.id, status: 'pending_faculty', facultyNotificationState: null },
                data: {
                    facultyNotificationState: 'failed',
                    facultyNotificationError: 'No faculty delivery recipient is configured',
                },
            });
        } else {
            const delivery = await deliverFacultyNotification({
                requestId: resolvedParams.id,
                actor: admin.username,
                recipients: stageRecipients,
                vpnModuleEnabled,
                expectedStatus: 'pending_faculty',
            });
            facultyDeliveryStatus = delivery.status;
            if (delivery.status === 'delivered') responseRequest = delivery.request;
        }

        // Send notification to student directors about the change
        try {
            const directorEmails = await resolveStageNotificationRecipients(
                workflow.stages[0],
                getStudentDirectorEmails
            );

            if (directorEmails.length > 0) {
                await sendStudentDirectorNotification(
                    'Request Returned to Faculty',
                    `Access request for ${updatedRequest.name} has been returned to Pending Faculty status.`,
                    {
                        'Request ID': resolvedParams.id,
                        'Name': updatedRequest.name,
                        'Returned By': admin.username,
                        'Returned At': new Date().toLocaleString(),
                    },
                    directorEmails
                );
                console.log('[Return to Faculty] Notification sent to student directors');
            }
        } catch (emailError) {
            console.error('[Return to Faculty] Failed to send director notification:', emailError);
        }

        // Log the action
        await logAuditAction({
            action: AuditActions.SEND_TO_FACULTY, // Re-using SEND_TO_FACULTY or creating a new one if needed, but this fits best
            category: AuditCategories.ACCESS_REQUEST,
            username: admin.username,
            targetId: resolvedParams.id,
            targetType: 'AccessRequest',
            details: {
                fromStatus: 'pending_student_directors',
                toStatus: 'pending_faculty',
                action: 'returned_to_faculty',
                facultyDeliveryStatus,
            },
            ipAddress: getIpAddress(request),
            userAgent: getUserAgent(request),
        });

        return NextResponse.json({
            success: facultyDeliveryStatus === 'delivered',
            partial: facultyDeliveryStatus !== 'delivered',
            facultyDeliveryStatus,
            request: toSafeAccessRequestResponse(responseRequest),
            message: facultyDeliveryStatus === 'delivered'
                ? 'Request returned to Faculty Review status and notification delivered.'
                : 'Request returned to Faculty Review status; faculty delivery requires attention.'
        }, { status: facultyDeliveryStatus === 'delivery_unknown' ? 202 : 200 });
    } catch (error) {
        console.error('Error returning request to faculty:', error);

        // Log the failure
        const resolvedParams = await params;
        const { admin } = await checkReviewAccessWithRateLimit(request);
        if (admin) {
            await logAuditAction({
                action: AuditActions.SEND_TO_FACULTY,
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
            { error: 'Failed to return request to faculty' },
            { status: 500 }
        );
    }
}
