import { NextRequest, NextResponse } from 'next/server';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { actorHasPermission } from '@/lib/rbac/core';
import { parseAdminJson, isJsonBodyError, MAX_REQUEST_BODY_SIZE } from '@/lib/admin-json-parser';
import { reconcileOffboardEnforcement } from '@/lib/offboard-campaign';
import { logAuditAction, AuditActions, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';
import { prisma } from '@/lib/prisma';

type ReconcileBody = {
  resolution?: 'not_applied' | 'verified_complete';
  evidence?: string;
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; recipientId: string }> }
) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin || response) return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!actorHasPermission(admin, 'offboard.manage')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id, recipientId } = await params;
    const campaignMode = await prisma.offboardCampaign.findUnique({
      where: { id },
      select: { workflowMode: true },
    });
    if (!campaignMode) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    if (campaignMode.workflowMode === 'direct' && !actorHasPermission(admin, 'offboard.execute_direct')) {
      return NextResponse.json({ error: 'Direct Offboarding permission is required' }, { status: 403 });
    }
    const body = await parseAdminJson<ReconcileBody>(request, MAX_REQUEST_BODY_SIZE.SMALL);
    if (!body.resolution || !['not_applied', 'verified_complete'].includes(body.resolution)) {
      return NextResponse.json({ error: 'A valid reconciliation resolution is required' }, { status: 400 });
    }
    const campaign = await reconcileOffboardEnforcement({
      campaignId: id,
      recipientId,
      actor: admin.username,
      resolution: body.resolution,
      evidence: body.evidence || '',
    });

    await logAuditAction({
      action: AuditActions.OFFBOARD_ENFORCEMENT_RECONCILED,
      category: AuditCategories.OFFBOARD_CAMPAIGN,
      username: admin.username,
      targetId: recipientId,
      targetType: 'OffboardCampaignRecipient',
      eventKind: 'lifecycle',
      outcome: 'success',
      details: { campaignId: id, resolution: body.resolution, evidenceProvided: true },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    return NextResponse.json({ campaign, success: true });
  } catch (error) {
    if (isJsonBodyError(error)) return NextResponse.json({ error: error.message }, { status: error.statusCode });
    const message = error instanceof Error ? error.message : 'Failed to reconcile enforcement';
    const status = /not found/i.test(message) ? 404 : /Only|evidence|must|conflict/i.test(message) ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
