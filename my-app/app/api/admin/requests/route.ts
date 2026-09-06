import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkReviewAccessWithRateLimit } from '@/lib/adminAuth';
import { actorHasPermission } from '@/lib/rbac/core';
import { logAuditAction, AuditActions, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';
import { CollectionQueryError, collectionPage } from '@/lib/admin/collections';
import { resolveRequestReviews } from '@/lib/workflow/request-review';
import { accessRequestWhere, parseAccessRequestCollectionQuery } from './access-request-collection';

export async function GET(request: NextRequest) {
  try {
    const { admin, response } = await checkReviewAccessWithRateLimit(request);
    if (!admin || response) return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!actorHasPermission(admin, 'access_requests.read')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const query = parseAccessRequestCollectionQuery(request.nextUrl.searchParams);
    const where = accessRequestWhere(query);
    const normalizedWhere = accessRequestWhere({ ...query, cursor: null });
    const [rows, total, overallTotal, statusCounts, facetCounts, stageCounts] = await Promise.all([
      prisma.accessRequest.findMany({
        where,
        orderBy: [{ [query.sort]: query.direction }, { id: query.direction }],
        take: query.limit + 1,
        omit: { accountPassword: true, verificationToken: true, verificationTokenHash: true },
        include: { event: { select: { id: true, name: true } } },
      }),
      prisma.accessRequest.count({ where: normalizedWhere }),
      prisma.accessRequest.count(),
      prisma.accessRequest.groupBy({ by: ['status'], where: normalizedWhere, _count: { _all: true } }),
      prisma.accessRequest.groupBy({ by: ['isInternal', 'isVerified'], where: normalizedWhere, _count: { _all: true } }),
      prisma.accessRequest.groupBy({ by: ['workflowVersionId', 'requestTypeKey', 'status'], where: normalizedWhere, _count: { _all: true } }),
    ]);
    const summary = Object.fromEntries(statusCounts.map((entry) => [entry.status, entry._count._all]));
    summary.total = overallTotal;
    summary.internal = facetCounts
      .filter((entry) => entry.isInternal)
      .reduce((count, entry) => count + entry._count._all, 0);
    summary.external = facetCounts
      .filter((entry) => !entry.isInternal)
      .reduce((count, entry) => count + entry._count._all, 0);
    summary.verified = facetCounts
      .filter((entry) => entry.isVerified)
      .reduce((count, entry) => count + entry._count._all, 0);
    const page = collectionPage({ rows, limit: query.limit, total, summary, fingerprint: query.fingerprint, cursorFor: (row) => ({ value: row[query.sort], id: row.id }) });
    const [itemReviews, bucketReviews] = await Promise.all([
      resolveRequestReviews(page.items, admin),
      resolveRequestReviews(stageCounts.map((entry) => ({
        status: entry.status,
        workflowVersionId: entry.workflowVersionId,
        requestTypeKey: entry.requestTypeKey,
      })), admin),
    ]);
    const items = page.items.map((item, index) => ({ ...item, review: itemReviews[index] }));
    const reviewStageBuckets = stageCounts.flatMap((entry, index) => {
      const review = bucketReviews[index];
      if (!review.currentStage) return [];
      return [{
        workflowVersionId: entry.workflowVersionId || 'legacy',
        workflowVersion: review.workflow.version,
        workflowSource: review.workflow.source,
        stageKey: review.currentStage.key,
        label: review.currentStage.label,
        count: entry._count._all,
      }];
    });
    await logAuditAction({ action: AuditActions.VIEW_REQUESTS_LIST, category: AuditCategories.ACCESS_REQUEST, username: admin.username, details: { total, returnedCount: page.items.length, filters: { status: query.status, type: query.type, verification: query.verification, eventId: query.eventId, event: query.event }, sort: query.sort, direction: query.direction }, ipAddress: getIpAddress(request), userAgent: getUserAgent(request) });
    return NextResponse.json({ ...page, items, reviewStageBuckets });
  } catch (error) {
    if (error instanceof CollectionQueryError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error('Error fetching requests:', error);
    return NextResponse.json({ error: 'Failed to fetch requests' }, { status: 500 });
  }
}
