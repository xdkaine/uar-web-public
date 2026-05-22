import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { logAuditAction, AuditActions, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';

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
        status: 'pending_student_directors',
        acknowledgedByDirector: false,
        acknowledgedAt: null,
        acknowledgedBy: null,
        sentToFacultyAt: null,
        sentToFacultyBy: null,
        // Keep the existing usernames and expiration, but force a new password before re-submission.
        accountPassword: null,
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
        comment: `Request moved back to Pending Student Directors by ${admin.username}. Credentials preserved for editing (password cleared - new password required). ${accessRequest.accountCreatedAt ? 'LDAP account was already created and can be updated if needed.' : ''}`,
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
      request: updatedRequest,
      message: 'Request moved back to Student Directors stage. Username preserved but password cleared - new password required.'
    });
  } catch (error) {
    console.error('Error moving request back:', error);

    const resolvedParams = await params;
    const { admin } = await checkAdminAuthWithRateLimit(request);
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
