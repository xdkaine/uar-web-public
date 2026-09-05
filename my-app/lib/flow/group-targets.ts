import type { PrismaClient, Prisma } from '@prisma/client';

const DYNAMIC_JOIN_GROUP = '{{joinGroupDn}}';

export function configuredAutomationGroupDns(nodes: unknown): string[] {
  if (!Array.isArray(nodes)) return [];
  const values: string[] = [];
  for (const rawNode of nodes) {
    if (!rawNode || typeof rawNode !== 'object') continue;
    const node = rawNode as { type?: unknown; config?: unknown };
    if (node.type !== 'action_enqueue_group_add' || !node.config || typeof node.config !== 'object') continue;
    const config = node.config as { groupDns?: unknown; groupDn?: unknown };
    const configured = Array.isArray(config.groupDns)
      ? config.groupDns
      : typeof config.groupDn === 'string'
        ? [config.groupDn]
        : [];
    for (const value of configured) {
      if (typeof value !== 'string') continue;
      const dn = value.trim();
      if (!dn || dn === DYNAMIC_JOIN_GROUP) continue;
      if (!values.some((current) => current.toLowerCase() === dn.toLowerCase())) values.push(dn);
    }
  }
  return values;
}

type GroupPolicyClient = Pick<PrismaClient, 'allowedTicketSubjectGroup'> | Prisma.TransactionClient;

export async function assertAutomationGroupsEligible(client: GroupPolicyClient, nodes: unknown): Promise<void> {
  const configured = configuredAutomationGroupDns(nodes);
  if (configured.length === 0) return;
  const groups = await client.allowedTicketSubjectGroup.findMany({
    where: { dn: { in: configured } },
    select: { dn: true, isActive: true, canJoinViaTicket: true, autoApproveJoin: true },
  });
  const eligible = new Set(
    groups
      .filter((group) => group.isActive && group.canJoinViaTicket && group.autoApproveJoin)
      .map((group) => group.dn.toLowerCase())
  );
  const invalid = configured.filter((dn) => !eligible.has(dn.toLowerCase()));
  if (invalid.length > 0) {
    throw new Error(`WORKFLOW_GROUP_INELIGIBLE:${invalid.join(', ')}`);
  }
}
