import { describe, expect, it, vi } from 'vitest';

import { assertAutomationGroupsEligible, configuredAutomationGroupDns } from './group-targets';

const NODES = [{
  id: 'groups',
  type: 'action_enqueue_group_add',
  config: { groupDns: ['CN=One,DC=example,DC=test', '{{joinGroupDn}}', 'cn=one,dc=example,dc=test', 'CN=Two,DC=example,DC=test'] },
}];

describe('workflow group target policy', () => {
  it('deduplicates static groups and excludes the event-bound join group token', () => {
    expect(configuredAutomationGroupDns(NODES)).toEqual([
      'CN=One,DC=example,DC=test',
      'CN=Two,DC=example,DC=test',
    ]);
  });

  it('rejects publication when any static target is not active and auto-approved', async () => {
    const findMany = vi.fn().mockResolvedValue([
      { dn: 'CN=One,DC=example,DC=test', isActive: true, canJoinViaTicket: true, autoApproveJoin: true },
      { dn: 'CN=Two,DC=example,DC=test', isActive: true, canJoinViaTicket: true, autoApproveJoin: false },
    ]);
    await expect(assertAutomationGroupsEligible({ allowedTicketSubjectGroup: { findMany } } as never, NODES))
      .rejects.toThrow('WORKFLOW_GROUP_INELIGIBLE:CN=Two,DC=example,DC=test');
  });
});
