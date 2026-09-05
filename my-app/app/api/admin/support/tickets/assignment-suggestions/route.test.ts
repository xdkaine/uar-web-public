import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  checkAdminAuthWithRateLimit: vi.fn(),
  actorHasPermission: vi.fn(),
  checkRateLimitAsync: vi.fn(),
  isRateLimitUnavailable: vi.fn(() => false),
  groupFindMany: vi.fn(),
  searchLDAPUsers: vi.fn(),
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

vi.mock('@/lib/prisma', () => ({
  prisma: {
    allowedTicketSubjectGroup: {
      findMany: mocks.groupFindMany,
    },
  },
}));

vi.mock('@/lib/ldap', () => ({
  searchLDAPUsers: mocks.searchLDAPUsers,
}));

import { GET } from './route';

function request(query: string) {
  return new NextRequest(
    `https://portal.example.test/api/admin/support/tickets/assignment-suggestions?q=${encodeURIComponent(query)}`
  );
}

describe('ticket assignment suggestions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkAdminAuthWithRateLimit.mockResolvedValue({
      admin: { username: 'admin1' },
      response: null,
    });
    mocks.actorHasPermission.mockReturnValue(true);
    mocks.checkRateLimitAsync.mockResolvedValue({
      success: true,
      limit: 30,
      remaining: 29,
      reset: Date.now() + 60_000,
    });
    mocks.groupFindMany.mockResolvedValue([]);
    mocks.searchLDAPUsers.mockResolvedValue([]);
  });

  it('does not enumerate people or groups until at least three characters are entered', async () => {
    const response = await GET(request('al'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      suggestions: [],
      directoryUnavailable: false,
    });
    expect(mocks.groupFindMany).not.toHaveBeenCalled();
    expect(mocks.searchLDAPUsers).not.toHaveBeenCalled();
  });

  it('returns enabled people and approved groups in one safe result shape', async () => {
    mocks.searchLDAPUsers.mockResolvedValue([
      { username: 'alex.chen', displayName: 'Alex Chen' },
    ]);
    mocks.groupFindMany.mockResolvedValue([
      {
        dn: 'CN=Ticket Team,OU=Groups,DC=example,DC=test',
        name: 'Student Support Team',
      },
    ]);

    const response = await GET(request('alex'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.groupFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        isActive: true,
        canBeAssignee: true,
        OR: [
          { name: { contains: 'alex', mode: 'insensitive' } },
          { dn: { contains: 'alex', mode: 'insensitive' } },
        ],
      }),
    }));
    expect(mocks.searchLDAPUsers).toHaveBeenCalledWith('alex', 6);
    expect(payload.suggestions).toEqual([
      {
        targetType: 'user',
        username: 'alex.chen',
        label: 'Alex Chen',
        secondaryLabel: 'Username: alex.chen',
      },
      {
        targetType: 'directory_group',
        dn: 'CN=Ticket Team,OU=Groups,DC=example,DC=test',
        label: 'Student Support Team',
        secondaryLabel: 'Approved group \u00b7 example.test \u203a Groups',
      },
    ]);
    expect(payload.suggestions.every(
      (suggestion: { label: string }) => !suggestion.label.includes('OU=Groups')
    )).toBe(true);
  });

  it('falls back to a short CN when a stored group name is still a directory path', async () => {
    mocks.groupFindMany.mockResolvedValue([
      {
        dn: 'CN=Helpdesk,OU=Groups,DC=example,DC=test',
        name: 'CN=Helpdesk,OU=Groups,DC=example,DC=test',
      },
    ]);

    const response = await GET(request('help'));
    const payload = await response.json();

    expect(payload.suggestions).toEqual([
      {
        targetType: 'directory_group',
        dn: 'CN=Helpdesk,OU=Groups,DC=example,DC=test',
        label: 'Helpdesk',
        secondaryLabel: 'Approved group \u00b7 example.test \u203a Groups',
      },
    ]);
  });

  it('keeps approved group suggestions available when the live people lookup is unavailable', async () => {
    mocks.searchLDAPUsers.mockRejectedValue(new Error('directory offline'));
    mocks.groupFindMany.mockResolvedValue([
      { dn: 'CN=Helpdesk,DC=example,DC=test', name: 'Helpdesk' },
    ]);

    const response = await GET(request('help'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.directoryUnavailable).toBe(true);
    expect(payload.suggestions).toEqual([
      {
        targetType: 'directory_group',
        dn: 'CN=Helpdesk,DC=example,DC=test',
        label: 'Helpdesk',
        secondaryLabel: 'Approved group \u00b7 example.test',
      },
    ]);
  });

  it('distinguishes approved groups with the same friendly name by directory path', async () => {
    mocks.groupFindMany.mockResolvedValue([
      {
        dn: 'CN=Helpdesk,OU=Faculty,DC=example,DC=test',
        name: 'Helpdesk',
      },
      {
        dn: 'CN=Helpdesk,OU=Students,DC=example,DC=test',
        name: 'Helpdesk',
      },
    ]);

    const response = await GET(request('help'));
    const payload = await response.json();

    expect(payload.suggestions).toEqual([
      expect.objectContaining({
        label: 'Helpdesk',
        secondaryLabel: 'Approved group \u00b7 example.test \u203a Faculty',
      }),
      expect.objectContaining({
        label: 'Helpdesk',
        secondaryLabel: 'Approved group \u00b7 example.test \u203a Students',
      }),
    ]);
  });

  it('requires the ticket assignment permission', async () => {
    mocks.actorHasPermission.mockReturnValue(false);

    const response = await GET(request('alex'));

    expect(response.status).toBe(403);
    expect(mocks.groupFindMany).not.toHaveBeenCalled();
    expect(mocks.searchLDAPUsers).not.toHaveBeenCalled();
  });
});
