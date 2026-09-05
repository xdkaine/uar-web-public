import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const tx = {
    $queryRaw: vi.fn(),
    accountLifecycleAction: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    accountLifecycleHistory: { create: vi.fn() },
    accountLifecycleBatch: { findUnique: vi.fn(), update: vi.fn() },
    accessRequest: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    batchAccountItem: { findUnique: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    batchAuditLog: { create: vi.fn() },
    aDAccountActivityLog: { create: vi.fn() },
    vPNAccount: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
    vPNAccountStatusLog: { findFirst: vi.fn(), create: vi.fn() },
    vPNAccountActivityLog: { create: vi.fn() },
    auditLog: { create: vi.fn() },
    moduleState: { findUnique: vi.fn() },
    requestComment: { create: vi.fn() },
    session: { count: vi.fn() },
    providerLogoutTask: { findMany: vi.fn() },
  };

  return {
    activeClaimId: '',
    tx,
    prisma: {
      accountLifecycleAction: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
      accountLifecycleHistory: { create: vi.fn() },
      accessRequest: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
      batchAccountItem: { findUnique: vi.fn(), findMany: vi.fn() },
      vPNAccount: { findUnique: vi.fn(), findMany: vi.fn() },
      session: { count: vi.fn() },
      providerLogoutTask: { findMany: vi.fn() },
      $transaction: vi.fn(),
    },
    disableLDAPUser: vi.fn(),
    disableConfirmedLDAPUser: vi.fn(),
    enableLDAPUser: vi.fn(),
    enableConfirmedLDAPUser: vi.fn(),
    deleteConfirmedDisabledLDAPUser: vi.fn(),
    appendADDescription: vi.fn(),
    searchLDAPUser: vi.fn(),
    assertLifecycleAccountNotProtected: vi.fn(),
    assertLifecycleGroupNotProtected: vi.fn(),
    getLDAPGroupMembers: vi.fn(),
    getLDAPGroupIdentity: vi.fn(),
    addLDAPGroupMember: vi.fn(),
    removeLDAPGroupMember: vi.fn(),
    appLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    logActionHistoryEvent: vi.fn(),
    revokeUserSessionsEverywhere: vi.fn(),
    assertExternalSideEffectAllowed: vi.fn(),
    moduleEnabled: vi.fn(),
  };
});

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }));

vi.mock('@/lib/ldap', () => ({
  disableLDAPUser: mocks.disableLDAPUser,
  disableConfirmedLDAPUser: mocks.disableConfirmedLDAPUser,
  enableLDAPUser: mocks.enableLDAPUser,
  enableConfirmedLDAPUser: mocks.enableConfirmedLDAPUser,
  deleteConfirmedDisabledLDAPUser: mocks.deleteConfirmedDisabledLDAPUser,
  appendADDescription: mocks.appendADDescription,
  searchLDAPUser: mocks.searchLDAPUser,
  getLDAPGroupMembers: mocks.getLDAPGroupMembers,
  getLDAPGroupIdentity: mocks.getLDAPGroupIdentity,
  addLDAPGroupMember: mocks.addLDAPGroupMember,
  removeLDAPGroupMember: mocks.removeLDAPGroupMember,
}));
vi.mock('@/lib/lifecycle-protection', () => ({
  assertLifecycleAccountNotProtected: mocks.assertLifecycleAccountNotProtected,
  assertLifecycleGroupNotProtected: mocks.assertLifecycleGroupNotProtected,
}));

vi.mock('@/lib/logger', () => ({ appLogger: mocks.appLogger }));

vi.mock('@/lib/action-history', () => ({
  logActionHistoryEvent: mocks.logActionHistoryEvent,
}));

// Manual offboarding must revoke sessions through the sanctioned ADR-0014
// bulk helper (portal rows + IdP backchannel), never a raw deleteMany.
vi.mock('@/lib/auth/provider-logout-audit', () => ({
  revokeUserSessionsEverywhere: mocks.revokeUserSessionsEverywhere,
}));
vi.mock('@/lib/clone-safety', () => ({
  assertExternalSideEffectAllowed: mocks.assertExternalSideEffectAllowed,
}));
vi.mock('@/lib/modules/core', () => ({
  isModuleEnabled: mocks.moduleEnabled,
  isModuleEnabledStrict: mocks.moduleEnabled,
  MODULE_STATE_LOCK_NAMESPACE: 639117,
}));

vi.mock('@/lib/audit-log', () => ({
  AuditActions: {
    DISABLE_AD_ACCOUNT: 'disable_ad_account',
    ENABLE_AD_ACCOUNT: 'enable_ad_account',
    DELETE_USER: 'delete_user',
    DELETE_VPN_ACCOUNT: 'delete_vpn_account',
    REVOKE_VPN_ACCESS: 'revoke_vpn_access',
    RESTORE_VPN_ACCESS: 'restore_vpn_access',
    PROMOTE_VPN_ROLE: 'promote_vpn_role',
    DEMOTE_VPN_ROLE: 'demote_vpn_role',
    PROCESS_LIFECYCLE_ACTION: 'process_lifecycle_action',
  },
  AuditCategories: { LIFECYCLE: 'lifecycle', VPN: 'vpn' },
}));

import { processLifecycleAction, processNextQueuedAction, retryFailedAction } from './lifecycle-processor';

function manualDisableBothAction(overrides: Record<string, unknown> = {}) {
  return {
    id: 'action-1',
    status: 'processing',
    actionType: 'disable_both',
    targetAccountType: 'BOTH',
    targetUsername: 'aduser',
    targetUserId: 'request-1',
    requestedBy: 'admin1',
    reason: 'manual offboard',
    relatedRequestId: 'request-1',
    relatedTicketId: null,
    notes: null,
    batchId: null,
    canRestore: true,
    offboardCampaignId: null,
    offboardCampaign: null,
    operationMode: 'governed',
    targetDirectoryDn: 'CN=aduser,OU=Users,DC=example,DC=test',
    targetDirectoryObjectGuid: 'guid-aduser',
    bindingFailureCode: null,
    preflightSnapshot: {
      relatedRequestId: 'request-1',
      objectGuid: 'guid-aduser',
      enabled: true,
    },
    authorizationEvidence: null,
    policyVersion: 'governed-directory-identity-v1',
    ...overrides,
  };
}

function accessRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: 'request-1',
    status: 'approved',
    name: 'AD User',
    email: 'aduser@example.test',
    adAccountStatus: 'active',
    provisioningState: 'completed',
    ldapUsername: 'aduser',
    linkedAdUsername: 'aduser',
    linkedVpnUsername: null,
    vpnUsername: null,
    version: 4,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.activeClaimId = '';
  mocks.prisma.$transaction.mockImplementation(async (callback: (tx: typeof mocks.tx) => Promise<unknown>) => callback(mocks.tx));
  mocks.prisma.accountLifecycleAction.updateMany.mockImplementation(async ({ data }: { data: { claimId?: string } }) => {
    if (data.claimId) mocks.activeClaimId = data.claimId;
    return { count: 1 };
  });
  mocks.prisma.accountLifecycleAction.findUnique.mockImplementation(async () =>
    manualDisableBothAction({ claimId: mocks.activeClaimId })
  );
  mocks.tx.$queryRaw.mockResolvedValue([{ lock_acquired: 'locked', id: 'request-1' }]);
  mocks.tx.accountLifecycleAction.findUnique.mockImplementation(async () => ({
    status: 'processing',
    claimId: mocks.activeClaimId,
    claimedUntil: new Date(Date.now() + 10 * 60 * 1000),
  }));
  mocks.tx.accountLifecycleAction.findFirst.mockResolvedValue(null);
  mocks.tx.accountLifecycleAction.updateMany.mockResolvedValue({ count: 1 });
  mocks.prisma.accessRequest.findUnique.mockResolvedValue(accessRequest());
  mocks.prisma.accessRequest.findFirst.mockResolvedValue(accessRequest());
  mocks.prisma.accessRequest.findMany.mockResolvedValue([accessRequest()]);
  mocks.tx.accessRequest.findUnique.mockImplementation((args) => mocks.prisma.accessRequest.findUnique(args));
  mocks.tx.accessRequest.findMany.mockImplementation((args) => mocks.prisma.accessRequest.findMany(args));
  mocks.prisma.batchAccountItem.findUnique.mockResolvedValue(null);
  mocks.prisma.batchAccountItem.findMany.mockResolvedValue([]);
  mocks.tx.batchAccountItem.findUnique.mockImplementation((args) => mocks.prisma.batchAccountItem.findUnique(args));
  mocks.tx.batchAccountItem.findMany.mockImplementation((args) => mocks.prisma.batchAccountItem.findMany(args));
  mocks.tx.batchAccountItem.updateMany.mockResolvedValue({ count: 1 });
  mocks.prisma.vPNAccount.findUnique.mockResolvedValue(null);
  mocks.prisma.vPNAccount.findMany.mockResolvedValue([]);
  mocks.prisma.session.count.mockResolvedValue(0);
  mocks.prisma.providerLogoutTask.findMany.mockResolvedValue([]);
  mocks.tx.session.count.mockResolvedValue(0);
  mocks.tx.providerLogoutTask.findMany.mockResolvedValue([]);
  mocks.tx.moduleState.findUnique.mockResolvedValue({ moduleId: 'vpn.management', enabled: true });
  mocks.deleteConfirmedDisabledLDAPUser.mockResolvedValue({
    dn: 'CN=aduser,OU=Users,DC=example,DC=test',
    objectGuid: 'guid-aduser',
    username: 'aduser',
    userAccountControl: 514,
  });
  mocks.assertLifecycleAccountNotProtected.mockResolvedValue(undefined);
  mocks.assertLifecycleGroupNotProtected.mockResolvedValue(undefined);
  mocks.addLDAPGroupMember.mockResolvedValue(true);
  mocks.removeLDAPGroupMember.mockResolvedValue(true);
  mocks.getLDAPGroupIdentity.mockResolvedValue({
    dn: 'CN=Research Users,OU=Groups,DC=example,DC=test',
    objectGuid: 'guid-research-users',
  });
  mocks.searchLDAPUser.mockResolvedValue({
    objectName: 'CN=aduser,OU=Users,DC=example,DC=test',
    attributes: [
      { type: 'sAMAccountName', values: ['aduser'] },
      { type: 'userAccountControl', values: ['512'] },
      { type: 'objectGUID', values: ['guid-aduser'] },
    ],
  });
  mocks.revokeUserSessionsEverywhere.mockResolvedValue({
    portalSessionsRevoked: 0,
    providerLogoutsAttempted: 0,
    providerSessionsDestroyed: 0,
  });
  mocks.tx.accessRequest.updateMany.mockResolvedValue({ count: 1 });
  mocks.assertExternalSideEffectAllowed.mockReturnValue(undefined);
  mocks.moduleEnabled.mockResolvedValue(true);
});

describe('processLifecycleAction request directory identity', () => {
  it('stops before an LDAP write when aliases diverge after the action was queued', async () => {
    mocks.prisma.accessRequest.findUnique.mockResolvedValue(accessRequest({
      ldapUsername: 'aduser', linkedAdUsername: 'reused-aduser',
    }));

    const result = await processLifecycleAction('action-1');

    expect(result).toMatchObject({ success: false, reconciliationRequired: false });
    expect(result.error).toContain('conflicting AD identity aliases');
    expect(mocks.disableConfirmedLDAPUser).not.toHaveBeenCalled();
    expect(mocks.appendADDescription).not.toHaveBeenCalled();
  });
});

describe('processLifecycleAction batch-governed AD state', () => {
  it('disables the bound directory object and advances the batch item instead of a request', async () => {
    const batchOwner = {
      id: 'batch-item-1', batchId: 'creation-batch-1', lifecycleOwnerKind: 'batch_item',
      accessRequestId: null, accountType: 'AD', status: 'completed', ldapUsername: 'aduser',
      name: 'AD User', email: 'aduser@example.test', version: 1, adAccountStatus: 'active',
      targetDirectoryDn: 'CN=aduser,OU=Users,DC=example,DC=test',
      targetDirectoryObjectGuid: 'guid-aduser',
    };
    mocks.prisma.accountLifecycleAction.findUnique.mockImplementation(async () => manualDisableBothAction({
      claimId: mocks.activeClaimId,
      actionType: 'disable_ad',
      targetAccountType: 'AD',
      targetUserId: 'batch-item-1',
      operationMode: 'batch_governed',
      relatedRequestId: null,
      relatedBatchAccountItemId: 'batch-item-1',
      policyVersion: 'batch-governed-directory-identity-v1',
      preflightSnapshot: {
        relatedBatchAccountItemId: 'batch-item-1', sourceBatchId: 'creation-batch-1',
        batchItemVersion: 1, objectGuid: 'guid-aduser', enabled: true,
      },
    }));
    mocks.prisma.accessRequest.findMany.mockResolvedValue([]);
    mocks.prisma.batchAccountItem.findUnique.mockResolvedValue(batchOwner);
    mocks.prisma.batchAccountItem.findMany.mockResolvedValue([{ id: 'batch-item-1' }]);
    mocks.searchLDAPUser
      .mockResolvedValueOnce({
        objectName: batchOwner.targetDirectoryDn,
        attributes: [
          { type: 'sAMAccountName', values: ['aduser'] },
          { type: 'userAccountControl', values: ['512'] },
          { type: 'objectGUID', values: ['guid-aduser'] },
        ],
      })
      .mockResolvedValueOnce({
        objectName: batchOwner.targetDirectoryDn,
        attributes: [
          { type: 'sAMAccountName', values: ['aduser'] },
          { type: 'userAccountControl', values: ['514'] },
          { type: 'objectGUID', values: ['guid-aduser'] },
        ],
      });

    const result = await processLifecycleAction('action-1');

    expect(result).toMatchObject({ success: true, adCompleted: true });
    expect(mocks.disableConfirmedLDAPUser).toHaveBeenCalledWith('aduser', {
      dn: batchOwner.targetDirectoryDn,
      objectGuid: 'guid-aduser',
    });
    expect(mocks.tx.batchAccountItem.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'batch-item-1', version: 1, adAccountStatus: 'active' },
      data: expect.objectContaining({ adAccountStatus: 'disabled', version: { increment: 1 } }),
    }));
    expect(mocks.tx.accessRequest.updateMany).not.toHaveBeenCalled();
  });

  it('stops before LDAP execution when a processing batch claim competes with the selected completed owner', async () => {
    const batchOwner = {
      id: 'batch-item-1', batchId: 'creation-batch-1', lifecycleOwnerKind: 'batch_item', accessRequestId: null,
      accountType: 'AD', status: 'completed', ldapUsername: 'aduser', version: 1, adAccountStatus: 'active',
      name: 'AD User', email: 'aduser@example.test',
      targetDirectoryDn: 'CN=aduser,OU=Users,DC=example,DC=test', targetDirectoryObjectGuid: 'guid-aduser',
    };
    mocks.prisma.accountLifecycleAction.findUnique.mockImplementation(async () => manualDisableBothAction({
      claimId: mocks.activeClaimId, actionType: 'disable_ad', targetAccountType: 'AD', targetUserId: 'batch-item-1',
      operationMode: 'batch_governed', relatedRequestId: null, relatedBatchAccountItemId: 'batch-item-1',
      policyVersion: 'batch-governed-directory-identity-v1',
      preflightSnapshot: { relatedBatchAccountItemId: 'batch-item-1', sourceBatchId: 'creation-batch-1', batchItemVersion: 1, enabled: true },
    }));
    mocks.prisma.accessRequest.findMany.mockResolvedValue([]);
    mocks.prisma.batchAccountItem.findUnique.mockResolvedValue(batchOwner);
    mocks.prisma.batchAccountItem.findMany.mockResolvedValue([{ id: 'batch-item-1' }, { id: 'batch-item-processing' }]);

    const result = await processLifecycleAction('action-1');

    expect(result).toMatchObject({ success: false, reconciliationRequired: false });
    expect(mocks.disableConfirmedLDAPUser).not.toHaveBeenCalled();
    expect(mocks.prisma.batchAccountItem.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: { in: ['processing', 'completed', 'reconciliation_required'] },
        OR: [{ adAccountStatus: null }, { adAccountStatus: { not: 'deleted' } }],
      }),
    }));
  });
});

describe('processLifecycleAction permanent AD deletion', () => {
  function deleteAction(overrides: Record<string, unknown> = {}) {
    return manualDisableBothAction({
      claimId: mocks.activeClaimId,
      actionType: 'delete_ad',
      targetAccountType: 'AD',
      canRestore: false,
      relatedTicketId: 'INC-1042',
      policyVersion: 'governed-directory-delete-v3',
      preflightSnapshot: {
        relatedRequestId: 'request-1',
        requestVersion: 4,
        objectGuid: 'guid-aduser',
        enabled: false,
      },
      authorizationEvidence: {
        destructiveAction: 'delete_ad',
        directoryDeletionMethod: 'same-connection-final-preflight-immutable-guid-v1',
        ticketReference: 'INC-1042',
        typedAcknowledgement: 'DELETE aduser',
        irreversibleImpactAcknowledged: true,
        actor: 'admin1',
        confirmedAt: '2026-08-31T00:00:00.000Z',
        safetyChecks: {
          singleAccountOnly: true,
          governedOperation: true,
          uniqueRequestOwnerVerified: true,
          requestLifecycleReady: true,
          portalDisabledVerified: true,
          liveDirectoryDisabledVerified: true,
          protectedAccountPolicyPassed: true,
          immutableIdentityCaptured: true,
          irreversibleImpactAcknowledged: true,
        },
      },
      ...overrides,
    });
  }

  const disabledDirectoryUser = {
    objectName: 'CN=aduser,OU=Users,DC=example,DC=test',
    attributes: [
      { type: 'sAMAccountName', values: ['aduser'] },
      { type: 'userAccountControl', values: ['514'] },
      { type: 'objectGUID', values: ['guid-aduser'] },
    ],
  };

  it('deletes one governed disabled account and records the durable projection', async () => {
    mocks.prisma.accountLifecycleAction.findUnique.mockImplementation(async () => deleteAction());
    mocks.prisma.accessRequest.findUnique.mockResolvedValue(accessRequest({ adAccountStatus: 'disabled' }));
    mocks.prisma.accessRequest.findMany.mockResolvedValue([accessRequest({ adAccountStatus: 'disabled' })]);
    mocks.searchLDAPUser.mockResolvedValue(disabledDirectoryUser);

    const result = await processLifecycleAction('action-1');

    expect(result).toMatchObject({ success: true, adCompleted: true });
    expect(mocks.deleteConfirmedDisabledLDAPUser).toHaveBeenCalledWith(
      'aduser',
      { dn: 'CN=aduser,OU=Users,DC=example,DC=test', objectGuid: 'guid-aduser' },
      expect.any(Function),
      expect.any(Function)
    );
    expect(mocks.tx.accessRequest.updateMany).toHaveBeenCalledWith({
      where: { id: 'request-1', adAccountStatus: 'disabled', version: 4 },
      data: { adAccountStatus: 'deleted', version: { increment: 1 } },
    });
    expect(mocks.tx.aDAccountActivityLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ actionType: 'deleted', ldapSuccess: true }),
    }));
    expect(mocks.tx.requestComment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: 'ad_account_deleted' }),
    }));
    expect(mocks.tx.accountLifecycleAction.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        resultSnapshot: expect.objectContaining({
          safetyChecks: expect.objectContaining({
            confirmationEvidenceValidated: true,
            portalDisabledRevalidated: true,
            immutableGuidDeleteTargetApplied: true,
            capturedGuidAbsentAfterDelete: true,
          }),
        }),
      }),
    }));
  });

  it('rejects permanent deletion when a request retains a divergent alias after confirmation', async () => {
    mocks.prisma.accountLifecycleAction.findUnique.mockImplementation(async () => deleteAction());
    const owner = accessRequest({ adAccountStatus: 'disabled', linkedAdUsername: 'old-reused-name' });
    mocks.prisma.accessRequest.findUnique.mockResolvedValue(owner);
    mocks.prisma.accessRequest.findMany.mockResolvedValue([owner]);
    mocks.searchLDAPUser.mockResolvedValue(disabledDirectoryUser);

    const result = await processLifecycleAction('action-1');

    expect(result).toMatchObject({ success: false, reconciliationRequired: false });
    expect(result.error).toContain('conflicting AD identity aliases');
    expect(mocks.deleteConfirmedDisabledLDAPUser).not.toHaveBeenCalled();
    expect(mocks.tx.accessRequest.updateMany).not.toHaveBeenCalled();
  });

  it('deletes one batch-governed disabled account and advances the batch-item CAS', async () => {
    const batchOwner = {
      id: 'batch-item-1',
      batchId: 'creation-batch-1',
      lifecycleOwnerKind: 'batch_item',
      accessRequestId: null,
      accountType: 'AD',
      status: 'completed',
      ldapUsername: 'aduser',
      name: 'AD User',
      email: 'aduser@example.test',
      version: 2,
      adAccountStatus: 'disabled',
      targetDirectoryDn: 'CN=aduser,OU=Users,DC=example,DC=test',
      targetDirectoryObjectGuid: 'guid-aduser',
    };
    mocks.prisma.accountLifecycleAction.findUnique.mockImplementation(async () => deleteAction({
      operationMode: 'batch_governed',
      targetUserId: 'batch-item-1',
      relatedRequestId: null,
      relatedBatchAccountItemId: 'batch-item-1',
      policyVersion: 'batch-governed-directory-delete-v2',
      preflightSnapshot: {
        relatedBatchAccountItemId: 'batch-item-1',
        sourceBatchId: 'creation-batch-1',
        batchItemVersion: 2,
        objectGuid: 'guid-aduser',
        enabled: false,
      },
      authorizationEvidence: {
        destructiveAction: 'delete_ad',
        directoryDeletionMethod: 'same-connection-final-preflight-immutable-guid-v1',
        ticketReference: 'INC-1042',
        typedAcknowledgement: 'DELETE aduser',
        irreversibleImpactAcknowledged: true,
        actor: 'admin1',
        confirmedAt: '2026-09-04T00:00:00.000Z',
        safetyChecks: {
          singleAccountOnly: true,
          batchGovernedOperation: true,
          uniqueBatchOwnerVerified: true,
          batchLifecycleReady: true,
          portalDisabledVerified: true,
          liveDirectoryDisabledVerified: true,
          protectedAccountPolicyPassed: true,
          immutableIdentityCaptured: true,
          irreversibleImpactAcknowledged: true,
        },
      },
    }));
    mocks.prisma.accessRequest.findMany.mockResolvedValue([]);
    mocks.prisma.batchAccountItem.findUnique.mockResolvedValue(batchOwner);
    mocks.prisma.batchAccountItem.findMany.mockResolvedValue([{ id: 'batch-item-1' }]);
    mocks.searchLDAPUser.mockResolvedValue(disabledDirectoryUser);

    const result = await processLifecycleAction('action-1');

    expect(result).toMatchObject({ success: true, adCompleted: true });
    expect(mocks.tx.batchAccountItem.updateMany).toHaveBeenCalledWith({
      where: { id: 'batch-item-1', version: 2, adAccountStatus: 'disabled' },
      data: { adAccountStatus: 'deleted', version: { increment: 1 } },
    });
    expect(mocks.tx.batchAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ batchId: 'creation-batch-1', action: 'ad_account_deleted' }),
    }));
    expect(mocks.tx.requestComment.create).not.toHaveBeenCalled();
  });

  it('deletes a reviewed disabled unmanaged account without fabricating a request record', async () => {
    mocks.prisma.accountLifecycleAction.findUnique.mockImplementation(async () => deleteAction({
      operationMode: 'directory_override',
      relatedRequestId: null,
      targetUserId: null,
      batchId: 'plan-1',
      policyVersion: 'unmanaged-directory-delete-v2',
      preflightSnapshot: { objectGuid: 'guid-aduser', enabled: false },
      authorizationEvidence: {
        destructiveAction: 'delete_ad',
        directoryDeletionMethod: 'same-connection-final-preflight-immutable-guid-v1',
        ticketReference: 'INC-1042',
        typedAcknowledgement: 'DELETE 2 ACCOUNTS / 2 RECORDS',
        irreversibleImpactAcknowledged: true,
        actor: 'admin1',
        confirmedAt: '2026-09-04T00:00:00.000Z',
        bulkPlanId: 'plan-1',
        selectionDigest: 'digest-1',
        targetCount: 2,
        recordCount: 2,
        safetyChecks: {
          reviewedPlan: true,
          unmanagedOperation: true,
          noPortalOwnerVerified: true,
          liveDirectoryDisabledVerified: true,
          protectedAccountPolicyPassed: true,
          immutableIdentityCaptured: true,
          irreversibleImpactAcknowledged: true,
        },
      },
    }));
    mocks.prisma.accessRequest.findMany.mockResolvedValue([]);
    mocks.searchLDAPUser.mockResolvedValue(disabledDirectoryUser);

    const result = await processLifecycleAction('action-1');

    expect(result).toMatchObject({ success: true, adCompleted: true });
    expect(mocks.deleteConfirmedDisabledLDAPUser).toHaveBeenCalledTimes(1);
    expect(mocks.tx.accessRequest.updateMany).not.toHaveBeenCalled();
    expect(mocks.tx.aDAccountActivityLog.create).not.toHaveBeenCalled();
    expect(mocks.tx.requestComment.create).not.toHaveBeenCalled();
  });

  it('blocks deletion when the recorded confirmation checklist is incomplete', async () => {
    mocks.prisma.accountLifecycleAction.findUnique.mockImplementation(async () => deleteAction({
      authorizationEvidence: {
        destructiveAction: 'delete_ad',
        ticketReference: 'INC-1042',
        typedAcknowledgement: 'DELETE aduser',
        irreversibleImpactAcknowledged: true,
        actor: 'admin1',
        safetyChecks: { singleAccountOnly: true },
      },
    }));

    const result = await processLifecycleAction('action-1');

    expect(result).toMatchObject({ success: false, reconciliationRequired: false });
    expect(mocks.deleteConfirmedDisabledLDAPUser).not.toHaveBeenCalled();
  });

  it('blocks deletion when the access-request version changed after confirmation', async () => {
    mocks.prisma.accountLifecycleAction.findUnique.mockImplementation(async () => deleteAction());
    mocks.prisma.accessRequest.findUnique.mockResolvedValue(accessRequest({ adAccountStatus: 'disabled', version: 5 }));
    mocks.prisma.accessRequest.findMany.mockResolvedValue([accessRequest({ adAccountStatus: 'disabled', version: 5 })]);
    mocks.searchLDAPUser.mockResolvedValue(disabledDirectoryUser);

    const result = await processLifecycleAction('action-1');

    expect(result).toMatchObject({ success: false, reconciliationRequired: false });
    expect(mocks.deleteConfirmedDisabledLDAPUser).not.toHaveBeenCalled();
  });

  it('prefers the current approved owner over a historical offboarded request', async () => {
    const currentOwner = accessRequest({ adAccountStatus: 'disabled' });
    const historicalOwner = accessRequest({
      id: 'request-old',
      status: 'offboarded',
      adAccountStatus: 'deleted',
    });
    mocks.prisma.accountLifecycleAction.findUnique.mockImplementation(async () => deleteAction());
    mocks.prisma.accessRequest.findUnique.mockResolvedValue(currentOwner);
    mocks.prisma.accessRequest.findMany.mockImplementation(async ({ where }: {
      where: { status?: { in?: string[]; notIn?: string[] } | string };
    }) => {
      if (typeof where.status === 'object' && where.status.in) return [currentOwner, historicalOwner];
      if (typeof where.status === 'object' && where.status.notIn) return [currentOwner];
      return [historicalOwner];
    });
    mocks.searchLDAPUser.mockResolvedValue(disabledDirectoryUser);

    const result = await processLifecycleAction('action-1');

    expect(result).toMatchObject({ success: true, adCompleted: true });
    expect(mocks.deleteConfirmedDisabledLDAPUser).toHaveBeenCalledTimes(1);
  });

  it('blocks deletion when a second active but non-ready request claims the username', async () => {
    const currentOwner = accessRequest({ adAccountStatus: 'disabled' });
    const conflictingOwner = accessRequest({
      id: 'request-2',
      provisioningState: 'reconciliation_required',
      adAccountStatus: 'disabled',
    });
    mocks.prisma.accountLifecycleAction.findUnique.mockImplementation(async () => deleteAction());
    mocks.prisma.accessRequest.findUnique.mockResolvedValue(currentOwner);
    mocks.prisma.accessRequest.findMany.mockResolvedValue([currentOwner, conflictingOwner]);
    mocks.searchLDAPUser.mockResolvedValue(disabledDirectoryUser);

    const result = await processLifecycleAction('action-1');

    expect(result).toMatchObject({ success: false, reconciliationRequired: false });
    expect(mocks.deleteConfirmedDisabledLDAPUser).not.toHaveBeenCalled();
  });

  it('blocks deletion when the portal record no longer says disabled', async () => {
    mocks.prisma.accountLifecycleAction.findUnique.mockImplementation(async () => deleteAction());
    mocks.prisma.accessRequest.findUnique.mockResolvedValue(accessRequest({ adAccountStatus: 'active' }));

    const result = await processLifecycleAction('action-1');

    expect(result).toMatchObject({ success: false, reconciliationRequired: false });
    expect(mocks.deleteConfirmedDisabledLDAPUser).not.toHaveBeenCalled();
  });

  it('does not execute an AD deletion confirmed under the earlier method', async () => {
    mocks.prisma.accountLifecycleAction.findUnique.mockImplementation(async () => deleteAction({
      policyVersion: 'governed-directory-delete-v2',
      authorizationEvidence: {},
    }));

    const result = await processLifecycleAction('action-1');

    expect(result).toMatchObject({ success: false, reconciliationRequired: false, error: expect.stringContaining('earlier deletion method') });
    expect(mocks.deleteConfirmedDisabledLDAPUser).not.toHaveBeenCalled();
  });

  it('requires reconciliation after the irreversible delete call begins', async () => {
    mocks.prisma.accountLifecycleAction.findUnique.mockImplementation(async () => deleteAction());
    mocks.prisma.accessRequest.findUnique.mockResolvedValue(accessRequest({ adAccountStatus: 'disabled' }));
    mocks.prisma.accessRequest.findMany.mockResolvedValue([accessRequest({ adAccountStatus: 'disabled' })]);
    mocks.searchLDAPUser.mockResolvedValue(disabledDirectoryUser);
    mocks.deleteConfirmedDisabledLDAPUser.mockImplementationOnce(async (_username, _identity, onDeleteStart) => {
      onDeleteStart();
      throw new Error('LDAP delete outcome is unknown');
    });

    const result = await processLifecycleAction('action-1');

    expect(result).toMatchObject({
      success: false,
      reconciliationRequired: true,
      error: 'LDAP delete outcome is unknown',
    });
    expect(mocks.tx.accountLifecycleAction.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        resultSnapshot: expect.objectContaining({
          stage: 'ldap_delete_boundary_entered_outcome_unknown',
          safetyChecks: expect.objectContaining({
            governingRequestRowLocked: true,
            immutableGuidDeleteTargetPrepared: true,
          }),
        }),
      }),
    }));
  });

  it('commits the LDAP-boundary checkpoint before waiting for the LDAP outcome', async () => {
    let releaseLdap!: () => void;
    let boundaryEntered!: () => void;
    const atBoundary = new Promise<void>((resolve) => { boundaryEntered = resolve; });
    const ldapPending = new Promise<void>((resolve) => { releaseLdap = resolve; });
    mocks.prisma.accountLifecycleAction.findUnique.mockImplementation(async () => deleteAction());
    mocks.prisma.accessRequest.findUnique.mockResolvedValue(accessRequest({ adAccountStatus: 'disabled' }));
    mocks.prisma.accessRequest.findMany.mockResolvedValue([accessRequest({ adAccountStatus: 'disabled' })]);
    mocks.searchLDAPUser.mockResolvedValue(disabledDirectoryUser);
    mocks.deleteConfirmedDisabledLDAPUser.mockImplementationOnce(async (_username, identity, onDeleteStart) => {
      await onDeleteStart();
      boundaryEntered();
      await ldapPending;
      throw new Error('Simulated worker interruption after LDAP boundary');
    });

    const processing = processLifecycleAction('action-1');
    await atBoundary;
    expect(mocks.prisma.accountLifecycleAction.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'action-1', status: 'processing' }),
      data: {
        resultSnapshot: expect.objectContaining({
          stage: 'ldap_delete_boundary_entered_outcome_unknown',
          safetyChecks: expect.objectContaining({ immutableGuidDeleteTargetPrepared: true }),
        }),
      },
    }));

    releaseLdap();
    await expect(processing).resolves.toMatchObject({ success: false, reconciliationRequired: true });
  });

  it('does not enter LDAP until the governing request row lock is acquired', async () => {
    let releaseRequestLock!: () => void;
    let requestLockStarted!: () => void;
    const requestLockEntered = new Promise<void>((resolve) => { requestLockStarted = resolve; });
    const requestLockPending = new Promise<Array<{ id: string }>>((resolve) => {
      releaseRequestLock = () => resolve([{ id: 'request-1' }]);
    });
    mocks.prisma.accountLifecycleAction.findUnique.mockImplementation(async () => deleteAction());
    mocks.prisma.accessRequest.findUnique.mockResolvedValue(accessRequest({ adAccountStatus: 'disabled' }));
    mocks.prisma.accessRequest.findMany.mockResolvedValue([accessRequest({ adAccountStatus: 'disabled' })]);
    mocks.searchLDAPUser.mockResolvedValue(disabledDirectoryUser);
    mocks.tx.$queryRaw
      .mockResolvedValueOnce([{ lock_acquired: 'locked' }])
      .mockResolvedValueOnce([{ lock_acquired: 'locked' }])
      .mockImplementationOnce(async () => {
        requestLockStarted();
        return requestLockPending;
      });

    const processing = processLifecycleAction('action-1');
    await requestLockEntered;
    expect(mocks.deleteConfirmedDisabledLDAPUser).not.toHaveBeenCalled();

    releaseRequestLock();
    await expect(processing).resolves.toMatchObject({ success: true });

    const requestLockCall = mocks.tx.$queryRaw.mock.calls.find((call) =>
      String(call[0]).includes('FROM "AccessRequest"')
    );
    const requestLockSql = String(requestLockCall?.[0]);
    expect(requestLockSql).toContain('LOWER("ldapUsername")');
    expect(requestLockSql).toContain('LOWER("linkedAdUsername")');
    expect(requestLockSql).toContain('FOR UPDATE');
  });

  it('blocks at execution when another delete for the captured GUID is active', async () => {
    mocks.prisma.accountLifecycleAction.findUnique.mockImplementation(async () => deleteAction());
    mocks.prisma.accessRequest.findUnique.mockResolvedValue(accessRequest({ adAccountStatus: 'disabled' }));
    mocks.prisma.accessRequest.findMany.mockResolvedValue([accessRequest({ adAccountStatus: 'disabled' })]);
    mocks.searchLDAPUser.mockResolvedValue(disabledDirectoryUser);
    mocks.tx.accountLifecycleAction.findFirst.mockResolvedValue({ id: 'delete-2', status: 'reconciliation_required' });

    const result = await processLifecycleAction('action-1');

    expect(result).toMatchObject({ success: false, reconciliationRequired: false });
    expect(mocks.deleteConfirmedDisabledLDAPUser).not.toHaveBeenCalled();
  });

  it('does not requeue a failed deletion while another deletion is active', async () => {
    const failedDelete = deleteAction({ status: 'failed', claimId: null });
    mocks.prisma.accountLifecycleAction.findUnique.mockResolvedValue(failedDelete);
    mocks.tx.accountLifecycleAction.findUnique.mockResolvedValue(failedDelete);
    mocks.tx.accountLifecycleAction.findFirst.mockResolvedValue({ id: 'delete-2', status: 'queued' });

    await expect(retryFailedAction('action-1')).resolves.toBe(false);

    expect(mocks.tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(mocks.tx.accountLifecycleAction.updateMany).not.toHaveBeenCalled();
  });

  it('requires GUID reconciliation when the captured object disappeared before the portal delete call', async () => {
    mocks.prisma.accountLifecycleAction.findUnique.mockImplementation(async () => deleteAction());
    mocks.prisma.accessRequest.findUnique.mockResolvedValue(accessRequest({ adAccountStatus: 'disabled' }));
    mocks.prisma.accessRequest.findMany.mockResolvedValue([accessRequest({ adAccountStatus: 'disabled' })]);
    mocks.searchLDAPUser.mockResolvedValue(null);

    const result = await processLifecycleAction('action-1');

    expect(result).toMatchObject({ success: false, reconciliationRequired: true });
    expect(mocks.deleteConfirmedDisabledLDAPUser).not.toHaveBeenCalled();
  });

  it('requires reconciliation when the portal disabled-state CAS changes after LDAP deletion', async () => {
    mocks.prisma.accountLifecycleAction.findUnique.mockImplementation(async () => deleteAction());
    mocks.prisma.accessRequest.findUnique.mockResolvedValue(accessRequest({ adAccountStatus: 'disabled' }));
    mocks.prisma.accessRequest.findMany.mockResolvedValue([accessRequest({ adAccountStatus: 'disabled' })]);
    mocks.searchLDAPUser.mockResolvedValue(disabledDirectoryUser);
    mocks.tx.accessRequest.updateMany.mockResolvedValueOnce({ count: 0 });
    mocks.deleteConfirmedDisabledLDAPUser.mockImplementationOnce(async (_username, identity, onDeleteStart) => {
      onDeleteStart();
      return { ...identity, username: 'aduser', userAccountControl: 514 };
    });

    const result = await processLifecycleAction('action-1');

    expect(result).toMatchObject({ success: false, reconciliationRequired: true });
  });

  it('blocks deletion while sessions or provider logout work remains', async () => {
    mocks.prisma.accountLifecycleAction.findUnique.mockImplementation(async () => deleteAction());
    mocks.prisma.accessRequest.findUnique.mockResolvedValue(accessRequest({ adAccountStatus: 'disabled' }));
    mocks.prisma.accessRequest.findMany.mockResolvedValue([accessRequest({ adAccountStatus: 'disabled' })]);
    mocks.searchLDAPUser.mockResolvedValue(disabledDirectoryUser);
    mocks.tx.session.count.mockResolvedValue(1);

    const result = await processLifecycleAction('action-1');

    expect(result).toMatchObject({ success: false, reconciliationRequired: false });
    expect(mocks.tx.session.count).toHaveBeenCalledWith({
      where: { username: { equals: 'aduser', mode: 'insensitive' } },
    });
    expect(mocks.deleteConfirmedDisabledLDAPUser).not.toHaveBeenCalled();
  });

  it('fences a worker whose claim expired before it acquired the directory execution lock', async () => {
    mocks.prisma.accountLifecycleAction.findUnique.mockImplementation(async () => deleteAction());
    mocks.tx.accountLifecycleAction.findUnique.mockResolvedValueOnce({
      status: 'reconciliation_required',
      claimId: null,
      claimedUntil: null,
    });

    const result = await processLifecycleAction('action-1');

    expect(result).toMatchObject({ success: false, reconciliationRequired: false });
    expect(mocks.deleteConfirmedDisabledLDAPUser).not.toHaveBeenCalled();
  });

  it('does not begin LDAP deletion until the shared directory execution fence is acquired', async () => {
    let releaseLock!: () => void;
    const lockPending = new Promise<Array<{ lock_acquired: string }>>((resolve) => {
      releaseLock = () => resolve([{ lock_acquired: 'locked' }]);
    });
    mocks.prisma.accountLifecycleAction.findUnique.mockImplementation(async () => deleteAction());
    mocks.prisma.accessRequest.findUnique.mockResolvedValue(accessRequest({ adAccountStatus: 'disabled' }));
    mocks.prisma.accessRequest.findMany.mockResolvedValue([accessRequest({ adAccountStatus: 'disabled' })]);
    mocks.searchLDAPUser.mockResolvedValue(disabledDirectoryUser);
    mocks.tx.$queryRaw.mockReturnValueOnce(lockPending);

    const processing = processLifecycleAction('action-1');
    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.deleteConfirmedDisabledLDAPUser).not.toHaveBeenCalled();

    releaseLock();
    await processing;
    expect(mocks.deleteConfirmedDisabledLDAPUser).toHaveBeenCalledTimes(1);
  });
});

describe('stale directory claim recovery', () => {
  it('does not revoke a stale claim while its directory execution fence is held', async () => {
    mocks.prisma.accountLifecycleAction.findMany.mockResolvedValue([{
      id: 'action-1', actionType: 'delete_ad', targetUsername: 'aduser',
    }]);
    mocks.prisma.accountLifecycleAction.findFirst.mockResolvedValue(null);
    mocks.tx.$queryRaw.mockResolvedValueOnce([{ lock_acquired: false }]);

    await expect(processNextQueuedAction()).resolves.toBeNull();

    expect(mocks.tx.accountLifecycleAction.updateMany).not.toHaveBeenCalled();
  });

  it('moves an expired directory claim to reconciliation after acquiring the fence', async () => {
    mocks.prisma.accountLifecycleAction.findMany.mockResolvedValue([{
      id: 'action-1', actionType: 'delete_ad', targetUsername: 'aduser',
    }]);
    mocks.prisma.accountLifecycleAction.findFirst.mockResolvedValue(null);
    mocks.tx.$queryRaw.mockResolvedValueOnce([{ lock_acquired: true }]);

    await expect(processNextQueuedAction()).resolves.toBeNull();

    expect(mocks.tx.accountLifecycleAction.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'action-1', status: 'processing' }),
      data: expect.objectContaining({ status: 'reconciliation_required', claimId: null }),
    }));
  });

  it('objectively fails an expired VPN deletion claim when the live record remains', async () => {
    mocks.prisma.accountLifecycleAction.findMany.mockResolvedValue([{
      id: 'action-vpn-1', actionType: 'delete_vpn_record', targetUsername: 'vpnuser', targetUserId: 'vpn-1',
    }]);
    mocks.prisma.accountLifecycleAction.findFirst.mockResolvedValue(null);
    mocks.tx.$queryRaw.mockResolvedValueOnce([{ lock_acquired: true }]);
    mocks.tx.vPNAccount.findUnique.mockResolvedValue({ id: 'vpn-1', username: 'vpnuser', status: 'revoked' });

    await expect(processNextQueuedAction()).resolves.toBeNull();

    expect(mocks.tx.accountLifecycleAction.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'action-vpn-1', status: 'processing' }),
      data: expect.objectContaining({ status: 'failed', claimId: null }),
    }));
  });
});

describe('processLifecycleAction permanent VPN record deletion', () => {
  function vpnDeleteAction(overrides: Record<string, unknown> = {}) {
    return manualDisableBothAction({
      claimId: mocks.activeClaimId,
      actionType: 'delete_vpn_record',
      targetAccountType: 'VPN',
      targetUsername: 'vpnuser',
      targetUserId: 'vpn-1',
      relatedRequestId: null,
      relatedTicketId: 'CHG-2042',
      canRestore: false,
      policyVersion: 'vpn-record-delete-v1',
      preflightSnapshot: {
        vpnAccountId: 'vpn-1',
        username: 'vpnuser',
        status: 'revoked',
        revokedAt: '2026-08-30T20:00:00.000Z',
        revokedBy: 'admin0',
        revokedReason: 'Expired access',
        latestStatusLogId: 'vpn-status-1',
        latestStatus: 'revoked',
        accessRequestId: null,
        accessRequestVersion: null,
        activeRequestClaimantIds: [],
      },
      authorizationEvidence: {
        typedAcknowledgement: 'DELETE VPN RECORD vpnuser',
        irreversibleImpactAcknowledged: true,
      },
      ...overrides,
    });
  }

  it('requires a new reviewed confirmation instead of retrying a failed permanent deletion', async () => {
    mocks.prisma.accountLifecycleAction.findUnique.mockResolvedValue(
      vpnDeleteAction({ status: 'failed', claimId: null })
    );

    await expect(retryFailedAction('action-1')).resolves.toBe(false);

    expect(mocks.tx.accountLifecycleAction.updateMany).not.toHaveBeenCalled();
  });

  it('deletes only the live row and retains deletion evidence in one transaction', async () => {
    const action = vpnDeleteAction();
    mocks.prisma.accountLifecycleAction.findUnique.mockImplementation(async () => ({
      ...action,
      claimId: mocks.activeClaimId,
    }));
    mocks.tx.vPNAccount.findUnique.mockResolvedValue({
      id: 'vpn-1', username: 'vpnuser', name: 'VPN User', email: 'vpn@example.test',
      status: 'revoked', portalType: 'Limited', accessRequestId: null,
      revokedAt: new Date('2026-08-30T20:00:00.000Z'), revokedBy: 'admin0', revokedReason: 'Expired access',
    });
    mocks.tx.vPNAccountStatusLog.findFirst.mockResolvedValue({
      id: 'vpn-status-1', accountId: 'vpn-1', newStatus: 'revoked', createdAt: new Date('2026-08-30T20:00:00.000Z'),
    });
    mocks.tx.accessRequest.findMany.mockResolvedValue([]);
    mocks.tx.vPNAccount.delete.mockResolvedValue({ id: 'vpn-1' });

    const result = await processLifecycleAction('action-1');

    expect(result.error).toBeUndefined();
    expect(result).toMatchObject({ success: true, vpnCompleted: true });
    expect(mocks.tx.vPNAccountStatusLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ accountId: 'vpn-1', liveAccountId: 'vpn-1', oldStatus: 'revoked', newStatus: 'deleted' }),
    }));
    expect(mocks.tx.vPNAccountActivityLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ accountId: 'vpn-1', actionType: 'deleted', lifecycleActionId: 'action-1' }),
    }));
    expect(mocks.tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'delete_vpn_account', relatedVpnAccountId: 'vpn-1' }),
    }));
    expect(mocks.tx.vPNAccount.delete).toHaveBeenCalledWith({ where: { id: 'vpn-1' } });
    expect(mocks.tx.accountLifecycleAction.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'completed', vpnDisabled: true }),
    }));
  });

  it('stops before deleting when a processing VPN batch claim appears after confirmation', async () => {
    const action = vpnDeleteAction();
    mocks.prisma.accountLifecycleAction.findUnique.mockImplementation(async () => ({ ...action, claimId: mocks.activeClaimId }));
    mocks.tx.vPNAccount.findUnique.mockResolvedValue({
      id: 'vpn-1', username: 'vpnuser', name: 'VPN User', email: null,
      status: 'revoked', portalType: 'Limited', accessRequestId: null,
      revokedAt: new Date('2026-08-30T20:00:00.000Z'), revokedBy: 'admin0', revokedReason: 'Expired access',
    });
    mocks.tx.vPNAccountStatusLog.findFirst.mockResolvedValue({ id: 'vpn-status-1', accountId: 'vpn-1', newStatus: 'revoked' });
    mocks.tx.accessRequest.findMany.mockResolvedValue([]);
    mocks.tx.batchAccountItem.findMany.mockResolvedValue([{
      id: 'vpn-batch-1', batchId: 'batch-1', lifecycleOwnerKind: 'batch_item', accessRequestId: null,
      accountType: 'VPN', status: 'processing', ldapUsername: 'vpnuser', vpnUsername: 'vpnuser', version: 1,
    }]);

    const result = await processLifecycleAction('action-1');

    expect(result).toMatchObject({ success: false, reconciliationRequired: false });
    expect(mocks.tx.vPNAccount.delete).not.toHaveBeenCalled();
    expect(mocks.tx.batchAccountItem.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: { in: ['processing', 'completed', 'reconciliation_required'] } }),
    }));
  });

  it('fails a queued VPN child before lookup when its combined plan uses the earlier AD method', async () => {
    const action = vpnDeleteAction({
      batchId: 'plan-1',
      batch: {
        id: 'plan-1',
        policyVersion: 'reviewed-lifecycle-deletion-plan-v1',
        authorizationEvidence: { action: 'delete_both_records' },
      },
    });
    mocks.prisma.accountLifecycleAction.findUnique.mockImplementation(async () => ({
      ...action,
      claimId: mocks.activeClaimId,
    }));

    const result = await processLifecycleAction('action-1');

    expect(result).toMatchObject({ success: false, reconciliationRequired: false, error: expect.stringContaining('earlier AD deletion method') });
    expect(mocks.tx.vPNAccount.findUnique).not.toHaveBeenCalled();
    expect(mocks.tx.vPNAccount.delete).not.toHaveBeenCalled();
  });

  it('fails closed when the latest status evidence is not revoked', async () => {
    const action = vpnDeleteAction();
    mocks.prisma.accountLifecycleAction.findUnique.mockImplementation(async () => ({
      ...action,
      claimId: mocks.activeClaimId,
    }));
    mocks.tx.vPNAccount.findUnique.mockResolvedValue({
      id: 'vpn-1', username: 'vpnuser', name: 'VPN User', email: null,
      status: 'revoked', portalType: 'Limited', accessRequestId: null,
      revokedAt: new Date(), revokedBy: 'admin0', revokedReason: 'Expired access',
    });
    mocks.tx.vPNAccountStatusLog.findFirst.mockResolvedValue({ id: 'vpn-status-2', newStatus: 'active' });

    const result = await processLifecycleAction('action-1');

    expect(result).toMatchObject({ success: false, reconciliationRequired: false });
    expect(mocks.tx.vPNAccount.delete).not.toHaveBeenCalled();
  });

  it('invalidates an old confirmation after the account is restored and revoked again', async () => {
    const action = vpnDeleteAction();
    mocks.prisma.accountLifecycleAction.findUnique.mockImplementation(async () => ({
      ...action,
      claimId: mocks.activeClaimId,
    }));
    mocks.tx.vPNAccount.findUnique.mockResolvedValue({
      id: 'vpn-1', username: 'vpnuser', name: 'VPN User', email: null,
      status: 'revoked', portalType: 'Limited', accessRequestId: null,
      revokedAt: new Date('2026-08-31T20:00:00.000Z'), revokedBy: 'admin2', revokedReason: 'Revoked again',
    });
    mocks.tx.vPNAccountStatusLog.findFirst.mockResolvedValue({ id: 'vpn-status-2', newStatus: 'revoked' });
    mocks.tx.accessRequest.findMany.mockResolvedValue([]);

    const result = await processLifecycleAction('action-1');

    expect(result).toMatchObject({ success: false, reconciliationRequired: false });
    expect(mocks.tx.vPNAccount.delete).not.toHaveBeenCalled();
  });

  it('invalidates an unlinked confirmation when a request is linked before execution', async () => {
    const action = vpnDeleteAction();
    mocks.prisma.accountLifecycleAction.findUnique.mockImplementation(async () => ({
      ...action,
      claimId: mocks.activeClaimId,
    }));
    mocks.tx.vPNAccount.findUnique.mockResolvedValue({
      id: 'vpn-1', username: 'vpnuser', name: 'VPN User', email: null,
      status: 'revoked', portalType: 'Limited', accessRequestId: 'request-2',
      revokedAt: new Date('2026-08-30T20:00:00.000Z'), revokedBy: 'admin0', revokedReason: 'Expired access',
    });
    mocks.tx.vPNAccountStatusLog.findFirst.mockResolvedValue({ id: 'vpn-status-1', newStatus: 'revoked' });
    mocks.tx.accessRequest.findMany.mockResolvedValue([{ id: 'request-2', version: 2 }]);

    const result = await processLifecycleAction('action-1');

    expect(result).toMatchObject({ success: false, reconciliationRequired: false });
    expect(mocks.tx.vPNAccount.delete).not.toHaveBeenCalled();
    expect(mocks.tx.accessRequest.updateMany).not.toHaveBeenCalled();
  });

  it('fails before deletion when the VPN module is disabled under the shared fence', async () => {
    const action = vpnDeleteAction();
    mocks.prisma.accountLifecycleAction.findUnique.mockImplementation(async () => ({
      ...action,
      claimId: mocks.activeClaimId,
    }));
    mocks.tx.moduleState.findUnique.mockResolvedValue({ moduleId: 'vpn.management', enabled: false });

    const result = await processLifecycleAction('action-1');

    expect(result).toMatchObject({ success: false, reconciliationRequired: false });
    expect(mocks.tx.vPNAccount.delete).not.toHaveBeenCalled();
  });
});

describe('processLifecycleAction manual offboarding', () => {
  it('does not execute external side effects when another worker owns the claim', async () => {
    mocks.prisma.accountLifecycleAction.updateMany.mockResolvedValue({ count: 0 });
    mocks.prisma.accountLifecycleAction.findUnique.mockResolvedValue(
      manualDisableBothAction({ claimId: 'other-worker', claimedUntil: new Date(Date.now() + 60_000) })
    );

    await expect(processLifecycleAction('action-1')).rejects.toThrow('is not ready for processing');

    expect(mocks.disableLDAPUser).not.toHaveBeenCalled();
    expect(mocks.tx.vPNAccount.update).not.toHaveBeenCalled();
  });

  it('fails before LDAP mutation when immutable directory evidence is absent', async () => {
    mocks.prisma.accountLifecycleAction.findUnique.mockImplementation(async () => manualDisableBothAction({
      claimId: mocks.activeClaimId,
      targetDirectoryDn: null,
      targetDirectoryObjectGuid: null,
      preflightSnapshot: null,
      policyVersion: null,
    }));

    const result = await processLifecycleAction('action-1');

    expect(result).toMatchObject({
      success: false,
      reconciliationRequired: false,
      error: 'Directory identity evidence is missing for access request request-1',
    });
    expect(mocks.disableLDAPUser).not.toHaveBeenCalled();
  });

  it('processes a unique portal owner against the confirmed AD object', async () => {
    mocks.prisma.accountLifecycleAction.findUnique.mockImplementation(async () => manualDisableBothAction({
      claimId: mocks.activeClaimId,
      actionType: 'disable_ad',
      targetAccountType: 'AD',
      targetDirectoryDn: 'CN=aduser,OU=Users,DC=example,DC=test',
      targetDirectoryObjectGuid: 'guid-aduser',
      bindingFailureCode: null,
      preflightSnapshot: { relatedRequestId: 'request-1', objectGuid: 'guid-aduser', enabled: true },
      policyVersion: 'governed-directory-identity-v1',
    }));
    mocks.prisma.accessRequest.findMany.mockResolvedValue([accessRequest({
      ldapUsername: 'aduser', linkedAdUsername: 'aduser',
    })]);
    mocks.searchLDAPUser
      .mockResolvedValueOnce({
        objectName: 'CN=aduser,OU=Users,DC=example,DC=test',
        attributes: [
          { type: 'sAMAccountName', values: ['aduser'] },
          { type: 'userAccountControl', values: ['512'] },
          { type: 'objectGUID', values: ['guid-aduser'] },
        ],
      })
      .mockResolvedValueOnce({
        objectName: 'CN=aduser,OU=Users,DC=example,DC=test',
        attributes: [
          { type: 'sAMAccountName', values: ['aduser'] },
          { type: 'userAccountControl', values: ['514'] },
          { type: 'objectGUID', values: ['guid-aduser'] },
        ],
      });

    const result = await processLifecycleAction('action-1');

    expect(result).toMatchObject({ success: true, adCompleted: true });
    expect(mocks.disableConfirmedLDAPUser).toHaveBeenCalledWith('aduser', {
      dn: 'CN=aduser,OU=Users,DC=example,DC=test',
      objectGuid: 'guid-aduser',
    });
  });

  it('does not classify clone-mode preflight rejection as an uncertain external mutation', async () => {
    mocks.assertExternalSideEffectAllowed.mockImplementationOnce(() => {
      throw new Error('External ldap-write side effects are disabled in production-clone read-only mode');
    });

    const result = await processLifecycleAction('action-1');

    expect(result).toMatchObject({ success: false, reconciliationRequired: false });
    expect(mocks.disableLDAPUser).not.toHaveBeenCalled();
  });

  it('revokes a linked VPN username and marks the request offboarded', async () => {
    const request = accessRequest({ linkedVpnUsername: 'vpnuser' });
    const vpnAccount = {
      id: 'vpn-1',
      username: 'vpnuser',
      status: 'active',
      accessRequestId: null,
      name: 'VPN User',
      email: 'vpnuser@example.test',
    };

    mocks.prisma.accessRequest.findUnique.mockResolvedValue(request);
    mocks.prisma.vPNAccount.findUnique.mockImplementation(async ({ where }: { where: { username: string } }) => (
      where.username === 'vpnuser' ? vpnAccount : null
    ));
    mocks.searchLDAPUser
      .mockResolvedValueOnce({
        objectName: 'CN=aduser,OU=Users,DC=example,DC=test',
        attributes: [
          { type: 'sAMAccountName', values: ['aduser'] },
          { type: 'userAccountControl', values: ['512'] },
          { type: 'objectGUID', values: ['guid-aduser'] },
        ],
      })
      .mockResolvedValueOnce({
        objectName: 'CN=aduser,OU=Users,DC=example,DC=test',
        attributes: [
          { type: 'sAMAccountName', values: ['aduser'] },
          { type: 'userAccountControl', values: ['514'] },
          { type: 'objectGUID', values: ['guid-aduser'] },
        ],
      });
    // Two portal rows revoked, one carried a live IdP session that was destroyed.
    mocks.revokeUserSessionsEverywhere.mockResolvedValue({
      portalSessionsRevoked: 2,
      providerLogoutsAttempted: 1,
      providerSessionsDestroyed: 1,
    });

    const result = await processLifecycleAction('action-1');

    expect(result).toMatchObject({ success: true, adCompleted: true, vpnCompleted: true });
    expect(mocks.disableConfirmedLDAPUser).toHaveBeenCalledWith('aduser', {
      dn: 'CN=aduser,OU=Users,DC=example,DC=test',
      objectGuid: 'guid-aduser',
    });
    expect(mocks.tx.vPNAccount.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'vpn-1' },
      data: expect.objectContaining({ status: 'revoked', revokedBy: 'admin1' }),
    }));
    expect(mocks.tx.accessRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'request-1', status: 'approved' },
      data: expect.objectContaining({ status: 'offboarded' }),
    }));
    expect(mocks.tx.requestComment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ requestId: 'request-1', type: 'manual_offboard' }),
    }));
    expect(mocks.revokeUserSessionsEverywhere).toHaveBeenCalledWith('aduser', expect.objectContaining({
      actor: 'system:lifecycle',
      actorType: 'system',
      reason: 'lifecycle_disable',
    }));

    const completedHistory = mocks.tx.accountLifecycleHistory.create.mock.calls.find(([call]) => call.data.event === 'completed')?.[0];
    expect(JSON.parse(completedHistory.data.details)).toMatchObject({
      linkedVpnUsername: 'vpnuser',
      manualOffboard: { requestMarkedOffboarded: true, accessRequestId: 'request-1' },
      sessionCleanup: { deletedSessions: 2, providerLogoutsAttempted: 1, providerSessionsDestroyed: 1 },
    });
  });

  it('completes AD-only offboarding when no linked VPN exists', async () => {
    const normallyApprovedRequest = accessRequest({ provisioningState: null });
    mocks.prisma.accessRequest.findUnique.mockResolvedValue(normallyApprovedRequest);
    mocks.prisma.accessRequest.findFirst.mockResolvedValue(normallyApprovedRequest);
    mocks.searchLDAPUser
      .mockResolvedValueOnce({
        objectName: 'CN=aduser,OU=Users,DC=example,DC=test',
        attributes: [
          { type: 'sAMAccountName', values: ['aduser'] },
          { type: 'userAccountControl', values: ['512'] },
          { type: 'objectGUID', values: ['guid-aduser'] },
        ],
      })
      .mockResolvedValueOnce({
        objectName: 'CN=aduser,OU=Users,DC=example,DC=test',
        attributes: [
          { type: 'sAMAccountName', values: ['aduser'] },
          { type: 'userAccountControl', values: ['514'] },
          { type: 'objectGUID', values: ['guid-aduser'] },
        ],
      });

    const result = await processLifecycleAction('action-1');

    expect(result).toMatchObject({ success: true, adCompleted: true, vpnCompleted: false });
    expect(mocks.tx.vPNAccount.update).not.toHaveBeenCalled();
    expect(mocks.tx.accessRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'offboarded' }),
    }));

    const completedHistory = mocks.tx.accountLifecycleHistory.create.mock.calls.find(([call]) => call.data.event === 'completed')?.[0];
    expect(JSON.parse(completedHistory.data.details)).toMatchObject({
      linkedVpnUsername: null,
      linkedVpnSkippedReason: 'no_linked_vpn_account',
      manualOffboard: { requestMarkedOffboarded: true },
    });
  });

  it('requires reconciliation when directory mutation returns an unknown outcome', async () => {
    mocks.disableConfirmedLDAPUser.mockRejectedValueOnce(new Error('LDAP operation timed out after 10000ms'));

    const result = await processLifecycleAction('action-1');

    expect(result).toMatchObject({
      success: false,
      reconciliationRequired: true,
      error: 'LDAP operation timed out after 10000ms',
    });
    expect(mocks.tx.accountLifecycleAction.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'reconciliation_required',
        claimId: null,
        claimedUntil: null,
      }),
    }));
    expect(mocks.tx.accountLifecycleHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        event: 'reconciliation_required',
        newStatus: 'reconciliation_required',
      }),
    });
  });
});

describe('processLifecycleAction directory override', () => {
  it('disables an unlinked directory account and requires successful readback', async () => {
    mocks.prisma.accessRequest.findMany.mockResolvedValue([]);
    mocks.prisma.accountLifecycleAction.findUnique.mockImplementation(async () => manualDisableBothAction({
      claimId: mocks.activeClaimId,
      actionType: 'disable_ad',
      targetAccountType: 'AD',
      operationMode: 'directory_override',
      targetDirectoryDn: 'CN=aduser,OU=Users,DC=example,DC=test',
      bindingFailureCode: 'DIRECTORY_REQUEST_BINDING_MISSING',
      preflightSnapshot: { accessRequestId: null, objectGuid: 'guid-aduser' },
      authorizationEvidence: { ticketReference: 'INC-1042' },
      policyVersion: 'directory-override-v1',
      relatedRequestId: null,
      relatedTicketId: 'INC-1042',
      targetUserId: null,
    }));
    mocks.searchLDAPUser
      .mockResolvedValueOnce({
        objectName: 'CN=aduser,OU=Users,DC=example,DC=test',
        attributes: [{ type: 'sAMAccountName', values: ['aduser'] }, { type: 'userAccountControl', values: ['512'] }, { type: 'objectGUID', values: ['guid-aduser'] }],
      })
      .mockResolvedValueOnce({
        objectName: 'CN=aduser,OU=Users,DC=example,DC=test',
        attributes: [{ type: 'sAMAccountName', values: ['aduser'] }, { type: 'userAccountControl', values: ['514'] }, { type: 'objectGUID', values: ['guid-aduser'] }],
      });

    const result = await processLifecycleAction('action-1');

    expect(result).toMatchObject({ success: true, adCompleted: true });
    expect(mocks.disableConfirmedLDAPUser).toHaveBeenCalledWith('aduser', {
      dn: 'CN=aduser,OU=Users,DC=example,DC=test',
      objectGuid: 'guid-aduser',
    });
    expect(mocks.revokeUserSessionsEverywhere).toHaveBeenCalledWith('aduser', expect.any(Object));
    expect(mocks.tx.accessRequest.update).not.toHaveBeenCalled();
    expect(mocks.tx.aDAccountActivityLog.create).not.toHaveBeenCalled();
    expect(mocks.tx.accountLifecycleAction.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ resultSnapshot: expect.any(Object), status: 'completed' }),
    }));
  });

  it('blocks a directory administrator before any external mutation', async () => {
    mocks.prisma.accessRequest.findMany.mockResolvedValue([]);
    mocks.prisma.accountLifecycleAction.findUnique.mockImplementation(async () => manualDisableBothAction({
      claimId: mocks.activeClaimId,
      actionType: 'disable_ad',
      targetAccountType: 'AD',
      operationMode: 'directory_override',
      targetDirectoryDn: 'CN=aduser,OU=Users,DC=example,DC=test',
      bindingFailureCode: 'DIRECTORY_REQUEST_BINDING_MISSING',
      preflightSnapshot: { accessRequestId: null, objectGuid: 'guid-aduser' },
      authorizationEvidence: { ticketReference: 'INC-1042' },
      relatedRequestId: null,
      relatedTicketId: 'INC-1042',
    }));
    mocks.assertLifecycleAccountNotProtected.mockRejectedValue(new Error('Protected directory administrator account'));

    const result = await processLifecycleAction('action-1');

    expect(result).toMatchObject({ success: false, reconciliationRequired: false });
    expect(mocks.disableLDAPUser).not.toHaveBeenCalled();
  });

  it('blocks an override when a batch owner appears before execution', async () => {
    mocks.prisma.accessRequest.findMany.mockResolvedValue([]);
    mocks.prisma.batchAccountItem.findMany.mockResolvedValue([{ id: 'batch-item-1' }]);
    mocks.prisma.accountLifecycleAction.findUnique.mockImplementation(async () => manualDisableBothAction({
      claimId: mocks.activeClaimId,
      actionType: 'disable_ad',
      targetAccountType: 'AD',
      operationMode: 'directory_override',
      targetDirectoryDn: 'CN=aduser,OU=Users,DC=example,DC=test',
      bindingFailureCode: 'DIRECTORY_REQUEST_BINDING_MISSING',
      preflightSnapshot: { accessRequestId: null, objectGuid: 'guid-aduser' },
      authorizationEvidence: { ticketReference: 'INC-1042' },
      policyVersion: 'directory-override-v1',
      relatedRequestId: null,
      relatedTicketId: 'INC-1042',
      targetUserId: null,
    }));

    const result = await processLifecycleAction('action-1');

    expect(result).toMatchObject({ success: false, reconciliationRequired: false });
    expect(mocks.disableConfirmedLDAPUser).not.toHaveBeenCalled();
    expect(mocks.searchLDAPUser).not.toHaveBeenCalled();
  });
});

describe('processLifecycleAction group identity binding', () => {
  function groupAction(overrides: Record<string, unknown> = {}) {
    return manualDisableBothAction({
      claimId: mocks.activeClaimId,
      actionType: 'add_group_member',
      targetAccountType: 'AD',
      targetGroupDn: 'CN=Research Users,OU=Groups,DC=example,DC=test',
      targetGroupObjectGuid: 'guid-research-users',
      targetDirectoryDn: 'CN=aduser,OU=Users,DC=example,DC=test',
      targetDirectoryObjectGuid: 'guid-aduser',
      relatedRequestId: null,
      targetUserId: null,
      ...overrides,
    });
  }

  it('rejects a group deleted and recreated at the saved DN', async () => {
    mocks.prisma.accountLifecycleAction.findUnique.mockImplementation(async () => groupAction());
    mocks.getLDAPGroupIdentity.mockResolvedValue({
      dn: 'CN=Research Users,OU=Groups,DC=example,DC=test',
      objectGuid: 'replacement-group-guid',
    });

    const result = await processLifecycleAction('action-1');

    expect(result).toMatchObject({ success: false, reconciliationRequired: false });
    expect(mocks.assertLifecycleGroupNotProtected).not.toHaveBeenCalled();
    expect(mocks.addLDAPGroupMember).not.toHaveBeenCalled();
  });

  it('rejects a username rebound to a different directory principal', async () => {
    mocks.prisma.accountLifecycleAction.findUnique.mockImplementation(async () => groupAction());
    mocks.searchLDAPUser.mockResolvedValue({
      objectName: 'CN=aduser,OU=Replacement Users,DC=example,DC=test',
      attributes: [{ type: 'objectGUID', values: ['replacement-user-guid'] }],
    });

    const result = await processLifecycleAction('action-1');

    expect(result).toMatchObject({ success: false, reconciliationRequired: false });
    expect(mocks.addLDAPGroupMember).not.toHaveBeenCalled();
  });

  it('rechecks protected ancestry under the worker claim before mutation', async () => {
    mocks.prisma.accountLifecycleAction.findUnique.mockImplementation(async () => groupAction());
    mocks.assertLifecycleGroupNotProtected.mockRejectedValue(
      new Error('Administrative and privilege-bearing groups cannot be changed')
    );

    const result = await processLifecycleAction('action-1');

    expect(result).toMatchObject({ success: false, reconciliationRequired: false });
    expect(mocks.assertLifecycleGroupNotProtected).toHaveBeenCalledWith(
      'CN=Research Users,OU=Groups,DC=example,DC=test'
    );
    expect(mocks.addLDAPGroupMember).not.toHaveBeenCalled();
  });

  it.each([
    ['add_group_member', 'addLDAPGroupMember'],
    ['remove_from_group', 'removeLDAPGroupMember'],
  ] as const)('requires reconciliation when member identity changes after %s', async (actionType, mutationMock) => {
    mocks.prisma.accountLifecycleAction.findUnique.mockImplementation(async () => groupAction({ actionType }));
    mocks.searchLDAPUser
      .mockResolvedValueOnce({
        objectName: 'CN=aduser,OU=Users,DC=example,DC=test',
        attributes: [{ type: 'objectGUID', values: ['guid-aduser'] }],
      })
      .mockResolvedValueOnce({
        objectName: 'CN=aduser,OU=Users,DC=example,DC=test',
        attributes: [{ type: 'objectGUID', values: ['replacement-user-guid'] }],
      });
    mocks.getLDAPGroupMembers.mockResolvedValue(
      actionType === 'add_group_member'
        ? [{ dn: 'CN=aduser,OU=Users,DC=example,DC=test' }]
        : []
    );

    const result = await processLifecycleAction('action-1');

    expect(result).toMatchObject({
      success: false,
      reconciliationRequired: true,
      error: 'Directory readback resolved a different member than the confirmed target',
    });
    expect(mocks[mutationMock]).toHaveBeenCalledTimes(1);
  });
});
