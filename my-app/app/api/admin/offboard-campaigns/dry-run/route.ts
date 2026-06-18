import { NextRequest, NextResponse } from 'next/server';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { createOffboardDryRun } from '@/lib/offboard-campaign';
import { logAuditAction, AuditActions, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';

export async function POST(request: NextRequest) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const campaign = await createOffboardDryRun(body, admin.username);

    await logAuditAction({
      action: AuditActions.OFFBOARD_DRY_RUN,
      category: AuditCategories.OFFBOARD_CAMPAIGN,
      username: admin.username,
      targetId: campaign?.id,
      targetType: 'OffboardCampaign',
      details: {
        name: body.name,
        waveSize: body.waveSize,
        canarySize: body.canarySize,
        includedUsernames: Array.isArray(body.includedUsernames) ? body.includedUsernames.length : 0,
      },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    return NextResponse.json({ campaign, message: 'Dry run created' });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create offboard dry run' },
      { status: 500 }
    );
  }
}
