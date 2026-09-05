import { NextRequest, NextResponse } from 'next/server';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { actorHasPermission } from '@/lib/rbac/core';
import { createOffboardOperationPreview } from '@/lib/offboard-campaign';
import { prisma } from '@/lib/prisma';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin || response) return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!actorHasPermission(admin, 'offboard.manage')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const { id } = await params;
    const campaign = await prisma.offboardCampaign.findUnique({
      where: { id },
      select: { workflowMode: true },
    });
    if (campaign?.workflowMode === 'direct' && !actorHasPermission(admin, 'offboard.execute_direct')) {
      return NextResponse.json({ error: 'Direct offboarding permission is required' }, { status: 403 });
    }
    const preview = await createOffboardOperationPreview(id, 'activation', admin.username);
    return NextResponse.json({ preview });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to build activation preview' }, { status: 500 });
  }
}
