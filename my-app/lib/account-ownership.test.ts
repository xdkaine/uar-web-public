import { describe, expect, it } from 'vitest';
import { summarizeAccountOwnership, unavailableAccountOwnership } from './account-ownership';
import { buildLifecycleAccountInventory } from './lifecycle-account-inventory';

const directoryUser = { username: 'person', dn: 'CN=person', objectGuid: 'original-guid', displayName: 'Person', email: '', accountEnabled: false };
const batchItem = {
  id: 'item', batchId: 'run', batch: { id: 'run', description: 'Fixture run' },
  accessRequestId: null, lifecycleOwnerKind: 'batch_item', accountType: 'AD',
  ldapUsername: 'person', status: 'completed', adAccountStatus: 'disabled',
  targetDirectoryDn: directoryUser.dn, targetDirectoryObjectGuid: directoryUser.objectGuid,
};

describe('shared ownership summary', () => {
  it('keeps run and item IDs distinct from request IDs', () => {
    const [account] = buildLifecycleAccountInventory({ directoryUsers: [directoryUser], vpnAccounts: [], accessRequests: [], batchItems: [batchItem] });
    expect(summarizeAccountOwnership(account, { batches: true, requests: true })).toEqual({
      ownerType: 'batch_account', ownerId: 'item', batchItemId: 'item', batchRunId: 'run', requestId: null,
      readiness: 'ready', expectedSystems: ['AD'], requestHref: null, batchHref: '/admin/batch-accounts/run',
    });
    expect(summarizeAccountOwnership(account, { batches: false, requests: true }).batchHref).toBeNull();
  });
  it('preserves legacy request ownership alongside batch provenance', () => {
    const [account] = buildLifecycleAccountInventory({
      directoryUsers: [directoryUser], vpnAccounts: [],
      accessRequests: [{ id: 'request', name: 'Person', email: '', status: 'approved', provisioningState: 'completed', ldapUsername: 'person', createdAt: new Date() }],
      batchItems: [{ ...batchItem, accessRequestId: 'request', lifecycleOwnerKind: 'access_request_legacy' }],
    });
    expect(summarizeAccountOwnership(account, { requests: true, batches: true })).toMatchObject({
      ownerType: 'access_request', requestId: 'request', batchRunId: 'run',
      requestHref: '/admin/requests/request', batchHref: '/admin/batch-accounts/run',
    });
  });
  it('keeps unavailable evidence distinct from a confirmed absence of ownership', () => {
    expect(unavailableAccountOwnership().readiness).toBe('unavailable');
    const [account] = buildLifecycleAccountInventory({ directoryUsers: [directoryUser], vpnAccounts: [], accessRequests: [] });
    expect(summarizeAccountOwnership(account, { requests: true, batches: true }).readiness).toBe('unowned');
  });
});
