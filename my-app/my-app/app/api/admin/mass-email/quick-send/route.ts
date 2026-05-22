import { NextRequest, NextResponse } from 'next/server';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { parseAdminJson, isJsonBodyError, MAX_REQUEST_BODY_SIZE } from '@/lib/admin-json-parser';
import { secureErrorResponse, secureJsonResponse } from '@/lib/apiResponse';
import { AuditActions, AuditCategories, getIpAddress, getUserAgent, logAuditAction } from '@/lib/audit-log';
import { quickSendMassEmail, type CreateMassEmailInput } from '@/lib/mass-email';

export async function POST(request: NextRequest) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin || response) return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await parseAdminJson<Record<string, unknown>>(request, MAX_REQUEST_BODY_SIZE.LARGE);
    const result = await quickSendMassEmail(body as unknown as CreateMassEmailInput, admin.username);

    await logAuditAction({
      action: AuditActions.QUICK_SEND_MASS_EMAIL,
      category: AuditCategories.MASS_EMAIL,
      username: admin.username,
      targetId: result.campaign?.id,
      targetType: 'MassEmailCampaign',
      eventKind: 'notification',
      details: {
        subject: result.campaign?.subject,
        eligibleRecipients: result.campaign?.eligibleRecipients,
        initialProcessResults: result.results,
      },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    return secureJsonResponse({ ...result, message: 'Mass email quick-send started' }, 201);
  } catch (error) {
    if (isJsonBodyError(error)) return secureErrorResponse(error.message, error.statusCode);
    return secureErrorResponse(error instanceof Error ? error.message : 'Failed to start mass email quick-send', 500);
  }
}