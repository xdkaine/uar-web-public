import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assignmentFindMany: vi.fn(),
  groupFindMany: vi.fn(),
  memberFindMany: vi.fn(),
  accessRequestFindMany: vi.fn(),
  getEmailConfig: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    supportTicketAssignment: { findMany: mocks.assignmentFindMany },
    allowedTicketSubjectGroup: { findMany: mocks.groupFindMany },
    directoryGroupMemberSnapshot: { findMany: mocks.memberFindMany },
    accessRequest: { findMany: mocks.accessRequestFindMany },
  },
}));

vi.mock('@/lib/email-config', () => ({
  getEmailConfig: mocks.getEmailConfig,
}));

import { resolveTicketNotificationRecipients } from './routing';

describe('resolveTicketNotificationRecipients direct user grants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.groupFindMany.mockResolvedValue([]);
    mocks.memberFindMany.mockResolvedValue([]);
    mocks.accessRequestFindMany.mockResolvedValue([]);
    mocks.getEmailConfig.mockResolvedValue({ adminEmail: 'queue@example.test' });
  });

  it('routes to the verified address captured on the assignment without requiring an access request', async () => {
    mocks.assignmentFindMany.mockResolvedValue([
      {
        targetType: 'user',
        targetUsername: 'alex.chen',
        targetGroupDn: null,
        targetEmail: 'Alex.Chen@Example.Test',
      },
    ]);

    const result = await resolveTicketNotificationRecipients('ticket-1');

    expect(result.emails).toEqual(['alex.chen@example.test']);
    expect(result.sources['alex.chen@example.test']).toBe('user:alex.chen');
    expect(result.usedQueueFallback).toBe(false);
    expect(mocks.accessRequestFindMany).not.toHaveBeenCalled();
  });

  it('keeps the legacy access-request fallback for assignments created before the migration', async () => {
    mocks.assignmentFindMany.mockResolvedValue([
      {
        targetType: 'user',
        targetUsername: 'legacy.user',
        targetGroupDn: null,
        targetEmail: null,
      },
    ]);
    mocks.accessRequestFindMany.mockResolvedValue([
      {
        ldapUsername: 'legacy.user',
        linkedAdUsername: null,
        email: 'legacy.user@example.test',
      },
    ]);

    const result = await resolveTicketNotificationRecipients('ticket-2');

    expect(result.emails).toEqual(['legacy.user@example.test']);
    expect(mocks.accessRequestFindMany).toHaveBeenCalled();
  });

  it('matches legacy usernames without depending on their stored casing', async () => {
    mocks.assignmentFindMany.mockResolvedValue([
      {
        targetType: 'user',
        targetUsername: 'ALEX.CHEN',
        targetGroupDn: null,
        targetEmail: null,
      },
    ]);
    mocks.accessRequestFindMany.mockResolvedValue([
      {
        ldapUsername: 'alex.chen',
        linkedAdUsername: null,
        email: 'alex.chen@example.test',
      },
    ]);

    const result = await resolveTicketNotificationRecipients('ticket-legacy-case');

    expect(result.emails).toEqual(['alex.chen@example.test']);
    expect(mocks.accessRequestFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: expect.arrayContaining([
            { ldapUsername: { equals: 'ALEX.CHEN', mode: 'insensitive' } },
          ]),
        },
      })
    );
  });
});
