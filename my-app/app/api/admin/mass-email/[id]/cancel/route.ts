import { NextRequest, NextResponse } from 'next/server';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { secureErrorResponse, secureJsonResponse } from '@/lib/apiResponse';
import { AuditActions, AuditCategories, getIpAddress, getUserAgent, logAuditAction } from '@/lib/audit-log';
import { cancelMassEmailCampaign } from '@/lib/mass-email';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin || response) return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const campaign = await cancelMassEmailCampaign(id, admin.username);

    await logAuditAction({
      action: AuditActions.CANCEL_MASS_EMAIL_CAMPAIGN,
      category: AuditCategories.MASS_EMAIL,
      username: admin.username,
      targetId: id,
      targetType: 'MassEmailCampaign',
      eventKind: 'write',
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    return secureJsonResponse({ campaign, message: 'Mass email campaign cancelled' });
  } catch (error) {
    return secureErrorResponse(error instanceof Error ? error.message : 'Failed to cancel mass email campaign', 500);
  }
}