import { NextRequest, NextResponse } from 'next/server';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { actorHasPermission } from '@/lib/rbac/core';
import { retryNotification } from '@/lib/notification-queue';
import { appLogger } from '@/lib/logger';
import { getIpAddress, logAuditAction } from '@/lib/audit-log';

/**
 * Admin endpoint to manually retry sending notification for a request
 * POST /api/admin/requests/[id]/resend-notification
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
    if (!actorHasPermission(admin, 'access_requests.provision')) {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    
    const { id: requestId } = await params;
    
    appLogger.info('Admin manually retrying notification', {
      requestId,
      adminUser: admin.username,
    });
    
    // Attempt to resend notification
    const success = await retryNotification(requestId);
    
    if (success) {
      // Log audit action
      await logAuditAction({
        action: 'resend_notification',
        category: 'request_management',
        username: admin.username,
        targetId: requestId,
        targetType: 'access_request',
        details: { action: 'manually_resent_notification' },
        ipAddress: getIpAddress(request) || 'unknown',
        success: true,
      });
      
      appLogger.info('Notification manually resent successfully', {
        requestId,
        adminUser: admin.username,
      });
      
      return NextResponse.json({
        success: true,
        message: 'Notification sent successfully',
      });
    } else {
      return NextResponse.json(
        { error: 'Failed to send notification' },
        { status: 500 }
      );
    }
    
  } catch (error) {
    appLogger.error('Failed to resend notification', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    
    return NextResponse.json(
      { error: 'Failed to resend notification' },
      { status: 500 }
    );
  }
}
