import { NextRequest, NextResponse } from 'next/server';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { actorHasPermission } from '@/lib/rbac/core';
import { parseAdminJson, isJsonBodyError, MAX_REQUEST_BODY_SIZE } from '@/lib/admin-json-parser';
import { secureErrorResponse, secureJsonResponse } from '@/lib/apiResponse';
import { AuditActions, AuditCategories, getIpAddress, getUserAgent, logAuditAction } from '@/lib/audit-log';
import { massEmailPreviewDigest, resolveMassEmailRecipients, type MassEmailTargetInput } from '@/lib/mass-email';

export async function POST(request: NextRequest) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin || response) return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!actorHasPermission(admin, 'communications.manage')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await parseAdminJson<Record<string, unknown>>(request, MAX_REQUEST_BODY_SIZE.MEDIUM);
    const resolution = await resolveMassEmailRecipients((body.targets || body) as MassEmailTargetInput);

    await logAuditAction({
      action: AuditActions.RESOLVE_MASS_EMAIL_RECIPIENTS,
      category: AuditCategories.MASS_EMAIL,
      username: admin.username,
      eventKind: 'read',
      details: resolution.summary,
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    return secureJsonResponse({
      resolution,
      previewDigest: massEmailPreviewDigest(
        resolution,
        typeof body.subject === 'string' ? body.subject : '',
        typeof body.html === 'string' ? body.html : ''
      ),
    });
  } catch (error) {
    if (isJsonBodyError(error)) return secureErrorResponse(error.message, error.statusCode);
    return secureErrorResponse(error instanceof Error ? error.message : 'Failed to resolve mass email recipients', 500);
  }
}
