import { NextRequest, NextResponse } from 'next/server';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { prisma } from '@/lib/prisma';
import { sendFacultyNotification } from '@/lib/email';
import { getIpAddress, logAuditAction } from '@/lib/audit-log';
import { appLogger } from '@/lib/logger';

/**
 * Send access request to faculty for approval
 * POST /api/admin/requests/[id]/send-to-faculty
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Verify admin authentication
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: requestId } = await params;

    // Fetch the access request
    const accessRequest = await prisma.accessRequest.findUnique({
      where: { id: requestId },
      include: {
        event: true,
      },
    });

    if (!accessRequest) {
      return NextResponse.json(
        { error: 'Request not found' },
        { status: 404 }
      );
    }

    // Validate request status
    if (accessRequest.status !== 'pending_student_directors') {
      return NextResponse.json(
        { 
          error: 'Request must be in pending_student_directors status to send to faculty',
          currentStatus: accessRequest.status,
        },
        { status: 400 }
      );
    }

    // Check if already sent to faculty
    if (accessRequest.sentToFacultyAt) {
      return NextResponse.json(
        { 
          error: 'Request has already been sent to faculty',
          sentAt: accessRequest.sentToFacultyAt,
          sentBy: accessRequest.sentToFacultyBy,
        },
        { status: 400 }
      );
    }

    // Parse request body for optional message
    let customMessage: string | undefined;
    try {
      const body = await request.json();
      customMessage = body.message;
    } catch {
      // No body or invalid JSON - continue without custom message
    }

    // Send notification to faculty
    try {
      await sendFacultyNotification(
        accessRequest.id,
        accessRequest.name,
        accessRequest.email,
        accessRequest.isInternal,
        accessRequest.needsDomainAccount,
        accessRequest.eventReason || undefined,
        accessRequest.event?.name,
        customMessage
      );
    } catch (emailError) {
      appLogger.error('Failed to send faculty notification', {
        requestId,
        error: emailError instanceof Error ? emailError.message : 'Unknown error',
      });
      
      return NextResponse.json(
        { error: 'Failed to send notification email to faculty' },
        { status: 500 }
      );
    }

    // Update request status and tracking fields
    const updatedRequest = await prisma.accessRequest.update({
      where: { id: requestId },
      data: {
        status: 'pending_faculty',
        sentToFacultyAt: new Date(),
        sentToFacultyBy: admin.username,
      },
    });

    // Add comment to request
    await prisma.requestComment.create({
      data: {
        requestId,
        author: admin.username,
        type: 'system',
        comment: `Request sent to faculty for approval${customMessage ? ` with message: "${customMessage}"` : ''}`,
      },
    });

    // Log audit action
    await logAuditAction({
      action: 'send_to_faculty',
      category: 'request_management',
      username: admin.username,
      targetId: requestId,
      targetType: 'access_request',
      details: {
        requestEmail: accessRequest.email,
        requestName: accessRequest.name,
        hasCustomMessage: !!customMessage,
      },
      ipAddress: getIpAddress(request) || 'unknown',
      success: true,
    });

    appLogger.info('Request sent to faculty', {
      requestId,
      adminUser: admin.username,
      requestEmail: accessRequest.email,
    });

    return NextResponse.json({
      success: true,
      message: 'Request sent to faculty successfully',
      request: updatedRequest,
    });

  } catch (error) {
    appLogger.error('Failed to send request to faculty', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    return NextResponse.json(
      { error: 'Failed to send request to faculty' },
      { status: 500 }
    );
  }
}
