import { prisma } from '@/lib/prisma';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function ruleActionsIncludeGroupAdd(actions: unknown): boolean {
  return (
    Array.isArray(actions) &&
    actions.some((action) => isRecord(action) && action.key === 'enqueue_group_add')
  );
}

export function graphNodesIncludeGroupAdd(nodes: unknown): boolean {
  return (
    Array.isArray(nodes) &&
    nodes.some((node) => isRecord(node) && node.type === 'action_enqueue_group_add')
  );
}

export async function isGroupJoinWorkflowAvailable(): Promise<boolean> {
  const [rules, graphs] = await Promise.all([
    prisma.automationRule.findMany({
      where: { triggerKey: 'ticket_created', enabled: true },
      select: { actions: true },
    }),
    prisma.workflowGraph.findMany({
      where: { triggerKey: 'ticket_created', enabled: true, status: 'published' },
      select: { nodes: true },
    }),
  ]);
  return (
    rules.some((rule) => ruleActionsIncludeGroupAdd(rule.actions)) ||
    graphs.some((graph) => graphNodesIncludeGroupAdd(graph.nodes))
  );
}
