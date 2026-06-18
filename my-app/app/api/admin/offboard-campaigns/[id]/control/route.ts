import { NextRequest, NextResponse } from 'next/server';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { controlOffboardCampaign } from '@/lib/offboard-campaign';
import { logAuditAction, AuditActions, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';

function auditActionForControl(action: string) {
  if (action.startsWith('pause')) return AuditActions.PAUSE_OFFBOARD_CAMPAIGN;
  if (action.startsWith('resume')) return AuditActions.RESUME_OFFBOARD_CAMPAIGN;
  if (action === 'cancel') return AuditActions.CANCEL_OFFBOARD_CAMPAIGN;
  if (action === 'emergency_stop') return AuditActions.EMERGENCY_STOP_OFFBOARD_CAMPAIGN;
  return AuditActions.UPDATE_SETTINGS;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const action = String(body.action || '');
    if (!action) {
      return NextResponse.json({ error: 'Action is required' }, { status: 400 });
    }

    const campaign = await controlOffboardCampaign(id, action, admin.username);

    await logAuditAction({
      action: auditActionForControl(action),
      category: AuditCategories.OFFBOARD_CAMPAIGN,
      username: admin.username,
      targetId: id,
      targetType: 'OffboardCampaign',
      details: { action },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    return NextResponse.json({ campaign, message: 'Campaign control updated' });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update campaign control' },
      { status: 500 }
    );
  }
}
