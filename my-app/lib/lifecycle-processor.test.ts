import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const tx = {
    accountLifecycleAction: { update: vi.fn() },
    accountLifecycleHistory: { create: vi.fn() },
    accountLifecycleBatch: { findUnique: vi.fn(), update: vi.fn() },
    accessRequest: { update: vi.fn(), updateMany: vi.fn() },
    aDAccountActivityLog: { create: vi.fn() },
    vPNAccount: { update: vi.fn() },
    vPNAccountStatusLog: { create: vi.fn() },
    vPNAccountActivityLog: { create: vi.fn() },
    requestComment: { create: vi.fn() },
  };

  return {
    tx,
    prisma: {
      accountLifecycleAction: { findUnique: vi.fn(), update: vi.fn() },
      accountLifecycleHistory: { create: vi.fn() },
      accessRequest: { findUnique: vi.fn(), findFirst: vi.fn() },
      vPNAccount: { findUnique: vi.fn(), findMany: vi.fn() },
      session: { deleteMany: vi.fn() },
      $transaction: vi.fn(),
    },
    disableLDAPUser: vi.fn(),
    enableLDAPUser: vi.fn(),
    appendADDescription: vi.fn(),
    appLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    logActionHistoryEvent: vi.fn(),
  };
});

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }));

vi.mock('@/lib/ldap', () => ({
  disableLDAPUser: mocks.disableLDAPUser,
  enableLDAPUser: mocks.enableLDAPUser,
  appendADDescription: mocks.appendADDescription,
}));

vi.mock('@/lib/logger', () => ({ appLogger: mocks.appLogger }));

vi.mock('@/lib/action-history', () => ({
  logActionHistoryEvent: mocks.logActionHistoryEvent,
}));

vi.mock('@/lib/audit-log', () => ({
  AuditActions: {
    DISABLE_AD_ACCOUNT: 'disable_ad_account',
    ENABLE_AD_ACCOUNT: 'enable_ad_account',
    REVOKE_VPN_ACCESS: 'revoke_vpn_access',
    RESTORE_VPN_ACCESS: 'restore_vpn_access',
    PROMOTE_VPN_ROLE: 'promote_vpn_role',
    DEMOTE_VPN_ROLE: 'demote_vpn_role',
    PROCESS_LIFECYCLE_ACTION: 'process_lifecycle_action',
  },
  AuditCategories: { LIFECYCLE: 'lifecycle' },
}));

import { processLifecycleAction } from './lifecycle-processor';

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
    linkedVpnUsername: null,
    vpnUsername: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.$transaction.mockImplementation(async (callback: (tx: typeof mocks.tx) => Promise<unknown>) => callback(mocks.tx));
  mocks.prisma.accountLifecycleAction.findUnique.mockResolvedValue(manualDisableBothAction());
  mocks.prisma.accessRequest.findUnique.mockResolvedValue(accessRequest());
  mocks.prisma.accessRequest.findFirst.mockResolvedValue(accessRequest());
  mocks.prisma.vPNAccount.findUnique.mockResolvedValue(null);
  mocks.prisma.vPNAccount.findMany.mockResolvedValue([]);
  mocks.prisma.session.deleteMany.mockResolvedValue({ count: 0 });
  mocks.tx.accessRequest.updateMany.mockResolvedValue({ count: 1 });
});

describe('processLifecycleAction manual offboarding', () => {
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
    mocks.prisma.session.deleteMany.mockResolvedValue({ count: 2 });

    const result = await processLifecycleAction('action-1');

    expect(result).toMatchObject({ success: true, adCompleted: true, vpnCompleted: true });
    expect(mocks.disableLDAPUser).toHaveBeenCalledWith('aduser');
    expect(mocks.tx.vPNAccount.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { username: 'vpnuser' },
      data: expect.objectContaining({ status: 'revoked', revokedBy: 'admin1' }),
    }));
    expect(mocks.tx.accessRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'request-1', status: 'approved' },
      data: expect.objectContaining({ status: 'offboarded' }),
    }));
    expect(mocks.tx.requestComment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ requestId: 'request-1', type: 'manual_offboard' }),
    }));
    expect(mocks.prisma.session.deleteMany).toHaveBeenCalledWith({ where: { username: 'aduser' } });

    const completedHistory = mocks.tx.accountLifecycleHistory.create.mock.calls.find(([call]) => call.data.event === 'completed')?.[0];
    expect(JSON.parse(completedHistory.data.details)).toMatchObject({
      linkedVpnUsername: 'vpnuser',
      manualOffboard: { requestMarkedOffboarded: true, accessRequestId: 'request-1' },
      sessionCleanup: { deletedSessions: 2 },
    });
  });

  it('completes AD-only offboarding when no linked VPN exists', async () => {
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
});
