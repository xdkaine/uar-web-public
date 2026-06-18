import { describe, expect, it } from 'vitest';
import { matchesSyncStatusSearch, type SyncStatusAccount } from './AccountSyncStatusTab';

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
