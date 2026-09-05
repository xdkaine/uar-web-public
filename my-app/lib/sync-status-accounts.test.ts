import { describe, expect, it } from 'vitest';
import { projectSyncStatusAccounts } from './sync-status-accounts';

const user = { username: 'person', dn: 'CN=person', objectGuid: 'original-guid', displayName: 'Person', email: 'person@cpp.edu', accountEnabled: false };
const item = { id: 'item', batchId: 'run', batch: { id: 'run', description: 'Fixture' }, accessRequestId: null, lifecycleOwnerKind: 'batch_item', accountType: 'AD', ldapUsername: 'person', status: 'completed', adAccountStatus: 'disabled', targetDirectoryDn: user.dn, targetDirectoryObjectGuid: user.objectGuid };
const base = { directoryUsers: [user], vpnAccounts: [], accessRequests: [], batchItems: [item], vpnModuleEnabled: true, linkAccess: { requests: true, batches: true } };

describe('Sync Status inventory projection', () => {
  it('shows batch ownership without an access request or missing VPN issue', () => {
    const [account] = projectSyncStatusAccounts(base);
    expect(account).toMatchObject({ accountRef: 'ad:person', hasAccessRequest: false, requestId: null, resolutionKind: null, syncIssues: [], ownership: { ownerType: 'batch_account', batchRunId: 'run', requestId: null } });
  });
  it('does not infer ownership from a matching email', () => {
    const accounts = projectSyncStatusAccounts({ ...base, batchItems: [], accessRequests: [{ id: 'unlinked-request', name: 'Person', email: user.email, status: 'approved', createdAt: new Date() }] });
    expect(accounts).toHaveLength(2);
    expect(accounts.find((account) => account.hasAdAccount)).toMatchObject({ hasAccessRequest: false, ownership: { readiness: 'unowned' } });
  });
  it('keeps an unowned VPN record separate from a batch AD account with the same username', () => {
    const accounts = projectSyncStatusAccounts({ ...base, vpnAccounts: [{ id: 'vpn', username: 'person', name: 'Person', email: '', status: 'revoked', portalType: 'Limited', createdAt: new Date() }] });
    expect(accounts).toHaveLength(2);
    expect(new Set(accounts.map((account) => account.accountRef)).size).toBe(2);
    expect(accounts.find((account) => account.hasVpnAccount)).toMatchObject({ hasAdAccount: false, ownership: { readiness: 'unowned' } });
  });
  it('does not expose a batch navigation link without batch permission', () => {
    const [account] = projectSyncStatusAccounts({ ...base, linkAccess: { requests: true, batches: false } });
    expect(account.ownership.batchHref).toBeNull();
  });
  it('omits request history without request-read permission', () => {
    const [account] = projectSyncStatusAccounts({ ...base, batchItems: [], linkAccess: { requests: false, batches: false }, accessRequests: [{ id: 'request', name: 'Person', email: user.email, ldapUsername: user.username, status: 'approved', createdAt: new Date() }] });
    expect(account.requestHistory).toEqual([]);
    expect(account.ownership.requestHref).toBeNull();
  });
});
