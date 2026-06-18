import { NextRequest, NextResponse } from 'next/server';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { parseAdminJson, isJsonBodyError, MAX_REQUEST_BODY_SIZE } from '@/lib/admin-json-parser';
import { secureErrorResponse, secureJsonResponse } from '@/lib/apiResponse';
import { AuditActions, AuditCategories, getIpAddress, getUserAgent, logAuditAction } from '@/lib/audit-log';
import { processMassEmailCampaigns } from '@/lib/mass-email';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin || response) return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const body = await parseAdminJson<Record<string, unknown>>(request, MAX_REQUEST_BODY_SIZE.SMALL).catch((): Record<string, unknown> => ({}));
    const limit = typeof body.limit === 'number' ? body.limit : undefined;
    const results = await processMassEmailCampaigns({ campaignId: id, actor: admin.username, limit });

    await logAuditAction({
      action: AuditActions.PROCESS_MASS_EMAIL_CAMPAIGN,
      category: AuditCategories.MASS_EMAIL,
      username: admin.username,
      targetId: id,
      targetType: 'MassEmailCampaign',
      eventKind: 'notification',
      details: { results },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    return secureJsonResponse({ results, message: 'Mass email processing completed for this batch' });
  } catch (error) {
    if (isJsonBodyError(error)) return secureErrorResponse(error.message, error.statusCode);
    return secureErrorResponse(error instanceof Error ? error.message : 'Failed to process mass email campaign', 500);
  }
}