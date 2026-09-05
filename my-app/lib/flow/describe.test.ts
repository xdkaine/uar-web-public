import { describe, expect, it } from 'vitest';
import { describeWorkflow, describeWorkflowSummary } from './describe';

describe('describeWorkflow', () => {
  it('renders a linear group-join automation in plain English', () => {
    const lines = describeWorkflow(
      [
        { id: 't', type: 'trigger_ticket_created', config: {} },
        {
          id: 'c',
          type: 'logic_condition',
          config: { field: 'joinGroupDn', equals: 'CN=CPTC,OU=KaminoGroups,DC=sdc,DC=cpp' },
        },
        { id: 'add', type: 'action_enqueue_group_add', config: { groupDn: '{{joinGroupDn}}' } },
        { id: 'close', type: 'action_close_ticket', config: {} },
      ],
      [
        { source: 't', target: 'c' },
        { source: 'c', sourceHandle: 'true', target: 'add' },
        { source: 'add', target: 'close' },
      ]
    );

    expect(lines[0]).toBe('When a ticket is created');
    expect(lines.some((line) => line.startsWith('if the requested group is CN=CPTC'))).toBe(true);
    expect(lines).toContain('then add the requester to the group they asked about.');
    expect(lines).toContain('then close the ticket.');
  });

  it('renders TRUE/FALSE branches with then/otherwise wording', () => {
    const lines = describeWorkflow(
      [
        { id: 't', type: 'trigger_ticket_created', config: {} },
        { id: 'c', type: 'logic_condition', config: { field: 'severity', equals: 'critical' } },
        {
          id: 'mail',
          type: 'action_send_email',
          config: { to: 'admin@cpp.edu', subject: 'Critical ticket' },
        },
        { id: 'alert', type: 'action_create_service_alert', config: { title: 'Escalate' } },
      ],
      [
        { source: 't', target: 'c' },
        { source: 'c', sourceHandle: 'true', target: 'mail' },
        { source: 'c', sourceHandle: 'false', target: 'alert' },
      ]
    );

    expect(lines).toContain('then send an email to admin@cpp.edu ("Critical ticket").');
    expect(lines.some((line) => line.startsWith('otherwise raise a'))).toBe(true);
  });

  it('returns empty when there is no trigger', () => {
    expect(describeWorkflow([{ id: 'a', type: 'action_close_ticket', config: {} }], [])).toEqual([]);
    expect(describeWorkflowSummary([], [])).toBe('');
  });

  it('summarizes to a single line', () => {
    const summary = describeWorkflowSummary(
      [
        { id: 't', type: 'trigger_dc_unreachable', config: {} },
        { id: 'a', type: 'action_create_service_alert', config: { severity: 'critical', title: 'DC down' } },
      ],
      [{ source: 't', target: 'a' }]
    );
    expect(summary).toBe(
      'When the primary directory becomes unreachable then raise a critical service alert ("DC down").'
    );
  });

  it('renders lifecycle triggers, group conditions, and banner cleanup in plain English', () => {
    const lines = describeWorkflow(
      [
        { id: 't', type: 'trigger_lifecycle_action_completed', config: {} },
        {
          id: 'c',
          type: 'logic_condition',
          config: {
            groups: [
              {
                match: 'any',
                comparisons: [
                  { field: 'actionType', op: 'equals', value: 'disable_ad' },
                  { field: 'error', op: 'contains', value: 'LDAP', },
                ],
              },
              {
                match: 'all',
                comparisons: [
                  { field: 'actionType', op: 'in', value: ['disable_ad', 'revoke_vpn'] },
                ],
              },
            ],
          },
        },
        { id: 'clear', type: 'action_clear_notification_banner', config: { createdByGraph: true } },
        { id: 'remove', type: 'action_enqueue_group_remove', config: { groupDn: 'CN=Old-Access' } },
      ],
      [
        { source: 't', target: 'c' },
        { source: 'c', sourceHandle: 'true', target: 'clear' },
        { source: 'clear', target: 'remove' },
      ]
    );

    expect(lines[0]).toBe('When a lifecycle action completes');
    const conditionLine = lines.find((line) => line.startsWith('if any of')) ?? '';
    expect(conditionLine).toContain('the lifecycle action type is disable_ad');
    expect(conditionLine).toContain('the error message contains LDAP');
    expect(conditionLine).toContain(
      'and the lifecycle action type is one of disable_ad or revoke_vpn:'
    );
    expect(lines).toContain('then clear the site banners this workflow created.');
    expect(lines).toContain('then remove the user from CN=Old-Access.');
  });
});
