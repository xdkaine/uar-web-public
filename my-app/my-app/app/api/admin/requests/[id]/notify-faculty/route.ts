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

    const result = await prisma.accessRequest.updateMany({
      where: { 
        id: resolvedParams.id,
        status: 'pending_faculty'
      },
      data: {
        sentToFacultyAt: new Date(),
        sentToFacultyBy: admin.username,
      },
    });

    if (result.count === 0) {
      const current = await prisma.accessRequest.findUnique({
        where: { id: resolvedParams.id },
        select: { status: true }
      });
      
      return NextResponse.json({ 
        error: `Request status is ${current?.status}, expected pending_faculty` 
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
        comment: `Faculty notification sent by ${admin.username}. Faculty has been notified to create/enable the VPN account.`,
        author: admin.username,
        type: 'system',
      },
    });

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
        console.log('[Notify Faculty] Email sent to faculty:', facultyEmail);
      } else {
        console.warn('[Notify Faculty] No faculty email configured');
      }
    } catch (emailError) {
      console.error('[Notify Faculty] Failed to send faculty email:', emailError);
    }

    try {
      const directorEmails = await getStudentDirectorEmails();
      
      if (directorEmails.length > 0) {
        await sendStudentDirectorNotification(
          'New Request Pending Faculty Approval',
          `A new access request has been sent to pending faculty status and requires attention.`,
          {
            'Request ID': resolvedParams.id,
            'Name': updatedRequest.name,
            'Email': updatedRequest.email,
            'Type': updatedRequest.isInternal ? 'Internal Student' : 'External Student',
            'Sent By': admin.username,
            'Sent At': new Date().toLocaleString(),
          }
        );
        console.log('[Notify Faculty] Notification sent to student directors:', directorEmails.join(', '));
      } else {
        console.warn('[Notify Faculty] No student director emails configured');
      }
    } catch (emailError) {
      console.error('[Notify Faculty] Failed to send student director notification:', emailError);
    }

    await logAuditAction({
      action: AuditActions.SEND_TO_FACULTY,
      category: AuditCategories.ACCESS_REQUEST,
      username: admin.username,
      targetId: resolvedParams.id,
      targetType: 'AccessRequest',
      details: { requestName: updatedRequest.name, requestEmail: updatedRequest.email },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    return NextResponse.json({ 
      success: true, 
      request: updatedRequest 
    });
  } catch (error) {
    console.error('Error notifying faculty:', error);
    
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
      { error: 'Failed to mark as sent to faculty' },
      { status: 500 }
    );
  }
}
