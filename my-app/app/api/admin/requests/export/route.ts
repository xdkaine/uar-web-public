import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkReviewAccessWithRateLimit } from '@/lib/adminAuth';
import { actorHasPermission } from '@/lib/rbac/core';
import { generateCsvContent } from '@/lib/csv-security';
import { CollectionQueryError } from '@/lib/admin/collections';
import { accessRequestWhere, parseAccessRequestCollectionQuery } from '../access-request-collection';

const EXPORT_LIMIT = 5_000;

export async function GET(request: NextRequest) {
  try {
    const { admin, response } = await checkReviewAccessWithRateLimit(request);
    if (!admin || response) return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!actorHasPermission(admin, 'access_requests.read')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const query = parseAccessRequestCollectionQuery(request.nextUrl.searchParams);
    const where = accessRequestWhere({ ...query, cursor: null, limit: EXPORT_LIMIT });
    const total = await prisma.accessRequest.count({ where });
    if (total > EXPORT_LIMIT) return NextResponse.json({ error: 'Refine filters before exporting more than 5,000 requests.', code: 'EXPORT_FILTER_TOO_BROAD', total }, { status: 422 });
    const rows = await prisma.accessRequest.findMany({ where, orderBy: [{ [query.sort]: query.direction }, { id: query.direction }], include: { event: { select: { name: true } } } });
    const csv = generateCsvContent(['Date', 'Name', 'Email', 'Type', 'Event', 'Institution', 'Access Ends', 'Status', 'Verified'], rows.map((row) => [row.createdAt.toISOString(), row.name, row.email, row.isInternal ? 'Internal' : 'External', row.event?.name || row.eventReason || '', row.institution || '', row.accountExpiresAt?.toISOString() || '', row.status, row.isVerified ? 'Yes' : 'No']));
    return new NextResponse(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="access-requests-${new Date().toISOString().slice(0, 10)}.csv"`, 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof CollectionQueryError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error('Error exporting access requests:', error);
    return NextResponse.json({ error: 'Failed to export requests' }, { status: 500 });
  }
}
