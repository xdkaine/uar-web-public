import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { actorHasPermission } from '@/lib/rbac/core';
import { logAuditAction, getIpAddress, getUserAgent, AuditCategories } from '@/lib/audit-log';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!actorHasPermission(admin, 'service_alerts.manage')) {
      return NextResponse.json({ error: 'Forbidden - insufficient permissions' }, { status: 403 });
    }

    const resolvedParams = await params;
    const alert = await prisma.serviceAlert.findUnique({
      where: { id: resolvedParams.id },
    });

    if (!alert) {
      return NextResponse.json({ error: 'Service alert not found' }, { status: 404 });
    }

    if (alert.status !== 'active' && alert.status !== 'resolved') {
      return NextResponse.json(
        { error: `Alert is already ${alert.status}` },
        { status: 409 }
      );
    }

    const updated = await prisma.serviceAlert.update({
      where: { id: alert.id },
      data: {
        status: 'dismissed',
        dismissedBy: admin.username,
        dismissedAt: new Date(),
      },
    });

    await logAuditAction({
      action: 'dismiss_service_alert',
      category: AuditCategories.SETTINGS,
      username: admin.username,
      targetId: alert.id,
      targetType: 'ServiceAlert',
      details: {
        dedupeKey: alert.dedupeKey,
        category: alert.category,
        occurrenceCount: alert.occurrenceCount,
        previousStatus: alert.status,
      },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    return NextResponse.json({ alert: updated });
  } catch (error) {
    console.error('Error dismissing service alert:', error);
    return NextResponse.json({ error: 'Failed to dismiss service alert' }, { status: 500 });
  }
}
