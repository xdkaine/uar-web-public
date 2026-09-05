import { NextRequest, NextResponse } from 'next/server';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { actorHasPermission } from '@/lib/rbac/core';
import { parseAdminJson, isJsonBodyError, MAX_REQUEST_BODY_SIZE } from '@/lib/admin-json-parser';
import { secureErrorResponse, secureJsonResponse } from '@/lib/apiResponse';
import { AuditActions, AuditCategories, getIpAddress, getUserAgent, logAuditAction } from '@/lib/audit-log';
import { requireModuleEnabled } from '@/lib/modules/guards';
import { sendMassEmailTest } from '@/lib/mass-email';

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
    const result = await sendMassEmailTest({
      to: String(body.to || ''),
      subject: String(body.subject || ''),
      html: String(body.html || ''),
    }, admin.username);

    await logAuditAction({
      action: AuditActions.TEST_MASS_EMAIL,
      category: AuditCategories.MASS_EMAIL,
      username: admin.username,
      subjectEmail: String(body.to || ''),
      eventKind: 'notification',
      details: { messageId: result.messageId },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    return secureJsonResponse({ result, message: 'Test email sent' });
  } catch (error) {
    if (isJsonBodyError(error)) return secureErrorResponse(error.message, error.statusCode);
    return secureErrorResponse(error instanceof Error ? error.message : 'Failed to send test email', 500);
  }
}