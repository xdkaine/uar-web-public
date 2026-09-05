/**
 * Plain-English rendering of a workflow graph so non-technical operators can
 * read exactly what will happen without tracing the canvas. Pure functions;
 * the wording mirrors the node catalog labels.
 */
import { FLOW_NODE_CATALOG, type FlowNodeDefinition } from './catalog';

export interface DescribeNode {
  id: string;
  type: string;
  config: Record<string, unknown>;
}

export interface DescribeEdge {
  source: string;
  sourceHandle?: string | null;
  target: string;
}

function configValue(node: DescribeNode, key: string): string {
  const value = node.config?.[key];
  return value === undefined || value === null ? '' : String(value).trim();
}

/** Friendly names for condition fields, shared by legacy and group modes. */
const CONTEXT_FIELD_LABELS: Record<string, string> = {
  category: 'the ticket category',
  severity: 'the severity',
  status: 'the status',
  newStatus: 'the new status',
  oldStatus: 'the previous status',
  username: 'the username',
  requestedForSelf: '"filed for self"',
  requestedForGroupDn: 'the filed-for group',
  joinGroupDn: 'the requested group',
  joinAutoApprove: '"auto-approve configured"',
  ticketId: 'the ticket id',
  ticketSubject: 'the ticket subject',
  isStaff: '"staff reply"',
  target: 'the probe target',
  error: 'the error message',
  actionType: 'the lifecycle action type',
  actionId: 'the action id',
  batchId: 'the batch id',
  detectorKey: 'the operational detector',
  reasonCode: 'the intervention reason',
  subjectType: 'the affected record type',
  subjectId: 'the affected record id',
  route: 'the scheduled job route',
};

function describeNodeAction(node: DescribeNode, entry: FlowNodeDefinition | undefined): string {
  if (!entry) return 'unknown step';
  switch (node.type) {
    case 'action_send_email': {
      const to = configValue(node, 'to');
      const subject = configValue(node, 'subject');
      return `send an email to ${to || '…'} ("${subject || '…'}")`;
    }
    case 'action_create_service_alert': {
      const title = configValue(node, 'title');
      const severity = configValue(node, 'severity') || 'info';
      return `raise a ${severity} service alert ("${title || '…'}")`;
    }
    case 'action_resolve_service_alerts': {
      const category = configValue(node, 'category');
      return `resolve ${category || 'matching'} service alerts`;
    }
    case 'action_create_notification_banner':
      return 'show a site-wide banner';
    case 'action_clear_notification_banner': {
      const dedupeKey = configValue(node, 'dedupeKey');
      const createdByGraph = node.config?.createdByGraph === true || configValue(node, 'createdByGraph') === 'true';
      if (dedupeKey && createdByGraph) return `clear the banner "${dedupeKey}" and every banner this workflow created`;
      if (dedupeKey) return `clear the notification banner "${dedupeKey}"`;
      if (createdByGraph) return 'clear the site banners this workflow created';
      return 'clear matching notification banners';
    }
    case 'action_add_ticket_response':
      return 'reply on the ticket';
    case 'action_close_ticket':
      return 'close the ticket';
    case 'action_update_ticket':
      return `set the ticket to ${configValue(node, 'status') || '…'}`;
    case 'action_enqueue_group_add': {
      const group = configValue(node, 'groupDn');
      return group === '{{joinGroupDn}}'
        ? 'add the requester to the group they asked about'
        : `add the requester to ${group || '…'}`;
    }
    case 'action_enqueue_group_remove': {
      const group = configValue(node, 'groupDn');
      return group === '{{joinGroupDn}}'
        ? 'remove the user from the group named in the event'
        : `remove the user from ${group || '…'}`;
    }
    case 'logic_delay':
      return `wait ${configValue(node, 'minutes') || '…'} minutes`;
    case 'logic_condition': {
      const rawGroups = node.config?.groups;
      if (Array.isArray(rawGroups) && rawGroups.length > 0) {
        // Groups combine with AND; within a group ALL/ANY per its match.
        const groupTexts = rawGroups.map((rawGroup) => {
          const group = (rawGroup ?? {}) as {
            match?: string;
            comparisons?: Array<{ field?: string; op?: string; value?: unknown }>;
          };
          const comparisons = Array.isArray(group.comparisons) ? group.comparisons : [];
          const comparisonTexts = comparisons.map((comparison) => {
            const label = CONTEXT_FIELD_LABELS[comparison.field ?? ''] ?? comparison.field ?? '…';
            const value = Array.isArray(comparison.value)
              ? comparison.value.join(' or ')
              : String(comparison.value ?? '…');
            if (comparison.op === 'contains') return `${label} contains ${value}`;
            if (comparison.op === 'in') return `${label} is one of ${value}`;
            return `${label} is ${value}`;
          });
          const joiner = group.match === 'any' ? ' or ' : ' and ';
          const body = comparisonTexts.join(joiner) || '…';
          return comparisonTexts.length > 1
            ? `${group.match === 'any' ? 'any' : 'all'} of (${body})`
            : body;
        });
        return `if ${groupTexts.join(' and ') || '…'}`;
      }
      const field = configValue(node, 'field');
      const equals = configValue(node, 'equals');
      return `if ${(CONTEXT_FIELD_LABELS[field] ?? field) || '…'} is ${equals || '…'}`;
    }
    default:
      return entry.label.toLowerCase();
  }
}

function describeTrigger(node: DescribeNode, entry: FlowNodeDefinition | undefined): string {
  if (!entry) return 'Something happens';
  switch (node.type) {
    case 'trigger_ticket_created':
      return 'When a ticket is created';
    case 'trigger_ticket_replied':
      return 'When someone replies to a ticket';
    case 'trigger_ticket_status_changed':
      return 'When a ticket changes status';
    case 'trigger_dc_unreachable':
      return 'When the primary directory becomes unreachable';
    case 'trigger_dc_recovered':
      return 'When the directory recovers';
    case 'trigger_schedule':
      return `Every ${configValue(node, 'everyMinutes') || '…'} minutes`;
    case 'trigger_lifecycle_action_completed':
      return 'When a lifecycle action completes';
    case 'trigger_lifecycle_action_failed':
      return 'When a lifecycle action fails';
    case 'trigger_operational_issue_detected':
      return 'When a structured operational issue is detected';
    case 'trigger_operational_issue_resolved':
      return 'When a structured operational issue is resolved';
    default:
      return entry.label;
  }
}

/**
 * Render the graph as a readable sentence chain, following TRUE/FALSE branches
 * where present. Bounded output; cycles are cut by visited-set.
 */
export function describeWorkflow(nodes: DescribeNode[], edges: DescribeEdge[]): string[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const entryFor = (node: DescribeNode) => FLOW_NODE_CATALOG[node.type];
  const outgoing = new Map<string, DescribeEdge[]>();
  for (const edge of edges) {
    if (!outgoing.has(edge.source)) outgoing.set(edge.source, []);
    outgoing.get(edge.source)!.push(edge);
  }

  const trigger = nodes.find((node) => node.type.startsWith('trigger'));
  if (!trigger) return [];

  const lines: string[] = [describeTrigger(trigger, entryFor(trigger))];
  const visited = new Set<string>([trigger.id]);

  const walk = (nodeId: string, prefix: string, depth: number) => {
    if (depth > 24) return;
    const nextEdges = (outgoing.get(nodeId) ?? []).filter(
      (edge) => byId.has(edge.target) && !visited.has(edge.target)
    );
    for (const edge of nextEdges) {
      const target = byId.get(edge.target)!;
      visited.add(target.id);
      const entry = entryFor(target);
      let branchPrefix = prefix;
      if (edge.sourceHandle === 'true') branchPrefix = 'then ';
      if (edge.sourceHandle === 'false') branchPrefix = 'otherwise ';
      if (target.type === 'logic_condition') {
        lines.push(`${describeNodeAction(target, entry)}:`);
        walk(target.id, branchPrefix || prefix, depth + 1);
      } else {
        const actionPrefix = branchPrefix || prefix || 'then ';
        lines.push(`${actionPrefix}${describeNodeAction(target, entry)}.`);
        walk(target.id, actionPrefix, depth + 1);
      }
    }
  };

  walk(trigger.id, '', 0);
  return lines;
}

/** One-line list form for compact display. */
export function describeWorkflowSummary(nodes: DescribeNode[], edges: DescribeEdge[]): string {
  const lines = describeWorkflow(nodes, edges);
  if (lines.length === 0) return '';
  return lines.join(' ').replace(/\s+/g, ' ').trim();
}
