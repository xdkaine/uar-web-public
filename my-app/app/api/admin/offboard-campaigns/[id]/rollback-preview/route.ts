import { NextRequest, NextResponse } from 'next/server';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { actorHasPermission } from '@/lib/rbac/core';
import { createOffboardOperationPreview } from '@/lib/offboard-campaign';
import { prisma } from '@/lib/prisma';

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
    const campaignMode = await prisma.offboardCampaign.findUnique({ where: { id }, select: { workflowMode: true } });
    if (!campaignMode) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    if (campaignMode.workflowMode === 'direct') {
      if (!actorHasPermission(admin, 'offboard.execute_direct')) {
        return NextResponse.json({ error: 'Direct Offboarding permission is required' }, { status: 403 });
      }
      return NextResponse.json({ error: 'Direct offboarding cannot be rolled back; future access requires a new account request' }, { status: 409 });
    }
    const preview = await createOffboardOperationPreview(id, 'rollback', admin.username);
    return NextResponse.json({ preview });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to build rollback preview' },
      { status: 500 }
    );
  }
}
