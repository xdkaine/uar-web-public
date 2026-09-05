import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  checkAdminAuthWithRateLimit: vi.fn(),
  actorHasPermission: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  create: vi.fn(),
  findManyGroups: vi.fn(),
  findManyRuns: vi.fn(),
  isMemberOfAdminGroup: vi.fn(() => true),
  logAuditAction: vi.fn(),
}));

vi.mock('@/lib/adminAuth', () => ({
  checkAdminAuthWithRateLimit: mocks.checkAdminAuthWithRateLimit,
}));
vi.mock('@/lib/rbac/core', () => ({ actorHasPermission: mocks.actorHasPermission }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    allowedTicketSubjectGroup: {
      findUnique: mocks.findUnique,
      update: mocks.update,
      create: mocks.create,
      findMany: mocks.findManyGroups,
    },
    directorySyncRun: { findMany: mocks.findManyRuns },
  },
}));
vi.mock('@/lib/audit-log', () => ({
  AuditActions: { MANAGE_TICKET_GROUPS: 'manage_ticket_groups' },
  AuditCategories: { SUPPORT: 'support' },
  getIpAddress: vi.fn(() => '127.0.0.1'),
  getUserAgent: vi.fn(() => 'vitest'),
  logAuditAction: mocks.logAuditAction,
}));
vi.mock('@/lib/ldap/admin-groups', () => ({ isMemberOfAdminGroup: mocks.isMemberOfAdminGroup }));

import { PUT } from './route';

const admin = {
  username: 'routingadmin',
  roles: new Set(['system_administrator']),
  permissions: new Set(['tickets.configure']),
};

function putRequest(body: unknown) {
  return new NextRequest('https://example.test/api/admin/config/ticket-groups', {
    method: 'PUT',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkAdminAuthWithRateLimit.mockResolvedValue({ admin, response: null });
  mocks.actorHasPermission.mockReturnValue(true);
  mocks.findUnique.mockResolvedValue(null);
  mocks.update.mockResolvedValue(null);
  mocks.create.mockImplementation(async ({ data }) => ({
    id: 'grp-1',
    mail: null,
    lastSyncedAt: null,
    lastSyncStatus: null,
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...data,
  }));
  mocks.findManyRuns.mockResolvedValue([]);
  mocks.logAuditAction.mockResolvedValue(undefined);
});

describe('PUT /api/admin/config/ticket-groups flags', () => {
  it('persists canJoinViaTicket when toggled on an existing group', async () => {
    mocks.findUnique.mockResolvedValue({
      id: 'grp-1',
      dn: 'CN=Analysts,OU=Groups,DC=sdc,DC=cpp',
      name: 'Analysts',
      canBeRequestedFor: true,
      canBeAssignee: false,
      canJoinViaTicket: false,
      isActive: true,
    });
    mocks.update.mockResolvedValue({
      id: 'grp-1',
      dn: 'CN=Analysts,OU=Groups,DC=sdc,DC=cpp',
      name: 'Analysts',
      canBeRequestedFor: true,
      canBeAssignee: false,
      canJoinViaTicket: true,
      isActive: true,
    });

    const response = await PUT(
      putRequest({
        dn: 'CN=Analysts,OU=Groups,DC=sdc,DC=cpp',
        canJoinViaTicket: true,
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith({
      where: { dn: 'CN=Analysts,OU=Groups,DC=sdc,DC=cpp' },
      data: expect.objectContaining({ canJoinViaTicket: true }),
    });
    const payload = await response.json();
    expect(payload.group.canJoinViaTicket).toBe(true);
  });

  it('accepts canJoinViaTicket on group creation instead of dropping it', async () => {
    const response = await PUT(
      putRequest({
        dn: 'CN=Helpdesk,OU=Groups,DC=sdc,DC=cpp',
        name: 'Helpdesk',
        canJoinViaTicket: true,
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        dn: 'CN=Helpdesk,OU=Groups,DC=sdc,DC=cpp',
        canJoinViaTicket: true,
      }),
    });
  });

  it('rejects non-boolean flag values for every known flag', async () => {
    const response = await PUT(
      putRequest({
        dn: 'CN=Analysts,OU=Groups,DC=sdc,DC=cpp',
        canJoinViaTicket: 'yes',
      })
    );

    expect(response.status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
