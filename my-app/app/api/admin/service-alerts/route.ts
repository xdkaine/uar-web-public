import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { actorHasPermission } from '@/lib/rbac/core';

export async function GET(request: NextRequest) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!actorHasPermission(admin, 'service_alerts.read')) {
      return NextResponse.json({ error: 'Forbidden - insufficient permissions' }, { status: 403 });
    }

    const statusParam = request.nextUrl.searchParams.get('status');
    const where =
      statusParam === 'active' || statusParam === 'resolved' || statusParam === 'dismissed'
        ? { status: statusParam }
        : {};

    const alerts = await prisma.serviceAlert.findMany({
      where,
      orderBy: [{ status: 'desc' }, { lastSeenAt: 'desc' }],
      take: 200,
    });

    return NextResponse.json({ alerts });
  } catch (error) {
    console.error('Error listing service alerts:', error);
    return NextResponse.json({ error: 'Failed to list service alerts' }, { status: 500 });
  }
}
