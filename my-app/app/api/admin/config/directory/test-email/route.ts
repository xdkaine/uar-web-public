import { NextRequest, NextResponse } from 'next/server';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { actorHasPermission } from '@/lib/rbac/core';
import { sendRelayTestEmail } from '@/lib/email';
import { logAuditAction, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';
import { validateEmail } from '@/lib/validation';
import { isJsonBodyError, MAX_REQUEST_BODY_SIZE, parseJsonWithLimit } from '@/lib/validation';

export const dynamic = 'force-dynamic';

/**
 * Sends a one-off test message through the resolved SMTP relay so operators
 * can verify host/port/credentials from System Configuration. Never touches
 * business flows; the recipient is operator-provided.
 */
export async function POST(request: NextRequest) {
  const { admin, response } = await checkAdminAuthWithRateLimit(request);
  if (!admin || response) {
    return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!actorHasPermission(admin, 'directory.configure')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await parseJsonWithLimit<{ to?: unknown }>(request, MAX_REQUEST_BODY_SIZE.SMALL);
    const to = typeof body.to === 'string' ? body.to.trim().toLowerCase() : '';
    if (!validateEmail(to)) {
      return NextResponse.json({ error: 'A valid recipient email address is required' }, { status: 400 });
    }

    try {
      const { messageId } = await sendRelayTestEmail(to);
      await logAuditAction({
        action: 'test_email_relay',
        category: AuditCategories.SETTINGS,
        username: admin.username,
        eventKind: 'security',
        outcome: 'success',
        details: { to },
        ipAddress: getIpAddress(request),
        userAgent: getUserAgent(request),
      }).catch(() => undefined);
      return NextResponse.json({ ok: true, messageId });
    } catch (sendError) {
      const message = sendError instanceof Error ? sendError.message : 'Relay test failed';
      await logAuditAction({
        action: 'test_email_relay',
        category: AuditCategories.SETTINGS,
        username: admin.username,
        eventKind: 'security',
        outcome: 'failure',
        details: { to, error: message },
        ipAddress: getIpAddress(request),
        userAgent: getUserAgent(request),
      }).catch(() => undefined);
      return NextResponse.json({ ok: false, error: message }, { status: 502 });
    }
  } catch (error) {
    if (isJsonBodyError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error('Error running relay test:', error);
    return NextResponse.json({ error: 'Failed to run relay test' }, { status: 500 });
  }
}
