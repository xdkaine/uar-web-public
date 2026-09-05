import { describe, expect, it } from 'vitest';
import { buildSyncStatusCsv, filterSyncStatusAccounts, matchesSyncStatusSearch } from './AccountSyncStatusHelpers';
import type { SyncStatusAccount } from './AccountSyncStatusTypes';

const baseAccount: SyncStatusAccount = {
  identifier: 'external1',
  name: 'External User',
  email: null,
  hasAdAccount: false,
  adUsername: null,
  adDisplayName: null,
  adEmail: null,
  adSyncDate: null,
  hasVpnAccount: true,
  vpnUsername: 'vpnuser',
  vpnPortalType: 'External',
  vpnStatus: 'revoked',
  vpnCreatedAt: '2026-05-21T00:00:00.000Z',
  hasAccessRequest: false,
  requestId: null,
  requestStatus: null,
  requestCreatedAt: null,
  isManuallyAssigned: false,
  syncStatus: 'vpn_only',
  syncIssues: [],
  lastSyncId: null,
  wasAutoAssigned: false,
};

describe('matchesSyncStatusSearch', () => {
  it('searches nullable-email accounts without throwing', () => {
    expect(() => matchesSyncStatusSearch(baseAccount, 'vpnuser')).not.toThrow();
    expect(matchesSyncStatusSearch(baseAccount, 'vpnuser')).toBe(true);
  });

  it('does not match empty nullable fields', () => {
    expect(matchesSyncStatusSearch(baseAccount, 'missing-value')).toBe(false);
  });
});

describe('ownership-aware sync status helpers', () => {
  const requestOwned: SyncStatusAccount = {
    ...baseAccount,
    identifier: 'directory-user',
    ownership: {
      ownerType: 'access_request', ownerId: 'request-1', requestId: 'request-1', batchItemId: null,
      batchRunId: null, readiness: 'ready', expectedSystems: null,
      requestHref: '/admin/requests/request-1', batchHref: null,
    },
  };
  const batchOwned: SyncStatusAccount = {
    ...baseAccount,
    identifier: 'batch-user',
    ownership: {
      ownerType: 'batch_account', ownerId: 'batch-item-1', requestId: null, batchItemId: 'batch-item-1',
      batchRunId: 'batch-run-1', readiness: 'ready', expectedSystems: ['AD'],
      requestHref: null, batchHref: '/admin/batch-accounts/batch-run-1',
    },
  };

  it('searches request and batch IDs and filters by ownership state', () => {
    expect(matchesSyncStatusSearch(requestOwned, 'request-1')).toBe(true);
    expect(matchesSyncStatusSearch(batchOwned, 'batch-run-1')).toBe(true);
    expect(filterSyncStatusAccounts([requestOwned, batchOwned, baseAccount], '', 'all', 'all', 'batch_owner')).toEqual([batchOwned]);
    expect(filterSyncStatusAccounts([requestOwned, batchOwned, baseAccount], '', 'all', 'all', 'ownership_unavailable')).toEqual([baseAccount]);
  });

  it('exports distinct request, batch item, and batch run identifiers', () => {
    const csv = buildSyncStatusCsv([{ ...requestOwned, name: 'Request "quoted"', syncIssues: ['Needs "review"'] }, batchOwned]);
    expect(csv).toContain('Request ID');
    expect(csv).toContain('Batch Item ID');
    expect(csv).toContain('Batch Run ID');
    expect(csv).toContain('batch-item-1');
    expect(csv).toContain('batch-run-1');
    expect(csv).toContain('"Request ""quoted"""');
    expect(csv).toContain('"Needs ""review"""');
  });
});
