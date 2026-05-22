import { NextRequest, NextResponse } from 'next/server';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { executeOffboardRollback } from '@/lib/offboard-campaign';
import { logAuditAction, AuditActions, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';

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
    const campaign = await executeOffboardRollback(id, admin.username);

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

    return NextResponse.json({ campaign, message: 'Rollback processed' });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to execute rollback' },
      { status: 500 }
    );
  }
}
