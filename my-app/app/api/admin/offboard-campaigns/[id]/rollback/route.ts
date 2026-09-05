import { NextRequest, NextResponse } from 'next/server';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { actorHasPermission } from '@/lib/rbac/core';
import { executeOffboardOperation, OffboardOperationError } from '@/lib/offboard-campaign';
import { logAuditAction, AuditActions, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';
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
    const body = await request.json().catch(() => ({}));
    const idempotencyKey = request.headers.get('Idempotency-Key') || '';
    const result = await executeOffboardOperation({
      campaignId: id,
      kind: 'rollback',
      actor: admin.username,
      previewId: typeof body.previewId === 'string' ? body.previewId : '',
      digest: typeof body.digest === 'string' ? body.digest : '',
      idempotencyKey,
    });
    const campaign = result.campaign;

    await logAuditAction({
      action: campaign?.rollbackFailureCount ? AuditActions.OFFBOARD_ROLLBACK_FAILURE : AuditActions.OFFBOARD_ROLLBACK_SUCCESS,
      category: AuditCategories.OFFBOARD_CAMPAIGN,
      username: admin.username,
      targetId: id,
      targetType: 'OffboardCampaign',
      details: {
        rollbackSuccessCount: campaign?.rollbackSuccessCount,
        rollbackFailureCount: campaign?.rollbackFailureCount,
      },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    return NextResponse.json({ campaign, run: result.run, duplicate: result.duplicate, message: result.duplicate ? 'Rollback already processed' : 'Rollback processed' });
  } catch (error) {
    if (error instanceof OffboardOperationError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to execute rollback' },
      { status: 500 }
    );
  }
}
