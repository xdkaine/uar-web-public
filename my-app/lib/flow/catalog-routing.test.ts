import { describe, expect, it } from 'vitest';
import { FLOW_NODE_CATALOG, NODE_TYPE_TO_TRIGGER_KEY } from './catalog';
import { validateGraph } from './graph';
import { renderTokens, type FlowContext } from './engine';
import { WORKFLOW_TEMPLATES } from './templates';

describe('flow catalog extensions', () => {
  it('exposes the structured fields workflows need', () => {
    const condition = FLOW_NODE_CATALOG.logic_condition;
    const fieldOptions = condition.configSchema.find((f) => f.name === 'field')?.options ?? [];
    const values = new Set(fieldOptions.map((o) => o.value));
    expect(values.has('requestedForSelf')).toBe(true);
    expect(values.has('joinAutoApprove')).toBe(true);

    expect(FLOW_NODE_CATALOG.action_update_ticket).toBeDefined();
    const statusField =
      FLOW_NODE_CATALOG.action_update_ticket.configSchema.find((f) => f.name === 'status');
    expect(statusField?.options?.map((o) => o.value)).toEqual(['open', 'in_progress', 'closed']);
  });

  it('validates the seeded auto group join shape', () => {
    const result = validateGraph(
      [
        { id: 't1', type: 'trigger_ticket_created', config: {} },
        { id: 'c1', type: 'logic_condition', config: { field: 'category', equals: 'ACCOUNT' } },
        { id: 'c2', type: 'logic_condition', config: { field: 'requestedForSelf', equals: 'true' } },
        { id: 'c3', type: 'logic_condition', config: { field: 'joinAutoApprove', equals: 'true' } },
        { id: 'a1', type: 'action_enqueue_group_add', config: { groupDn: '{{joinGroupDn}}' } },
        { id: 'a2', type: 'action_add_ticket_response', config: { message: 'queued' } },
        { id: 'a3', type: 'action_update_ticket', config: { status: 'in_progress' } },
      ],
      [
        { id: 'e1', source: 't1', target: 'c1' },
        { id: 'e2', source: 'c1', sourceHandle: 'true', target: 'c2' },
        { id: 'e3', source: 'c2', sourceHandle: 'true', target: 'c3' },
        { id: 'e4', source: 'c3', sourceHandle: 'true', target: 'a1' },
        { id: 'e5', source: 'a1', target: 'a2' },
        { id: 'e6', source: 'a2', target: 'a3' },
      ]
    );
    expect(result).toMatchObject({ ok: true, triggerKey: 'ticket_created' });
  });

  it('rejects invalid statuses on update_ticket', () => {
    const result = validateGraph(
      [
        { id: 't1', type: 'trigger_ticket_created', config: {} },
        { id: 'a1', type: 'action_update_ticket', config: { status: 'deleted' } },
      ],
      [{ id: 'e1', source: 't1', target: 'a1' }]
    );
    expect(result.ok).toBe(false);
  });

  it('maps lifecycle trigger keys and publishes their typed context fields', () => {
    expect(NODE_TYPE_TO_TRIGGER_KEY.trigger_lifecycle_action_completed).toBe('lifecycle_action_completed');
    expect(NODE_TYPE_TO_TRIGGER_KEY.trigger_lifecycle_action_failed).toBe('lifecycle_action_failed');

    const failedFields = (FLOW_NODE_CATALOG.trigger_lifecycle_action_failed.contextFields ?? []).map(
      (field) => field.key
    );
    expect(failedFields).toEqual(expect.arrayContaining(['actionType', 'username', 'status', 'actionId', 'batchId', 'error']));
    const completedFields = (FLOW_NODE_CATALOG.trigger_lifecycle_action_completed.contextFields ?? []).map(
      (field) => field.key
    );
    expect(completedFields).not.toContain('error');
  });

  it('maps structured operational issue triggers with audit-safe fields', () => {
    expect(NODE_TYPE_TO_TRIGGER_KEY.trigger_operational_issue_detected).toBe('operational_issue_detected');
    expect(NODE_TYPE_TO_TRIGGER_KEY.trigger_operational_issue_resolved).toBe('operational_issue_resolved');

    const fields = (FLOW_NODE_CATALOG.trigger_operational_issue_detected.contextFields ?? []).map(
      (field) => field.key
    );
    expect(fields).toEqual(expect.arrayContaining([
      'detectorKey',
      'reasonCode',
      'severity',
      'subjectType',
      'subjectId',
      'route',
      'evidenceEventId',
      'correlationId',
      'href',
    ]));
    expect(fields).not.toContain('rawLog');
  });

  it('keeps every premade template a valid graph, including the new lifecycle ones', () => {
    for (const template of WORKFLOW_TEMPLATES) {
      // Templates ship with recipient fields intentionally blank for the
      // operator to fill before publishing; fill them so structural validity
      // (types, edges, condition groups vs trigger registry) is what's tested.
      const nodes = template.nodes.map((node) => {
        const config = { ...node.config };
        if (config.to === '') config.to = 'ops@cpp.edu';
        return { ...node, config };
      });
      const result = validateGraph(nodes, template.edges);
      expect(result.ok, `${template.id}: ${result.errors.join('; ')}`).toBe(true);
    }
  });

  it('ships safe draft templates for the requested infrastructure checks', () => {
    const templates = new Map(WORKFLOW_TEMPLATES.map((template) => [template.id, template]));
    expect([...templates.keys()]).toEqual(expect.arrayContaining([
      'truenas-vm-ping-monitoring',
      'proxmox-cluster-ping-monitoring',
      'multi-vm-ldaps-monitoring',
    ]));
    for (const id of ['truenas-vm-ping-monitoring', 'proxmox-cluster-ping-monitoring', 'multi-vm-ldaps-monitoring']) {
      const source = templates.get(id)?.nodes.find((node) => node.type === 'source_monitor_endpoints');
      expect(source?.config.checks).toHaveLength(3);
      expect(templates.get(id)?.edges.map((edge) => edge.sourceHandle)).toEqual(expect.arrayContaining(['failed', 'recovered']));
    }
  });
});

describe('renderTokens with routing context', () => {
  it('substitutes join-group tokens from the enriched context', () => {
    const context: FlowContext = {
      username: 'jdoe',
      requestedForSelf: true,
      joinGroupDn: 'CN=Analysts,OU=Groups,DC=sdc,DC=cpp',
      joinAutoApprove: true,
    };
    expect(renderTokens('Add {{username}} to {{joinGroupDn}}', context)).toBe(
      'Add jdoe to CN=Analysts,OU=Groups,DC=sdc,DC=cpp'
    );
    expect(renderTokens('auto={{joinAutoApprove}} self={{requestedForSelf}}', context)).toBe(
      'auto=true self=true'
    );
  });

  it('leaves unknown tokens visible instead of failing', () => {
    expect(renderTokens('Hello {{missing}}', {})).toBe('Hello {{missing}}');
  });
});
