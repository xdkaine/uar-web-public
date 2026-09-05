import { FLOW_NODE_CATALOG, isKnownNodeType, NODE_TYPE_TO_TRIGGER_KEY, type ConditionGroup } from './catalog';
import { validateWorkflowMonitorChecks } from '@/lib/monitoring/workflow-checks';

/**
 * Graph shape validation (ADR-0013): acyclic, exactly one trigger root,
 * catalog-known node types with valid configs, bounded fan-out, and edges
 * that respect each node's declared handles. Runs validate again before any
 * side effect so an edited graph cannot execute stale shapes.
 */

export interface FlowNode {
  id: string;
  type: string;
  config: Record<string, unknown>;
  position?: { x: number; y: number };
}

export interface FlowEdge {
  id: string;
  source: string;
  sourceHandle?: string | null;
  target: string;
}

export interface GraphValidationResult {
  ok: boolean;
  errors: string[];
  /** Resolved trigger event key, e.g. ticket_created. */
  triggerKey?: string;
}

const MAX_NODES = 60;
const MAX_EDGES = 120;
const MAX_FAN_OUT = 8;
const MAX_CONDITION_GROUPS = 5;
const MAX_CONDITION_COMPARISONS = 10;

function validateConfig(type: string, config: Record<string, unknown>): string[] {
  const definition = FLOW_NODE_CATALOG[type];
  if (!definition) return [`Unknown node type "${type}"`];
  const errors: string[] = [];
  if (type === 'source_monitor_endpoints') {
    const validated = validateWorkflowMonitorChecks(config.checks);
    if (!validated.ok) errors.push(...validated.errors);
    return errors;
  }
  if (type === 'action_enqueue_group_add') {
    const legacy = typeof config.groupDn === 'string' && config.groupDn.trim() ? [config.groupDn.trim()] : [];
    const groupDns = Array.isArray(config.groupDns) ? config.groupDns : legacy;
    if (groupDns.length === 0) errors.push('Add user to groups: choose at least one group');
    if (groupDns.length > 10) errors.push('Add user to groups: choose at most 10 groups');
    if (!groupDns.every((entry) => typeof entry === 'string' && entry.trim().length > 0 && entry.length <= 4000)) {
      errors.push('Add user to groups: every group must be a non-empty directory DN or token');
    }
    return errors;
  }
  // Advanced condition groups take precedence over the legacy single-field
  // comparison; when present, field/equals stop being mandatory so stored
  // graphs stay valid while new group-only graphs validate cleanly.
  const hasConditionGroups =
    type === 'logic_condition' && Array.isArray(config.groups) && config.groups.length > 0;
  for (const field of definition.configSchema) {
    if (hasConditionGroups && (field.name === 'field' || field.name === 'equals')) continue;
    const value = config[field.name];
    const missing = value === undefined || value === null || String(value).trim() === '';
    if (field.required && missing) {
      errors.push(`${definition.label}: "${field.label}" is required`);
      continue;
    }
    if (missing) continue;
    if (field.kind === 'number') {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) {
        errors.push(`${definition.label}: "${field.label}" must be a number`);
      } else {
        if (type === 'logic_delay' && field.name === 'minutes' && (parsed < 1 || parsed > 1440)) {
          errors.push('Wait: minutes must be between 1 and 1440');
        }
        if (type === 'trigger_schedule' && field.name === 'everyMinutes' && parsed < 5) {
          errors.push('Schedule: minimum interval is 5 minutes');
        }
      }
    }
    if (field.kind === 'select' && field.options) {
      const allowed = new Set(field.options.map((option) => option.value));
      if (!allowed.has(String(value))) {
        errors.push(`${definition.label}: "${field.label}" has an invalid selection`);
      }
    }
    if (
      (field.kind === 'string' || field.kind === 'text' || field.kind === 'group-dn') &&
      String(value).length > 4000
    ) {
      errors.push(`${definition.label}: "${field.label}" exceeds 4000 characters`);
    }
  }
  return errors;
}

/**
 * Validate advanced condition groups (ADR-0013 headroom): typed comparisons
 * against the trigger's context-field registry only, ops matched to value
 * shape, bounded size. No expression language - every comparison is a
 * dropdown-driven field/op plus a plain string or list of strings.
 */
function validateConditionGroups(
  config: Record<string, unknown>,
  triggerType: string | undefined
): string[] {
  const rawGroups = config.groups;
  if (!Array.isArray(rawGroups) || rawGroups.length === 0) return [];
  const errors: string[] = [];
  if (rawGroups.length > MAX_CONDITION_GROUPS) {
    errors.push(`Condition allows at most ${MAX_CONDITION_GROUPS} groups`);
  }
  const triggerDefinition = triggerType ? FLOW_NODE_CATALOG[triggerType] : undefined;
  const knownFields = new Set((triggerDefinition?.contextFields ?? []).map((field) => field.key));
  rawGroups.forEach((rawGroup, groupIndex) => {
    const groupLabel = `Condition group ${groupIndex + 1}`;
    if (!rawGroup || typeof rawGroup !== 'object') {
      errors.push(`${groupLabel} must be an object`);
      return;
    }
    const group = rawGroup as Partial<ConditionGroup>;
    if (group.match !== 'all' && group.match !== 'any') {
      errors.push(`${groupLabel}: match must be "all" or "any"`);
    }
    if (!Array.isArray(group.comparisons) || group.comparisons.length === 0) {
      errors.push(`${groupLabel} needs at least one comparison`);
      return;
    }
    if (group.comparisons.length > MAX_CONDITION_COMPARISONS) {
      errors.push(`${groupLabel} allows at most ${MAX_CONDITION_COMPARISONS} comparisons`);
    }
    group.comparisons.forEach((rawComparison, comparisonIndex) => {
      const comparisonLabel = `${groupLabel}, comparison ${comparisonIndex + 1}`;
      if (!rawComparison || typeof rawComparison !== 'object') {
        errors.push(`${comparisonLabel} must be an object`);
        return;
      }
      const comparison = rawComparison as { field?: unknown; op?: unknown; value?: unknown };
      if (typeof comparison.field !== 'string' || !comparison.field.trim()) {
        errors.push(`${comparisonLabel} needs a field`);
      } else if (triggerDefinition && !knownFields.has(comparison.field)) {
        errors.push(
          `${comparisonLabel}: field "${comparison.field}" is not available for this workflow's trigger`
        );
      }
      if (comparison.op !== 'equals' && comparison.op !== 'contains' && comparison.op !== 'in') {
        errors.push(`${comparisonLabel}: op must be equals, contains, or in`);
      }
      if (comparison.op === 'in') {
        if (
          !Array.isArray(comparison.value) ||
          comparison.value.length === 0 ||
          !comparison.value.every((entry) => typeof entry === 'string' && entry.trim().length > 0)
        ) {
          errors.push(`${comparisonLabel}: "in" needs a non-empty list of values`);
        }
      } else if (typeof comparison.value !== 'string' || comparison.value.trim().length === 0) {
        errors.push(`${comparisonLabel}: value must be a non-empty string for ${String(comparison.op)}`);
      } else if (comparison.value.length > 4000) {
        errors.push(`${comparisonLabel}: value exceeds 4000 characters`);
      }
    });
  });
  return errors;
}

export function validateGraph(nodes: unknown, edges: unknown): GraphValidationResult {
  const errors: string[] = [];

  if (!Array.isArray(nodes) || nodes.length === 0) {
    return { ok: false, errors: ['A workflow needs at least one trigger node'] };
  }
  if (nodes.length > MAX_NODES) {
    errors.push(`Workflows allow at most ${MAX_NODES} nodes`);
  }
  if (!Array.isArray(edges)) {
    return { ok: false, errors: ['Edges must be a list'] };
  }
  if (edges.length > MAX_EDGES) {
    errors.push(`Workflows allow at most ${MAX_EDGES} connections`);
  }

  const parsedNodes: FlowNode[] = [];
  const nodeById = new Map<string, FlowNode>();
  const ids = new Set<string>();
  let triggerNode: FlowNode | undefined;

  for (const raw of nodes) {
    const candidate = raw as Partial<FlowNode>;
    if (typeof candidate.id !== 'string' || typeof candidate.type !== 'string') {
      errors.push('Every node needs an id and a type');
      continue;
    }
    if (ids.has(candidate.id)) {
      errors.push(`Duplicate node id "${candidate.id}"`);
      continue;
    }
    ids.add(candidate.id);
    if (!isKnownNodeType(candidate.type)) {
      errors.push(`Unknown node type "${candidate.type}" - this graph cannot run until it is removed or the portal is updated`);
      continue;
    }
    const node: FlowNode = {
      id: candidate.id,
      type: candidate.type,
      config: (candidate.config ?? {}) as Record<string, unknown>,
      position: candidate.position,
    };
    parsedNodes.push(node);
    nodeById.set(node.id, node);

    const category = FLOW_NODE_CATALOG[node.type]?.category;
    if (category === 'trigger' || category === 'source') {
      if (triggerNode) {
        errors.push('A workflow has exactly one trigger');
      } else {
        triggerNode = node;
      }
    }
    errors.push(...validateConfig(node.type, node.config));
  }

  // Condition groups reference the trigger's typed context registry, so they
  // are validated once the single trigger node is known.
  if (triggerNode) {
    for (const node of parsedNodes) {
      if (node.type === 'logic_condition') {
        errors.push(...validateConditionGroups(node.config, triggerNode.type));
      }
    }
  }

  let triggerKey: string | undefined;
  if (triggerNode) {
    triggerKey = NODE_TYPE_TO_TRIGGER_KEY[triggerNode.type] ?? (triggerNode.type === 'trigger_schedule' ? 'schedule' : undefined);
    if (!triggerKey) {
      errors.push(`Trigger type "${triggerNode.type}" has no event mapping`);
    }
  } else {
    errors.push('A workflow needs exactly one trigger node');
  }

  // Edge integrity + handle checks + fan-out bound.
  const outgoing = new Map<string, number>();
  for (const raw of edges) {
    const edge = raw as Partial<FlowEdge>;
    if (typeof edge.source !== 'string' || typeof edge.target !== 'string') {
      errors.push('Every connection needs a source and a target');
      continue;
    }
    if (!ids.has(edge.source) || !ids.has(edge.target)) {
      errors.push('Connection references an unknown node');
      continue;
    }
    if (edge.source === edge.target) {
      errors.push('Connections cannot loop back into the same node');
      continue;
    }
    const source = nodeById.get(edge.source);
    if (source) {
      const handles = FLOW_NODE_CATALOG[source.type]?.handles;
      if (handles && handles.length > 0) {
        const handleId = edge.sourceHandle ?? 'out';
        if (!handles.some((handle) => handle.id === handleId)) {
          errors.push(`Connection from "${source.id}" uses an invalid output`);
        }
      }
      const count = (outgoing.get(edge.source) ?? 0) + 1;
      outgoing.set(edge.source, count);
      if (count > MAX_FAN_OUT) {
        errors.push(`"${source.id}" exceeds the maximum of ${MAX_FAN_OUT} outgoing connections`);
      }
    }
  }

  // Acyclic check via iterative DFS on the reachable graph.
  if (errors.length === 0) {
    const adjacency = new Map<string, string[]>();
    for (const raw of edges) {
      const edge = raw as FlowEdge;
      const list = adjacency.get(edge.source) ?? [];
      list.push(edge.target);
      adjacency.set(edge.source, list);
    }
    const state = new Map<string, 1 | 2>(); // 1 visiting, 2 done
    const stack: Array<{ id: string; iterator: Iterator<string> }> = [];
    for (const startId of ids) {
      if (state.has(startId)) continue;
      const neighbors = adjacency.get(startId) ?? [];
      state.set(startId, 1);
      stack.push({ id: startId, iterator: neighbors[Symbol.iterator]() });
      while (stack.length > 0) {
        const top = stack[stack.length - 1];
        if (!top) break;
        const next = top.iterator.next();
        if (next.done) {
          state.set(top.id, 2);
          stack.pop();
          continue;
        }
        const target = next.value;
        if (state.get(target) === 1) {
          errors.push('Workflow contains a cycle; loops must use bounded Wait nodes instead');
          stack.length = 0;
          break;
        }
        if (!state.has(target)) {
          state.set(target, 1);
          stack.push({ id: target, iterator: (adjacency.get(target) ?? [])[Symbol.iterator]() });
        }
      }
    }
  }

  return { ok: errors.length === 0, errors, triggerKey };
}
