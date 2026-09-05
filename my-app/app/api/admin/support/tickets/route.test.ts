import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  checkAdminAuthWithRateLimit: vi.fn(),
  actorHasPermission: vi.fn(),
  supportTicketCount: vi.fn(),
  supportTicketFindMany: vi.fn(),
  logAuditAction: vi.fn(),
  searchLDAPUser: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    supportTicket: {
      count: mocks.supportTicketCount,
      findMany: mocks.supportTicketFindMany,
    },
  },
}));

vi.mock('@/lib/adminAuth', () => ({
  checkAdminAuthWithRateLimit: mocks.checkAdminAuthWithRateLimit,
}));

vi.mock('@/lib/rbac/core', () => ({
  actorHasPermission: mocks.actorHasPermission,
}));

vi.mock('@/lib/audit-log', () => ({
  AuditActions: { VIEW_TICKETS_LIST: 'view_tickets_list' },
  AuditCategories: { SUPPORT: 'support' },
  getIpAddress: () => '203.0.113.10',
  getUserAgent: () => 'support-ticket-route-test',
  logAuditAction: mocks.logAuditAction,
}));

vi.mock('@/lib/ldap', () => ({
  searchLDAPUser: mocks.searchLDAPUser,
}));

import { GET } from './route';

describe('GET /api/admin/support/tickets JSON boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkAdminAuthWithRateLimit.mockResolvedValue({
      admin: { username: 'support-admin' },
      response: null,
    });
    mocks.actorHasPermission.mockReturnValue(true);
    mocks.supportTicketCount.mockResolvedValueOnce(1).mockResolvedValueOnce(1);
    mocks.searchLDAPUser.mockResolvedValue(null);
    mocks.logAuditAction.mockResolvedValue(undefined);
  });

  it('serializes Prisma BigInt attachment totals without failing the ticket list', async () => {
    mocks.supportTicketFindMany.mockResolvedValue([
      {
        id: 'ticket-1',
        createdAt: new Date('2026-08-27T12:00:00.000Z'),
        updatedAt: new Date('2026-08-27T12:00:00.000Z'),
        subject: 'Attachment issue',
        category: 'ACCOUNT',
        severity: 'normal',
        body: 'Help is needed.',
        status: 'open',
        username: 'alice',
        internalOnly: false,
        attachmentCount: 1,
        attachmentBytes: BigInt(727_280),
        closedAt: null,
        closedBy: null,
        relatedRequestId: null,
        requestedForGroupDn: null,
        joinGroupDn: null,
        responses: [],
        statusLogs: [],
        assignments: [],
        _count: { attachments: 1 },
      },
    ]);

    const response = await GET(
      new NextRequest('https://portal.example.test/api/admin/support/tickets')
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      tickets: [{ id: 'ticket-1', attachmentBytes: '727280', attachmentCount: 1 }],
    });
  });
});
