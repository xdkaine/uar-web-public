import { NextRequest, NextResponse } from 'next/server';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { processOffboardCampaigns } from '@/lib/offboard-campaign';

export async function POST(request: NextRequest) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const results = await processOffboardCampaigns({
      campaignId: body.campaignId,
      actor: admin.username,
      limit: body.limit,
    });

    return NextResponse.json({
      success: true,
      results,
      message: `Processed ${results.length} offboard campaign(s)`,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to process offboard campaigns' },
      { status: 500 }
    );
  }
}
