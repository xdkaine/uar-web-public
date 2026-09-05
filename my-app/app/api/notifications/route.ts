import { NextRequest, NextResponse } from 'next/server';

import { getSessionFromCookies } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { isJsonBodyError, MAX_REQUEST_BODY_SIZE, parseJsonWithLimit } from '@/lib/validation';

async function usernameOrResponse() {
  const session = await getSessionFromCookies();
  return session ? { username: session.username.toLowerCase() } : { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
}

export async function GET() {
  const auth = await usernameOrResponse();
  if ('response' in auth) return auth.response;
  const [items, unread] = await Promise.all([
    prisma.userNotification.findMany({
      where: { username: auth.username, dismissedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 30,
    }),
    prisma.userNotification.count({ where: { username: auth.username, dismissedAt: null, readAt: null } }),
  ]);
  return NextResponse.json({ items, unread });
}

export async function PATCH(request: NextRequest) {
  const auth = await usernameOrResponse();
  if ('response' in auth) return auth.response;
  try {
    const body = await parseJsonWithLimit<{ id?: unknown; action?: unknown }>(request, MAX_REQUEST_BODY_SIZE.SMALL);
    if (body.action === 'read_all') {
      await prisma.userNotification.updateMany({
        where: { username: auth.username, dismissedAt: null, readAt: null },
        data: { readAt: new Date() },
      });
      return NextResponse.json({ updated: true });
    }
    if (typeof body.id !== 'string' || !['read', 'dismiss'].includes(String(body.action))) {
      return NextResponse.json({ error: 'Valid id and action are required' }, { status: 400 });
    }
    const result = await prisma.userNotification.updateMany({
      where: { id: body.id, username: auth.username },
      data: body.action === 'dismiss' ? { dismissedAt: new Date(), readAt: new Date() } : { readAt: new Date() },
    });
    if (result.count !== 1) return NextResponse.json({ error: 'Notification not found' }, { status: 404 });
    return NextResponse.json({ updated: true });
  } catch (error) {
    if (isJsonBodyError(error)) return NextResponse.json({ error: error.message }, { status: error.statusCode });
    return NextResponse.json({ error: 'Could not update notification' }, { status: 500 });
  }
}
