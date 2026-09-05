import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/session';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [recentSucceeded, recentFailed, activeAlerts, pendingActions] = await Promise.all([
    prisma.cronRun.count({ where: { startedAt: { gte: since }, outcome: 'success' } }),
    prisma.cronRun.count({ where: { startedAt: { gte: since }, outcome: 'failed' } }),
    prisma.serviceAlert.count({ where: { status: 'active' } }),
    prisma.accountLifecycleAction.count({ where: { status: { in: ['pending', 'processing'] } } }),
  ]);
  return NextResponse.json({ recentSucceeded, recentFailed, activeAlerts, pendingActions }, { headers: { 'Cache-Control': 'private, no-store' } });
}
