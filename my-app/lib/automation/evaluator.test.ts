import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  serviceAlertFindUnique: vi.fn(),
  serviceAlertCreate: vi.fn(),
  serviceAlertUpdate: vi.fn(),
  groupFindUnique: vi.fn(),
  lifecycleFindFirst: vi.fn(),
  lifecycleCreate: vi.fn(),
  ticketFindUnique: vi.fn(),
  ticketUpdate: vi.fn(),
  statusLogCreate: vi.fn(),
  responseCreate: vi.fn(),
  createLifecycleGroupAction: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    serviceAlert: {
      findUnique: mocks.serviceAlertFindUnique,
      create: mocks.serviceAlertCreate,
      update: mocks.serviceAlertUpdate,
    },
    allowedTicketSubjectGroup: {
      findUnique: mocks.groupFindUnique,
    },
    accountLifecycleAction: {
      findFirst: mocks.lifecycleFindFirst,
      create: mocks.lifecycleCreate,
    },
    supportTicket: {
      findUnique: mocks.ticketFindUnique,
      update: mocks.ticketUpdate,
    },
    ticketStatusLog: {
      create: mocks.statusLogCreate,
    },
    ticketResponse: {
      create: mocks.responseCreate,
    },
    $transaction: vi.fn((operations: unknown[]) => Promise.all(operations as never[])),
  },
}));

vi.mock('@/lib/logger', () => ({
  appLogger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('@/lib/lifecycle-group-action', () => ({
  createLifecycleGroupAction: mocks.createLifecycleGroupAction,
}));

import { evaluateConditions, runAutomationRule } from './evaluator';

const TICKET_CONTEXT = {
  ticketId: 'ticket-1',
  creatorUsername: 'alice',
  joinGroupDn: 'CN=Joinable,DC=test',
};

const baseRule = {
  id: 'rule-1',
  name: 'test rule',
  triggerKey: 'ticket_created',
  conditions: [],
  // Valid filler action: condition-mismatch tests must fail on conditions,
  // never on definition validation, so at least one action must exist.
  actions: [{ key: 'close_ticket' }],
};

describe('evaluateConditions', () => {
  it('requires every condition to match', () => {
    const conditions = [
      { key: 'context_field_exists' as const, field: 'ticketId' },
      { key: 'context_field_equals' as const, field: 'creatorUsername', value: 'alice' },
    ];
    expect(evaluateConditions(conditions, TICKET_CONTEXT)).toBe(true);
    expect(
      evaluateConditions(
        [{ key: 'context_field_equals' as const, field: 'creatorUsername', value: 'bob' }],
        TICKET_CONTEXT
      )
    ).toBe(false);
  });
});

describe('runAutomationRule', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.serviceAlertFindUnique.mockResolvedValue(null);
    mocks.serviceAlertCreate.mockResolvedValue({ id: 'a1' });
    mocks.groupFindUnique.mockResolvedValue({
      dn: TICKET_CONTEXT.joinGroupDn,
      name: 'Joinable',
      canJoinViaTicket: true,
      autoApproveJoin: true,
      isActive: true,
    });
    mocks.lifecycleFindFirst.mockResolvedValue(null);
    mocks.lifecycleCreate.mockResolvedValue({ id: 'life-1' });
    mocks.createLifecycleGroupAction.mockImplementation(async (input: Record<string, unknown>) => {
      mocks.lifecycleCreate({
        data: {
          actionType: input.actionType,
          targetUsername: input.username,
          status: 'queued',
        },
      });
      return { action: { id: 'life-1' }, replayed: false };
    });
    mocks.ticketFindUnique.mockResolvedValue({ id: 'ticket-1', status: 'open' });
    mocks.ticketUpdate.mockResolvedValue({});
  });

  it('reports unmatched without executing actions when conditions fail', async () => {
    const result = await runAutomationRule(
      { ...baseRule, conditions: [{ key: 'context_field_exists', field: 'absent' }] },
      {}
    );
    expect(result.matched).toBe(false);
    expect(result.outcomes).toHaveLength(0);
    expect(mocks.serviceAlertCreate).not.toHaveBeenCalled();
  });

  it('flags invalid rule definitions instead of executing', async () => {
    const result = await runAutomationRule(
      { ...baseRule, actions: [{ key: 'format_disk' }] },
      TICKET_CONTEXT
    );
    expect(result.error).toContain('invalid_rule_definition');
  });

  it('creates a new alert when the dedupe key is unseen', async () => {
    const result = await runAutomationRule(
      {
        ...baseRule,
        actions: [
          {
            key: 'create_service_alert',
            config: {
              dedupeKey: 'dc-primary',
              category: 'directory',
              severity: 'critical',
              title: 'DC {{target}} down',
              message: 'unreachable',
            },
          },
        ],
      },
      { target: 'dc1' }
    );
    expect(result.matched).toBe(true);
    expect(result.outcomes[0].ok).toBe(true);
    expect(mocks.serviceAlertCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ title: 'DC dc1 down' }),
      })
    );
  });

  it('increments occurrence count on an existing alert', async () => {
    mocks.serviceAlertFindUnique.mockResolvedValue({ id: 'existing' });
    const result = await runAutomationRule(
      {
        ...baseRule,
        actions: [
          {
            key: 'create_service_alert',
            config: {
              dedupeKey: 'dc-primary',
              category: 'directory',
              title: 't',
              message: 'm',
            },
          },
        ],
      },
      {}
    );
    expect(result.outcomes[0].detail).toEqual({ created: false, reoccurred: true });
    expect(mocks.serviceAlertUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ occurrenceCount: { increment: 1 } }),
      })
    );
  });

  it('queues a group add only for approved joinable groups', async () => {
    const rule = { ...baseRule, actions: [{ key: 'enqueue_group_add' }] };
    const ok = await runAutomationRule(rule, TICKET_CONTEXT);
    expect(ok.outcomes[0].ok).toBe(true);
    expect(mocks.lifecycleCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actionType: 'add_group_member',
          targetUsername: 'alice',
          status: 'queued',
        }),
      })
    );

    mocks.groupFindUnique.mockResolvedValue({ canJoinViaTicket: false, isActive: true });
    const denied = await runAutomationRule(rule, TICKET_CONTEXT);
    expect(denied.outcomes[0].ok).toBe(false);
    expect(denied.error).toContain('action_failed');
  });

  it('fails closed when the target group is not flagged for auto-approval', async () => {
    const rule = { ...baseRule, actions: [{ key: 'enqueue_group_add' }] };
    mocks.groupFindUnique.mockResolvedValue({
      dn: TICKET_CONTEXT.joinGroupDn,
      name: 'Manual Review',
      canJoinViaTicket: true,
      autoApproveJoin: false,
      isActive: true,
    });
    const denied = await runAutomationRule(rule, TICKET_CONTEXT);
    expect(denied.outcomes[0].ok).toBe(false);
    expect(denied.error).toContain(
      '"Manual Review" is not configured for automatic adds; enable auto-approve in Support & Routing first'
    );
    expect(mocks.lifecycleCreate).not.toHaveBeenCalled();

    mocks.groupFindUnique.mockResolvedValue({
      dn: TICKET_CONTEXT.joinGroupDn,
      name: 'Legacy Row',
      canJoinViaTicket: true,
      isActive: true,
    });
    const missingFlag = await runAutomationRule(rule, TICKET_CONTEXT);
    expect(missingFlag.outcomes[0].ok).toBe(false);
    expect(mocks.lifecycleCreate).not.toHaveBeenCalled();
  });

  it('deduplicates concurrent group adds for the same ticket', async () => {
    mocks.lifecycleFindFirst.mockResolvedValue({ id: 'already-queued' });
    const result = await runAutomationRule(
      { ...baseRule, actions: [{ key: 'enqueue_group_add' }] },
      TICKET_CONTEXT
    );
    expect(result.outcomes[0].detail).toEqual({
      alreadyQueued: true,
      actionId: 'already-queued',
    });
    expect(mocks.lifecycleCreate).not.toHaveBeenCalled();
  });

  it('closes an open ticket with a status log entry and no-ops when closed', async () => {
    const rule = { ...baseRule, actions: [{ key: 'close_ticket' }] };
    const closed = await runAutomationRule(rule, TICKET_CONTEXT);
    expect(closed.outcomes[0].ok).toBe(true);
    expect(mocks.ticketUpdate).toHaveBeenCalled();

    mocks.ticketFindUnique.mockResolvedValue({ id: 'ticket-1', status: 'closed' });
    const noop = await runAutomationRule(rule, TICKET_CONTEXT);
    expect(noop.outcomes[0].detail).toEqual({ alreadyClosed: true });
  });

  it('stops at the first failed action and reports it', async () => {
    mocks.groupFindUnique.mockResolvedValue(null);
    const result = await runAutomationRule(
      {
        ...baseRule,
        actions: [{ key: 'enqueue_group_add' }, { key: 'close_ticket' }],
      },
      TICKET_CONTEXT
    );
    expect(result.matched).toBe(true);
    expect(result.outcomes).toHaveLength(1);
    expect(mocks.ticketUpdate).not.toHaveBeenCalled();
  });
});
