import { NextRequest, NextResponse } from 'next/server';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { listOffboardCampaigns } from '@/lib/offboard-campaign';
import { logAuditAction, AuditActions, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';

export async function GET(request: NextRequest) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const campaignId = request.nextUrl.searchParams.get('id');
    const result = await listOffboardCampaigns(campaignId);

    await logAuditAction({
      action: AuditActions.VIEW_OFFBOARD_CAMPAIGNS,
      category: AuditCategories.OFFBOARD_CAMPAIGN,
      username: admin.username,
      targetId: campaignId || undefined,
      targetType: 'OffboardCampaign',
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch offboard campaigns' },
      { status: 500 }
    );
  }
}
