import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getSessionFromCookies: vi.fn(),
  revokeSessionById: vi.fn(),
  clearSession: vi.fn(),
  isUserDomainAdmin: vi.fn(),
  supportTicketFindUnique: vi.fn(),
  supportTicketUpdate: vi.fn(),
  ticketResponseCreate: vi.fn(),
  ticketResponseFindUnique: vi.fn(),
  accessRequestFindUnique: vi.fn(),
  accessRequestFindFirst: vi.fn(),
  checkRateLimitAsync: vi.fn(),
  logAuditAction: vi.fn(),
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

vi.mock('@/lib/prisma', () => ({
  prisma: {
    supportTicket: {
      findUnique: mocks.supportTicketFindUnique,
      update: mocks.supportTicketUpdate,
    },
    ticketResponse: {
      create: mocks.ticketResponseCreate,
      findUnique: mocks.ticketResponseFindUnique,
    },
    accessRequest: {
      findUnique: mocks.accessRequestFindUnique,
      findFirst: mocks.accessRequestFindFirst,
    },
    $transaction: vi.fn(async (callback) => callback({
      ticketResponse: { create: mocks.ticketResponseCreate, findUnique: mocks.ticketResponseFindUnique },
      supportTicket: { update: mocks.supportTicketUpdate },
    })),
  },
}));

vi.mock('@/lib/notifications', () => ({
  notifyActiveAdministrators: vi.fn().mockResolvedValue(undefined),
  notifyUser: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/ratelimit', () => ({
  checkRateLimitAsync: mocks.checkRateLimitAsync,
  isRateLimitUnavailable: () => false,
}));

vi.mock('@/lib/audit-log', () => ({
  logAuditAction: mocks.logAuditAction,
  AuditActions: {
    CREATE_TICKET_RESPONSE: 'create_ticket_response',
  },
  AuditCategories: {
    SUPPORT: 'support',
  },
  getIpAddress: () => '203.0.113.51',
  getUserAgent: () => 'support-response-route-test',
}));

vi.mock('@/lib/support/routing', () => ({
  resolveTicketNotificationRecipients: vi.fn().mockResolvedValue({
    emails: [],
    sources: {},
    usedQueueFallback: true,
    activeAssignmentCount: 0,
  }),
}));

vi.mock('@/lib/support/ticket-access', () => ({
  resolveTicketMutationAccess: mocks.resolveTicketMutationAccess,
  resolveTicketViewAccess: vi.fn(),
}));

import { POST } from './route';

const routeContext = {
  params: Promise.resolve({ id: 'ticket-1' }),
};

function request(idempotencyKey?: string) {
  return new NextRequest(
    'https://portal.example.test/api/support/tickets/ticket-1/responses',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(idempotencyKey ? { 'x-idempotency-key': idempotencyKey } : {}) },
      body: JSON.stringify({ message: 'Please investigate this issue.' }),
    }
  );
}

function ticket(username = 'ticket-owner') {
  return {
    id: 'ticket-1',
    username,
    subject: 'Need help',
    relatedRequestId: null,
  };
}

describe('support response live administrator authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionFromCookies.mockResolvedValue({
      id: 'revoked-admin-session',
      username: 'former-admin',
      isAdmin: true,
    });
    mocks.isUserDomainAdmin.mockResolvedValue(false);
    mocks.revokeSessionById.mockResolvedValue(undefined);
    mocks.checkRateLimitAsync.mockResolvedValue({
      success: true,
      limit: 30,
      remaining: 29,
      reset: Date.now() + 60 * 60 * 1000,
    });
    mocks.supportTicketFindUnique.mockResolvedValue(ticket());
    mocks.ticketResponseCreate.mockResolvedValue({
      id: 'response-1',
      isStaff: true,
    });
    mocks.ticketResponseFindUnique.mockResolvedValue(null);
    mocks.supportTicketUpdate.mockResolvedValue({});
    mocks.accessRequestFindUnique.mockResolvedValue(null);
    mocks.accessRequestFindFirst.mockResolvedValue(null);
    mocks.logAuditAction.mockResolvedValue(undefined);
    mocks.resolveTicketMutationAccess.mockImplementation(async (value: { username: string }, auth: { username: string; isAdmin: boolean }) =>
      value.username === auth.username ? 'owner' : auth.isAdmin ? 'admin' : null
    );
  });

  it('denies an unmapped stale admin before creating a cross-user staff response', async () => {
    const response = await POST(request(), routeContext);

    expect(response.status).toBe(403);
    expect(mocks.isUserDomainAdmin).not.toHaveBeenCalled();
    expect(mocks.revokeSessionById).not.toHaveBeenCalled();
    expect(mocks.clearSession).not.toHaveBeenCalled();
    expect(mocks.ticketResponseCreate).not.toHaveBeenCalled();
  });

  it('keeps ordinary responses owner-scoped and non-staff', async () => {
    mocks.getSessionFromCookies.mockResolvedValue({
      id: 'owner-session',
      username: 'ticket-owner',
      isAdmin: false,
    });

    const ownResponse = await POST(request(), routeContext);
    expect(ownResponse.status).toBe(201);
    expect(mocks.ticketResponseCreate).toHaveBeenCalledWith({
      data: {
        ticketId: 'ticket-1',
        message: 'Please investigate this issue.',
        author: 'ticket-owner',
        isStaff: false,
        clientRequestId: null,
      },
    });
    expect(mocks.isUserDomainAdmin).not.toHaveBeenCalled();

    mocks.supportTicketFindUnique.mockResolvedValue(ticket('another-owner'));
    const otherResponse = await POST(request(), routeContext);
    expect(otherResponse.status).toBe(403);
  });

  it('lets an assignee-group member respond as non-staff', async () => {
    mocks.getSessionFromCookies.mockResolvedValue({
      id: 'member-session',
      username: 'team-member',
      isAdmin: false,
    });
    mocks.resolveTicketMutationAccess.mockResolvedValue('assignee');

    const response = await POST(request(), routeContext);

    expect(response.status).toBe(201);
    expect(mocks.ticketResponseCreate).toHaveBeenCalledWith({
      data: {
        ticketId: 'ticket-1',
        message: 'Please investigate this issue.',
        author: 'team-member',
        isStaff: false,
        clientRequestId: null,
      },
    });
  });

  it('denies a stranger who is not an assignee', async () => {
    mocks.getSessionFromCookies.mockResolvedValue({
      id: 'stranger-session',
      username: 'random-user',
      isAdmin: false,
    });

    const response = await POST(request(), routeContext);

    expect(response.status).toBe(403);
    expect(mocks.ticketResponseCreate).not.toHaveBeenCalled();
  });

  it('returns the prior response without duplicating side effects on retry', async () => {
    mocks.getSessionFromCookies.mockResolvedValue({ id: 'owner-session', username: 'ticket-owner', isAdmin: false });
    mocks.ticketResponseFindUnique.mockResolvedValue({ id: 'existing-response', ticketId: 'ticket-1', author: 'ticket-owner', message: 'Please investigate this issue.' });

    const response = await POST(request('client-attempt-1'), routeContext);

    expect(response.status).toBe(200);
    expect(mocks.ticketResponseFindUnique).toHaveBeenCalledWith({
      where: { ticketId_clientRequestId: { ticketId: 'ticket-1', clientRequestId: 'client-attempt-1' } },
    });
    expect(mocks.ticketResponseCreate).not.toHaveBeenCalled();
    expect(mocks.supportTicketUpdate).not.toHaveBeenCalled();
  });

  it('rejects reuse of an idempotency key by a different payload', async () => {
    mocks.getSessionFromCookies.mockResolvedValue({ id: 'owner-session', username: 'ticket-owner', isAdmin: false });
    mocks.ticketResponseFindUnique.mockResolvedValue({ id: 'existing-response', ticketId: 'ticket-1', author: 'ticket-owner', message: 'Different response' });

    const response = await POST(request('client-attempt-1'), routeContext);

    expect(response.status).toBe(409);
    expect(mocks.ticketResponseCreate).not.toHaveBeenCalled();
  });
});
