import { NextRequest, NextResponse } from 'next/server';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { actorHasPermission } from '@/lib/rbac/core';
import { parseAdminJson, isJsonBodyError, MAX_REQUEST_BODY_SIZE } from '@/lib/admin-json-parser';
import { secureErrorResponse, secureJsonResponse } from '@/lib/apiResponse';
import { AuditActions, AuditCategories, getIpAddress, getUserAgent, logAuditAction } from '@/lib/audit-log';
import { previewMassEmailContent } from '@/lib/mass-email';

export async function POST(request: NextRequest) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin || response) return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!actorHasPermission(admin, 'communications.manage')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await parseAdminJson<Record<string, unknown>>(request, MAX_REQUEST_BODY_SIZE.LARGE);
    const preview = previewMassEmailContent(String(body.subject || ''), String(body.html || ''));

    await logAuditAction({
      action: AuditActions.PREVIEW_MASS_EMAIL,
      category: AuditCategories.MASS_EMAIL,
      username: admin.username,
      eventKind: 'read',
      details: { subject: preview.subject, htmlLength: preview.html.length },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    return secureJsonResponse({ preview });
  } catch (error) {
    if (isJsonBodyError(error)) return secureErrorResponse(error.message, error.statusCode);
    return secureErrorResponse(error instanceof Error ? error.message : 'Failed to preview mass email', 500);
  }
}