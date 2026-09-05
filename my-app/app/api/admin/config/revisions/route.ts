import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAuditAccessWithRateLimit } from '@/lib/adminAuth';

export const dynamic = 'force-dynamic';

/**
 * Read model for the configuration change trail (roadmap §6.14). Read-only:
 * revisions are appended by configuration writes and never edited here.
 * Secret rows carry only the redaction marker by construction.
 */
export async function GET(request: NextRequest) {
  const { admin, response } = await checkAuditAccessWithRateLimit(request);
  if (!admin || response) {
    return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const searchParams = request.nextUrl.searchParams;
  const key = searchParams.get('key')?.trim() || undefined;
  const page = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10) || 1);
  const limitRaw = Number.parseInt(searchParams.get('limit') || '50', 10);
  const limit = Math.min(200, Math.max(1, limitRaw || 50));

  const [total, revisions] = await Promise.all([
    prisma.configurationRevision.count({ where: key ? { key } : undefined }),
    prisma.configurationRevision.findMany({
      where: key ? { key } : undefined,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  return NextResponse.json({
    revisions,
    total,
    page,
    limit,
    pages: Math.max(1, Math.ceil(total / limit)),
  });
}
