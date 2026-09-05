import { NextRequest, NextResponse } from 'next/server';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { actorHasPermission } from '@/lib/rbac/core';
import { retryOffboardExtensionNotification } from '@/lib/offboard-campaign';
import { logAuditAction, AuditActions, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; extensionId: string }> }
) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!actorHasPermission(admin, 'offboard.manage')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const { id, extensionId } = await params;
    const result = await retryOffboardExtensionNotification(id, extensionId, admin.username);
    await logAuditAction({
      action: AuditActions.OFFBOARD_EXTENSION_NOTIFICATION_RETRY,
      category: AuditCategories.OFFBOARD_CAMPAIGN,
      username: admin.username,
      targetId: extensionId,
      targetType: 'OffboardCampaignExtension',
      details: { campaignId: id },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });
    return NextResponse.json({ ...result, message: 'Extension notification resent' });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to retry extension notification' },
      { status: 400 }
    );
  }
}
