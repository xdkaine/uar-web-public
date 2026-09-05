import { describe, expect, it } from 'vitest';

import { buildDirectoryUsersCsv, directoryUserMatchesSearch, type LDAPUser } from './user-management-utils';

const user: LDAPUser = {
  dn: 'CN=Batch User,OU=People,DC=example,DC=test',
  username: 'batch-user',
  displayName: 'Batch User',
  email: 'batch@example.test',
  description: '',
  accountEnabled: true,
  accountExpires: null,
  whenCreated: '2026-09-04T00:00:00.000Z',
  memberOf: [],
  ownership: {
    ownerType: 'batch_account', ownerId: 'batch-item-1', requestId: null, batchItemId: 'batch-item-1',
    batchRunId: 'batch-run-1', readiness: 'ready', expectedSystems: ['AD'], requestHref: null,
    batchHref: '/admin/batch-accounts/batch-run-1',
  },
};

describe('directory ownership presentation helpers', () => {
  it('searches batch IDs and does not invent request IDs', () => {
    expect(directoryUserMatchesSearch(user, 'batch-item-1')).toBe(true);
    expect(directoryUserMatchesSearch(user, 'request-1')).toBe(false);
  });

  it('exports the distinct ownership identifiers', () => {
    const csv = buildDirectoryUsersCsv([{ ...user, description: 'Owner "quoted"' }]);
    expect(csv).toContain('Request ID');
    expect(csv).toContain('Batch Item ID');
    expect(csv).toContain('Batch Run ID');
    expect(csv).toContain('"batch-item-1"');
    expect(csv).toContain('"batch-run-1"');
    expect(csv).toContain('"Owner ""quoted"""');
  });
});
