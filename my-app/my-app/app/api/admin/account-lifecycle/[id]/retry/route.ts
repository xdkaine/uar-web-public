import { NextRequest, NextResponse } from 'next/server';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { secureJsonResponse, secureErrorResponse } from '@/lib/apiResponse';
import { retryFailedAction } from '@/lib/lifecycle-processor';
import { logAuditAction, AuditCategories, AuditActions, getIpAddress } from '@/lib/audit-log';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { admin, response } = await checkAdminAuthWithRateLimit(request);
  if (!admin || response) {
    return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  try {
    const success = await retryFailedAction(id);

    if (!success) {
      return secureErrorResponse('Failed to retry action');
    }

    // Log the retry action
    await logAuditAction({
      username: admin.username,
      action: AuditActions.RETRY_LIFECYCLE_ACTION,
      category: AuditCategories.LIFECYCLE,
      details: { actionId: id },
      ipAddress: getIpAddress(request) || 'unknown',
      userAgent: request.headers.get('user-agent') || 'unknown',
    });

    return secureJsonResponse({ message: 'Action queued for retry' }, 200);
  } catch (error) {
    console.error('Error retrying lifecycle action:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return secureErrorResponse(errorMessage);
  }
}
