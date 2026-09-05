import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  workflowGraphFindMany: vi.fn(),
  flowRunCreate: vi.fn(),
  flowRunUpdate: vi.fn(),
  flowRunUpdateMany: vi.fn(),
  flowRunFindUnique: vi.fn(),
  flowTimerCreate: vi.fn(),
  flowTimerCreateMany: vi.fn(),
  flowTimerFindUnique: vi.fn(),
  flowTimerFindMany: vi.fn(),
  flowTimerDeleteMany: vi.fn(),
  flowTimerUpdateMany: vi.fn(),
  flowActionAttemptFindUnique: vi.fn(),
  flowActionAttemptFindMany: vi.fn(),
  flowActionAttemptCreate: vi.fn(),
  flowActionAttemptUpdateMany: vi.fn(),
  flowArtifactCreate: vi.fn(),
  flowArtifactFindMany: vi.fn(),
  flowArtifactUpdateMany: vi.fn(),
  notificationBannerCreate: vi.fn(),
  notificationBannerUpdateMany: vi.fn(),
  ticketResponseCreate: vi.fn(),
  allowedTicketSubjectGroupFindUnique: vi.fn(),
  allowedTicketSubjectGroupFindMany: vi.fn(),
  accountLifecycleActionFindFirst: vi.fn(),
  accountLifecycleActionCreate: vi.fn(),
  sendAutomationEmail: vi.fn(),
  supportTicketFindUnique: vi.fn(),
  supportTicketCreate: vi.fn(),
  supportTicketUpdate: vi.fn(),
  ticketStatusLogCreate: vi.fn(),
  prismaTransaction: vi.fn(),
  accessRequestFindUnique: vi.fn(),
  accessRequestFindFirst: vi.fn(),
  sendTicketResponseToUser: vi.fn(),
  sendTicketStatusChangeToUser: vi.fn(),
  createLifecycleGroupAction: vi.fn(),
  createLifecycleGroupActions: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    workflowGraph: { findMany: mocks.workflowGraphFindMany },
    flowRun: {
      create: mocks.flowRunCreate,
      update: mocks.flowRunUpdate,
      updateMany: mocks.flowRunUpdateMany,
      findUnique: mocks.flowRunFindUnique,
    },
    flowTimer: {
      create: mocks.flowTimerCreate,
      createMany: mocks.flowTimerCreateMany,
      findUnique: mocks.flowTimerFindUnique,
      findMany: mocks.flowTimerFindMany,
      deleteMany: mocks.flowTimerDeleteMany,
      updateMany: mocks.flowTimerUpdateMany,
    },
    flowActionAttempt: {
      findUnique: mocks.flowActionAttemptFindUnique,
      findMany: mocks.flowActionAttemptFindMany,
      create: mocks.flowActionAttemptCreate,
      updateMany: mocks.flowActionAttemptUpdateMany,
    },
    flowArtifact: {
      create: mocks.flowArtifactCreate,
      findMany: mocks.flowArtifactFindMany,
      updateMany: mocks.flowArtifactUpdateMany,
    },
    notificationBanner: {
      create: mocks.notificationBannerCreate,
      updateMany: mocks.notificationBannerUpdateMany,
    },
    ticketResponse: { create: mocks.ticketResponseCreate },
    supportTicket: {
      findUnique: mocks.supportTicketFindUnique,
      create: mocks.supportTicketCreate,
      update: mocks.supportTicketUpdate,
    },
    ticketStatusLog: { create: mocks.ticketStatusLogCreate },
    accessRequest: {
      findUnique: mocks.accessRequestFindUnique,
      findFirst: mocks.accessRequestFindFirst,
    },
    $transaction: mocks.prismaTransaction,
    allowedTicketSubjectGroup: { findUnique: mocks.allowedTicketSubjectGroupFindUnique, findMany: mocks.allowedTicketSubjectGroupFindMany },
    accountLifecycleAction: {
      findFirst: mocks.accountLifecycleActionFindFirst,
      create: mocks.accountLifecycleActionCreate,
    },
  },
}));

vi.mock('@/lib/logger', () => ({
  appLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/lib/automation/email-sender', () => ({
  sendAutomationEmail: mocks.sendAutomationEmail,
}));

vi.mock('@/lib/email', () => ({
  sendTicketResponseToUser: mocks.sendTicketResponseToUser,
  sendTicketStatusChangeToUser: mocks.sendTicketStatusChangeToUser,
}));

vi.mock('@/lib/lifecycle-group-action', () => ({
  createLifecycleGroupAction: mocks.createLifecycleGroupAction,
  createLifecycleGroupActions: mocks.createLifecycleGroupActions,
}));

import { emitFlowEvent, emitLifecycleActionEvent, runFlowTick, type FlowNodeOutcome } from './engine';

const TRIGGER = { id: 'trigger-1', type: 'trigger_ticket_created', config: {} };

const WAIT_NODE = { id: 'wait-1', type: 'logic_delay', config: { minutes: 30 } };

const EMAIL_NODE = {
  id: 'email-1',
  type: 'action_send_email',
  config: { to: 'staff@cpp.edu', subject: 'Ticket {{ticketId}}', body: 'Filed by {{username}}' },
};

const BANNER_NODE = {
  id: 'banner-1',
  type: 'action_create_notification_banner',
  config: { message: 'Maintenance soon', type: 'warning', expiresMinutes: 15 },
};

const REPLY_NODE = {
  id: 'reply-1',
  type: 'action_add_ticket_response',
  config: { message: 'Working on {{ticketId}}' },
};

const CLOSE_NODE = {
  id: 'close-1',
  type: 'action_close_ticket',
  config: {},
};

const GROUP_ADD_NODE = {
  id: 'group-add-1',
  type: 'action_enqueue_group_add',
  config: { groupDn: '{{joinGroupDn}}' },
};

const MALWARE_TRIGGER = {
  id: 'malware-trigger',
  type: 'trigger_attachment_malware_detected',
  config: {},
};

const CREATE_INTERNAL_TICKET_NODE = {
  id: 'create-internal-ticket',
  type: 'action_create_internal_ticket',
  config: {
    subject: '[Security] Malware blocked on {{ticketId}}',
    body: 'Attachment {{filename}} was quarantined for ticket {{ticketId}}.',
    category: 'SECURITY',
    severity: 'critical',
  },
};

const JOIN_GROUP_DN = 'CN=App-Users,OU=Groups,DC=example,DC=test';

const ALLOWED_GROUP = {
  dn: JOIN_GROUP_DN,
  name: 'App Users',
  canJoinViaTicket: true,
  autoApproveJoin: true,
  isActive: true,
};

const JOIN_CONTEXT = {
  ticketId: 'tkt-7',
  creatorUsername: 'alice',
  joinGroupDn: JOIN_GROUP_DN,
};

function edge(id: string, source: string, target: string): { id: string; source: string; target: string } {
  return { id, source, target };
}

function stubGraph(nodes: unknown[], edges: unknown[], graphId = 'graph-1'): void {
  mocks.workflowGraphFindMany.mockResolvedValue([
    { id: graphId, name: 'Test Graph', nodes, edges },
  ]);
}

function lastFlowRunUpdate(): { where: { id: string }; data: Record<string, unknown> } {
  const calls = mocks.flowRunUpdate.mock.calls;
  return calls[calls.length - 1][0];
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.flowRunCreate.mockResolvedValue({ id: 'run-1' });
  mocks.flowRunUpdate.mockResolvedValue(undefined);
  mocks.flowRunUpdateMany.mockResolvedValue({ count: 1 });
  mocks.flowArtifactCreate.mockResolvedValue({});
  mocks.flowArtifactFindMany.mockResolvedValue([]);
  mocks.flowArtifactUpdateMany.mockResolvedValue({ count: 0 });
  mocks.flowTimerFindMany.mockResolvedValue([]);
  mocks.flowTimerFindUnique.mockImplementation(async () => ({
    dueAt: mocks.flowTimerCreateMany.mock.calls.at(-1)?.[0]?.data?.[0]?.dueAt ?? new Date(),
  }));
  mocks.flowTimerCreateMany.mockResolvedValue({ count: 1 });
  mocks.flowTimerDeleteMany.mockResolvedValue({ count: 1 });
  mocks.flowTimerUpdateMany.mockResolvedValue({ count: 1 });
  mocks.flowActionAttemptFindUnique.mockResolvedValue(null);
  mocks.flowActionAttemptFindMany.mockResolvedValue([]);
  mocks.flowActionAttemptCreate.mockResolvedValue({ id: 'attempt-1' });
  mocks.flowActionAttemptUpdateMany.mockResolvedValue({ count: 1 });
  mocks.notificationBannerCreate.mockResolvedValue({ id: 'banner-1' });
  mocks.notificationBannerUpdateMany.mockResolvedValue({ count: 0 });
  mocks.ticketResponseCreate.mockResolvedValue({ id: 'response-1' });
  mocks.sendAutomationEmail.mockResolvedValue({ messageId: 'msg-1' });
  mocks.supportTicketFindUnique.mockResolvedValue({ subject: 'Test ticket', username: 'alice', relatedRequestId: null });
  mocks.supportTicketCreate.mockResolvedValue({ id: 'internal-ticket-1' });
  mocks.accessRequestFindUnique.mockResolvedValue(null);
  mocks.accessRequestFindFirst.mockResolvedValue(null);
  mocks.sendTicketResponseToUser.mockResolvedValue(undefined);
  mocks.sendTicketStatusChangeToUser.mockResolvedValue(undefined);
  mocks.createLifecycleGroupActions.mockImplementation(async (inputs: Array<Record<string, unknown>>) => inputs.map((input, index) => {
    const action = { id: `action-${index + 1}` };
    mocks.accountLifecycleActionCreate({
      data: {
        actionType: input.actionType,
        targetUsername: input.username,
        targetGroupDn: input.groupDn,
        status: 'queued',
        relatedTicketId: input.relatedTicketId,
      },
    });
    const artifact = input.flowArtifact as { runId: string; nodeId: string } | undefined;
    if (artifact) {
      mocks.flowArtifactCreate({ data: { ...artifact, kind: 'lifecycle_action', refId: action.id } });
    }
    return { action, replayed: false };
  }));
  mocks.createLifecycleGroupAction.mockImplementation(async (input: Record<string, unknown>) => {
    const action = { id: input.actionType === 'remove_from_group' ? 'action-r1' : 'action-1' };
    mocks.accountLifecycleActionCreate({
      data: {
        actionType: input.actionType,
        targetUsername: input.username,
        targetGroupDn: input.groupDn,
        status: 'queued',
        relatedTicketId: input.relatedTicketId,
      },
    });
    const artifact = input.flowArtifact as { runId: string; nodeId: string } | undefined;
    if (artifact) {
      mocks.flowArtifactCreate({ data: { ...artifact, kind: 'lifecycle_action', refId: action.id } });
    }
    return { action, replayed: false };
  });
  mocks.prismaTransaction.mockImplementation(async (input: unknown) => {
    if (typeof input === 'function') {
      return input({
        supportTicket: { create: mocks.supportTicketCreate },
        flowArtifact: { create: mocks.flowArtifactCreate },
        accountLifecycleAction: { findFirst: mocks.accountLifecycleActionFindFirst, create: mocks.accountLifecycleActionCreate },
      });
    }
    return Promise.all(input as Promise<unknown>[]);
  });
});

describe('emitFlowEvent idempotency', () => {
  it('skips re-execution when the same event key is redelivered', async () => {
    stubGraph([TRIGGER, EMAIL_NODE], [edge('e1', 'trigger-1', 'email-1')]);
    mocks.flowRunCreate
      .mockResolvedValueOnce({ id: 'run-1' })
      .mockRejectedValueOnce({ code: 'P2002' });
    mocks.flowRunFindUnique.mockResolvedValue({ status: 'succeeded' });

    const first = await emitFlowEvent('ticket_created', 'ticket_created:t-1', {
      ticketId: 't-1',
      username: 'alice',
    });
    const second = await emitFlowEvent('ticket_created', 'ticket_created:t-1', {
      ticketId: 't-1',
      username: 'alice',
    });

    expect(first).toBe(1);
    expect(second).toBe(0);
    expect(mocks.flowRunCreate).toHaveBeenCalledTimes(2);
    expect(mocks.sendAutomationEmail).toHaveBeenCalledTimes(1);
    expect(mocks.flowRunUpdate).toHaveBeenCalledTimes(1);
    expect(lastFlowRunUpdate().data.status).toBe('succeeded');
  });

  it.each(['running', 'failed'])('does not accept a duplicate %s run as completed delivery', async (status) => {
    stubGraph([TRIGGER, EMAIL_NODE], [edge('e1', 'trigger-1', 'email-1')]);
    mocks.flowRunCreate.mockRejectedValue({ code: 'P2002' });
    mocks.flowRunFindUnique.mockResolvedValue({ status });

    await expect(emitFlowEvent(
      'ticket_created',
      'ticket_created:t-incomplete',
      { ticketId: 't-incomplete', username: 'alice' },
      { throwOnInfrastructureFailure: true }
    )).rejects.toThrow('1 workflow graph delivery attempt(s) failed');
    expect(mocks.sendAutomationEmail).not.toHaveBeenCalled();
  });
});

describe('internal security ticket action', () => {
  it('creates an admin-only ticket from the attachment malware trigger', async () => {
    stubGraph(
      [MALWARE_TRIGGER, CREATE_INTERNAL_TICKET_NODE],
      [edge('e-malware', 'malware-trigger', 'create-internal-ticket')]
    );

    const runs = await emitFlowEvent(
      'attachment_malware_detected',
      'attachment_malware:attachment-1',
      {
        ticketId: 'ticket-9',
        attachmentId: 'attachment-1',
        filename: 'invoice.exe',
        username: 'alice',
      }
    );

    expect(runs).toBe(1);
    expect(mocks.supportTicketCreate).toHaveBeenCalledWith({
      data: {
        subject: '[Security] Malware blocked on ticket-9',
        body: 'Attachment invoice.exe was quarantined for ticket ticket-9.',
        category: 'SECURITY',
        severity: 'critical',
        status: 'open',
        username: 'automation',
        internalOnly: true,
      },
      select: { id: true },
    });
    expect(mocks.flowArtifactCreate).toHaveBeenCalledWith({
      data: {
        runId: 'run-1',
        nodeId: 'create-internal-ticket',
        kind: 'support_ticket',
        refId: 'internal-ticket-1',
      },
    });
  });
});

describe('timer persistence and resume', () => {
  it('persists a FlowTimer row and parks the run without executing downstream actions', async () => {
    stubGraph([TRIGGER, WAIT_NODE, EMAIL_NODE], [
      edge('e1', 'trigger-1', 'wait-1'),
      edge('e2', 'wait-1', 'email-1'),
    ]);
    const startedAt = Date.now();

    const runs = await emitFlowEvent('ticket_created', 'ticket_created:t-2', {
      ticketId: 't-2',
      username: 'alice',
    });

    expect(runs).toBe(1);
    expect(mocks.flowTimerCreateMany).toHaveBeenCalledTimes(1);
    const timerData = mocks.flowTimerCreateMany.mock.calls[0][0].data[0];
    expect(timerData.runId).toBe('run-1');
    expect(timerData.nodeId).toBe('wait-1');
    expect(timerData.payload).toEqual({ ticketId: 't-2', username: 'alice' });
    expect(timerData.dueAt.getTime()).toBeGreaterThanOrEqual(startedAt + 30 * 60_000 - 1_000);
    expect(timerData.dueAt.getTime()).toBeLessThanOrEqual(Date.now() + 30 * 60_000 + 1_000);
    expect(mocks.sendAutomationEmail).not.toHaveBeenCalled();
    const update = lastFlowRunUpdate();
    expect(update.data.status).toBe('waiting');
    expect(update.data.finishedAt).toBeNull();
  });

  it('resumes a waiting run past the Wait node exactly once and deletes the timer', async () => {
    const previousOutcomes: FlowNodeOutcome[] = [
      { nodeId: 'wait-1', type: 'logic_delay', status: 'waiting', detail: { minutes: 30 } },
    ];
    mocks.flowTimerFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
      { id: 'timer-1', runId: 'run-1', nodeId: 'wait-1', payload: { ticketId: 't-9', username: 'bob' } },
    ]);
    mocks.flowRunFindUnique.mockResolvedValue({
      id: 'run-1',
      status: 'waiting',
      nodeOutcomes: previousOutcomes,
      graph: {
        id: 'graph-1',
        name: 'Test Graph',
        nodes: [TRIGGER, WAIT_NODE, EMAIL_NODE],
        edges: [edge('e1', 'trigger-1', 'wait-1'), edge('e2', 'wait-1', 'email-1')],
        enabled: true,
        status: 'published',
      },
    });
    mocks.workflowGraphFindMany.mockResolvedValue([]);

    const tick = await runFlowTick();

    expect(tick.processed).toBe(1);
    expect(mocks.sendAutomationEmail).toHaveBeenCalledTimes(1);
    expect(mocks.sendAutomationEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: ['staff@cpp.edu'], subject: 'Ticket t-9' })
    );
    expect(mocks.flowTimerDeleteMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: 'timer-1', status: 'processing' }),
    });
    const update = lastFlowRunUpdate();
    expect(update.data.status).toBe('succeeded');
    expect(update.data.finishedAt).toBeInstanceOf(Date);
    expect(update.data.nodeOutcomes).toHaveLength(2);
  });
});

describe('fan-out execution', () => {
  it('executes every fan-out branch exactly once and reports success', async () => {
    stubGraph([TRIGGER, BANNER_NODE, REPLY_NODE], [
      edge('f1', 'trigger-1', 'banner-1'),
      edge('f2', 'trigger-1', 'reply-1'),
    ]);

    const runs = await emitFlowEvent('ticket_created', 'evt-fanout', { ticketId: 't-5' });

    expect(runs).toBe(1);
    expect(mocks.notificationBannerCreate).toHaveBeenCalledTimes(1);
    expect(mocks.ticketResponseCreate).toHaveBeenCalledTimes(1);
    expect(mocks.ticketResponseCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ ticketId: 't-5', message: 'Working on t-5' }),
      })
    );
    const update = lastFlowRunUpdate();
    expect(update.data.status).toBe('succeeded');
    const outcomes = update.data.nodeOutcomes as Array<{ nodeId: string; status: string }>;
    expect(outcomes.filter((outcome) => outcome.status === 'succeeded').map((o) => o.nodeId)).toEqual(
      expect.arrayContaining(['banner-1', 'reply-1'])
    );
  });
});

describe('workflow ticket notifications', () => {
  it('emails the ticket creator when an automation reply is added', async () => {
    stubGraph([TRIGGER, REPLY_NODE], [edge('r1', 'trigger-1', 'reply-1')]);
    mocks.supportTicketFindUnique.mockResolvedValue({
      subject: 'Printer on fire',
      username: 'alice',
      relatedRequestId: null,
    });
    mocks.accessRequestFindFirst.mockResolvedValue({ email: 'alice@example.test', name: 'Alice' });

    await emitFlowEvent('ticket_created', 'evt-reply-mail', { ticketId: 't-9' });
    await vi.waitFor(() => expect(mocks.sendTicketResponseToUser).toHaveBeenCalledTimes(1));

    expect(mocks.sendTicketResponseToUser).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketId: 't-9',
        subject: 'Printer on fire',
        userEmail: 'alice@example.test',
        userName: 'Alice',
        staffUsername: 'automation',
      })
    );
    expect(mocks.sendTicketStatusChangeToUser).not.toHaveBeenCalled();
  });

  it('emails the creator when automation closes the ticket', async () => {
    stubGraph([TRIGGER, CLOSE_NODE], [edge('c1', 'trigger-1', 'close-1')]);
    mocks.supportTicketFindUnique
      .mockResolvedValueOnce({ id: 't-10', status: 'open' })
      .mockResolvedValue({ subject: 'Printer on fire', username: 'alice', relatedRequestId: null });
    mocks.supportTicketUpdate.mockResolvedValue({});
    mocks.ticketStatusLogCreate.mockResolvedValue({});
    mocks.accessRequestFindFirst.mockResolvedValue({ email: 'alice@example.test', name: 'Alice' });

    await emitFlowEvent('ticket_created', 'evt-close-mail', { ticketId: 't-10' });
    await vi.waitFor(() => expect(mocks.sendTicketStatusChangeToUser).toHaveBeenCalledTimes(1));

    expect(mocks.sendTicketStatusChangeToUser).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketId: 't-10',
        oldStatus: 'open',
        newStatus: 'closed',
        changedBy: 'automation',
      })
    );
    expect(mocks.sendTicketResponseToUser).not.toHaveBeenCalled();
  });

  it('skips notifications when the creator has no email on file', async () => {
    stubGraph([TRIGGER, REPLY_NODE], [edge('r2', 'trigger-1', 'reply-1')]);
    mocks.supportTicketFindUnique.mockResolvedValue({
      subject: 'No email',
      username: 'nobody',
      relatedRequestId: null,
    });
    mocks.accessRequestFindFirst.mockResolvedValue(null);

    await emitFlowEvent('ticket_created', 'evt-no-mail', { ticketId: 't-11' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mocks.sendTicketResponseToUser).not.toHaveBeenCalled();
  });
});

describe('action_enqueue_group_add policy gates', () => {
  it('preflights and queues one independently tracked action per selected group', async () => {
    const secondDn = 'CN=Database-Users,OU=Groups,DC=example,DC=test';
    const node = { ...GROUP_ADD_NODE, config: { groupDns: [JOIN_GROUP_DN, secondDn] } };
    stubGraph([TRIGGER, node], [edge('g-multi', 'trigger-1', 'group-add-1')]);
    mocks.allowedTicketSubjectGroupFindMany.mockResolvedValue([ALLOWED_GROUP, { ...ALLOWED_GROUP, dn: secondDn, name: 'Database Users' }]);
    mocks.accountLifecycleActionFindFirst.mockResolvedValue(null);
    mocks.accountLifecycleActionCreate.mockResolvedValueOnce({ id: 'action-1' }).mockResolvedValueOnce({ id: 'action-2' });

    await emitFlowEvent('ticket_created', 'evt-group-multi', JOIN_CONTEXT);

    expect(mocks.accountLifecycleActionCreate).toHaveBeenCalledTimes(2);
    expect(mocks.accountLifecycleActionCreate).toHaveBeenNthCalledWith(1, expect.objectContaining({ data: expect.objectContaining({ targetGroupDn: JOIN_GROUP_DN }) }));
    expect(mocks.accountLifecycleActionCreate).toHaveBeenNthCalledWith(2, expect.objectContaining({ data: expect.objectContaining({ targetGroupDn: secondDn }) }));
    expect(mocks.flowArtifactCreate).toHaveBeenCalledTimes(2);
  });

  it('queues a lifecycle membership add for allowlisted auto-approve groups', async () => {
    stubGraph([TRIGGER, GROUP_ADD_NODE], [edge('g1', 'trigger-1', 'group-add-1')]);
    mocks.allowedTicketSubjectGroupFindMany.mockResolvedValue([ALLOWED_GROUP]);
    mocks.accountLifecycleActionFindFirst.mockResolvedValue(null);
    mocks.accountLifecycleActionCreate.mockResolvedValue({ id: 'action-1' });

    const runs = await emitFlowEvent('ticket_created', 'evt-group-add', JOIN_CONTEXT);

    expect(runs).toBe(1);
    expect(mocks.accountLifecycleActionCreate).toHaveBeenCalledTimes(1);
    expect(mocks.accountLifecycleActionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actionType: 'add_group_member',
          targetUsername: 'alice',
          status: 'queued',
          relatedTicketId: 'tkt-7',
        }),
      })
    );
    expect(mocks.flowArtifactCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ kind: 'lifecycle_action', refId: 'action-1' }),
      })
    );
    expect(lastFlowRunUpdate().data.status).toBe('succeeded');
  });

  it('refuses manual-review groups with the Support & Routing guidance', async () => {
    stubGraph([TRIGGER, GROUP_ADD_NODE], [edge('g1', 'trigger-1', 'group-add-1')]);
    mocks.allowedTicketSubjectGroupFindMany.mockResolvedValue([{
      ...ALLOWED_GROUP,
      autoApproveJoin: false,
    }]);

    const runs = await emitFlowEvent('ticket_created', 'evt-group-manual', JOIN_CONTEXT);

    expect(runs).toBe(1);
    expect(mocks.accountLifecycleActionCreate).not.toHaveBeenCalled();
    const update = lastFlowRunUpdate();
    expect(update.data.status).toBe('failed');
    expect(update.data.error).toBe(
      '"App Users" is not configured for automatic adds; enable auto-approve in Support & Routing first'
    );
  });

  it('refuses groups outside the ticket allowlist', async () => {
    stubGraph([TRIGGER, GROUP_ADD_NODE], [edge('g1', 'trigger-1', 'group-add-1')]);
    mocks.allowedTicketSubjectGroupFindMany.mockResolvedValue([]);

    await emitFlowEvent('ticket_created', 'evt-group-unlisted', JOIN_CONTEXT);

    const update = lastFlowRunUpdate();
    expect(update.data.status).toBe('failed');
    expect(update.data.error).toBe(`"${JOIN_GROUP_DN}" is not an approved active join group`);
    expect(mocks.accountLifecycleActionCreate).not.toHaveBeenCalled();
  });
});

describe('disabled graph contract', () => {
  it('only queries enabled published graphs and starts nothing when none qualify', async () => {
    mocks.workflowGraphFindMany.mockResolvedValue([]);

    const runs = await emitFlowEvent('ticket_created', 'evt-disabled', { ticketId: 't-1' });

    expect(runs).toBe(0);
    expect(mocks.workflowGraphFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { enabled: true, status: 'published', triggerKey: 'ticket_created' },
      })
    );
    expect(mocks.flowRunCreate).not.toHaveBeenCalled();
    expect(mocks.sendAutomationEmail).not.toHaveBeenCalled();
  });

  it('finishes an already-started waiting run from its pinned graph after new runs are disabled', async () => {
    mocks.flowTimerFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
      { id: 'timer-x', runId: 'run-9', nodeId: 'wait-1', payload: { ticketId: 't-1' } },
    ]);
    mocks.flowRunFindUnique.mockResolvedValue({
      id: 'run-9',
      status: 'waiting',
      nodeOutcomes: [{ nodeId: 'wait-1', type: 'logic_delay', status: 'waiting' }],
      graph: {
        id: 'graph-9',
        name: 'Paused Graph',
        nodes: [TRIGGER, WAIT_NODE, EMAIL_NODE],
        edges: [edge('x1', 'trigger-1', 'wait-1'), edge('x2', 'wait-1', 'email-1')],
        enabled: false,
        status: 'published',
      },
    });
    mocks.workflowGraphFindMany.mockResolvedValue([]);

    const tick = await runFlowTick();

    expect(tick.processed).toBe(1);
    expect(mocks.sendAutomationEmail).toHaveBeenCalledTimes(1);
    expect(mocks.flowRunUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'run-9' },
      data: expect.objectContaining({ status: 'succeeded' }),
    }));
    expect(mocks.flowTimerDeleteMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: 'timer-x', status: 'processing' }),
    });
  });

  it('drops due timers whose run is no longer waiting instead of re-fetching forever', async () => {
    mocks.flowTimerFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
      { id: 'timer-stale', runId: 'run-done', nodeId: 'email-1', payload: { ticketId: 't-2' } },
    ]);
    mocks.flowRunFindUnique.mockResolvedValue({
      id: 'run-done',
      status: 'succeeded',
      nodeOutcomes: [],
      graph: {
        id: 'graph-2',
        name: 'Finished Graph',
        nodes: [TRIGGER, EMAIL_NODE],
        edges: [edge('x1', 'trigger-1', 'email-1')],
        enabled: true,
        status: 'published',
      },
    });

    const tick = await runFlowTick();

    expect(tick.processed).toBe(0);
    expect(mocks.sendAutomationEmail).not.toHaveBeenCalled();
    expect(mocks.flowRunUpdate).not.toHaveBeenCalled();
    expect(mocks.flowTimerDeleteMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: 'timer-stale', status: 'processing' }),
    });
  });
});

const LIFECYCLE_FAILED_TRIGGER = { id: 'lc-trigger', type: 'trigger_lifecycle_action_failed', config: {} };

const LIFECYCLE_EMAIL_NODE = {
  id: 'lc-email-1',
  type: 'action_send_email',
  config: {
    to: 'admins@cpp.edu',
    subject: '{{actionType}} failed for {{username}}',
    body: 'error={{error}} batch={{batchId}} action={{actionId}}',
  },
};

describe('emitLifecycleActionEvent', () => {
  it('fans failed lifecycle actions out to failure-triggered graphs with full context', async () => {
    stubGraph([LIFECYCLE_FAILED_TRIGGER, LIFECYCLE_EMAIL_NODE], [
      edge('e1', 'lc-trigger', 'lc-email-1'),
    ]);

    const runs = await emitLifecycleActionEvent({
      actionType: 'remove_from_group',
      username: 'bob',
      status: 'failed',
      actionId: 'act-42',
      batchId: 'batch-7',
      error: 'LDAP unavailable',
    });

    expect(runs).toBe(1);
    expect(mocks.workflowGraphFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { enabled: true, status: 'published', triggerKey: 'lifecycle_action_failed' },
      })
    );
    expect(mocks.flowRunCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          triggerKey: 'lifecycle_action_failed',
          eventKey: 'lifecycle_action:remove_from_group:bob:lifecycle_action_failed:action:act-42',
        }),
      })
    );
    expect(mocks.sendAutomationEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: 'remove_from_group failed for bob',
        body: 'error=LDAP unavailable batch=batch-7 action=act-42',
      })
    );
  });

  it('routes completed actions to the completed trigger key without error text', async () => {
    stubGraph([LIFECYCLE_FAILED_TRIGGER, LIFECYCLE_EMAIL_NODE], [
      edge('e1', 'lc-trigger', 'lc-email-1'),
    ]);

    const runs = await emitLifecycleActionEvent({
      actionType: 'enable_ad',
      username: 'carol',
      status: 'completed',
      batchId: null,
    });

    expect(runs).toBe(1);
    expect(mocks.workflowGraphFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { enabled: true, status: 'published', triggerKey: 'lifecycle_action_completed' },
      })
    );
    // No action id and a null batch id: identity falls back to adhoc wall clock.
    const eventKey = mocks.flowRunCreate.mock.calls[0][0].data.eventKey as string;
    expect(eventKey.startsWith('lifecycle_action:enable_ad:carol:lifecycle_action_completed:adhoc:')).toBe(true);
  });

  it('stays idempotent when the same lifecycle completion is redelivered', async () => {
    stubGraph([LIFECYCLE_FAILED_TRIGGER, LIFECYCLE_EMAIL_NODE], [
      edge('e1', 'lc-trigger', 'lc-email-1'),
    ]);
    mocks.flowRunCreate
      .mockResolvedValueOnce({ id: 'run-1' })
      .mockRejectedValueOnce({ code: 'P2002' });

    const input = {
      actionType: 'disable_ad',
      username: 'dave',
      status: 'completed' as const,
      actionId: 'act-99',
    };
    const first = await emitLifecycleActionEvent(input);
    const second = await emitLifecycleActionEvent(input);

    expect(first).toBe(1);
    expect(second).toBe(0);
    expect(mocks.sendAutomationEmail).toHaveBeenCalledTimes(1);
  });
});

describe('action_clear_notification_banner', () => {
  const CLEAR_BY_REF = {
    id: 'clear-banner-1',
    type: 'action_clear_notification_banner',
    config: { dedupeKey: 'banner-ref-9' },
  };

  it('deactivates banners recorded under the given artifact reference and marks them cleared', async () => {
    stubGraph([TRIGGER, CLEAR_BY_REF], [edge('cb1', 'trigger-1', 'clear-banner-1')]);
    mocks.flowArtifactFindMany.mockResolvedValue([{ id: 'fa-1', refId: 'banner-9' }]);
    mocks.notificationBannerUpdateMany.mockResolvedValue({ count: 1 });
    mocks.flowArtifactUpdateMany.mockResolvedValue({ count: 1 });

    await emitFlowEvent('ticket_created', 'evt-clear-ref', {});

    expect(mocks.flowArtifactFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { kind: 'notification_banner', clearedAt: null, refId: 'banner-ref-9' },
      })
    );
    expect(mocks.notificationBannerUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['banner-9'] }, isActive: true },
        data: { isActive: false },
      })
    );
    expect(mocks.flowArtifactUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['fa-1'] } } })
    );
    expect(lastFlowRunUpdate().data.status).toBe('succeeded');
  });

  it('clears every active banner this graph created when createdByGraph is set', async () => {
    stubGraph(
      [
        TRIGGER,
        { id: 'clear-banner-2', type: 'action_clear_notification_banner', config: { createdByGraph: true } },
      ],
      [edge('cb2', 'trigger-1', 'clear-banner-2')]
    );
    mocks.flowArtifactFindMany.mockResolvedValue([
      { id: 'fa-2', refId: 'banner-5' },
      { id: 'fa-3', refId: 'banner-6' },
    ]);
    mocks.notificationBannerUpdateMany.mockResolvedValue({ count: 2 });

    await emitFlowEvent('ticket_created', 'evt-clear-graph', {});

    expect(mocks.flowArtifactFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { kind: 'notification_banner', clearedAt: null, run: { graphId: 'graph-1' } },
      })
    );
    expect(mocks.notificationBannerUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['banner-5', 'banner-6'] }, isActive: true } })
    );
    expect(lastFlowRunUpdate().data.status).toBe('succeeded');
  });

  it('succeeds silently when nothing matches (idempotent)', async () => {
    stubGraph([TRIGGER, CLEAR_BY_REF], [edge('cb3', 'trigger-1', 'clear-banner-1')]);
    mocks.flowArtifactFindMany.mockResolvedValue([]);

    await emitFlowEvent('ticket_created', 'evt-clear-none', {});

    expect(lastFlowRunUpdate().data.status).toBe('succeeded');
    expect(mocks.notificationBannerUpdateMany).not.toHaveBeenCalled();
    expect(mocks.flowArtifactUpdateMany).not.toHaveBeenCalled();
  });

  it('fails loudly when neither match mode is configured', async () => {
    stubGraph(
      [
        TRIGGER,
        { id: 'clear-banner-3', type: 'action_clear_notification_banner', config: {} },
      ],
      [edge('cb4', 'trigger-1', 'clear-banner-3')]
    );

    await emitFlowEvent('ticket_created', 'evt-clear-invalid', {});

    const update = lastFlowRunUpdate();
    expect(update.data.status).toBe('failed');
    expect(update.data.error).toContain('banner reference');
    expect(mocks.notificationBannerUpdateMany).not.toHaveBeenCalled();
  });
});

describe('action_enqueue_group_remove', () => {
  const GROUP_REMOVE_NODE = {
    id: 'group-remove-1',
    type: 'action_enqueue_group_remove',
    config: { groupDn: JOIN_GROUP_DN },
  };

  it('queues a remove_from_group lifecycle action mirroring the add gates', async () => {
    stubGraph([TRIGGER, GROUP_REMOVE_NODE], [edge('gr1', 'trigger-1', 'group-remove-1')]);
    mocks.allowedTicketSubjectGroupFindUnique.mockResolvedValue(ALLOWED_GROUP);
    mocks.accountLifecycleActionFindFirst.mockResolvedValue(null);
    mocks.accountLifecycleActionCreate.mockResolvedValue({ id: 'action-r1' });

    const runs = await emitFlowEvent('ticket_created', 'evt-group-remove', JOIN_CONTEXT);

    expect(runs).toBe(1);
    expect(mocks.accountLifecycleActionCreate).toHaveBeenCalledTimes(1);
    expect(mocks.accountLifecycleActionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actionType: 'remove_from_group',
          targetUsername: 'alice',
          status: 'queued',
          relatedTicketId: 'tkt-7',
        }),
      })
    );
    expect(mocks.flowArtifactCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ kind: 'lifecycle_action', refId: 'action-r1' }),
      })
    );
    expect(lastFlowRunUpdate().data.status).toBe('succeeded');
  });

  it('refuses groups outside the allowlist exactly like the add node', async () => {
    stubGraph([TRIGGER, GROUP_REMOVE_NODE], [edge('gr2', 'trigger-1', 'group-remove-1')]);
    mocks.allowedTicketSubjectGroupFindUnique.mockResolvedValue(null);

    await emitFlowEvent('ticket_created', 'evt-group-remove-unlisted', JOIN_CONTEXT);

    const update = lastFlowRunUpdate();
    expect(update.data.status).toBe('failed');
    expect(update.data.error).toBe('Target group is not an approved allowlist entry');
    expect(mocks.accountLifecycleActionCreate).not.toHaveBeenCalled();
  });
});

function conditionNode(groups: unknown[]): { id: string; type: string; config: Record<string, unknown> } {
  return { id: 'cond-1', type: 'logic_condition', config: { groups } };
}

describe('condition group evaluation', () => {
  it('ANDs across groups, applies ANY within a group, and compares case-insensitively', async () => {
    stubGraph([LIFECYCLE_FAILED_TRIGGER, conditionNode([
      { match: 'all', comparisons: [{ field: 'actionType', op: 'equals', value: 'DISABLE_AD' }] },
      {
        match: 'any',
        comparisons: [
          { field: 'username', op: 'contains', value: 'ALIC' },
          { field: 'username', op: 'in', value: ['NOPE', 'OTHER'] },        ],
      },
    ]), LIFECYCLE_EMAIL_NODE], [
      edge('cg1', 'lc-trigger', 'cond-1'),
      { id: 'cg2', source: 'cond-1', sourceHandle: 'true', target: 'lc-email-1' },
    ]);

    await emitFlowEvent('lifecycle_action_failed', 'evt-cond-pass', {
      actionType: 'disable_ad',
      username: 'Alice',
      error: 'boom',
    });

    expect(mocks.sendAutomationEmail).toHaveBeenCalledTimes(1);
    expect(lastFlowRunUpdate().data.status).toBe('succeeded');
  });

  it('skips the TRUE branch when any group fails', async () => {
    stubGraph([LIFECYCLE_FAILED_TRIGGER, conditionNode([
      { match: 'any', comparisons: [{ field: 'actionType', op: 'equals', value: 'revoke_vpn' }] },
    ]), LIFECYCLE_EMAIL_NODE], [
      edge('cg3', 'lc-trigger', 'cond-1'),
      { id: 'cg4', source: 'cond-1', sourceHandle: 'true', target: 'lc-email-1' },
    ]);

    await emitFlowEvent('lifecycle_action_failed', 'evt-cond-fail', {
      actionType: 'disable_ad',
      username: 'bob',
    });

    expect(mocks.sendAutomationEmail).not.toHaveBeenCalled();
    const outcomes = lastFlowRunUpdate().data.nodeOutcomes as Array<{ nodeId: string; status: string }>;
    expect(outcomes.find((outcome) => outcome.nodeId === 'cond-1')?.status).toBe('skipped');
  });

  it('treats "in" membership case-insensitively across the whole value list', async () => {
    stubGraph([LIFECYCLE_FAILED_TRIGGER, conditionNode([
      { match: 'all', comparisons: [{ field: 'actionType', op: 'in', value: ['Disable_AD', 'REVOKE_VPN'] }] },
    ]), LIFECYCLE_EMAIL_NODE], [
      edge('cg5', 'lc-trigger', 'cond-1'),
      { id: 'cg6', source: 'cond-1', sourceHandle: 'true', target: 'lc-email-1' },
    ]);

    await emitFlowEvent('lifecycle_action_failed', 'evt-cond-in', {
      actionType: 'revoke_vpn',
      username: 'carol',
    });

    expect(mocks.sendAutomationEmail).toHaveBeenCalledTimes(1);
  });

  it('still honors legacy single-field conditions for stored graphs', async () => {
    const severityCondition = { id: 'cond-legacy', type: 'logic_condition', config: { field: 'severity', equals: 'critical' } };
    const emailNode = {
      id: 'email-legacy',
      type: 'action_send_email',
      config: { to: 'staff@cpp.edu', subject: 'Legacy', body: 'x' },
    };
    stubGraph([TRIGGER, severityCondition, emailNode], [
      edge('lg1', 'trigger-1', 'cond-legacy'),
      { id: 'lg2', source: 'cond-legacy', sourceHandle: 'true', target: 'email-legacy' },
    ]);

    await emitFlowEvent('ticket_created', 'evt-cond-legacy-hit', { severity: 'critical' });
    expect(mocks.sendAutomationEmail).toHaveBeenCalledTimes(1);

    await emitFlowEvent('ticket_created', 'evt-cond-legacy-miss', { severity: 'low' });
    expect(mocks.sendAutomationEmail).toHaveBeenCalledTimes(1);
  });
});
