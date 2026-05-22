import { NextRequest, NextResponse } from 'next/server';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { parseAdminJson, isJsonBodyError, MAX_REQUEST_BODY_SIZE } from '@/lib/admin-json-parser';
import { secureErrorResponse, secureJsonResponse } from '@/lib/apiResponse';
import { AuditActions, AuditCategories, getIpAddress, getUserAgent, logAuditAction } from '@/lib/audit-log';
import { createMassEmailDraft, listMassEmailCampaigns, type CreateMassEmailInput } from '@/lib/mass-email';

export async function GET(request: NextRequest) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin || response) return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const campaignId = request.nextUrl.searchParams.get('id');
    const result = await listMassEmailCampaigns(campaignId);

    await logAuditAction({
      action: AuditActions.VIEW_MASS_EMAIL_CAMPAIGNS,
      category: AuditCategories.MASS_EMAIL,
      username: admin.username,
      targetId: campaignId || undefined,
      targetType: 'MassEmailCampaign',
      eventKind: 'read',
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    return secureJsonResponse(result);
  } catch (error) {
    return secureErrorResponse(error instanceof Error ? error.message : 'Failed to fetch mass email campaigns', 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin || response) return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await parseAdminJson<Record<string, unknown>>(request, MAX_REQUEST_BODY_SIZE.LARGE);
    const campaign = await createMassEmailDraft(body as unknown as CreateMassEmailInput, admin.username);

    await logAuditAction({
      action: AuditActions.CREATE_MASS_EMAIL_CAMPAIGN,
      category: AuditCategories.MASS_EMAIL,
      username: admin.username,
      targetId: campaign?.id,
      targetType: 'MassEmailCampaign',
      eventKind: 'write',
      details: {
        subject: campaign?.subject,
        eligibleRecipients: campaign?.eligibleRecipients,
        skippedRecipients: campaign?.skippedRecipients,
      },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    return secureJsonResponse({ campaign, message: 'Mass email draft created' }, 201);
  } catch (error) {
    if (isJsonBodyError(error)) return secureErrorResponse(error.message, error.statusCode);
    return secureErrorResponse(error instanceof Error ? error.message : 'Failed to create mass email draft', 500);
  }
}