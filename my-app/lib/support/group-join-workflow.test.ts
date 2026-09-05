import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  automationRuleFindMany: vi.fn(),
  workflowGraphFindMany: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    automationRule: {
      findMany: mocks.automationRuleFindMany,
    },
    workflowGraph: {
      findMany: mocks.workflowGraphFindMany,
    },
  },
}));

import {
  graphNodesIncludeGroupAdd,
  isGroupJoinWorkflowAvailable,
  ruleActionsIncludeGroupAdd,
} from './group-join-workflow';

describe('ruleActionsIncludeGroupAdd', () => {
  it('matches the enqueue_group_add action key', () => {
    expect(ruleActionsIncludeGroupAdd([{ key: 'enqueue_group_add' }])).toBe(true);
    expect(ruleActionsIncludeGroupAdd([{ key: 'send_email', config: {} }])).toBe(false);
    expect(ruleActionsIncludeGroupAdd([])).toBe(false);
    expect(ruleActionsIncludeGroupAdd(null)).toBe(false);
    expect(ruleActionsIncludeGroupAdd('bogus')).toBe(false);
  });
});

describe('graphNodesIncludeGroupAdd', () => {
  it('matches the action_enqueue_group_add node type', () => {
    expect(graphNodesIncludeGroupAdd([{ id: 'n1', type: 'action_enqueue_group_add' }])).toBe(true);
    expect(graphNodesIncludeGroupAdd([{ id: 'n1', type: 'action_send_email' }])).toBe(false);
    expect(graphNodesIncludeGroupAdd([])).toBe(false);
    expect(graphNodesIncludeGroupAdd(undefined)).toBe(false);
  });
});

describe('isGroupJoinWorkflowAvailable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is true when an enabled ticket_created rule enqueues group adds', async () => {
    mocks.automationRuleFindMany.mockResolvedValue([{ actions: [{ key: 'enqueue_group_add' }] }]);
    mocks.workflowGraphFindMany.mockResolvedValue([]);

    await expect(isGroupJoinWorkflowAvailable()).resolves.toBe(true);
    expect(mocks.automationRuleFindMany).toHaveBeenCalledWith({
      where: { triggerKey: 'ticket_created', enabled: true },
      select: { actions: true },
    });
  });

  it('is true when a published ticket_created graph contains a group-add node', async () => {
    mocks.automationRuleFindMany.mockResolvedValue([{ actions: [{ key: 'close_ticket' }] }]);
    mocks.workflowGraphFindMany.mockResolvedValue([
      { nodes: [{ id: 'n1', type: 'trigger_ticket_created' }, { id: 'n2', type: 'action_enqueue_group_add' }] },
    ]);

    await expect(isGroupJoinWorkflowAvailable()).resolves.toBe(true);
    expect(mocks.workflowGraphFindMany).toHaveBeenCalledWith({
      where: { triggerKey: 'ticket_created', enabled: true, status: 'published' },
      select: { nodes: true },
    });
  });

  it('is false when neither rules nor graphs can fulfill a group add', async () => {
    mocks.automationRuleFindMany.mockResolvedValue([]);
    mocks.workflowGraphFindMany.mockResolvedValue([]);

    await expect(isGroupJoinWorkflowAvailable()).resolves.toBe(false);
  });

  it('is false when unrelated enabled automation exists', async () => {
    mocks.automationRuleFindMany.mockResolvedValue([
      { actions: [{ key: 'create_service_alert', config: { dedupeKey: 'x' } }] },
    ]);
    mocks.workflowGraphFindMany.mockResolvedValue([
      { nodes: [{ id: 'n1', type: 'action_send_email' }] },
    ]);

    await expect(isGroupJoinWorkflowAvailable()).resolves.toBe(false);
  });
});
