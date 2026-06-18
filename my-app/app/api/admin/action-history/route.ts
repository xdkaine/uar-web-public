import { NextRequest, NextResponse } from 'next/server';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { getActionHistory, logActionHistoryEvent } from '@/lib/action-history';
import { AuditActions, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';

function parsePageParam(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export async function GET(request: NextRequest) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const params = request.nextUrl.searchParams;
    const search = (params.get('q') || params.get('search'))?.trim() || null;
    const query = {
      search,
      requestId: params.get('requestId'),
      subjectUsername: params.get('subjectUsername'),
      subjectEmail: params.get('subjectEmail'),
      vpnAccountId: params.get('vpnAccountId'),
      includeReads: params.get('includeReads') === 'true',
      eventKind: params.get('eventKind'),
      outcome: params.get('outcome'),
      page: parsePageParam(params.get('page'), 1),
      limit: Math.min(parsePageParam(params.get('limit'), 50), 100),
    };

    if (!query.search && !query.requestId && !query.subjectUsername && !query.subjectEmail && !query.vpnAccountId) {
      return NextResponse.json(
        { error: 'At least one history subject or lookup query is required' },
        { status: 400 }
      );
    }

    const history = await getActionHistory(query);

    await logActionHistoryEvent({
      action: AuditActions.ACCOUNT_HISTORY_VIEW,
      category: AuditCategories.LOGS,
      username: admin.username,
      actorType: 'admin',
      targetId: query.requestId || query.vpnAccountId || undefined,
      targetType: query.requestId ? 'AccessRequest' : query.vpnAccountId ? 'VPNAccount' : 'AccountHistory',
      subjectUsername: query.subjectUsername,
      subjectEmail: query.subjectEmail,
      relatedRequestId: query.requestId,
      relatedVpnAccountId: query.vpnAccountId,
      eventKind: 'read',
      outcome: 'success',
      details: {
        includeReads: query.includeReads,
        search: query.search,
        eventKind: query.eventKind,
        outcome: query.outcome,
        page: query.page,
        limit: query.limit,
        total: history.total,
      },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    return NextResponse.json(history);
  } catch (error) {
    console.error('Error fetching action history:', error);
    return NextResponse.json(
      { error: 'Failed to fetch action history' },
      { status: 500 }
    );
  }
}