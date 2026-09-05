import { NextRequest, NextResponse } from 'next/server';

import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { PAGE_APPEARANCE_KEYS } from '@/lib/appearance';
import { prisma } from '@/lib/prisma';
import { actorHasPermission } from '@/lib/rbac/core';

interface HistoryCursor {
  v: 1;
  createdAt: string;
  id: string;
  source: 'configuration' | 'managed_page';
}

function decodeCursor(raw: string | null): HistoryCursor | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as HistoryCursor;
    if (value.v !== 1 || typeof value.id !== 'string' || !value.id || (value.source !== 'configuration' && value.source !== 'managed_page') || Number.isNaN(Date.parse(value.createdAt))) throw new Error('invalid');
    return value;
  } catch {
    throw new Error('MALFORMED_CURSOR');
  }
}

export async function GET(request: NextRequest) {
  const { admin, response } = await checkAdminAuthWithRateLimit(request);
  if (!admin || response) return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!actorHasPermission(admin, 'appearance.manage')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const limit = Math.min(50, Math.max(1, Number.parseInt(request.nextUrl.searchParams.get('limit') ?? '20', 10) || 20));
    const cursor = decodeCursor(request.nextUrl.searchParams.get('cursor'));
    const before = cursor ? new Date(cursor.createdAt) : null;
    const cursorWhere = (source: HistoryCursor['source']) => cursor && before ? {
      OR: [
        { createdAt: { lt: before } },
        { createdAt: before, id: { lt: cursor.id } },
        ...(source.localeCompare(cursor.source) < 0 ? [{ createdAt: before, id: cursor.id }] : []),
      ],
    } : {};

    const [configuration, managed, configurationTotal, managedTotal] = await Promise.all([
      prisma.configurationRevision.findMany({ where: { key: { in: [...PAGE_APPEARANCE_KEYS] }, ...cursorWhere('configuration') }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit + 1, select: { id: true, key: true, createdAt: true, changedBy: true, changeKind: true } }),
      prisma.managedPageRevision.findMany({ where: { status: { not: 'draft' }, ...cursorWhere('managed_page') }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit + 1, select: { id: true, pageKey: true, version: true, status: true, createdAt: true, updatedBy: true } }),
      prisma.configurationRevision.count({ where: { key: { in: [...PAGE_APPEARANCE_KEYS] } } }),
      prisma.managedPageRevision.count({ where: { status: { not: 'draft' } } }),
    ]);

    const merged = [
      ...configuration.map((revision) => ({ source: 'configuration' as const, id: revision.id, key: revision.key, version: null, status: revision.changeKind, actor: revision.changedBy, createdAt: revision.createdAt.toISOString() })),
      ...managed.map((revision) => ({ source: 'managed_page' as const, id: revision.id, key: revision.pageKey, version: revision.version, status: revision.status, actor: revision.updatedBy, createdAt: revision.createdAt.toISOString() })),
    ].sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id) || right.source.localeCompare(left.source));
    const items = merged.slice(0, limit);
    const hasNext = merged.length > limit;
    const last = items.at(-1);
    const nextCursor = hasNext && last
      ? Buffer.from(JSON.stringify({ v: 1, createdAt: last.createdAt, id: last.id, source: last.source })).toString('base64url')
      : null;
    return NextResponse.json({
      items,
      pageInfo: { limit, total: configurationTotal + managedTotal, nextCursor, hasNext },
      summary: { configuration: configurationTotal, managed_page: managedTotal },
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'MALFORMED_CURSOR') return NextResponse.json({ error: 'Malformed appearance history cursor' }, { status: 400 });
    console.error('Failed to load appearance history:', error);
    return NextResponse.json({ error: 'Failed to load appearance history' }, { status: 500 });
  }
}
