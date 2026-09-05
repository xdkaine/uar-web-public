import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getSessionFromCookies: vi.fn(),
  revokeSessionById: vi.fn(),
  clearSession: vi.fn(),
  isUserDomainAdmin: vi.fn(),
  checkRateLimitAsync: vi.fn(),
  accessRequestFindUnique: vi.fn(),
  accessRequestFindFirst: vi.fn(),
  transaction: vi.fn(),
  supportTicketCreate: vi.fn(),
  ticketStatusLogCreate: vi.fn(),
  sendTicketCreationNotifications: vi.fn(),
  groupFindUnique: vi.fn(),
  snapshotFindMany: vi.fn(),
}));

vi.mock('@/lib/session', () => ({
  getSessionFromCookies: mocks.getSessionFromCookies,
  revokeSessionById: mocks.revokeSessionById,
  clearSession: mocks.clearSession,
}));

vi.mock('@/lib/ldap', () => ({
  isUserDomainAdmin: mocks.isUserDomainAdmin,
}));

vi.mock('@/lib/ratelimit', () => ({
  checkRateLimitAsync: mocks.checkRateLimitAsync,
  isRateLimitUnavailable: () => false,
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    accessRequest: {
      findUnique: mocks.accessRequestFindUnique,
      findFirst: mocks.accessRequestFindFirst,
    },
    allowedTicketSubjectGroup: {
      findUnique: mocks.groupFindUnique,
    },
    directoryGroupMemberSnapshot: {
      findMany: mocks.snapshotFindMany,
    },
    $transaction: mocks.transaction,
  },
}));

vi.mock('@/lib/support/ticket-notifications', () => ({
  sendTicketCreationNotifications: mocks.sendTicketCreationNotifications,
}));

import { POST } from './route';

function request() {
  return new NextRequest('https://portal.example.test/api/support/tickets', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      subject: 'Cross-user issue',
      body: 'Please inspect this related access request.',
      relatedRequestId: 'another-users-request',
    }),
  });
}

describe('support ticket creation live administrator authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionFromCookies.mockResolvedValue({
      id: 'admin-session',
      username: 'support-admin',
      isAdmin: true,
    });
    mocks.isUserDomainAdmin.mockResolvedValue(false);
    mocks.revokeSessionById.mockResolvedValue(undefined);
    mocks.checkRateLimitAsync.mockResolvedValue({
      success: true,
      limit: 10,
      remaining: 9,
      reset: Date.now() + 60 * 60 * 1000,
    });
    mocks.accessRequestFindUnique.mockResolvedValue({
      id: 'another-users-request',
      ldapUsername: 'ticket-owner',
      vpnUsername: null,
      linkedAdUsername: null,
      linkedVpnUsername: null,
      email: 'owner@example.test',
    });
    mocks.supportTicketCreate.mockResolvedValue({
      id: 'ticket-1',
      subject: 'Cross-user issue',
      category: null,
      severity: null,
      body: 'Please inspect this related access request.',
      attachmentBytes: BigInt(727_280),
    });
    mocks.ticketStatusLogCreate.mockResolvedValue({});
    mocks.transaction.mockImplementation(async (operation) => operation({
      supportTicket: {
        create: mocks.supportTicketCreate,
      },
      ticketStatusLog: {
        create: mocks.ticketStatusLogCreate,
      },
    }));
    mocks.sendTicketCreationNotifications.mockResolvedValue(undefined);
    mocks.groupFindUnique.mockResolvedValue(null);
    // By default the filer is a member of every configured group.
    mocks.snapshotFindMany.mockResolvedValue([
      { groupDn: 'CN=Approved Group,DC=cpp,DC=edu', accountEnabled: true },
      { groupDn: 'CN=Other Group,DC=cpp,DC=edu', accountEnabled: null },
    ]);
  });

  it('rejects a requested-for DN that is not an approved active group', async () => {
    mocks.isUserDomainAdmin.mockResolvedValue(true);

    const response = await POST(new NextRequest('https://portal.example.test/api/support/tickets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        subject: 'Group issue',
        body: 'Affects the whole group.',
        requestedForGroupDn: 'CN=Not Approved,DC=cpp,DC=edu',
      }),
    }));

    expect(response.status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('persists an approved requested-for group on creation', async () => {
    mocks.isUserDomainAdmin.mockResolvedValue(true);
    mocks.groupFindUnique.mockResolvedValue({ canBeRequestedFor: true, isActive: true });

    const response = await POST(new NextRequest('https://portal.example.test/api/support/tickets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        subject: 'Group issue',
        body: 'Affects the whole group.',
        requestedForGroupDn: 'CN=Approved Group,DC=cpp,DC=edu',
      }),
    }));

    expect(response.status).toBe(201);
    expect(mocks.supportTicketCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        requestedForGroupDn: 'CN=Approved Group,DC=cpp,DC=edu',
      }),
    });
  });

  it('rejects a requested-for group the filer is not a snapshot member of', async () => {
    mocks.isUserDomainAdmin.mockResolvedValue(true);
    mocks.groupFindUnique.mockResolvedValue({ canBeRequestedFor: true, isActive: true });
    mocks.snapshotFindMany.mockResolvedValue([
      { groupDn: 'CN=Some Other Group,DC=cpp,DC=edu', accountEnabled: true },
    ]);

    const response = await POST(new NextRequest('https://portal.example.test/api/support/tickets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        subject: 'Group issue',
        body: 'Filing for a group I do not belong to.',
        requestedForGroupDn: 'CN=Approved Group,DC=cpp,DC=edu',
      }),
    }));

    expect(response.status).toBe(403);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('persists the shared ticket topics on creation', async () => {
    mocks.isUserDomainAdmin.mockResolvedValue(true);

    for (const category of ['ACCOUNT', 'INFRASTRUCTURE', 'SDC', 'SOC']) {
      const response = await POST(new NextRequest('https://portal.example.test/api/support/tickets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          subject: 'Topic check',
          body: 'A known topic must be accepted.',
          category,
        }),
      }));

      expect(response.status).toBe(201);
      expect(mocks.supportTicketCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({ category }),
      });
    }
  });

  it('rejects an unknown topic with the supported list', async () => {
    mocks.isUserDomainAdmin.mockResolvedValue(true);

    const response = await POST(new NextRequest('https://portal.example.test/api/support/tickets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        subject: 'Unknown topic',
        body: 'An unknown topic must be rejected.',
        category: 'NOPE',
      }),
    }));

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('ACCOUNT');
    expect(data.error).toContain('INFRASTRUCTURE');
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('rejects a join-group DN that is not flagged canJoinViaTicket', async () => {
    mocks.isUserDomainAdmin.mockResolvedValue(true);
    mocks.groupFindUnique.mockResolvedValue({ canJoinViaTicket: false, isActive: true });

    const response = await POST(new NextRequest('https://portal.example.test/api/support/tickets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        subject: 'Please add me',
        body: 'Requesting membership.',
        joinGroupDn: 'CN=Not Joinable,DC=cpp,DC=edu',
      }),
    }));

    expect(response.status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('persists an approved joinable group on creation', async () => {
    mocks.isUserDomainAdmin.mockResolvedValue(true);
    mocks.groupFindUnique.mockResolvedValue({ canJoinViaTicket: true, isActive: true });

    const response = await POST(new NextRequest('https://portal.example.test/api/support/tickets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        subject: 'Please add me',
        body: 'Requesting membership.',
        joinGroupDn: 'CN=Joinable,DC=cpp,DC=edu',
      }),
    }));

    expect(response.status).toBe(201);
    expect(mocks.supportTicketCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        joinGroupDn: 'CN=Joinable,DC=cpp,DC=edu',
      }),
    });
  });

  it('preserves a valid mapped administrator session without requiring legacy domain-admin status', async () => {
    const response = await POST(request());

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      ticket: { id: 'ticket-1', attachmentBytes: '727280' },
    });
    expect(mocks.revokeSessionById).not.toHaveBeenCalled();
    expect(mocks.clearSession).not.toHaveBeenCalled();
    expect(mocks.checkRateLimitAsync).toHaveBeenCalled();
    expect(mocks.transaction).toHaveBeenCalled();
    expect(mocks.sendTicketCreationNotifications).toHaveBeenCalled();
  });

  it('preserves cross-user ticket creation for a live directory administrator', async () => {
    mocks.isUserDomainAdmin.mockResolvedValue(true);

    const response = await POST(request());

    expect(response.status).toBe(201);
    expect(mocks.supportTicketCreate).toHaveBeenCalledWith({
      data: {
        subject: 'Cross-user issue',
        category: null,
        severity: null,
        body: 'Please inspect this related access request.',
        username: 'support-admin',
        status: 'open',
        relatedRequestId: 'another-users-request',
        requestedForGroupDn: null,
        joinGroupDn: null,
      },
    });
    expect(mocks.ticketStatusLogCreate).toHaveBeenCalledWith({
      data: {
        ticketId: 'ticket-1',
        oldStatus: null,
        newStatus: 'open',
        changedBy: 'support-admin',
        isStaff: true,
      },
    });
  });

  it('orchestrates queue notification plus creator receipt on creation', async () => {
    mocks.isUserDomainAdmin.mockResolvedValue(true);

    const response = await POST(request());

    expect(response.status).toBe(201);
    expect(mocks.sendTicketCreationNotifications).toHaveBeenCalledExactlyOnceWith({
      ticketId: 'ticket-1',
      subject: 'Cross-user issue',
      category: null,
      severity: null,
      body: 'Please inspect this related access request.',
      username: 'support-admin',
      creatorEmail: 'owner@example.test',
    });
  });

  it('still creates the ticket when no creator email can be resolved', async () => {
    mocks.isUserDomainAdmin.mockResolvedValue(true);
    mocks.accessRequestFindUnique.mockResolvedValue({
      id: 'another-users-request',
      ldapUsername: 'ticket-owner',
      vpnUsername: null,
      linkedAdUsername: null,
      linkedVpnUsername: null,
    });

    const response = await POST(request());

    expect(response.status).toBe(201);
    expect(mocks.sendTicketCreationNotifications).toHaveBeenCalledWith(
      expect.objectContaining({ ticketId: 'ticket-1', creatorEmail: null })
    );
  });
});
