import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { logAuditAction, AuditActions, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';
import { sendVPNPendingFacultyNotification, sendStudentDirectorNotification } from '@/lib/email';
import { getEmailConfig, getStudentDirectorEmails } from '@/lib/email-config';

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { admin, response } = await checkAdminAuthWithRateLimit(request);

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

        // Ensure status is correct for this transition
        if (accessRequest.status !== 'pending_student_directors') {
            return NextResponse.json({
                error: `Request status is ${accessRequest.status}, expected pending_student_directors`
            }, { status: 400 });
        }

        const result = await prisma.accessRequest.updateMany({
            where: {
                id: resolvedParams.id,
                status: 'pending_student_directors'
            },
            data: {
                status: 'pending_faculty',
                sentToFacultyAt: new Date(),
                sentToFacultyBy: admin.username,
                // Reset acknowledgment since it's going back to faculty
                acknowledgedByDirector: false,
                acknowledgedAt: null,
                acknowledgedBy: null,
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
                comment: `Request returned to Pending Faculty status by ${admin.username}. Faculty has been notified to review the account.`,
                author: admin.username,
                type: 'system',
            },
        });

        // Send email notification to faculty
        try {
            const emailConfig = await getEmailConfig();
            const facultyEmail = emailConfig.facultyEmail;

            if (facultyEmail) {
                await sendVPNPendingFacultyNotification(
                    facultyEmail,
                    updatedRequest.vpnUsername || updatedRequest.ldapUsername || 'N/A',
                    updatedRequest.name,
                    updatedRequest.email,
                    updatedRequest.isInternal ? 'Internal (Management/Limited)' : 'External',
                    admin.username
                );
                console.log('[Return to Faculty] Email sent to faculty:', facultyEmail);
            } else {
                console.warn('[Return to Faculty] No faculty email configured');
            }
        } catch (emailError) {
            console.error('[Return to Faculty] Failed to send faculty email:', emailError);
            // Don't fail the request if email fails
        }

        // Send notification to student directors about the change
        try {
            const directorEmails = await getStudentDirectorEmails();

            if (directorEmails.length > 0) {
                await sendStudentDirectorNotification(
                    'Request Returned to Faculty',
                    `Access request for ${updatedRequest.name} has been returned to Pending Faculty status.`,
                    {
                        'Request ID': resolvedParams.id,
                        'Name': updatedRequest.name,
                        'Returned By': admin.username,
                        'Returned At': new Date().toLocaleString(),
                    }
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
                action: 'returned_to_faculty'
            },
            ipAddress: getIpAddress(request),
            userAgent: getUserAgent(request),
        });

        return NextResponse.json({
            success: true,
            request: updatedRequest,
            message: 'Request returned to Faculty Review status.'
        });
    } catch (error) {
        console.error('Error returning request to faculty:', error);

        // Log the failure
        const resolvedParams = await params;
        const { admin } = await checkAdminAuthWithRateLimit(request);
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
