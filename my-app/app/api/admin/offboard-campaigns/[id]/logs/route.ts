import { NextRequest, NextResponse } from 'next/server';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { listOffboardCampaignLogs } from '@/lib/offboard-campaign';

const SORT_KEYS = new Set(['createdAt', 'level', 'eventType', 'actor', 'message']);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const sortKeyParam = request.nextUrl.searchParams.get('sortKey') || 'createdAt';
    const result = await listOffboardCampaignLogs(id, {
      page: Number(request.nextUrl.searchParams.get('page') || 1),
      pageSize: Number(request.nextUrl.searchParams.get('pageSize') || 25),
      sortKey: (SORT_KEYS.has(sortKeyParam) ? sortKeyParam : 'createdAt') as
        'createdAt' | 'level' | 'eventType' | 'actor' | 'message',
      sortDirection: request.nextUrl.searchParams.get('sortDirection') === 'asc' ? 'asc' : 'desc',
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load campaign logs' },
      { status: 500 }
    );
  }
}
