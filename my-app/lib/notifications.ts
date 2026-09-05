import { prisma } from '@/lib/prisma';
import { resolveAnyRoleForSession } from '@/lib/adminAuth';
import { actorHasPermission } from '@/lib/rbac/core';
import type { PermissionKey } from '@/lib/rbac/permissions';

export type NotificationKind = 'access_request' | 'support_ticket' | 'sync_failure' | 'security';

export async function notifyUser(input: {
  username: string;
  dedupeKey: string;
  kind: NotificationKind;
  title: string;
  message: string;
  href?: string;
  severity?: 'info' | 'warning' | 'critical';
}): Promise<void> {
  const username = input.username.trim().toLowerCase();
  if (!username) return;
  const preference = await prisma.userNotificationPreference.findUnique({ where: { username } });
  const enabled = input.kind === 'access_request'
    ? preference?.accessRequests !== false
    : input.kind === 'support_ticket'
      ? preference?.supportTickets !== false
      : input.kind === 'sync_failure'
        ? preference?.syncFailures !== false
        : true;
  if (!enabled) return;
  await prisma.userNotification.upsert({
    where: { username_dedupeKey: { username, dedupeKey: input.dedupeKey } },
    update: {
      title: input.title.slice(0, 200),
      message: input.message.slice(0, 1000),
      href: input.href,
      severity: input.severity ?? 'info',
      readAt: null,
      dismissedAt: null,
      createdAt: new Date(),
    },
    create: {
      username,
      dedupeKey: input.dedupeKey,
      kind: input.kind,
      title: input.title.slice(0, 200),
      message: input.message.slice(0, 1000),
      href: input.href,
      severity: input.severity ?? 'info',
    },
  });
}

export async function notifyActiveAdministrators(input: Omit<Parameters<typeof notifyUser>[0], 'username'>): Promise<void> {
  const sessions = await prisma.session.findMany({
    where: { isAdmin: true, revokedAt: null, expiresAt: { gt: new Date() } },
    distinct: ['username'],
    orderBy: { lastActivity: 'desc' },
    take: 500,
    select: { id: true, username: true, isAdmin: true, expiresAt: true, lastActivity: true, authProvider: true },
  });
  const requiredPermission: PermissionKey = input.kind === 'access_request'
    ? 'access_requests.read'
    : input.kind === 'support_ticket'
      ? 'tickets.read'
      : 'automation.manage';
  const recipients = await Promise.all(sessions.map(async (session) => {
    const authorization = await resolveAnyRoleForSession(session);
    return actorHasPermission(authorization, requiredPermission) ? session.username : null;
  }));
  await Promise.all(recipients.filter((username): username is string => !!username).map((username) => notifyUser({ ...input, username })));
}
