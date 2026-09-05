import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getSessionFromCookies: vi.fn(),
  revokeSessionById: vi.fn(),
  clearSession: vi.fn(),
  isUserDomainAdmin: vi.fn(),
  supportTicketFindUnique: vi.fn(),
  supportTicketUpdate: vi.fn(),
  supportTicketUpdateMany: vi.fn(),
  ticketStatusLogCreate: vi.fn(),
  accessRequestFindUnique: vi.fn(),
  accessRequestFindFirst: vi.fn(),
  transaction: vi.fn(),
  logAuditAction: vi.fn(),
  assignmentFindMany: vi.fn(),
  resolveTicketViewAccess: vi.fn(),
  resolveTicketMutationAccess: vi.fn(),
}));

vi.mock('@/lib/session', () => ({
  getSessionFromCookies: mocks.getSessionFromCookies,
  revokeSessionById: mocks.revokeSessionById,
  clearSession: mocks.clearSession,
}));

vi.mock('@/lib/ldap', () => ({
  isUserDomainAdmin: mocks.isUserDomainAdmin,
}));

vi.mock('@/lib/ldap/user-search', () => ({
  searchLDAPUser: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    supportTicket: {
      findUnique: mocks.supportTicketFindUnique,
      update: mocks.supportTicketUpdate,
      updateMany: mocks.supportTicketUpdateMany,
    },
    ticketStatusLog: {
      create: mocks.ticketStatusLogCreate,
    },
    accessRequest: {
      findUnique: mocks.accessRequestFindUnique,
      findFirst: mocks.accessRequestFindFirst,
    },
    supportTicketAssignment: {
      findMany: mocks.assignmentFindMany,
    },
    $transaction: mocks.transaction,
  },
}));

vi.mock('@/lib/support/ticket-access', () => ({
  resolveTicketViewAccess: mocks.resolveTicketViewAccess,
  resolveTicketMutationAccess: mocks.resolveTicketMutationAccess,
}));

vi.mock('@/lib/audit-log', () => ({
  logAuditAction: mocks.logAuditAction,
  AuditActions: {
    VIEW_TICKET: 'view_ticket',
    CLOSE_TICKET: 'close_ticket',
    REOPEN_TICKET: 'reopen_ticket',
    UPDATE_TICKET_STATUS: 'update_ticket_status',
  },
  AuditCategories: {
    SUPPORT: 'support',
  },
  getIpAddress: () => '203.0.113.50',
  getUserAgent: () => 'support-route-test',
}));

import { GET, PATCH } from './route';

const routeContext = {
  params: Promise.resolve({ id: 'ticket-1' }),
};

function request(method: 'GET' | 'PATCH', body?: Record<string, unknown>) {
  return new NextRequest('https://portal.example.test/api/support/tickets/ticket-1', {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

function ticket(username = 'ticket-owner') {
  return {
    id: 'ticket-1',
    username,
    subject: 'Need help',
    status: 'open',
    attachmentBytes: BigInt(727_280),
    updatedAt: new Date('2026-08-27T00:00:00.000Z'),
    relatedRequestId: null,
    responses: [],
    statusLogs: [],
  };
}

describe('support ticket live administrator authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionFromCookies.mockResolvedValue({
      id: 'revoked-admin-session',
      username: 'former-admin',
      isAdmin: true,
    });
    mocks.isUserDomainAdmin.mockResolvedValue(false);
    mocks.revokeSessionById.mockResolvedValue(undefined);
    mocks.supportTicketFindUnique.mockResolvedValue(ticket());
    mocks.supportTicketUpdate.mockReturnValue({});
    mocks.supportTicketUpdateMany.mockResolvedValue({ count: 1 });
    mocks.ticketStatusLogCreate.mockReturnValue({});
    mocks.transaction.mockImplementation(async (callback) => callback({
      supportTicket: { updateMany: mocks.supportTicketUpdateMany, findUnique: mocks.supportTicketFindUnique },
      ticketStatusLog: { create: mocks.ticketStatusLogCreate },
    }));
    mocks.accessRequestFindUnique.mockResolvedValue(null);
    mocks.accessRequestFindFirst.mockResolvedValue(null);
    mocks.logAuditAction.mockResolvedValue(undefined);
    mocks.assignmentFindMany.mockResolvedValue([]);
    mocks.resolveTicketViewAccess.mockImplementation(async (value: { username: string }, auth: { username: string; isAdmin: boolean }) =>
      value.username === auth.username ? 'owner' : auth.isAdmin ? 'admin' : null
    );
    mocks.resolveTicketMutationAccess.mockImplementation(async (value: { username: string }, auth: { username: string; isAdmin: boolean }) =>
      value.username === auth.username ? 'owner' : auth.isAdmin ? 'admin' : null
    );
  });

  it.each([
    ['read', () => GET(request('GET'), routeContext)],
    ['status update', () => PATCH(request('PATCH', { status: 'closed' }), routeContext)],
  ])('denies an unmapped stale admin before a cross-user %s', async (_action, invoke) => {
    const response = await invoke();

    expect(response.status).toBe(403);
    expect(mocks.isUserDomainAdmin).not.toHaveBeenCalled();
    expect(mocks.revokeSessionById).not.toHaveBeenCalled();
    expect(mocks.clearSession).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('allows an ordinary owner to read only their own ticket', async () => {
    mocks.getSessionFromCookies.mockResolvedValue({
      id: 'owner-session',
      username: 'ticket-owner',
      isAdmin: false,
    });

    const ownResponse = await GET(request('GET'), routeContext);
    expect(ownResponse.status).toBe(200);
    const ownPayload = await ownResponse.json();
    expect(ownPayload).toMatchObject({
      ticket: { id: 'ticket-1', attachmentBytes: '727280' },
    });
    expect(ownPayload.ticket).not.toHaveProperty('assignees');
    expect(mocks.assignmentFindMany).not.toHaveBeenCalled();
    expect(mocks.isUserDomainAdmin).not.toHaveBeenCalled();

    mocks.supportTicketFindUnique.mockResolvedValue(ticket('another-owner'));
    const otherResponse = await GET(request('GET'), routeContext);
    expect(otherResponse.status).toBe(403);
  });

  it('grants an assignee-group member read and close access on the assigned ticket', async () => {
    mocks.getSessionFromCookies.mockResolvedValue({
      id: 'member-session',
      username: 'team-member',
      isAdmin: false,
    });
    mocks.supportTicketFindUnique.mockResolvedValue(ticket('another-owner'));
    mocks.resolveTicketViewAccess.mockResolvedValue('assignee');
    mocks.resolveTicketMutationAccess.mockResolvedValue('assignee');

    const readResponse = await GET(request('GET'), routeContext);
    expect(readResponse.status).toBe(200);
    expect(mocks.resolveTicketViewAccess).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'ticket-1' }),
      expect.objectContaining({ username: 'team-member' })
    );

    const closeResponse = await PATCH(request('PATCH', { status: 'closed' }), routeContext);
    expect(closeResponse.status).toBe(200);
    await expect(closeResponse.json()).resolves.toMatchObject({
      ticket: { id: 'ticket-1', attachmentBytes: '727280' },
    });
    // Member actions are recorded as non-staff.
    expect(mocks.ticketStatusLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ changedBy: 'team-member', isStaff: false }),
    });
  });

  it('allows requested-for group members to read but not mutate the ticket', async () => {
    mocks.getSessionFromCookies.mockResolvedValue({
      id: 'group-session',
      username: 'group-member',
      isAdmin: false,
    });
    mocks.supportTicketFindUnique.mockResolvedValue({
      ...ticket('another-owner'),
      requestedForGroupDn: 'CN=Team,DC=cpp,DC=edu',
    });
    mocks.resolveTicketViewAccess.mockResolvedValue('group_member');
    mocks.resolveTicketMutationAccess.mockResolvedValue(null);

    expect((await GET(request('GET'), routeContext)).status).toBe(200);
    expect((await PATCH(request('PATCH', { status: 'closed' }), routeContext)).status).toBe(403);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('still denies a stranger even when assignee resolution denies too', async () => {
    mocks.getSessionFromCookies.mockResolvedValue({
      id: 'stranger-session',
      username: 'random-user',
      isAdmin: false,
    });
    mocks.supportTicketFindUnique.mockResolvedValue(ticket('another-owner'));

    const readResponse = await GET(request('GET'), routeContext);
    const patchResponse = await PATCH(request('PATCH', { status: 'closed' }), routeContext);

    expect(readResponse.status).toBe(403);
    expect(patchResponse.status).toBe(403);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('returns a conflict when another operator changes the status first', async () => {
    mocks.getSessionFromCookies.mockResolvedValue({ id: 'owner-session', username: 'ticket-owner', isAdmin: false });
    mocks.supportTicketUpdateMany.mockResolvedValue({ count: 0 });

    const response = await PATCH(request('PATCH', { status: 'closed' }), routeContext);

    expect(response.status).toBe(409);
    expect(mocks.ticketStatusLogCreate).not.toHaveBeenCalled();
  });
});
