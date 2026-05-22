import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { logAuditAction, AuditActions, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';

export async function GET(
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
      include: {
        event: {
          select: {
            id: true,
            name: true,
            description: true,
          },
        },
      },
    });

    if (!accessRequest) {
      return NextResponse.json({ error: 'Request not found' }, { status: 404 });
    }

    // Security: Don't return decrypted passwords in API responses
    // Use the dedicated /api/admin/requests/[id]/reveal-password endpoint instead
    const hasPassword = !!accessRequest.accountPassword;
    const passwordStatus = hasPassword 
      ? (accessRequest.isInternal ? 'encrypted_internal' : 'available')
      : null;

    // Exclude accountPassword from response, provide status indicator instead
    const { accountPassword: _excluded, ...safeRequest } = accessRequest;
    const responseData = {
      ...safeRequest,
      hasPassword,
      passwordStatus,
    };

    // Log viewing the request
    await logAuditAction({
      action: AuditActions.VIEW_REQUEST,
      category: AuditCategories.ACCESS_REQUEST,
      username: admin.username,
      targetId: resolvedParams.id,
      targetType: 'AccessRequest',
      details: {
        requestName: accessRequest.name,
        requestEmail: accessRequest.email,
        status: accessRequest.status,
        isInternal: accessRequest.isInternal,
      },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    return NextResponse.json({ request: responseData });
  } catch (error) {
    console.error('Error fetching request:', error);
    return NextResponse.json(
      { error: 'Failed to fetch request' },
      { status: 500 }
    );
  }
}
