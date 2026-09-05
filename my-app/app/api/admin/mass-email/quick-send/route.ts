import { NextRequest, NextResponse } from 'next/server';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { actorHasPermission } from '@/lib/rbac/core';
import { parseAdminJson, isJsonBodyError, MAX_REQUEST_BODY_SIZE } from '@/lib/admin-json-parser';
import { secureErrorResponse, secureJsonResponse } from '@/lib/apiResponse';
import { AuditActions, AuditCategories, getIpAddress, getUserAgent, logAuditAction } from '@/lib/audit-log';
import { requireModuleEnabled } from '@/lib/modules/guards';
import { quickSendMassEmail, type CreateMassEmailInput } from '@/lib/mass-email';

export async function POST(request: NextRequest) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin || response) return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!actorHasPermission(admin, 'communications.manage')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const moduleGuard = await requireModuleEnabled('communications');
    if (moduleGuard) return moduleGuard;

    const body = await parseAdminJson<Record<string, unknown>>(request, MAX_REQUEST_BODY_SIZE.LARGE);
    const previewDigest = typeof body.previewDigest === 'string' ? body.previewDigest : '';
    const result = await quickSendMassEmail(body as unknown as CreateMassEmailInput, admin.username, previewDigest);

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

    const failed = result.results.reduce((total, summary) => total + summary.failed, 0);
    const sent = result.results.reduce((total, summary) => total + summary.sent, 0);
    return secureJsonResponse({
      ...result,
      success: failed === 0,
      partial: failed > 0,
      initialWave: { sent, failed },
      message: failed > 0
        ? `Quick-send started; ${sent} sent and ${failed} failed in the initial wave`
        : `Quick-send started; ${sent} sent in the initial wave`,
    }, failed > 0 ? 207 : 201);
  } catch (error) {
    if (isJsonBodyError(error)) return secureErrorResponse(error.message, error.statusCode);
    if (error instanceof Error && error.message === 'MASS_EMAIL_PREVIEW_STALE') {
      return secureErrorResponse('The audience or message changed. Run the dry run again before sending.', 409);
    }
    return secureErrorResponse(error instanceof Error ? error.message : 'Failed to start mass email quick-send', 500);
  }
}
