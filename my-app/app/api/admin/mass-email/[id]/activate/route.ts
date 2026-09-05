import { NextRequest, NextResponse } from 'next/server';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { actorHasPermission } from '@/lib/rbac/core';
import { secureErrorResponse, secureJsonResponse } from '@/lib/apiResponse';
import { AuditActions, AuditCategories, getIpAddress, getUserAgent, logAuditAction } from '@/lib/audit-log';
import { requireModuleEnabled } from '@/lib/modules/guards';
import { activateMassEmailCampaign } from '@/lib/mass-email';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin || response) return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!actorHasPermission(admin, 'communications.manage')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const moduleGuard = await requireModuleEnabled('communications');
    if (moduleGuard) return moduleGuard;

    const { id } = await params;
    const campaign = await activateMassEmailCampaign(id, admin.username);

    await logAuditAction({
      action: AuditActions.ACTIVATE_MASS_EMAIL_CAMPAIGN,
      category: AuditCategories.MASS_EMAIL,
      username: admin.username,
      targetId: id,
      targetType: 'MassEmailCampaign',
      eventKind: 'notification',
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    return secureJsonResponse({ campaign, message: 'Mass email campaign activated' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to activate mass email campaign';
    return secureErrorResponse(message, message === 'MASS_EMAIL_PREVIEW_STALE' ? 409 : 500);
  }
}
