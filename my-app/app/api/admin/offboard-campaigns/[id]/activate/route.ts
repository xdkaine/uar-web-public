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
    const body = await request.json().catch(() => ({}));
    const campaignRecord = await prisma.offboardCampaign.findUnique({
      where: { id },
      select: { workflowMode: true },
    });
    if (campaignRecord?.workflowMode === 'direct' && !actorHasPermission(admin, 'offboard.execute_direct')) {
      return NextResponse.json({ error: 'Direct offboarding permission is required' }, { status: 403 });
    }
    const idempotencyKey = request.headers.get('Idempotency-Key') || '';
    const result = await executeOffboardOperation({
      campaignId: id,
      kind: 'activation',
      actor: admin.username,
      previewId: typeof body.previewId === 'string' ? body.previewId : '',
      digest: typeof body.digest === 'string' ? body.digest : '',
      idempotencyKey,
      directAcknowledgement: typeof body.directAcknowledgement === 'string' ? body.directAcknowledgement : undefined,
      irreversibleAcknowledgement: body.irreversibleAcknowledgement === true,
      authorizationEvidence: {
        ipAddress: getIpAddress(request),
        userAgent: getUserAgent(request),
        permission: campaignRecord?.workflowMode === 'direct' ? 'offboard.execute_direct' : 'offboard.manage',
      },
    });
    const campaign = result.campaign;

    await logAuditAction({
      action: AuditActions.ACTIVATE_OFFBOARD_CAMPAIGN,
      category: AuditCategories.OFFBOARD_CAMPAIGN,
      username: admin.username,
      targetId: id,
      targetType: 'OffboardCampaign',
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    return NextResponse.json({
      campaign,
      run: result.run,
      duplicate: result.duplicate,
      message: result.duplicate
        ? 'Activation already processed'
        : campaignRecord?.workflowMode === 'direct'
          ? 'Direct offboarding activated and first reviewed wave processed'
          : 'Campaign activated and first wave released',
    });
  } catch (error) {
    if (error instanceof OffboardOperationError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to activate offboard campaign' },
      { status: 500 }
    );
  }
}
