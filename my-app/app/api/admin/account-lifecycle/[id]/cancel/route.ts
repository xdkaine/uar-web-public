import { NextRequest, NextResponse } from 'next/server';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { actorHasPermission } from '@/lib/rbac/core';
import { secureJsonResponse, secureErrorResponse } from '@/lib/apiResponse';
import { cancelLifecycleAction } from '@/lib/lifecycle-processor';
import { logAuditAction, AuditCategories, AuditActions, getIpAddress } from '@/lib/audit-log';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { admin, response } = await checkAdminAuthWithRateLimit(request);
  if (!admin || response) {
    return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!actorHasPermission(admin, 'lifecycle.manage')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await params;

  try {
    const success = await cancelLifecycleAction(id, admin.username);

    if (!success) {
      return secureErrorResponse('Failed to cancel action');
    }

    // Log the cancellation
    await logAuditAction({
      username: admin.username,
      action: AuditActions.CANCEL_LIFECYCLE_ACTION,
      category: AuditCategories.LIFECYCLE,
      details: { actionId: id },
      ipAddress: getIpAddress(request) || 'unknown',
      userAgent: request.headers.get('user-agent') || 'unknown',
    });

    return secureJsonResponse({ message: 'Action cancelled' }, 200);
  } catch (error) {
    console.error('Error cancelling lifecycle action:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return secureErrorResponse(errorMessage);
  }
}
