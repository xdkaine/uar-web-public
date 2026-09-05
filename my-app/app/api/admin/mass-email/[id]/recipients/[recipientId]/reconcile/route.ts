import { NextRequest, NextResponse } from 'next/server';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { actorHasPermission } from '@/lib/rbac/core';
import { parseAdminJson, isJsonBodyError, MAX_REQUEST_BODY_SIZE } from '@/lib/admin-json-parser';
import { secureErrorResponse, secureJsonResponse } from '@/lib/apiResponse';
import { AuditActions, AuditCategories, getIpAddress, getUserAgent, logAuditAction } from '@/lib/audit-log';
import { reconcileMassEmailRecipient } from '@/lib/mass-email';

type ReconcileBody = {
  resolution?: 'delivered' | 'not_delivered';
  evidence?: string;
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; recipientId: string }> }
) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin || response) return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!actorHasPermission(admin, 'communications.manage')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id, recipientId } = await params;
    const body = await parseAdminJson<ReconcileBody>(request, MAX_REQUEST_BODY_SIZE.SMALL);
    if (!body.resolution || !['delivered', 'not_delivered'].includes(body.resolution)) {
      return secureErrorResponse('A valid reconciliation resolution is required', 400);
    }
    const campaign = await reconcileMassEmailRecipient(
      id,
      recipientId,
      admin.username,
      body.resolution,
      body.evidence || ''
    );

    await logAuditAction({
      action: AuditActions.PROCESS_MASS_EMAIL_CAMPAIGN,
      category: AuditCategories.MASS_EMAIL,
      username: admin.username,
      targetId: recipientId,
      targetType: 'MassEmailRecipient',
      eventKind: 'notification',
      outcome: 'success',
      details: { campaignId: id, resolution: body.resolution, evidenceProvided: true },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    return secureJsonResponse({ campaign, message: 'Recipient outcome reconciled' });
  } catch (error) {
    if (isJsonBodyError(error)) return secureErrorResponse(error.message, error.statusCode);
    const message = error instanceof Error ? error.message : 'Failed to reconcile recipient';
    const status = /not found/i.test(message) ? 404 : /Only|evidence|conflict/i.test(message) ? 409 : 500;
    return secureErrorResponse(message, status);
  }
}
