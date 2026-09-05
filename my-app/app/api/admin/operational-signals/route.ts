import { NextRequest, NextResponse } from 'next/server';

import { checkAuditAccessWithRateLimit } from '@/lib/adminAuth';
import { OPERATIONAL_EVIDENCE_ARCHIVE_AFTER_DAYS } from '@/lib/operations/detectors';
import { prisma } from '@/lib/prisma';
import { actorHasPermission } from '@/lib/rbac/core';

export const dynamic = 'force-dynamic';

/** Read-only, PII-free detector projections and immutable transition evidence. */
export async function GET(request: NextRequest) {
  const { admin, response } = await checkAuditAccessWithRateLimit(request);
  if (!admin || response) {
    return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const status = params.get('status')?.trim();
  const detectorKey = params.get('detectorKey')?.trim();
  const subjectType = params.get('subjectType')?.trim();
  const limitRaw = Number.parseInt(params.get('limit') || '40', 10);
  const limit = Math.min(100, Math.max(1, limitRaw || 40));

  const where = {
    ...(status === 'active' || status === 'resolved' ? { status } : {}),
    ...(detectorKey ? { detectorKey } : {}),
    ...(subjectType ? { subjectType } : {}),
  };

  const [signals, total, recentEvents, archives] = await Promise.all([
    prisma.operationalSignal.findMany({
      where,
      orderBy: { lastSeenAt: 'desc' },
      take: limit,
    }),
    prisma.operationalSignal.count({ where }),
    prisma.operationalSignalEvent.findMany({
      where: { signal: where },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 50),
      include: {
        signal: {
          select: {
            subjectType: true,
            subjectId: true,
            reasonCode: true,
            status: true,
          },
        },
      },
    }),
    prisma.operationalEvidenceArchive.findMany({
      orderBy: { rangeEnd: 'desc' },
      take: 20,
      select: {
        id: true,
        createdAt: true,
        rangeStart: true,
        rangeEnd: true,
        recordCount: true,
        formatVersion: true,
        readbackVerifiedAt: true,
        retentionExpiresAt: true,
      },
    }),
  ]);

  return NextResponse.json({
    signals,
    total,
    limit,
    recentEvents,
    archives,
    evidencePolicy: {
      archiveEligibleAfterDays: OPERATIONAL_EVIDENCE_ARCHIVE_AFTER_DAYS,
      retentionMode: 'indefinite_hot_until_archive_enabled',
      archiveFormat: 'canonical-json-v1',
      archiveStoragePolicy: 'deployment-managed',
    },
    capabilities: {
      accessRequestsRead: actorHasPermission(admin, 'access_requests.read'),
      serviceAlertsRead: actorHasPermission(admin, 'service_alerts.read'),
    },
  });
}
