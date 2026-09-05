import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  checkAdminAuthWithRateLimit: vi.fn(),
  actorHasPermission: vi.fn(),
  checkRateLimitAsync: vi.fn(),
  isRateLimitUnavailable: vi.fn(() => false),
  logAuditAction: vi.fn(),
  supportTicketFindUnique: vi.fn(),
  assignmentFindFirst: vi.fn(),
  assignmentFindMany: vi.fn(),
  assignmentCreate: vi.fn(),
  assignmentUpdate: vi.fn(),
  assignmentUpdateMany: vi.fn(),
  historyCreate: vi.fn(),
  historyFindMany: vi.fn(),
  groupFindUnique: vi.fn(),
  searchLDAPUser: vi.fn(),
  transaction: vi.fn(),
  emitAuditActionLog: vi.fn(),
}));

vi.mock('@/lib/adminAuth', () => ({
  checkAdminAuthWithRateLimit: mocks.checkAdminAuthWithRateLimit,
}));

vi.mock('@/lib/rbac/core', () => ({
  actorHasPermission: mocks.actorHasPermission,
}));

vi.mock('@/lib/ratelimit', () => ({
  checkRateLimitAsync: mocks.checkRateLimitAsync,
  isRateLimitUnavailable: mocks.isRateLimitUnavailable,
}));

vi.mock('@/lib/audit-log', () => ({
  logAuditAction: mocks.logAuditAction,
  emitAuditActionLog: mocks.emitAuditActionLog,
  AuditActions: {
    ASSIGN_TICKET: 'assign_ticket',
    UNASSIGN_TICKET: 'unassign_ticket',
    VIEW_TICKET_ASSIGNMENTS: 'view_ticket_assignments',
  },
  AuditCategories: { SUPPORT: 'support' },
  getIpAddress: () => '127.0.0.1',
  getUserAgent: () => 'vitest',
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    supportTicket: {
      findUnique: mocks.supportTicketFindUnique,
    },
    supportTicketAssignment: {
      findFirst: mocks.assignmentFindFirst,
      findMany: mocks.assignmentFindMany,
      create: mocks.assignmentCreate,
      update: mocks.assignmentUpdate,
      updateMany: mocks.assignmentUpdateMany,
    },
    ticketAssignmentHistory: {
      create: mocks.historyCreate,
      findMany: mocks.historyFindMany,
    },
    allowedTicketSubjectGroup: {
      findUnique: mocks.groupFindUnique,
    },
    $transaction: mocks.transaction,
  },
}));

vi.mock('@/lib/ldap', () => ({
  searchLDAPUser: mocks.searchLDAPUser,
}));

vi.mock('@/lib/support/routing', () => ({
  resolveTicketNotificationRecipients: vi.fn().mockResolvedValue({
    emails: [],
    sources: {},
    usedQueueFallback: true,
    activeAssignmentCount: 0,
  }),
}));

import { GET, POST } from './route';

type RouteContext = { params: Promise<{ id: string }> };
const context = (id: string): RouteContext => ({ params: Promise.resolve({ id }) });

function request(body: unknown) {
  return new NextRequest('https://portal.example.test/api/admin/support/tickets/ticket-1/assignments', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const approvedGroupDn = 'CN=Ticket Team,OU=Groups,DC=cpp,DC=edu';

describe('ticket assignment API authorization and state transitions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRateLimitAsync.mockResolvedValue({
      success: true,
      limit: 30,
      remaining: 29,
      reset: Date.now() + 3600_000,
    });
    mocks.supportTicketFindUnique.mockResolvedValue({
      id: 'ticket-1',
      subject: 'Printer on fire',
      status: 'open',
      internalOnly: false,
    });
    mocks.assignmentFindMany.mockResolvedValue([]);
    mocks.assignmentFindFirst.mockResolvedValue(null);
    mocks.assignmentCreate.mockImplementation(async ({ data }) => ({ id: 'assignment-1', ...data }));
    mocks.assignmentUpdate.mockResolvedValue({});
    mocks.assignmentUpdateMany.mockResolvedValue({ count: 1 });
    mocks.historyCreate.mockResolvedValue({});
    mocks.historyFindMany.mockResolvedValue([]);
    mocks.logAuditAction.mockResolvedValue(undefined);
    mocks.transaction.mockImplementation(async (callback) => callback({
      supportTicketAssignment: {
        findFirst: mocks.assignmentFindFirst,
        create: mocks.assignmentCreate,
        update: mocks.assignmentUpdate,
        updateMany: mocks.assignmentUpdateMany,
      },
      ticketAssignmentHistory: {
        create: mocks.historyCreate,
      },
      auditLog: {
        create: vi.fn(),
      },
    }));
    mocks.groupFindUnique.mockResolvedValue({
      dn: approvedGroupDn,
      name: 'Ticket Team',
      canBeAssignee: true,
      isActive: true,
    });
    mocks.searchLDAPUser.mockResolvedValue({
      objectName: 'CN=Alex Chen,OU=Users,DC=example,DC=test',
      attributes: [
        { type: 'sAMAccountName', values: ['alex.chen'] },
        { type: 'displayName', values: ['Alex Chen'] },
        { type: 'mail', values: ['Alex.Chen@Example.Test'] },
        { type: 'userAccountControl', values: ['512'] },
      ],
    });
  });

  it('rejects assigning an internal automation ticket to ordinary users or groups', async () => {
    mocks.checkAdminAuthWithRateLimit.mockResolvedValue({ admin: { username: 'admin1' }, response: null });
    mocks.actorHasPermission.mockReturnValue(true);
    mocks.supportTicketFindUnique.mockResolvedValue({
      id: 'ticket-internal',
      subject: 'Malware blocked',
      status: 'open',
      internalOnly: true,
    });

    const response = await POST(request({
      action: 'assign',
      targets: [{ targetType: 'user', username: 'alice' }],
    }), context('ticket-internal'));

    expect(response.status).toBe(400);
    expect(mocks.assignmentCreate).not.toHaveBeenCalled();
    expect(mocks.historyCreate).not.toHaveBeenCalled();
  });

  it('does not expose the stored notification address in assignment responses', async () => {
    mocks.checkAdminAuthWithRateLimit.mockResolvedValue({ admin: { username: 'admin1' }, response: null });
    mocks.actorHasPermission.mockReturnValue(true);

    const response = await GET(request({}), context('ticket-1'));

    expect(response.status).toBe(200);
    const query = mocks.assignmentFindMany.mock.calls[0][0];
    expect(query.select).not.toHaveProperty('targetEmail');
  });

  it.each([
    { actor: null as { username: string } | null, denial: { status: 401 } },
    { actor: { username: 'admin1' }, denial: null },
  ])('rejects unauthenticated or unauthorized actors', async ({ actor, denial }) => {
    mocks.checkAdminAuthWithRateLimit.mockResolvedValue({ admin: actor, response: denial });
    mocks.actorHasPermission.mockReturnValue(false);

    const response = await POST(request({
      action: 'assign',
      targets: [{ targetType: 'directory_group', dn: approvedGroupDn }],
    }), context('ticket-1'));

    expect([401, 403]).toContain(response.status);
    expect(mocks.assignmentCreate).not.toHaveBeenCalled();
  });

  it('rejects assignment of a group that is not an approved assignee group', async () => {
    mocks.checkAdminAuthWithRateLimit.mockResolvedValue({ admin: { username: 'admin1' }, response: null });
    mocks.actorHasPermission.mockReturnValue(true);
    mocks.groupFindUnique.mockResolvedValue(null);

    const response = await POST(request({
      action: 'assign',
      targets: [{ targetType: 'directory_group', dn: 'CN=Random,DC=cpp,DC=edu' }],
    }), context('ticket-1'));

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error).toMatch(/not an approved/);
    expect(mocks.assignmentCreate).not.toHaveBeenCalled();
    expect(mocks.historyCreate).not.toHaveBeenCalled();
  });

  it('creates an active assignment plus immutable history for an approved group', async () => {
    mocks.checkAdminAuthWithRateLimit.mockResolvedValue({ admin: { username: 'admin1' }, response: null });
    mocks.actorHasPermission.mockReturnValue(true);

    const response = await POST(request({
      action: 'assign',
      targets: [{ targetType: 'directory_group', dn: approvedGroupDn }],
    }), context('ticket-1'));

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.changedCount).toBe(1);
    expect(mocks.assignmentCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ticketId: 'ticket-1',
        targetType: 'directory_group',
        targetGroupDn: approvedGroupDn,
        targetLabel: 'Ticket Team',
        isActive: true,
        assignedBy: 'admin1',
      }),
    });
    expect(mocks.historyCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ticketId: 'ticket-1',
        action: 'assign',
        targetLabel: 'Ticket Team',
        actorUsername: 'admin1',
      }),
    });
    expect(mocks.logAuditAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'assign_ticket' }),
      expect.objectContaining({ auditLog: expect.any(Object) }),
      { emitOperationalLog: false }
    );
    expect(mocks.emitAuditActionLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'assign_ticket' })
    );
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
  });

  it('resolves a selected person to a canonical username and readable label', async () => {
    mocks.checkAdminAuthWithRateLimit.mockResolvedValue({ admin: { username: 'admin1' }, response: null });
    mocks.actorHasPermission.mockReturnValue(true);

    const response = await POST(request({
      action: 'assign',
      targets: [{ targetType: 'user', username: 'ALEX.CHEN' }],
    }), context('ticket-1'));

    expect(response.status).toBe(200);
    expect(mocks.searchLDAPUser).toHaveBeenCalledWith('ALEX.CHEN');
    expect(mocks.assignmentCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        targetType: 'user',
        targetUsername: 'alex.chen',
        targetLabel: 'Alex Chen',
        targetEmail: 'alex.chen@example.test',
      }),
    });
    expect(mocks.historyCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ targetLabel: 'Alex Chen' }),
    });
  });

  it('rejects missing or disabled directory users', async () => {
    mocks.checkAdminAuthWithRateLimit.mockResolvedValue({ admin: { username: 'admin1' }, response: null });
    mocks.actorHasPermission.mockReturnValue(true);
    mocks.searchLDAPUser.mockResolvedValue({
      objectName: 'CN=Disabled,OU=Users,DC=example,DC=test',
      attributes: [
        { type: 'sAMAccountName', values: ['disabled.user'] },
        { type: 'displayName', values: ['Disabled User'] },
        { type: 'userAccountControl', values: ['514'] },
      ],
    });

    const disabledResponse = await POST(request({
      action: 'assign',
      targets: [{ targetType: 'user', username: 'disabled.user' }],
    }), context('ticket-1'));

    expect(disabledResponse.status).toBe(400);
    expect(mocks.assignmentCreate).not.toHaveBeenCalled();

    mocks.searchLDAPUser.mockResolvedValue(null);
    const missingResponse = await POST(request({
      action: 'assign',
      targets: [{ targetType: 'user', username: 'missing.user' }],
    }), context('ticket-1'));

    expect(missingResponse.status).toBe(400);
    expect(mocks.assignmentCreate).not.toHaveBeenCalled();
  });

  it('reactivates a previously deactivated assignment instead of duplicating it', async () => {
    mocks.checkAdminAuthWithRateLimit.mockResolvedValue({ admin: { username: 'admin1' }, response: null });
    mocks.actorHasPermission.mockReturnValue(true);
    mocks.assignmentFindFirst.mockResolvedValue({
      id: 'assignment-9',
      isActive: false,
    });

    await POST(request({
      action: 'assign',
      targets: [{ targetType: 'directory_group', dn: approvedGroupDn }],
    }), context('ticket-1'));

    expect(mocks.assignmentUpdateMany).toHaveBeenCalledWith({
      where: { id: 'assignment-9', isActive: false },
      data: expect.objectContaining({ isActive: true }),
    });
    expect(mocks.assignmentCreate).not.toHaveBeenCalled();
  });

  it('deactivates on unassign and records history without creating new rows', async () => {
    mocks.checkAdminAuthWithRateLimit.mockResolvedValue({ admin: { username: 'admin1' }, response: null });
    mocks.actorHasPermission.mockReturnValue(true);
    mocks.assignmentFindFirst.mockResolvedValue({
      id: 'assignment-5',
      isActive: true,
    });

    const response = await POST(request({
      action: 'unassign',
      targets: [{ targetType: 'user', username: 'director1' }],
    }), context('ticket-1'));

    expect(response.status).toBe(200);
    expect(mocks.assignmentUpdateMany).toHaveBeenCalledWith({
      where: { id: 'assignment-5', isActive: true },
      data: { isActive: false },
    });
    expect(mocks.assignmentCreate).not.toHaveBeenCalled();
    expect(mocks.historyCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'unassign', targetType: 'user' }),
    });
  });

  it('reports no changes when assigning an already-active target', async () => {
    mocks.checkAdminAuthWithRateLimit.mockResolvedValue({ admin: { username: 'admin1' }, response: null });
    mocks.actorHasPermission.mockReturnValue(true);
    mocks.assignmentFindFirst.mockResolvedValue({
      id: 'assignment-7',
      isActive: true,
    });

    const response = await POST(request({
      action: 'assign',
      targets: [{ targetType: 'directory_group', dn: approvedGroupDn }],
    }), context('ticket-1'));

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.changedCount).toBe(0);
    expect(mocks.historyCreate).not.toHaveBeenCalled();
  });

  it('fails the request when the transactional audit write fails', async () => {
    mocks.checkAdminAuthWithRateLimit.mockResolvedValue({ admin: { username: 'admin1' }, response: null });
    mocks.actorHasPermission.mockReturnValue(true);
    mocks.logAuditAction.mockRejectedValue(new Error('audit unavailable'));

    const response = await POST(request({
      action: 'assign',
      targets: [{ targetType: 'directory_group', dn: approvedGroupDn }],
    }), context('ticket-1'));

    expect(response.status).toBe(500);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.assignmentCreate).toHaveBeenCalled();
    expect(mocks.historyCreate).toHaveBeenCalled();
    expect(mocks.emitAuditActionLog).not.toHaveBeenCalled();
  });

  it('does not duplicate evidence when another request wins the state transition', async () => {
    mocks.checkAdminAuthWithRateLimit.mockResolvedValue({ admin: { username: 'admin1' }, response: null });
    mocks.actorHasPermission.mockReturnValue(true);
    mocks.assignmentFindFirst.mockResolvedValue({ id: 'assignment-9', isActive: false });
    mocks.assignmentUpdateMany.mockResolvedValue({ count: 0 });

    const response = await POST(request({
      action: 'assign',
      targets: [{ targetType: 'directory_group', dn: approvedGroupDn }],
    }), context('ticket-1'));

    expect(response.status).toBe(200);
    expect((await response.json()).changedCount).toBe(0);
    expect(mocks.historyCreate).not.toHaveBeenCalled();
    expect(mocks.logAuditAction).not.toHaveBeenCalled();
    expect(mocks.emitAuditActionLog).not.toHaveBeenCalled();
  });

  it('does not perform a fallible assignment refresh after the transaction commits', async () => {
    mocks.checkAdminAuthWithRateLimit.mockResolvedValue({ admin: { username: 'admin1' }, response: null });
    mocks.actorHasPermission.mockReturnValue(true);
    mocks.assignmentFindMany.mockRejectedValue(new Error('refresh unavailable'));

    const response = await POST(request({
      action: 'assign',
      targets: [{ targetType: 'directory_group', dn: approvedGroupDn }],
    }), context('ticket-1'));

    expect(response.status).toBe(200);
    expect((await response.json()).changedCount).toBe(1);
    expect(mocks.assignmentFindMany).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown ticket', async () => {
    mocks.checkAdminAuthWithRateLimit.mockResolvedValue({ admin: { username: 'admin1' }, response: null });
    mocks.actorHasPermission.mockReturnValue(true);
    mocks.supportTicketFindUnique.mockResolvedValue(null);

    const response = await POST(request({
      action: 'assign',
      targets: [{ targetType: 'user', username: 'someone' }],
    }), context('missing'));

    expect(response.status).toBe(404);
  });

  it('validates target shape before touching the database', async () => {
    mocks.checkAdminAuthWithRateLimit.mockResolvedValue({ admin: { username: 'admin1' }, response: null });
    mocks.actorHasPermission.mockReturnValue(true);

    const response = await POST(request({
      action: 'assign',
      targets: [{ targetType: 'alien' }],
    }), context('ticket-1'));

    expect(response.status).toBe(400);
    expect(mocks.supportTicketFindUnique).not.toHaveBeenCalled();
  });
});
