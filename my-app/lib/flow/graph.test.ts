import { describe, expect, it } from 'vitest';
import { validateGraph } from './graph';
import { renderTokens } from './engine';

const triggerNode = {
  id: 't1',
  type: 'trigger_ticket_created',
  config: {},
  position: { x: 0, y: 0 },
};

const replyNode = {
  id: 'a1',
  type: 'action_add_ticket_response',
  config: { message: 'Thanks {{username}}, we got your ticket.' },
  position: { x: 200, y: 0 },
};

describe('validateGraph', () => {
  it('accepts a simple trigger -> action chain', () => {
    const result = validateGraph(
      [triggerNode, replyNode],
      [{ id: 'e1', source: 't1', target: 'a1' }]
    );

    expect(result.ok).toBe(true);
    expect(result.triggerKey).toBe('ticket_created');
    expect(result.errors).toEqual([]);
  });

  it('rejects graphs without a trigger node', () => {
    const result = validateGraph([replyNode], []);
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('trigger');
  });

  it('detects cycles before any execution can happen', () => {
    const condition = {
      id: 'c1',
      type: 'logic_condition',
      config: { field: 'severity', equals: 'critical' },
    };
    const result = validateGraph(
      [triggerNode, condition, replyNode],
      [
        { id: 'e1', source: 't1', target: 'c1' },
        { id: 'e2', source: 'c1', sourceHandle: 'true', target: 'a1' },
        { id: 'e3', source: 'a1', target: 'c1' },
      ]
    );
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('cycle');
  });

  it('requires configured fields on action nodes', () => {
    const emptyReply = { ...replyNode, config: {} };
    const result = validateGraph(
      [triggerNode, emptyReply],
      [{ id: 'e1', source: 't1', target: 'a1' }]
    );
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('Response');
  });

  it('rejects edges that use undeclared handles on branch nodes', () => {
    const condition = {
      id: 'c1',
      type: 'logic_condition',
      config: { field: 'severity', equals: 'critical' },
    };
    const result = validateGraph(
      [triggerNode, condition, replyNode],
      [
        { id: 'e1', source: 't1', target: 'c1' },
        { id: 'e2', source: 'c1', sourceHandle: 'sideways', target: 'a1' },
      ]
    );
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('invalid output');
  });

  it('maps schedule triggers to the schedule event key', () => {
    const schedule = {
      id: 's1',
      type: 'trigger_schedule',
      config: { everyMinutes: 15, topic: 'nightly-report' },
    };
    const email = {
      id: 'm1',
      type: 'action_send_email',
      config: {
        to: 'ops@cpp.edu',
        subject: 'Nightly report',
        body: 'Numbers inside.',
      },
    };
    const result = validateGraph([schedule, email], [{ id: 'e1', source: 's1', target: 'm1' }]);
    expect(result.ok).toBe(true);
    expect(result.triggerKey).toBe('schedule');
  });
});

describe('condition group validation', () => {
  const lifecycleTrigger = { id: 't1', type: 'trigger_lifecycle_action_failed', config: {} };

  function validateWithCondition(config: Record<string, unknown>) {
    return validateGraph(
      [lifecycleTrigger, { id: 'c1', type: 'logic_condition', config }],
      [{ id: 'e1', source: 't1', target: 'c1' }]
    );
  }

  it('accepts typed groups referencing known trigger context fields', () => {
    const result = validateWithCondition({
      groups: [
        {
          match: 'any',
          comparisons: [
            { field: 'actionType', op: 'equals', value: 'disable_ad' },
            { field: 'username', op: 'contains', value: 'bob' },
          ],
        },
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects comparisons against fields outside the trigger registry', () => {
    const result = validateWithCondition({
      groups: [{ match: 'all', comparisons: [{ field: 'category', op: 'equals', value: 'ACCOUNT' }] }],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('is not available for this workflow\'s trigger');
  });

  it('rejects ops whose value shape does not match', () => {
    const inWithString = validateWithCondition({
      groups: [{ match: 'all', comparisons: [{ field: 'actionType', op: 'in', value: 'disable_ad' }] }],
    });
    expect(inWithString.ok).toBe(false);
    expect(inWithString.errors.join(' ')).toContain('"in" needs a non-empty list');

    const equalsWithArray = validateWithCondition({
      groups: [{ match: 'all', comparisons: [{ field: 'actionType', op: 'equals', value: ['a'] }] }],
    });
    expect(equalsWithArray.ok).toBe(false);

    const emptyInList = validateWithCondition({
      groups: [{ match: 'all', comparisons: [{ field: 'actionType', op: 'in', value: [] }] }],
    });
    expect(emptyInList.ok).toBe(false);
  });

  it('rejects unknown ops and missing fields/values', () => {
    const badOp = validateWithCondition({
      groups: [{ match: 'all', comparisons: [{ field: 'actionType', op: 'regex', value: '.*' }] }],
    });
    expect(badOp.ok).toBe(false);
    expect(badOp.errors.join(' ')).toContain('op must be equals, contains, or in');

    const emptyField = validateWithCondition({
      groups: [{ match: 'all', comparisons: [{ field: '', op: 'equals', value: 'x' }] }],
    });
    expect(emptyField.ok).toBe(false);
  });

  it('caps groups at five and comparisons per group at ten', () => {
    const sixGroups = validateWithCondition({
      groups: Array.from({ length: 6 }, () => ({
        match: 'all',
        comparisons: [{ field: 'actionType', op: 'equals', value: 'x' }],
      })),
    });
    expect(sixGroups.ok).toBe(false);
    expect(sixGroups.errors.join(' ')).toContain('at most 5 groups');

    const elevenComparisons = validateWithCondition({
      groups: [
        {
          match: 'all',
          comparisons: Array.from({ length: 11 }, (_, index) => ({
            field: 'username',
            op: 'contains',
            value: `v${index}`,
          })),
        },
      ],
    });
    expect(elevenComparisons.ok).toBe(false);
    expect(elevenComparisons.errors.join(' ')).toContain('at most 10 comparisons');
  });

  it('stops requiring legacy field/equals when groups are configured', () => {
    const result = validateWithCondition({
      groups: [{ match: 'all', comparisons: [{ field: 'error', op: 'contains', value: 'LDAP' }] }],
    });
    expect(result.ok).toBe(true);
  });

  it('keeps requiring legacy field/equals without groups', () => {
    const result = validateWithCondition({});
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('required');
  });

  it('maps lifecycle triggers to their event keys', () => {
    const result = validateGraph(
      [lifecycleTrigger],
      []
    );
    expect(result.ok).toBe(true);
    expect(result.triggerKey).toBe('lifecycle_action_failed');
  });
});

describe('renderTokens', () => {
  it('substitutes known context values', () => {
    expect(renderTokens('Hello {{username}} re {{ticketSubject}}', { username: 'amy', ticketSubject: 'VPN down' })).toBe(
      'Hello amy re VPN down'
    );
  });

  it('leaves unknown placeholders visible so misconfigurations fail loudly', () => {
    expect(renderTokens('Value: {{nope}}', {})).toBe('Value: {{nope}}');
  });
});
