import { NextRequest, NextResponse } from 'next/server';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { actorHasPermission } from '@/lib/rbac/core';
import { getOffboardOperationPreview } from '@/lib/offboard-campaign';
import { generateCsvContent } from '@/lib/csv-security';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; operationId: string }> }) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin || response) return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!actorHasPermission(admin, 'offboard.manage')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const { id, operationId } = await params;
    const page = Number(request.nextUrl.searchParams.get('page') || '1');
    const pageSize = Number(request.nextUrl.searchParams.get('pageSize') || '100');
    const download = request.nextUrl.searchParams.get('download') === 'csv';
    const preview = await getOffboardOperationPreview(
      operationId,
      admin.username,
      id,
      download ? 1 : Number.isSafeInteger(page) ? page : 1,
      download ? 5000 : Number.isSafeInteger(pageSize) ? Math.min(pageSize, 500) : 100,
    );
    if (download) {
      if (preview.pageInfo.total > 5000) {
        return NextResponse.json({ error: 'Operation preview exceeds the 5,000-row export limit', code: 'EXPORT_FILTER_TOO_BROAD', total: preview.pageInfo.total }, { status: 422 });
      }
      const csv = generateCsvContent(
        ['recipientId', 'actions', 'conflicts', 'status', 'expectedState', 'outcome'],
        preview.items.map((item) => [
          item.recipientId,
          item.actions.join('|'),
          item.conflicts.join('|'),
          item.status,
          JSON.stringify(item.expectedState),
          JSON.stringify(item.outcome),
        ]),
      );
      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="offboard-operation-${operationId}.csv"`,
          'Cache-Control': 'no-store',
        },
      });
    }
    return NextResponse.json({ preview, campaignId: id });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to load operation preview' }, { status: 500 });
  }
}
