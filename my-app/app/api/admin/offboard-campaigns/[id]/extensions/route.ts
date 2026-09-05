import { NextRequest, NextResponse } from 'next/server';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { actorHasPermission } from '@/lib/rbac/core';
import {
  extendOffboardCampaignDeadline,
  type ExtendOffboardCampaignInput,
} from '@/lib/offboard-campaign';
import { isJsonBodyError, parseAdminJson, MAX_REQUEST_BODY_SIZE } from '@/lib/admin-json-parser';
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
    if (!actorHasPermission(admin, 'offboard.manage')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const { id } = await params;
    const body = await parseAdminJson<ExtendOffboardCampaignInput>(
      request,
      MAX_REQUEST_BODY_SIZE.MEDIUM
    );
    const result = await extendOffboardCampaignDeadline(id, body, admin.username);
    await logAuditAction({
      action: AuditActions.OFFBOARD_DEADLINE_EXTENSION,
      category: AuditCategories.OFFBOARD_CAMPAIGN,
      username: admin.username,
      targetId: id,
      targetType: 'OffboardCampaign',
      details: {
        requestedRecipients: body.recipientIds?.length || 'all',
        newDeadline: body.newDeadline,
        reminderCount: body.reminderDates?.length || 0,
        results: result.results,
      },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });
    return NextResponse.json({ ...result, message: 'Deadline extension processed' });
  } catch (error) {
    if (isJsonBodyError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Deadline extension failed' },
      { status: 400 }
    );
  }
}
