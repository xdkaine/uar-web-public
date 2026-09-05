import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  preferenceFindUnique: vi.fn(),
  notificationUpsert: vi.fn(),
  sessionFindMany: vi.fn(),
  resolveAnyRoleForSession: vi.fn(),
}));

vi.mock('@/lib/adminAuth', () => ({ resolveAnyRoleForSession: mocks.resolveAnyRoleForSession }));
vi.mock('@/lib/rbac/core', () => ({ actorHasPermission: (auth: { permissions?: Set<string> } | null, permission: string) => auth?.permissions?.has(permission) === true }));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    userNotificationPreference: { findUnique: mocks.preferenceFindUnique },
    userNotification: { upsert: mocks.notificationUpsert },
    session: { findMany: mocks.sessionFindMany },
  },
}));

import { notifyActiveAdministrators, notifyUser } from '@/lib/notifications';

describe('in-app notification delivery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.preferenceFindUnique.mockResolvedValue(null);
    mocks.notificationUpsert.mockResolvedValue({ id: 'notification-1' });
    mocks.resolveAnyRoleForSession.mockResolvedValue({ permissions: new Set(['access_requests.read', 'tickets.read', 'automation.manage']) });
  });

  it('normalizes usernames and uses an account-scoped dedupe key', async () => {
    await notifyUser({
      username: ' Alice ',
      dedupeKey: 'ticket-response:r1',
      kind: 'support_ticket',
      title: 'A response',
      message: 'There is a new response.',
    });

    expect(mocks.notificationUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { username_dedupeKey: { username: 'alice', dedupeKey: 'ticket-response:r1' } },
    }));
  });

  it('honors a disabled category preference', async () => {
    mocks.preferenceFindUnique.mockResolvedValue({ supportTickets: false });
    await notifyUser({ username: 'alice', dedupeKey: 'ticket:1', kind: 'support_ticket', title: 'Ticket', message: 'Changed' });
    expect(mocks.notificationUpsert).not.toHaveBeenCalled();
  });

  it('targets each distinct active administrator session', async () => {
    mocks.sessionFindMany.mockResolvedValue([
      { id: '1', username: 'AdminA', isAdmin: true, expiresAt: new Date(), lastActivity: new Date(), authProvider: 'ad' },
      { id: '2', username: 'AdminB', isAdmin: true, expiresAt: new Date(), lastActivity: new Date(), authProvider: 'ad' },
    ]);
    await notifyActiveAdministrators({ dedupeKey: 'sync:1', kind: 'sync_failure', title: 'Sync failed', message: 'One group failed.' });
    expect(mocks.sessionFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { isAdmin: true, revokedAt: null, expiresAt: { gt: expect.any(Date) } },
    }));
    expect(mocks.notificationUpsert).toHaveBeenCalledTimes(2);
  });

  it('does not notify a historical administrator who no longer has the required permission', async () => {
    mocks.sessionFindMany.mockResolvedValue([{ id: '1', username: 'FormerAdmin', isAdmin: true, expiresAt: new Date(), lastActivity: new Date(), authProvider: 'ad' }]);
    mocks.resolveAnyRoleForSession.mockResolvedValue({ permissions: new Set() });
    await notifyActiveAdministrators({ dedupeKey: 'ticket:1', kind: 'support_ticket', title: 'Ticket', message: 'Created' });
    expect(mocks.notificationUpsert).not.toHaveBeenCalled();
  });
});
