import { NextRequest, NextResponse } from 'next/server';

import { getSessionFromCookies } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { MAX_REQUEST_BODY_SIZE, parseJsonWithLimit } from '@/lib/validation';

async function currentUsername() {
  return (await getSessionFromCookies())?.username.toLowerCase() ?? null;
}

export async function GET() {
  const username = await currentUsername();
  if (!username) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const preferences = await prisma.userNotificationPreference.findUnique({ where: { username } });
  return NextResponse.json({ preferences: preferences ?? { username, accessRequests: true, supportTickets: true, syncFailures: true } });
}

export async function PUT(request: NextRequest) {
  const username = await currentUsername();
  if (!username) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await parseJsonWithLimit<Record<string, unknown>>(request, MAX_REQUEST_BODY_SIZE.SMALL);
  const value = (key: string) => body[key] !== false;
  const preferences = await prisma.userNotificationPreference.upsert({
    where: { username },
    update: { accessRequests: value('accessRequests'), supportTickets: value('supportTickets'), syncFailures: value('syncFailures') },
    create: { username, accessRequests: value('accessRequests'), supportTickets: value('supportTickets'), syncFailures: value('syncFailures') },
  });
  return NextResponse.json({ preferences });
}
