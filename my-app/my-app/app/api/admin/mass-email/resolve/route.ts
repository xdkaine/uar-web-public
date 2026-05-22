import { NextRequest, NextResponse } from 'next/server';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { parseAdminJson, isJsonBodyError, MAX_REQUEST_BODY_SIZE } from '@/lib/admin-json-parser';
import { secureErrorResponse, secureJsonResponse } from '@/lib/apiResponse';
import { AuditActions, AuditCategories, getIpAddress, getUserAgent, logAuditAction } from '@/lib/audit-log';
import { resolveMassEmailRecipients, type MassEmailTargetInput } from '@/lib/mass-email';

export async function POST(request: NextRequest) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin || response) return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

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

    return secureJsonResponse({ resolution });
  } catch (error) {
    if (isJsonBodyError(error)) return secureErrorResponse(error.message, error.statusCode);
    return secureErrorResponse(error instanceof Error ? error.message : 'Failed to resolve mass email recipients', 500);
  }
}