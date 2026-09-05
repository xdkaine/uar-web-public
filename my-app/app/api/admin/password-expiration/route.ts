import { NextRequest, NextResponse } from 'next/server';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { actorHasPermission } from '@/lib/rbac/core';
import { getPasswordExpirationReport } from '@/lib/password-expiration';
import {
  AuditActions,
  AuditCategories,
  getIpAddress,
  getUserAgent,
  logAuditAction,
} from '@/lib/audit-log';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!actorHasPermission(admin, 'password_expiration.read')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const report = await getPasswordExpirationReport();
    const recentLogs = await prisma.auditLog.findMany({
      where: {
        action: {
          in: [
            AuditActions.PASSWORD_EXPIRATION_EMAIL_SENT,
            AuditActions.PASSWORD_EXPIRATION_EMAIL_SKIPPED,
            AuditActions.PASSWORD_EXPIRATION_EMAIL_FAILURE,
            AuditActions.PASSWORD_EXPIRATION_SCHEDULER_RUN,
          ],
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 25,
      select: {
        id: true,
        createdAt: true,
        action: true,
        username: true,
        actorType: true,
        subjectUsername: true,
        subjectEmail: true,
        outcome: true,
        success: true,
        errorMessage: true,
      },
    });

    await logAuditAction({
      action: AuditActions.VIEW_PASSWORD_EXPIRATION_REPORT,
      category: AuditCategories.USER,
      username: admin.username,
      eventKind: 'read',
      details: {
        total: report.summary.total,
        expiringSoon: report.summary.expiring_soon,
        expired: report.summary.expired,
        mustChange: report.summary.must_change,
      },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    return NextResponse.json({ ...report, recentLogs });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch password expiration report' },
      { status: 500 }
    );
  }
}
