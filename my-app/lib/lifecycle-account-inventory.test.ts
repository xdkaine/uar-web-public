import { describe, expect, it } from 'vitest';

import { buildLifecycleAccountInventory, isInventoryGovernanceReady } from './lifecycle-account-inventory';

const directoryUser = {
  dn: 'CN=Person One,OU=Users,DC=example,DC=test',
  objectGuid: 'original-guid',
  username: 'person1',
  displayName: 'Person One',
  email: 'person1@example.test',
  accountEnabled: true,
};

const approvedRequest = {
  id: 'request-1',
  name: 'Person One',
  email: 'person1@example.test',
  status: 'approved',
  provisioningState: 'completed',
  ldapUsername: 'person1',
  linkedAdUsername: 'person1',
  vpnUsername: 'vpn-person-one',
  linkedVpnUsername: 'vpn-person-one',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
};

describe('buildLifecycleAccountInventory', () => {
  it.each([null, 'replacement-guid'])('keeps batch ownership under review when live GUID is %s', (objectGuid) => {
    const [account] = buildLifecycleAccountInventory({
      directoryUsers: [{ ...directoryUser, objectGuid }], vpnAccounts: [], accessRequests: [],
      batchItems: [{ id: 'item', batchId: 'run', batch: { id: 'run', description: '' }, accessRequestId: null,
        lifecycleOwnerKind: 'batch_item', accountType: 'AD', ldapUsername: 'person1', status: 'completed',
        targetDirectoryDn: directoryUser.dn, targetDirectoryObjectGuid: 'original-guid' }],
    });
    expect(account.governance).toMatchObject({ ownerType: 'batch_account', bindingPosture: 'conflict' });
  });
  it('keeps both divergent request aliases as conflicting ownership claims', () => {
    const accounts = buildLifecycleAccountInventory({
      directoryUsers: [directoryUser, { ...directoryUser, username: 'renamed' }], vpnAccounts: [],
      accessRequests: [{ ...approvedRequest, ldapUsername: 'renamed' }],
    });
    expect(accounts).toHaveLength(2);
    expect(accounts.every((account) => account.governance.ownerType === 'access_request' && account.governance.bindingPosture === 'conflict')).toBe(true);
  });
  it.each([
    { targetDirectoryDn: null, targetDirectoryObjectGuid: 'original-guid' },
    { targetDirectoryDn: directoryUser.dn, targetDirectoryObjectGuid: null },
    { targetDirectoryDn: 'CN=other', targetDirectoryObjectGuid: 'original-guid' },
  ])('requires matching captured batch identity evidence: %j', (identity) => {
    const [account] = buildLifecycleAccountInventory({
      directoryUsers: [directoryUser], vpnAccounts: [], accessRequests: [],
      batchItems: [{ id: 'item', batchId: 'run', batch: { id: 'run', description: '' }, accessRequestId: null,
        lifecycleOwnerKind: 'batch_item', accountType: 'AD', ldapUsername: 'person1', status: 'completed', ...identity }],
    });
    expect(account.governance).toMatchObject({ ownerType: 'batch_account', bindingPosture: 'conflict' });
  });
  it('retains a request-owned VPN record with an explicit legacy batch item', () => {
    const [account] = buildLifecycleAccountInventory({
      directoryUsers: [], accessRequests: [approvedRequest],
      vpnAccounts: [{ id: 'vpn', username: 'vpn-person-one', name: 'Person', email: '', status: 'revoked', portalType: 'Limited', accessRequestId: 'request-1', batchAccountItemId: 'legacy-item' }],
      batchItems: [{ id: 'legacy-item', batchId: 'run', batch: { id: 'run', description: '' }, lifecycleOwnerKind: 'access_request_legacy', accessRequestId: 'request-1', accountType: 'AD', ldapUsername: 'person1', vpnUsername: null, status: 'completed' }],
    });
    expect(account.governance).toMatchObject({ ownerType: 'access_request', requestId: 'request-1', bindingPosture: 'not_applicable' });
    expect(account.batchProvenance?.batchId).toBe('run');
  });
  it('does not call a VPN record unowned when an unfinished batch claims its username', () => {
    const [account] = buildLifecycleAccountInventory({
      directoryUsers: [], accessRequests: [],
      vpnAccounts: [{ id: 'vpn', username: 'person1', name: 'Person', email: '', status: 'revoked', portalType: 'Limited' }],
      batchItems: [{ id: 'item', batchId: 'run', batch: { id: 'run', description: '' }, lifecycleOwnerKind: 'batch_item', accessRequestId: null, accountType: 'VPN', ldapUsername: 'person1', vpnUsername: 'person1', status: 'processing' }],
    });
    expect(account.governance.bindingPosture).toBe('conflict');
  });
  it('retains a processing VPN reservation before vpnUsername is recorded', () => {
    const [account] = buildLifecycleAccountInventory({
      directoryUsers: [], accessRequests: [],
      vpnAccounts: [{ id: 'vpn', username: 'person1', name: 'Person', email: '', status: 'revoked', portalType: 'Limited' }],
      batchItems: [{ id: 'item', batchId: 'run', batch: { id: 'run', description: '' }, lifecycleOwnerKind: 'batch_item', accessRequestId: null, accountType: 'VPN', ldapUsername: 'person1', vpnUsername: null, status: 'processing' }],
    });
    expect(account.governance.bindingPosture).toBe('conflict');
  });
  it.each(['processing', 'reconciliation_required'])('does not present a %s VPN batch owner as ready', (status) => {
    const [account] = buildLifecycleAccountInventory({
      directoryUsers: [], accessRequests: [],
      vpnAccounts: [{ id: 'vpn', username: 'person1', name: 'Person', email: '', status: 'revoked', portalType: 'Limited', batchAccountItemId: 'item' }],
      batchItems: [{ id: 'item', batchId: 'run', batch: { id: 'run', description: '' }, lifecycleOwnerKind: 'batch_item', accessRequestId: null, accountType: 'VPN', ldapUsername: 'person1', vpnUsername: 'person1', status }],
    });
    expect(account.governance).toMatchObject({ ownerType: 'batch_account', bindingPosture: 'conflict' });
  });
  it('joins a differently named VPN account through its AD and request bindings', () => {
    const [account] = buildLifecycleAccountInventory({
      directoryUsers: [directoryUser],
      vpnAccounts: [{
        id: 'vpn-1',
        username: 'vpn-person-one',
        adUsername: 'person1',
        name: 'Person One',
        email: 'person1@example.test',
        status: 'active',
        portalType: 'Management',
        accessRequestId: 'request-1',
      }],
      accessRequests: [approvedRequest],
    });

    expect(account).toMatchObject({
      accountRef: 'ad:person1',
      directory: { username: 'person1', enabled: true },
      vpn: { id: 'vpn-1', username: 'vpn-person-one', status: 'active' },
      governance: { requestId: 'request-1', bindingPosture: 'verified' },
    });
  });

  it('uses one lifecycle-ready request without requiring a directory-side request attribute', () => {
    const [account] = buildLifecycleAccountInventory({
      directoryUsers: [directoryUser],
      vpnAccounts: [],
      accessRequests: [approvedRequest],
    });

    expect(account.governance).toMatchObject({
      requestId: 'request-1',
      status: 'approved',
      provisioningState: 'completed',
      bindingPosture: 'verified',
    });
  });

  it('uses one completed standalone batch item as the AD lifecycle owner', () => {
    const [account] = buildLifecycleAccountInventory({
      directoryUsers: [{ ...directoryUser, accountEnabled: false }],
      vpnAccounts: [],
      accessRequests: [],
      batchItems: [{
        id: 'batch-item-1',
        batchId: 'batch-run-1',
        batch: { id: 'batch-run-1', description: 'Workshop service identities' },
        accessRequestId: null,
        lifecycleOwnerKind: 'batch_item',
        accountType: 'AD',
        ldapUsername: 'person1',
        status: 'completed',
        mutationStage: 'completed',
        adAccountStatus: 'disabled',
        adDisabledAt: new Date('2026-09-04T19:00:00.000Z'),
        adDisabledBy: 'operator1',
        adDisabledReason: 'Batch expired.',
        targetDirectoryDn: directoryUser.dn,
        targetDirectoryObjectGuid: directoryUser.objectGuid,
      }],
    });

    expect(account).toMatchObject({
      governance: {
        ownerType: 'batch_account',
        ownerId: 'batch-item-1',
        batchAccountItemId: 'batch-item-1',
        requestId: null,
        status: 'completed',
        adAccountStatus: 'disabled',
        bindingPosture: 'verified',
      },
      batchProvenance: { batchId: 'batch-run-1', accountTypes: ['AD'] },
    });
    expect(isInventoryGovernanceReady(account, 'delete')).toBe(true);
  });

  it.each(['processing', 'reconciliation_required'])('keeps a %s standalone batch claim out of the unmanaged lane', (status) => {
    const [account] = buildLifecycleAccountInventory({
      directoryUsers: [directoryUser],
      vpnAccounts: [],
      accessRequests: [],
      batchItems: [{
        id: 'batch-item-1', batchId: 'batch-run-1', batch: { id: 'batch-run-1', description: 'Workshop identities' },
        accessRequestId: null, lifecycleOwnerKind: 'batch_item', accountType: 'AD', ldapUsername: 'PERSON1',
        status, mutationStage: 'processing', adAccountStatus: 'disabled',
      }],
    });

    expect(account.governance).toMatchObject({ ownerType: 'batch_account', batchAccountItemId: 'batch-item-1', bindingPosture: 'conflict' });
    expect(isInventoryGovernanceReady(account, 'delete')).toBe(false);
  });

  it('fails closed for duplicate standalone batch claims', () => {
    const [account] = buildLifecycleAccountInventory({
      directoryUsers: [directoryUser],
      vpnAccounts: [],
      accessRequests: [],
      batchItems: ['batch-item-1', 'batch-item-2'].map((id) => ({
        id, batchId: 'batch-run-1', batch: { id: 'batch-run-1', description: 'Workshop identities' },
        accessRequestId: null, lifecycleOwnerKind: 'batch_item', accountType: 'AD', ldapUsername: 'person1',
        status: 'completed', adAccountStatus: 'disabled',
      })),
    });

    expect(account.governance.bindingPosture).toBe('conflict');
    expect(account.governance.ownerType).toBeNull();
  });

  it('does not let a deleted batch AD projection claim a newly visible directory identity', () => {
    const [account] = buildLifecycleAccountInventory({
      directoryUsers: [directoryUser],
      vpnAccounts: [],
      accessRequests: [],
      batchItems: [{
        id: 'batch-item-1', batchId: 'batch-run-1', batch: { id: 'batch-run-1', description: 'Workshop identities' },
        accessRequestId: null, lifecycleOwnerKind: 'batch_item', accountType: 'AD', ldapUsername: 'person1',
        status: 'completed', adAccountStatus: 'deleted',
      }],
    });

    expect(account.governance).toMatchObject({ ownerType: null, bindingPosture: 'missing' });
  });

  it('carries the portal disabled-account audit evidence into the operator inventory', () => {
    const [account] = buildLifecycleAccountInventory({
      directoryUsers: [{ ...directoryUser, accountEnabled: false }],
      vpnAccounts: [],
      accessRequests: [{
        ...approvedRequest,
        adAccountStatus: 'disabled',
        adDisabledAt: new Date('2026-08-30T22:00:00.000Z'),
        adDisabledBy: 'operator1',
        adDisabledReason: 'Owner approved account retirement.',
      }],
    });

    expect(account.governance).toMatchObject({
      adAccountStatus: 'disabled',
      adDisabledAt: '2026-08-30T22:00:00.000Z',
      adDisabledBy: 'operator1',
      adDisabledReason: 'Owner approved account retirement.',
    });
  });

  it('marks duplicate lifecycle-ready portal owners as a conflict', () => {
    const [account] = buildLifecycleAccountInventory({
      directoryUsers: [directoryUser],
      vpnAccounts: [],
      accessRequests: [
        approvedRequest,
        { ...approvedRequest, id: 'request-2', createdAt: new Date('2026-02-01T00:00:00.000Z') },
      ],
    });

    expect(account.governance.bindingPosture).toBe('conflict');
    expect(account.governance.requestId).toBe('request-2');
  });

  it.each([
    ['ready request first', [
      approvedRequest,
      { ...approvedRequest, id: 'request-2', provisioningState: 'reconciliation_required', createdAt: new Date('2026-02-01T00:00:00.000Z') },
    ]],
    ['non-ready request first', [
      { ...approvedRequest, id: 'request-2', provisioningState: 'reconciliation_required', createdAt: new Date('2026-02-01T00:00:00.000Z') },
      approvedRequest,
    ]],
  ])('fails closed for mixed ready and non-ready owners regardless of order: %s', (_label, accessRequests) => {
    const [account] = buildLifecycleAccountInventory({
      directoryUsers: [directoryUser],
      vpnAccounts: [],
      accessRequests,
    });

    expect(account.governance.bindingPosture).toBe('conflict');
  });

  it('detects duplicate ownership across ldapUsername and linkedAdUsername aliases', () => {
    const [account] = buildLifecycleAccountInventory({
      directoryUsers: [directoryUser],
      vpnAccounts: [],
      accessRequests: [
        { ...approvedRequest, linkedAdUsername: null },
        {
          ...approvedRequest,
          id: 'request-2',
          ldapUsername: null,
          provisioningState: 'reconciliation_required',
          createdAt: new Date('2026-02-01T00:00:00.000Z'),
        },
      ],
    });

    expect(account.governance.bindingPosture).toBe('conflict');
  });

  it.each(['rejected', 'offboarded'])('ignores a historical %s request when one approved owner is current', (historicalStatus) => {
    const [account] = buildLifecycleAccountInventory({
      directoryUsers: [directoryUser],
      vpnAccounts: [],
      accessRequests: [
        { ...approvedRequest, id: 'historical-request', status: historicalStatus, createdAt: new Date('2025-01-01T00:00:00.000Z') },
        approvedRequest,
      ],
    });

    expect(account.governance).toMatchObject({ requestId: 'request-1', status: 'approved', bindingPosture: 'verified' });
  });

  it('keeps every VPN target visible when more than one maps to the same AD identity', () => {
    const accounts = buildLifecycleAccountInventory({
      directoryUsers: [directoryUser],
      vpnAccounts: [
        {
          id: 'vpn-1', username: 'vpn-person-one', adUsername: 'person1', name: 'Person One',
          email: 'person1@example.test', status: 'active', portalType: 'Management', accessRequestId: 'request-1',
        },
        {
          id: 'vpn-2', username: 'person-one-lab', adUsername: 'person1', name: 'Person One Lab',
          email: 'person1@example.test', status: 'active', portalType: 'Limited', accessRequestId: 'request-1',
        },
      ],
      accessRequests: [approvedRequest],
    });

    expect(accounts).toHaveLength(2);
    expect(accounts.map((account) => account.vpn?.username)).toEqual(expect.arrayContaining(['vpn-person-one', 'person-one-lab']));
    expect(accounts.filter((account) => account.vpn).every((account) => account.vpn?.relatedAccountCount === 2)).toBe(true);
  });

  it('does not merge a VPN account whose request contradicts its AD username', () => {
    const accounts = buildLifecycleAccountInventory({
      directoryUsers: [directoryUser],
      vpnAccounts: [{
        id: 'vpn-1', username: 'vpn-person-one', adUsername: 'someone-else', name: 'Person One',
        email: 'person1@example.test', status: 'active', portalType: 'Management', accessRequestId: 'request-1',
      }],
      accessRequests: [approvedRequest],
    });

    expect(accounts).toHaveLength(2);
    expect(accounts.find((account) => account.vpn)?.governance.bindingPosture).toBe('conflict');
    expect(accounts.find((account) => account.directory)?.vpn).toBeNull();
  });

  it('does not attach a VPN account when its request names a different VPN username', () => {
    const accounts = buildLifecycleAccountInventory({
      directoryUsers: [directoryUser],
      vpnAccounts: [{
        id: 'vpn-1', username: 'unexpected-vpn-name', adUsername: 'person1', name: 'Person One',
        email: 'person1@example.test', status: 'active', portalType: 'Management', accessRequestId: 'request-1',
      }],
      accessRequests: [approvedRequest],
    });

    expect(accounts).toHaveLength(2);
    expect(accounts.find((account) => account.directory)?.vpn).toBeNull();
    expect(accounts.find((account) => account.vpn)?.governance.bindingPosture).toBe('conflict');
  });

  it('treats a dangling VPN request id as a conflict instead of falling back by username', () => {
    const accounts = buildLifecycleAccountInventory({
      directoryUsers: [directoryUser],
      vpnAccounts: [{
        id: 'vpn-1', username: 'vpn-person-one', adUsername: 'person1', name: 'Person One',
        email: 'person1@example.test', status: 'active', portalType: 'Management', accessRequestId: 'missing-request',
      }],
      accessRequests: [approvedRequest],
    });

    expect(accounts.find((account) => account.directory)?.vpn).toBeNull();
    expect(accounts.find((account) => account.vpn)?.governance.bindingPosture).toBe('conflict');
  });

  it('does not attach an ungoverned VPN record to a governed AD row by username alone', () => {
    const accounts = buildLifecycleAccountInventory({
      directoryUsers: [directoryUser],
      vpnAccounts: [{
        id: 'vpn-1', username: 'person1', adUsername: null, name: 'Person One',
        email: 'person1@example.test', status: 'active', portalType: 'Management', accessRequestId: null,
      }],
      accessRequests: [approvedRequest],
    });

    expect(accounts).toHaveLength(2);
    expect(accounts.find((account) => account.directory)?.vpn).toBeNull();
  });

  it('recognizes an explicit, case-normalized VPN batch owner without joining it to an unowned AD account', () => {
    const accounts = buildLifecycleAccountInventory({
      directoryUsers: [directoryUser],
      vpnAccounts: [{
        id: 'vpn-1', username: 'VPN-PERSON-ONE', adUsername: 'person1', name: 'Person One',
        email: 'person1@example.test', status: 'revoked', portalType: 'Management', accessRequestId: null,
        batchAccountItemId: 'batch-vpn-1', batchId: 'batch-run-1',
      }],
      accessRequests: [],
      batchItems: [{
        id: 'batch-vpn-1', batchId: 'batch-run-1', batch: { id: 'batch-run-1', description: 'VPN identities' },
        accessRequestId: null, lifecycleOwnerKind: 'batch_item', accountType: 'VPN', ldapUsername: 'person1',
        vpnUsername: 'vpn-person-one', status: 'completed', mutationStage: 'completed',
      }],
    });

    expect(accounts).toHaveLength(2);
    expect(accounts.find((account) => account.directory)?.vpn).toBeNull();
    expect(accounts.find((account) => account.vpn)?.governance).toMatchObject({
      ownerType: 'batch_account', batchAccountItemId: 'batch-vpn-1', status: 'completed', bindingPosture: 'not_applicable',
    });
    expect(isInventoryGovernanceReady(accounts.find((account) => account.vpn)!, 'delete')).toBe(true);
  });

  it('keeps a legacy VPN batch provenance separate from an unowned AD row', () => {
    const accounts = buildLifecycleAccountInventory({
      directoryUsers: [directoryUser],
      vpnAccounts: [{
        id: 'vpn-1', username: 'vpn-person-one', adUsername: 'person1', name: 'Person One',
        email: 'person1@example.test', status: 'revoked', portalType: 'Management', accessRequestId: null, batchId: 'batch-run-1',
      }],
      accessRequests: [],
      batchItems: [{
        id: 'batch-vpn-1', batchId: 'batch-run-1', batch: { id: 'batch-run-1', description: 'VPN identities' },
        accessRequestId: null, lifecycleOwnerKind: 'batch_item', accountType: 'VPN', ldapUsername: 'person1',
        vpnUsername: 'vpn-person-one', status: 'completed', mutationStage: 'completed',
      }],
    });

    expect(accounts).toHaveLength(2);
    expect(accounts.find((account) => account.directory)?.vpn).toBeNull();
    expect(accounts.find((account) => account.vpn)).toMatchObject({
      governance: { ownerType: 'batch_account', batchAccountItemId: 'batch-vpn-1' },
      batchProvenance: { batchId: 'batch-run-1' },
    });
  });

  it('routes a legacy VPN username match without an internal request relation to review', () => {
    const accounts = buildLifecycleAccountInventory({
      directoryUsers: [],
      vpnAccounts: [{
        id: 'vpn-1', username: 'vpn-person-one', adUsername: 'person1', name: 'Person One',
        email: 'person1@example.test', status: 'active', portalType: 'Management', accessRequestId: null,
      }],
      accessRequests: [approvedRequest],
    });

    expect(accounts).toHaveLength(1);
    expect(accounts[0].governance).toMatchObject({ requestId: 'request-1', bindingPosture: 'conflict' });
  });

  it('chooses the request primary VPN target regardless of VPN input order', () => {
    const primary = {
      id: 'vpn-primary', username: 'vpn-person-one', adUsername: 'person1', name: 'Person One',
      email: 'person1@example.test', status: 'active', portalType: 'Management', accessRequestId: 'request-1',
    };
    const secondary = {
      id: 'vpn-secondary', username: 'person-one-lab', adUsername: 'person1', name: 'Person One Lab',
      email: 'person1@example.test', status: 'active', portalType: 'Limited', accessRequestId: 'request-1',
    };
    const linkedTargets = [[primary, secondary], [secondary, primary]].map((vpnAccounts) => (
      buildLifecycleAccountInventory({
        directoryUsers: [directoryUser],
        vpnAccounts,
        accessRequests: [approvedRequest],
      }).find((account) => account.directory)?.vpn?.username
    ));

    expect(linkedTargets).toEqual(['vpn-person-one', 'vpn-person-one']);
  });

  it('does not call a non-ready request a verified portal owner', () => {
    const [account] = buildLifecycleAccountInventory({
      directoryUsers: [directoryUser],
      vpnAccounts: [],
      accessRequests: [{ ...approvedRequest, provisioningState: 'reconciliation_required' }],
    });

    expect(account.governance.bindingPosture).toBe('conflict');
    expect(isInventoryGovernanceReady(account, 'disable')).toBe(false);
  });

  it('accepts one lifecycle-ready offboarded portal owner for restoration', () => {
    const [account] = buildLifecycleAccountInventory({
      directoryUsers: [directoryUser],
      vpnAccounts: [{
        id: 'vpn-1', username: 'vpn-person-one', adUsername: 'person1', name: 'Person One',
        email: 'person1@example.test', status: 'disabled', portalType: 'Management', accessRequestId: 'request-1',
      }],
      accessRequests: [{ ...approvedRequest, status: 'offboarded' }],
    });

    expect(account).toMatchObject({
      accountRef: 'ad:person1',
      vpn: { username: 'vpn-person-one' },
      governance: { status: 'offboarded', bindingPosture: 'verified' },
    });
    expect(isInventoryGovernanceReady(account, 'restore')).toBe(true);
  });

  it('marks a non-ready offboarded owner as a conflict instead of a missing-request exception', () => {
    const [account] = buildLifecycleAccountInventory({
      directoryUsers: [directoryUser],
      vpnAccounts: [],
      accessRequests: [{ ...approvedRequest, status: 'offboarded', provisioningState: 'reconciliation_required' }],
    });

    expect(account.governance).toMatchObject({ requestId: 'request-1', bindingPosture: 'conflict' });
  });

  it('fails closed when ready and non-ready offboarded records both claim the username', () => {
    const [account] = buildLifecycleAccountInventory({
      directoryUsers: [directoryUser],
      vpnAccounts: [],
      accessRequests: [
        { ...approvedRequest, status: 'offboarded' },
        { ...approvedRequest, id: 'request-2', status: 'offboarded', provisioningState: 'reconciliation_required' },
      ],
    });

    expect(account.governance.bindingPosture).toBe('conflict');
  });

  it('carries VPN restore permission into the lifecycle inventory', () => {
    const [account] = buildLifecycleAccountInventory({
      directoryUsers: [directoryUser],
      vpnAccounts: [{
        id: 'vpn-1', username: 'vpn-person-one', adUsername: 'person1', name: 'Person One',
        email: 'person1@example.test', status: 'revoked', portalType: 'Management', canRestore: false,
        accessRequestId: 'request-1',
      }],
      accessRequests: [approvedRequest],
    });

    expect(account.vpn).toMatchObject({ canRestore: false, relatedAccountCount: 1 });
  });

  it('does not call a consistently request-bound offboarded VPN account a link conflict when AD is absent', () => {
    const [account] = buildLifecycleAccountInventory({
      directoryUsers: [],
      vpnAccounts: [{
        id: 'vpn-1', username: 'vpn-person-one', adUsername: 'person1', name: 'Person One',
        email: 'person1@example.test', status: 'disabled', portalType: 'Management', accessRequestId: 'request-1',
      }],
      accessRequests: [{ ...approvedRequest, status: 'offboarded' }],
    });

    expect(account).toMatchObject({
      accountRef: 'vpn:vpn-person-one',
      directory: null,
      governance: { requestId: 'request-1', status: 'offboarded', bindingPosture: 'not_applicable' },
    });
  });
});
