import { NextRequest, NextResponse } from 'next/server';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { runLockedPasswordExpirationNotifications } from '@/lib/password-expiration';
import {
  AuditActions,
  AuditCategories,
  getIpAddress,
  getUserAgent,
  logAuditAction,
} from '@/lib/audit-log';

export async function POST(request: NextRequest) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const processing = await runLockedPasswordExpirationNotifications({
      actor: admin.username,
      statuses: ['expiring_soon', 'expired', 'must_change'],
    });
    if (processing.status === 'busy') {
      return NextResponse.json(processing, { status: 409 });
    }
    const result = processing.result;

    await logAuditAction({
      action: AuditActions.PASSWORD_EXPIRATION_SCHEDULER_RUN,
      category: AuditCategories.USER,
      username: admin.username,
      eventKind: 'notification',
      outcome: 'success',
      details: {
        manualProcess: true,
        summary: result.summary,
        correlationId: result.correlationId,
      },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to process password expiration reminders' },
      { status: 500 }
    );
  }
}
