import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAuditAccessWithRateLimit } from '@/lib/adminAuth';
import { effectiveCronRouteRegistry } from '@/lib/cron/registry';
import { OPERATIONAL_EVIDENCE_ARCHIVE_AFTER_DAYS } from '@/lib/operations/detectors';
import { projectCronRunForAudit } from '@/lib/cron/evidence';

export const dynamic = 'force-dynamic';

/**
 * Scheduler health evidence (roadmap §6.1 Overview & Health). Read-only view
 * of recorded cron executions; rows are written by the observability wrapper
 * and never edited here. The static registry is echoed so the UI can render
 * every scheduled job - including ones that have never recorded a run.
 */
export async function GET(request: NextRequest) {
  const { admin, response } = await checkAuditAccessWithRateLimit(request);
  if (!admin || response) {
    return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const searchParams = request.nextUrl.searchParams;
  const route = searchParams.get('route')?.trim() || undefined;
  const limitRaw = Number.parseInt(searchParams.get('limit') || '50', 10);
  const limit = Math.min(200, Math.max(1, limitRaw || 50));

  const [total, runs, flowRuns, operationalSignals, signalEvents, routes] = await Promise.all([
    prisma.cronRun.count({ where: route ? { route } : undefined }),
    prisma.cronRun.findMany({
      where: route ? { route } : undefined,
      orderBy: { startedAt: 'desc' },
      take: limit,
    }),
    prisma.flowRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: Math.min(limit, 40),
      select: {
        id: true,
        status: true,
        triggerKey: true,
        startedAt: true,
        finishedAt: true,
        graph: { select: { id: true, name: true, version: true } },
      },
    }),
    prisma.operationalSignal.findMany({
      where: {
        subjectType: 'scheduled_job',
        ...(route ? { subjectId: route } : {}),
      },
      orderBy: { lastSeenAt: 'desc' },
      take: route ? 20 : 40,
    }),
    prisma.operationalSignalEvent.findMany({
      where: {
        signal: {
          subjectType: 'scheduled_job',
          ...(route ? { subjectId: route } : {}),
        },
      },
      orderBy: { createdAt: 'desc' },
      take: route ? 50 : 20,
      include: {
        signal: {
          select: { subjectId: true, reasonCode: true, status: true },
        },
      },
    }),
    // This rollup does not depend on any request-scoped result above. Keep it
    // in the same read batch so opening the audit view does not create a
    // needless database round trip.
    prisma.cronRun.groupBy({
      by: ['route', 'outcome'],
      _count: { _all: true },
      _max: { startedAt: true },
    }),
  ]);

  // Per-route rollup for the health card: last run, outcome counts.
  const routeHealth = new Map<
    string,
    { route: string; lastRunAt: string | null; latestOutcome: string | null; outcomes: Record<string, number> }
  >();
  for (const row of routes) {
    let entry = routeHealth.get(row.route);
    if (!entry) {
      entry = { route: row.route, lastRunAt: null, latestOutcome: null, outcomes: {} };
      routeHealth.set(row.route, entry);
    }
    entry.outcomes[row.outcome] = (entry.outcomes[row.outcome] ?? 0) + row._count._all;
    const lastAt = row._max.startedAt;
    if (lastAt && (!entry.lastRunAt || lastAt.toISOString() > entry.lastRunAt)) {
      entry.lastRunAt = lastAt.toISOString();
    }
  }

  await Promise.all(Array.from(routeHealth.values()).map(async (entry) => {
    const latest = await prisma.cronRun.findFirst({
      where: { route: entry.route },
      orderBy: { startedAt: 'desc' },
      select: { outcome: true },
    });
    entry.latestOutcome = latest?.outcome ?? null;
  }));

  return NextResponse.json({
    runs: runs.map(projectCronRunForAudit),
    total,
    limit,
    flowRuns: flowRuns.map((run) => ({
      id: run.id,
      status: run.status,
      triggerKey: run.triggerKey,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      graphName: run.graph.name,
      graphVersion: run.graph.version,
      graphId: run.graph.id,
      failureClass: run.status === 'failed' ? 'workflow_execution_failed' : null,
    })),
    routeHealth: Array.from(routeHealth.values()).sort((a, b) =>
      (b.lastRunAt ?? '').localeCompare(a.lastRunAt ?? '')
    ),
    registry: effectiveCronRouteRegistry(),
    operationalSignals,
    signalEvents,
    evidencePolicy: {
      archiveEligibleAfterDays: OPERATIONAL_EVIDENCE_ARCHIVE_AFTER_DAYS,
      retentionMode: 'indefinite_hot_until_archive_enabled',
      archiveFormat: 'canonical-json-v1',
      archiveStoragePolicy: 'deployment-managed',
    },
  });
}
