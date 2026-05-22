import { NextRequest, NextResponse } from 'next/server';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { parseAdminJson, isJsonBodyError, MAX_REQUEST_BODY_SIZE } from '@/lib/admin-json-parser';
import { secureErrorResponse, secureJsonResponse } from '@/lib/apiResponse';
import { AuditActions, AuditCategories, getIpAddress, getUserAgent, logAuditAction } from '@/lib/audit-log';
import { getMassEmailCampaign, updateMassEmailDraft, type UpdateMassEmailDraftInput } from '@/lib/mass-email';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin || response) return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const campaign = await getMassEmailCampaign(id);
    if (!campaign) return secureErrorResponse('Mass email campaign not found', 404);

    await logAuditAction({
      action: AuditActions.VIEW_MASS_EMAIL_CAMPAIGNS,
      category: AuditCategories.MASS_EMAIL,
      username: admin.username,
      targetId: id,
      targetType: 'MassEmailCampaign',
      eventKind: 'read',
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    return secureJsonResponse({ campaign });
  } catch (error) {
    return secureErrorResponse(error instanceof Error ? error.message : 'Failed to fetch mass email campaign', 500);
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin || response) return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const body = await parseAdminJson<Record<string, unknown>>(request, MAX_REQUEST_BODY_SIZE.LARGE);
    const campaign = await updateMassEmailDraft(id, body as unknown as UpdateMassEmailDraftInput, admin.username);

    await logAuditAction({
      action: AuditActions.UPDATE_MASS_EMAIL_CAMPAIGN,
      category: AuditCategories.MASS_EMAIL,
      username: admin.username,
      targetId: id,
      targetType: 'MassEmailCampaign',
      eventKind: 'write',
      details: {
        subject: campaign.subject,
        eligibleRecipients: campaign.eligibleRecipients,
        skippedRecipients: campaign.skippedRecipients,
      },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    return secureJsonResponse({ campaign, message: 'Mass email draft updated' });
  } catch (error) {
    if (isJsonBodyError(error)) return secureErrorResponse(error.message, error.statusCode);
    return secureErrorResponse(error instanceof Error ? error.message : 'Failed to update mass email draft', 500);
  }
}