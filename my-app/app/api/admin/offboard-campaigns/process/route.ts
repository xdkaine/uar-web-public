import { NextRequest, NextResponse } from 'next/server';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { actorHasPermission } from '@/lib/rbac/core';
import { processOffboardCampaigns } from '@/lib/offboard-campaign';
import { prisma } from '@/lib/prisma';

export async function POST(request: NextRequest) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!actorHasPermission(admin, 'offboard.manage')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const allowDirect = actorHasPermission(admin, 'offboard.execute_direct');
    if (!allowDirect) {
      const directCampaign = await prisma.offboardCampaign.findFirst({
        where: {
          workflowMode: 'direct',
          status: 'active',
          ...(typeof body.campaignId === 'string' ? { id: body.campaignId } : {}),
        },
        select: { id: true },
      });
      if (directCampaign) {
        return NextResponse.json({ error: 'Direct Offboarding permission is required' }, { status: 403 });
      }
    }
    const results = await processOffboardCampaigns({
      campaignId: body.campaignId,
      actor: admin.username,
      limit: body.limit,
      allowDirect,
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
