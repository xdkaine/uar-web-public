import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sendOffboardReminderEmail: vi.fn(),
  sendOffboardExtensionReminderEmail: vi.fn(),
  sendOffboardDirectCompletedEmail: vi.fn(),
  listUsersInOU: vi.fn(),
  searchLDAPUser: vi.fn(),
  processLifecycleAction: vi.fn(),
  revokeUserSessionsEverywhere: vi.fn(),
  prisma: {
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    offboardCampaign: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    offboardCampaignRecipient: {
      count: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      createMany: vi.fn(),
      groupBy: vi.fn(),
    },
    offboardCampaignRecipientToken: {
      create: vi.fn(),
      deleteMany: vi.fn(),
      updateMany: vi.fn(),
    },
    offboardCampaignExtensionReminder: {
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    offboardCampaignExtension: {
      findMany: vi.fn(),
    },
    offboardCampaignLog: {
      create: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    accountLifecycleAction: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    accountLifecycleHistory: {
      create: vi.fn(),
    },
    offboardOperationRun: {
      updateMany: vi.fn(),
    },
    offboardOperationRunItem: {
      updateMany: vi.fn(),
      groupBy: vi.fn(),
    },
    session: {
      count: vi.fn(),
      deleteMany: vi.fn(),
    },
    providerLogoutTask: {
      findMany: vi.fn(),
    },
    vPNAccount: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    vpnIdentityOffboardFence: {
      upsert: vi.fn(),
    },
    accessRequest: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    requestComment: {
      create: vi.fn(),
    },
    systemConfigEntry: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}));

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('@/lib/ldap', () => ({
  listUsersInOU: mocks.listUsersInOU,
  searchLDAPUser: mocks.searchLDAPUser,
}));
vi.mock('@/lib/email', () => ({
  sendOffboardInitialEmail: vi.fn(),
  sendOffboardReminderEmail: mocks.sendOffboardReminderEmail,
  sendOffboardExtensionEmail: vi.fn(),
  sendOffboardExtensionReminderEmail: mocks.sendOffboardExtensionReminderEmail,
  sendOffboardDirectCompletedEmail: mocks.sendOffboardDirectCompletedEmail,
}));
vi.mock('@/lib/modules/core', () => ({
  isModuleEnabled: vi.fn().mockResolvedValue(true),
  isModuleEnabledStrict: vi.fn().mockResolvedValue(true),
}));
vi.mock('@/lib/lifecycle-processor', () => ({
  processLifecycleAction: mocks.processLifecycleAction,
}));
vi.mock('@/lib/auth/provider-logout-audit', () => ({
  revokeUserSessionsEverywhere: mocks.revokeUserSessionsEverywhere,
}));
vi.mock('@/lib/logger', () => ({
  appLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@/lib/audit-log', () => ({
  AuditActions: {
    OFFBOARD_CAMPAIGN_EVENT: 'offboard_campaign_event',
    OFFBOARD_REMINDER_SENT: 'offboard_reminder_sent',
  },
  AuditCategories: { OFFBOARD_CAMPAIGN: 'offboard_campaign' },
  sanitizeAuditDetails: (value: unknown) => value,
}));

import {
  activateOffboardCampaign,
  createOffboardDryRun,
  processOffboardCampaigns,
  reconcileOffboardEnforcement,
} from './offboard-campaign';
import { clearConfigCache } from './config/resolver';

const NOW = new Date('2026-06-12T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

beforeEach(() => {
  clearConfigCache();
  mocks.prisma.systemConfigEntry.findMany.mockResolvedValue([]);
});

function matchesDateFilter(value: Date, filter: { gt?: Date; lte?: Date } | undefined) {
  if (!filter) return true;
  if (filter.gt && value <= filter.gt) return false;
  if (filter.lte && value > filter.lte) return false;
  return true;
}

function configureProcessor(recipient: {
  id: string;
  initialEmailSentAt: Date;
  deadlineAt: Date;
  activeExtension?: boolean;
}, options: {
  enforcementPaused?: boolean;
  remindersPaused?: boolean;
} = {}) {
  const campaign = {
    id: 'campaign-1',
    status: 'active',
    sendingPaused: true,
    remindersPaused: options.remindersPaused ?? false,
    enforcementPaused: options.enforcementPaused ?? true,
    cancelledAt: null,
    emergencyStoppedAt: null,
  };

  mocks.prisma.offboardCampaign.findMany.mockResolvedValue([campaign]);
  mocks.prisma.offboardCampaign.findUnique.mockResolvedValue(campaign);
  mocks.prisma.offboardCampaignRecipient.count.mockResolvedValue(1);
  mocks.prisma.offboardCampaignRecipient.updateMany.mockImplementation(async ({ where }) => (
    where.status === 'email_sending' ? { count: 0 } : { count: 1 }
  ));
  mocks.prisma.offboardCampaignRecipient.findMany.mockImplementation(async ({ where }) => {
    const reminderQuery = where.reminder3SentAt === null || where.reminder6SentAt === null;
    if (!reminderQuery) return [];
    if (recipient.activeExtension && where.extensions?.none) return [];

    return matchesDateFilter(recipient.deadlineAt, where.deadlineAt)
      && matchesDateFilter(recipient.initialEmailSentAt, where.initialEmailSentAt)
      ? [{
          ...recipient,
          campaignId: campaign.id,
          status: 'sent',
          verifiedAt: null,
          enforcedAt: null,
          email: 'recipient@example.test',
          displayName: 'Recipient',
          adUsername: 'recipient',
          linkedVpnUsername: null,
        }]
      : [];
  });
  mocks.prisma.offboardCampaignRecipient.findUnique.mockResolvedValue({
    adUsername: 'recipient',
    linkedVpnUsername: null,
    email: 'recipient@example.test',
    accessRequestId: null,
    vpnAccountId: null,
  });
  mocks.prisma.offboardCampaignExtensionReminder.findMany.mockResolvedValue([]);
  mocks.prisma.offboardCampaignRecipientToken.create.mockResolvedValue({ id: 'token-1' });
  mocks.prisma.offboardCampaignRecipientToken.updateMany.mockResolvedValue({ count: 1 });
  mocks.prisma.offboardCampaignExtensionReminder.update.mockResolvedValue({});
  mocks.prisma.offboardCampaignExtensionReminder.updateMany.mockResolvedValue({ count: 1 });
  mocks.prisma.offboardCampaignRecipient.update.mockResolvedValue({});
  mocks.prisma.offboardCampaign.update.mockResolvedValue({});
  mocks.prisma.offboardCampaignLog.create.mockResolvedValue({ id: 'log-1' });
  mocks.prisma.auditLog.create.mockResolvedValue({});
  mocks.prisma.$transaction.mockImplementation(async callback => callback(mocks.prisma));
  mocks.sendOffboardReminderEmail.mockResolvedValue({ messageId: 'message-1' });
  mocks.sendOffboardExtensionReminderEmail.mockResolvedValue({ messageId: 'extension-message-1' });
}

function configureEnforcement(memberOf: string[]) {
  let enforcementClaimId: string | null = null;
  const campaign = {
    id: 'campaign-1',
    name: 'Active cleanup',
    status: 'active',
    sendingPaused: true,
    remindersPaused: true,
    enforcementPaused: false,
    cancelledAt: null,
    emergencyStoppedAt: null,
  };
  const recipient = {
    id: 'recipient-1',
    campaignId: campaign.id,
    campaign,
    status: 'sent',
    verifiedAt: null,
    enforcedAt: null,
    deadlineAt: new Date(NOW.getTime() - 60_000),
    enforcementClaimedAt: null,
    email: 'recipient@example.test',
    displayName: 'Recipient',
    adUsername: 'recipient',
    linkedVpnUsername: null,
    accessRequestId: 'request-1',
    vpnAccountId: null,
    originalAdEnabled: true,
    originalAdStatus: 'active',
    originalVpnStatus: null,
    originalVpnPortalType: null,
  };

  mocks.prisma.offboardCampaign.findMany.mockResolvedValue([campaign]);
  mocks.prisma.offboardCampaign.findUnique.mockResolvedValue(campaign);
  mocks.prisma.offboardCampaignRecipient.findMany.mockImplementation(async ({ where }) => (
    where.enforcementClaimedAt === null ? [recipient] : []
  ));
  mocks.prisma.offboardCampaignRecipient.updateMany.mockImplementation(async ({ where, data }) => {
    if (data?.enforcementClaimId) enforcementClaimId = data.enforcementClaimId;
    return where.status === 'email_sending' ? { count: 0 } : { count: 1 };
  });
  mocks.prisma.offboardCampaignRecipient.findUnique.mockImplementation(async () => ({
    ...recipient,
    status: enforcementClaimId ? 'enforcement_processing' : recipient.status,
    enforcementClaimId,
  }));
  mocks.prisma.offboardCampaignRecipient.count.mockResolvedValue(1);
  mocks.prisma.offboardCampaignRecipient.update.mockResolvedValue({});
  mocks.prisma.offboardCampaign.update.mockResolvedValue({});
  mocks.prisma.offboardCampaignLog.create.mockResolvedValue({ id: 'log-1' });
  mocks.prisma.auditLog.create.mockResolvedValue({});
  mocks.prisma.accountLifecycleAction.create.mockResolvedValue({ id: 'action-1' });
  mocks.prisma.accountLifecycleAction.findUnique.mockResolvedValue(null);
  mocks.prisma.accountLifecycleHistory.create.mockResolvedValue({});
  mocks.prisma.accessRequest.findMany.mockResolvedValue([{ id: 'request-1' }]);
  mocks.prisma.accessRequest.updateMany.mockResolvedValue({ count: 1 });
  mocks.prisma.requestComment.create.mockResolvedValue({ id: 'comment-1' });
  mocks.prisma.session.deleteMany.mockResolvedValue({ count: 0 });
  mocks.prisma.$transaction.mockImplementation(async callback => callback(mocks.prisma));
  mocks.searchLDAPUser.mockResolvedValue({
    objectName: 'CN=Recipient,OU=Users,DC=example,DC=test',
    attributes: [
      { type: 'sAMAccountName', values: ['recipient'] },
      { type: 'mail', values: [recipient.email] },
      { type: 'userAccountControl', values: ['512'] },
      { type: 'memberOf', values: memberOf },
      { type: 'objectGUID', values: ['guid-recipient'] },
    ],
  });
  mocks.processLifecycleAction.mockResolvedValue({ success: true });
  mocks.revokeUserSessionsEverywhere.mockResolvedValue({
    portalSessionsRevoked: 0,
    providerLogoutsAttempted: 0,
    providerSessionsDestroyed: 0,
    providerLogoutsReconciliationRequired: 0,
  });
}

function configureDirectOffboarding(options: {
  userAccountControl?: string;
  vpnStatus?: string;
  recipientStatus?: string;
  portalAdAccountStatus?: string;
} = {}) {
  const campaign = {
    id: 'campaign-direct',
    name: 'Confirmed departures',
    workflowMode: 'direct',
    status: 'active',
    currentWave: 0,
    pauseAfterEachWave: true,
    executionPaused: false,
    sendingPaused: true,
    remindersPaused: true,
    enforcementPaused: false,
    cancelledAt: null,
    emergencyStoppedAt: null,
    directExecutionCompletedAt: null,
    directOffboardReason: 'Sponsor confirmed the account holder has departed',
    directOffboardReference: 'INC-1234',
    activationOperationRunId: 'run-direct',
  };
  let recipientStatus = options.recipientStatus || 'direct_pending';
  let enforcementClaimId: string | null = null;
  let finalNoticeStatus = 'pending';
  const recipient = {
    id: 'recipient-direct',
    campaignId: campaign.id,
    campaign,
    status: recipientStatus,
    waveNumber: 0,
    verifiedAt: null,
    enforcedAt: null,
    deadlineAt: null,
    enforcementClaimedAt: null,
    enforcementClaimId,
    email: 'recipient@example.test',
    displayName: 'Recipient',
    adUsername: 'recipient',
    adDn: 'CN=Recipient,OU=Users,DC=example,DC=test',
    targetDirectoryObjectGuid: 'guid-recipient',
    linkedVpnUsername: options.vpnStatus ? 'recipient-vpn' : null,
    accessRequestId: 'request-1',
    expectedRequestVersion: 7,
    enforcementExpectedAd: false,
    enforcementExpectedVpn: false,
    enforcementFailureCounted: false,
    vpnAccountId: options.vpnStatus ? 'vpn-direct' : null,
    originalAdEnabled: true,
    originalAdStatus: 'active',
    originalVpnStatus: options.vpnStatus || null,
    originalVpnPortalType: null,
    finalNoticeStatus,
  };

  mocks.prisma.offboardCampaign.findMany.mockResolvedValue([campaign]);
  mocks.prisma.offboardCampaign.findUnique.mockImplementation(async ({ include }) => (
    include?.recipients
      ? { ...campaign, recipients: [{ ...recipient, status: recipientStatus }] }
      : campaign
  ));
  mocks.prisma.offboardCampaignRecipient.findMany.mockImplementation(async ({ where }) => {
    if (where.status === 'enforced') return [];
    if (where.status === 'direct_pending' && recipientStatus === 'direct_pending') return [{ ...recipient, status: recipientStatus }];
    return [];
  });
  mocks.prisma.offboardCampaignRecipient.findUnique.mockImplementation(async () => ({
    ...recipient,
    status: recipientStatus,
    enforcementClaimId,
    finalNoticeStatus,
  }));
  mocks.prisma.offboardCampaignRecipient.findFirst.mockResolvedValue(null);
  mocks.prisma.offboardCampaignRecipient.count.mockResolvedValue(1);
  mocks.prisma.offboardCampaignRecipient.groupBy.mockResolvedValue([{ status: recipientStatus, _count: { status: 1 } }]);
  mocks.prisma.offboardCampaignRecipient.updateMany.mockImplementation(async ({ where, data }) => {
    if (where.status === 'email_sending' || (where.finalNoticeStatus === 'sending' && where.finalNoticeClaimedUntil)) return { count: 0 };
    if (where.status === 'enforcement_processing' && recipientStatus !== 'enforcement_processing') return { count: 0 };
    if (data?.status) recipientStatus = data.status;
    if (data?.enforcementClaimId !== undefined) enforcementClaimId = data.enforcementClaimId;
    if (data?.finalNoticeStatus) finalNoticeStatus = data.finalNoticeStatus;
    return { count: 1 };
  });
  mocks.prisma.offboardCampaign.update.mockResolvedValue({});
  mocks.prisma.offboardCampaignLog.create.mockResolvedValue({ id: 'log-direct' });
  mocks.prisma.auditLog.create.mockResolvedValue({});
  mocks.prisma.accountLifecycleAction.findUnique.mockResolvedValue(null);
  mocks.prisma.accountLifecycleAction.findMany.mockResolvedValue([]);
  mocks.prisma.accountLifecycleAction.create.mockResolvedValue({ id: 'action-direct' });
  mocks.prisma.accountLifecycleHistory.create.mockResolvedValue({});
  mocks.prisma.offboardOperationRun.updateMany.mockImplementation(async ({ where }) => (
    where?.status === 'claimed' ? { count: 0 } : { count: 1 }
  ));
  mocks.prisma.offboardOperationRunItem.updateMany.mockResolvedValue({ count: 1 });
  mocks.prisma.offboardOperationRunItem.groupBy.mockResolvedValue([{ status: 'completed', _count: { status: 1 } }]);
  mocks.prisma.accessRequest.findMany.mockResolvedValue([{ id: 'request-1', version: 7 }]);
  mocks.prisma.accessRequest.findUnique.mockResolvedValue({
    status: 'approved',
    version: 7,
    adAccountStatus: options.portalAdAccountStatus || 'active',
  });
  mocks.prisma.accessRequest.updateMany.mockResolvedValue({ count: 1 });
  mocks.prisma.requestComment.create.mockResolvedValue({ id: 'comment-direct' });
  mocks.prisma.offboardCampaignExtension.findMany.mockResolvedValue([]);
  mocks.prisma.providerLogoutTask.findMany.mockResolvedValue([]);
  mocks.prisma.session.count.mockResolvedValue(0);
  mocks.prisma.$transaction.mockImplementation(async callback => callback(mocks.prisma));
  mocks.prisma.$queryRaw.mockResolvedValue([{ lock_acquired: 'locked' }]);
  mocks.prisma.vpnIdentityOffboardFence.upsert.mockResolvedValue({});
  mocks.searchLDAPUser.mockResolvedValue({
    objectName: recipient.adDn,
    attributes: [
      { type: 'sAMAccountName', values: ['recipient'] },
      { type: 'mail', values: [recipient.email] },
      { type: 'userAccountControl', values: [options.userAccountControl || '512'] },
      { type: 'memberOf', values: [] },
      { type: 'objectGUID', values: ['guid-recipient'] },
    ],
  });
  mocks.prisma.vPNAccount.findMany.mockResolvedValue(options.vpnStatus === 'active'
    ? [{ id: 'vpn-direct' }]
    : []);
  mocks.prisma.vPNAccount.findUnique.mockResolvedValue(options.vpnStatus ? {
    id: 'vpn-direct',
    username: 'recipient-vpn',
    status: options.vpnStatus,
    adUsername: 'recipient',
  } : null);
  mocks.processLifecycleAction.mockResolvedValue({ success: true });
  mocks.revokeUserSessionsEverywhere.mockResolvedValue({
    portalSessionsRevoked: 1,
    providerLogoutsAttempted: 1,
    providerSessionsDestroyed: 1,
    providerLogoutsReconciliationRequired: 0,
  });
  mocks.sendOffboardDirectCompletedEmail.mockResolvedValue({ messageId: 'message-direct' });
}

function ldapUser(memberOf: string[]) {
  return {
    dn: 'CN=Recipient,OU=Users,DC=example,DC=test',
    username: 'recipient',
    displayName: 'Recipient',
    email: 'recipient@example.test',
    description: '',
    accountEnabled: true,
    accountExpires: null,
    whenCreated: '20260101000000.0Z',
    memberOf,
  };
}

function configureDryRun(memberOf: string[]) {
  mocks.prisma.offboardCampaign.findFirst.mockResolvedValue(null);
  mocks.prisma.offboardCampaign.create.mockResolvedValue({ id: 'dry-run-1' });
  mocks.prisma.offboardCampaign.findUnique.mockResolvedValue({
    id: 'dry-run-1',
    recipients: [],
  });
  mocks.prisma.offboardCampaignRecipient.findMany.mockResolvedValue([]);
  mocks.prisma.offboardCampaignRecipient.createMany.mockResolvedValue({ count: 1 });
  mocks.prisma.offboardCampaignRecipient.groupBy.mockResolvedValue([]);
  mocks.prisma.offboardCampaignExtension.findMany.mockResolvedValue([]);
  mocks.prisma.vPNAccount.findMany.mockResolvedValue([]);
  mocks.prisma.accessRequest.findMany.mockResolvedValue([]);
  mocks.prisma.offboardCampaignLog.create.mockResolvedValue({ id: 'log-1' });
  mocks.prisma.auditLog.create.mockResolvedValue({});
  mocks.prisma.$transaction.mockImplementation(async callback => callback(mocks.prisma));
  mocks.listUsersInOU.mockResolvedValue([ldapUser(memberOf)]);
}

describe('processOffboardCampaigns reminder safety', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.clearAllMocks();
    process.env.LDAP_ADMIN_GROUPS = JSON.stringify([
      'CN=Tier\\2C One Admins,OU=Groups,DC=example,DC=test',
    ]);
  });

  it('does not send reminders after the recipient deadline', async () => {
    configureProcessor({
      id: 'expired-recipient',
      initialEmailSentAt: new Date(NOW.getTime() - 6.5 * DAY_MS),
      deadlineAt: new Date(NOW.getTime() - 60_000),
    });

    await processOffboardCampaigns({ campaignId: 'campaign-1', actor: 'test' });

    expect(mocks.sendOffboardReminderEmail).not.toHaveBeenCalled();
    const reminderQueries = mocks.prisma.offboardCampaignRecipient.findMany.mock.calls
      .map(([query]) => query.where)
      .filter(where => where.reminder3SentAt === null || where.reminder6SentAt === null);
    expect(reminderQueries).toHaveLength(2);
    expect(reminderQueries.every(where => where.deadlineAt?.gt instanceof Date)).toBe(true);
  });

  it('sends only day 6 when a delayed processor missed the day 3 window', async () => {
    configureProcessor({
      id: 'late-recipient',
      initialEmailSentAt: new Date(NOW.getTime() - 6.5 * DAY_MS),
      deadlineAt: new Date(NOW.getTime() + 12 * 60 * 60 * 1000),
    });

    const results = await processOffboardCampaigns({
      campaignId: 'campaign-1',
      actor: 'test',
      limit: 1,
    });

    expect(mocks.sendOffboardReminderEmail).toHaveBeenCalledTimes(1);
    expect(mocks.sendOffboardReminderEmail).toHaveBeenCalledWith(
      expect.objectContaining({ reminderDay: 6 })
    );
    expect(results[0].batchLimitReached).toBe(true);
  });

  it('scheduled processing excludes initial email work and old overdue backlog', async () => {
    const windowStart = new Date(NOW.getTime() - 5 * 60 * 1000);
    configureProcessor({
      id: 'old-overdue-recipient',
      initialEmailSentAt: new Date(NOW.getTime() - 7 * DAY_MS),
      deadlineAt: new Date(windowStart.getTime() - 60_000),
    }, {
      enforcementPaused: false,
    });

    await processOffboardCampaigns({
      campaignId: 'campaign-1',
      actor: 'offboard-scheduler',
      processInitialEmails: false,
      scheduledWindow: {
        startExclusive: windowStart,
        endInclusive: NOW,
      },
    });

    expect(mocks.prisma.offboardCampaignRecipient.findFirst).not.toHaveBeenCalled();
    expect(mocks.sendOffboardReminderEmail).not.toHaveBeenCalled();

    const enforcementQuery = mocks.prisma.offboardCampaignRecipient.findMany.mock.calls
      .map(([query]) => query.where)
      .find(where => where.enforcementClaimedAt === null);
    expect(enforcementQuery.deadlineAt).toEqual({
      gt: windowStart,
      lte: NOW,
    });

    const reminderQueries = mocks.prisma.offboardCampaignRecipient.findMany.mock.calls
      .map(([query]) => query.where)
      .filter(where => where.reminder3SentAt === null || where.reminder6SentAt === null);
    expect(reminderQueries).toHaveLength(2);
    expect(reminderQueries.every(where => where.deadlineAt?.gt.getTime() === NOW.getTime())).toBe(true);
    expect(reminderQueries.every(where => where.initialEmailSentAt?.gt instanceof Date)).toBe(true);
  });

  it('does not send legacy day reminders after an active deadline extension', async () => {
    configureProcessor({
      id: 'extended-recipient',
      initialEmailSentAt: new Date(NOW.getTime() - 17 * DAY_MS),
      deadlineAt: new Date(NOW.getTime() + 18 * DAY_MS),
      activeExtension: true,
    });

    await processOffboardCampaigns({ campaignId: 'campaign-1', actor: 'test' });

    expect(mocks.sendOffboardReminderEmail).not.toHaveBeenCalled();
  });

  it('does not send stored extension reminders created with less than 24 hours lead time', async () => {
    configureProcessor({
      id: 'extended-recipient',
      initialEmailSentAt: new Date(NOW.getTime() - 17 * DAY_MS),
      deadlineAt: new Date(NOW.getTime() + 18 * DAY_MS),
      activeExtension: true,
    });
    mocks.prisma.offboardCampaignExtensionReminder.findMany.mockResolvedValue([{
      id: 'unsafe-reminder',
      extensionId: 'extension-1',
      scheduledFor: new Date(NOW.getTime() - 5 * 60 * 1000),
      extension: {
        createdAt: new Date(NOW.getTime() - 20 * 60 * 1000),
        newDeadlineAt: new Date(NOW.getTime() + 18 * DAY_MS),
        recipient: {
          id: 'extended-recipient',
          email: 'recipient@example.test',
          displayName: 'Recipient',
          adUsername: 'recipient',
          linkedVpnUsername: null,
        },
      },
    }]);

    const results = await processOffboardCampaigns({
      campaignId: 'campaign-1',
      actor: 'test',
    });

    expect(mocks.sendOffboardExtensionReminderEmail).not.toHaveBeenCalled();
    expect(mocks.prisma.offboardCampaignExtensionReminder.updateMany).not.toHaveBeenCalled();
    expect(results[0].reminders).toBe(0);
  });

  it('reports paused reminders and enforcement without processing or replaying them', async () => {
    configureProcessor({
      id: 'paused-recipient',
      initialEmailSentAt: new Date(NOW.getTime() - 6 * DAY_MS),
      deadlineAt: NOW,
    }, {
      enforcementPaused: true,
      remindersPaused: true,
    });

    const results = await processOffboardCampaigns({
      campaignId: 'campaign-1',
      actor: 'offboard-scheduler',
      processInitialEmails: false,
      scheduledWindow: {
        startExclusive: new Date(NOW.getTime() - 5 * 60 * 1000),
        endInclusive: NOW,
      },
    });

    expect(results[0]).toEqual(expect.objectContaining({
      reminders: 0,
      remindersSkippedBecausePaused: true,
      enforced: 0,
      enforcementSkippedBecausePaused: true,
      failures: 0,
      batchLimitReached: false,
    }));
    const recipientWorkQueries = mocks.prisma.offboardCampaignRecipient.findMany.mock.calls
      .map(([query]) => query.where)
      .filter(where => where.finalNoticeStatus !== 'sending' && where.status !== 'enforcement_processing');
    expect(recipientWorkQueries).toHaveLength(0);
    expect(mocks.sendOffboardReminderEmail).not.toHaveBeenCalled();
  });
});

describe('processOffboardCampaigns administrator safety', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.clearAllMocks();
    process.env.LDAP_ADMIN_GROUPS = JSON.stringify([
      'CN=Tier\\2C One Admins,OU=Groups,DC=example,DC=test',
    ]);
  });

  it('skips live enforcement for an exact normalized administrator DN', async () => {
    configureEnforcement([
      'cn=Tier\\, One Admins,ou=groups,dc=EXAMPLE,dc=TEST',
    ]);

    const results = await processOffboardCampaigns({
      campaignId: 'campaign-1',
      actor: 'offboard-scheduler',
      processInitialEmails: false,
      limit: 1,
    });

    expect(results[0]).toMatchObject({
      enforced: 0,
      enforcementSkipped: 1,
      failures: 0,
    });
    expect(mocks.prisma.offboardCampaignRecipient.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'recipient-1', status: 'enforcement_processing' }),
      data: expect.objectContaining({
        status: 'enforcement_skipped',
        skipReason: 'became_admin_group_member',
      }),
    }));
    expect(mocks.processLifecycleAction).not.toHaveBeenCalled();
  });

  it('uses the saved administrator groups instead of a stale environment value', async () => {
    process.env.LDAP_ADMIN_GROUPS = JSON.stringify([
      'CN=Old Admins,OU=Groups,DC=example,DC=test',
    ]);
    mocks.prisma.systemConfigEntry.findMany.mockResolvedValue([
      {
        key: 'ldap.adminGroups',
        value: ['CN=Tier\\2C One Admins,OU=Groups,DC=example,DC=test'],
      },
    ]);
    configureEnforcement([
      'cn=Tier\\, One Admins,ou=groups,dc=EXAMPLE,dc=TEST',
    ]);

    const results = await processOffboardCampaigns({
      campaignId: 'campaign-1',
      actor: 'offboard-scheduler',
      processInitialEmails: false,
      limit: 1,
    });

    expect(results[0]).toMatchObject({
      enforced: 0,
      enforcementSkipped: 1,
      failures: 0,
    });
    expect(mocks.processLifecycleAction).not.toHaveBeenCalled();
  });

  it.each([
    'CN=Tier\\, One Admins Backup,OU=Groups,DC=example,DC=test',
    'CN=Tier\\, One Admins,OU=Other Groups,DC=example,DC=test',
  ])('does not protect a different complete group DN: %s', async (membership) => {
    configureEnforcement([membership]);

    const results = await processOffboardCampaigns({
      campaignId: 'campaign-1',
      actor: 'offboard-scheduler',
      processInitialEmails: false,
      limit: 1,
    });

    expect(results[0]).toMatchObject({
      enforced: 1,
      enforcementSkipped: 0,
      failures: 0,
    });
    expect(mocks.processLifecycleAction).toHaveBeenCalledTimes(1);
    const lifecycleCreate = mocks.prisma.accountLifecycleAction.create.mock.calls[0]?.[0];
    expect(lifecycleCreate?.data).toEqual(expect.objectContaining({
      status: 'queued',
      relatedRequestId: 'request-1',
      targetDirectoryDn: 'CN=Recipient,OU=Users,DC=example,DC=test',
      targetDirectoryObjectGuid: 'guid-recipient',
      policyVersion: 'governed-directory-identity-v1',
    }));
    expect(lifecycleCreate?.data).not.toHaveProperty('processedAt');
    expect(lifecycleCreate?.data).not.toHaveProperty('processedBy');
    expect(mocks.prisma.accountLifecycleHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ newStatus: 'queued' }),
    });
  });

  it.each([
    ['missing', undefined],
    ['ambiguous', 'CN=Domain Admins,CN=Administrators,CN=Schema Admins'],
  ])('aborts before claiming recipients when configuration is %s', async (_label, configuration) => {
    if (configuration === undefined) {
      delete process.env.LDAP_ADMIN_GROUPS;
    } else {
      process.env.LDAP_ADMIN_GROUPS = configuration;
    }

    await expect(
      processOffboardCampaigns({
        campaignId: 'campaign-1',
        actor: 'offboard-scheduler',
        processInitialEmails: false,
      })
    ).rejects.toThrow(/LDAP_ADMIN_GROUPS|complete DNs/);

    expect(mocks.prisma.offboardCampaignRecipient.updateMany).not.toHaveBeenCalled();
    expect(mocks.prisma.offboardCampaign.findMany).not.toHaveBeenCalled();
    expect(mocks.processLifecycleAction).not.toHaveBeenCalled();
  });
});

describe('direct offboarding execution', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.clearAllMocks();
    process.env.LDAP_ADMIN_GROUPS = JSON.stringify(['CN=Tier\\2C One Admins,OU=Groups,DC=example,DC=test']);
  });

  it('removes access before sending the final notice and never creates a verification token', async () => {
    configureDirectOffboarding();
    const results = await processOffboardCampaigns({ campaignId: 'campaign-direct', actor: 'direct-admin', limit: 1 });

    expect(results[0]).toMatchObject({
      workflowMode: 'direct',
      enforced: 1,
      finalNoticesSent: 1,
      failures: 0,
    });
    expect(mocks.processLifecycleAction).toHaveBeenCalledTimes(1);
    expect(mocks.revokeUserSessionsEverywhere).toHaveBeenCalledWith('recipient', expect.objectContaining({ actor: 'direct-admin' }));
    expect(mocks.sendOffboardDirectCompletedEmail).toHaveBeenCalledWith(expect.objectContaining({ adUsername: 'recipient' }));
    expect(mocks.processLifecycleAction.mock.invocationCallOrder[0]).toBeLessThan(mocks.sendOffboardDirectCompletedEmail.mock.invocationCallOrder[0]);
    expect(mocks.prisma.offboardCampaignRecipientToken.create).not.toHaveBeenCalled();
    expect(mocks.prisma.accountLifecycleAction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ offboardOperationRunId: 'run-direct' }),
    });
    const requestProjection = mocks.prisma.accessRequest.updateMany.mock.calls[0]?.[0]?.data;
    expect(requestProjection).not.toHaveProperty('adDisabledAt');
    expect(requestProjection).not.toHaveProperty('adDisabledBy');
    expect(requestProjection).not.toHaveProperty('adDisabledReason');
    expect(String(mocks.prisma.$queryRaw.mock.calls[0]?.[0])).toContain('pg_advisory_xact_lock');
    expect(mocks.prisma.vpnIdentityOffboardFence.upsert).toHaveBeenCalledWith({
      where: { canonicalAdUsername: 'recipient' },
      create: expect.objectContaining({
        campaignId: 'campaign-direct',
        recipientId: 'recipient-direct',
        blockedAccessRequestId: 'request-1',
      }),
      update: expect.objectContaining({
        campaignId: 'campaign-direct',
        recipientId: 'recipient-direct',
        blockedAccessRequestId: 'request-1',
      }),
    });
    expect(mocks.prisma.vpnIdentityOffboardFence.upsert.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.searchLDAPUser.mock.invocationCallOrder[0]);
  });

  it('recovers an expired activation-run lease as reconciliation required', async () => {
    configureDirectOffboarding();
    mocks.prisma.offboardOperationRun.updateMany.mockImplementation(async ({ where }) => (
      where?.status === 'claimed' ? { count: 1 } : { count: 1 }
    ));

    await processOffboardCampaigns({ campaignId: 'campaign-direct', actor: 'direct-admin', limit: 1 });

    expect(mocks.prisma.offboardOperationRun.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'run-direct',
        kind: 'activation',
        status: 'claimed',
        claimedUntil: { lte: expect.any(Date) },
      }),
      data: {
        status: 'reconciliation_required',
        claimId: null,
        claimedUntil: null,
      },
    });
    const finalStatuses = mocks.prisma.offboardOperationRun.updateMany.mock.calls
      .map(([call]) => call.data?.status)
      .filter(Boolean);
    expect(finalStatuses.at(-1)).toBe('reconciliation_required');
  });

  it('does not mutate stale direct claims when direct execution is unauthorized', async () => {
    configureDirectOffboarding();
    mocks.prisma.offboardCampaign.findMany.mockResolvedValue([]);

    await processOffboardCampaigns({ actor: 'limited-admin', allowDirect: false });

    expect(mocks.prisma.offboardCampaignRecipient.findMany.mock.calls.some(([call]) => (
      call.where?.status === 'enforcement_processing'
      || call.where?.finalNoticeStatus === 'sending'
    ))).toBe(false);
  });

  it('continues session and request offboarding when AD is already disabled without creating a redundant AD action', async () => {
    configureDirectOffboarding({ userAccountControl: '514' });

    const results = await processOffboardCampaigns({ campaignId: 'campaign-direct', actor: 'direct-admin', limit: 1 });

    expect(results[0]).toMatchObject({ enforced: 1, finalNoticesSent: 1 });
    expect(mocks.processLifecycleAction).not.toHaveBeenCalled();
    expect(mocks.revokeUserSessionsEverywhere).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.accessRequest.updateMany).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.accessRequest.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'request-1',
        status: 'approved',
        version: 7,
      },
      data: expect.objectContaining({
        status: 'offboarded',
        adAccountStatus: 'disabled',
      }),
    });
    const requestProjection = mocks.prisma.accessRequest.updateMany.mock.calls[0][0].data;
    expect(requestProjection).not.toHaveProperty('adDisabledAt');
    expect(requestProjection).not.toHaveProperty('adDisabledBy');
    expect(requestProjection).not.toHaveProperty('adDisabledReason');
    expect(mocks.searchLDAPUser).toHaveBeenCalledTimes(2);
    const directoryLockIndex = mocks.prisma.$queryRaw.mock.calls.findIndex(([, username, namespace]) => (
      username === 'recipient' && namespace === 873211
    ));
    expect(directoryLockIndex).toBeGreaterThanOrEqual(0);
    expect(mocks.prisma.$queryRaw.mock.invocationCallOrder[directoryLockIndex])
      .toBeLessThan(mocks.searchLDAPUser.mock.invocationCallOrder.at(-1)!);
    expect(mocks.searchLDAPUser.mock.invocationCallOrder.at(-1)!)
      .toBeLessThan(mocks.prisma.accessRequest.updateMany.mock.invocationCallOrder[0]);
    expect(mocks.prisma.requestComment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        comment: expect.stringMatching(/No LDAP disable write.*objectGUID=guid-recipient.*userAccountControl=514/),
      }),
    });
    expect(mocks.sendOffboardDirectCompletedEmail).toHaveBeenCalledTimes(1);
  });

  it('preserves existing AD-disable provenance when the portal projection is already disabled', async () => {
    configureDirectOffboarding({ userAccountControl: '514', portalAdAccountStatus: 'disabled' });

    const results = await processOffboardCampaigns({ campaignId: 'campaign-direct', actor: 'direct-admin', limit: 1 });

    expect(results[0]).toMatchObject({ enforced: 1, finalNoticesSent: 1 });
    const requestProjection = mocks.prisma.accessRequest.updateMany.mock.calls[0][0].data;
    expect(requestProjection).not.toHaveProperty('adAccountStatus');
    expect(requestProjection).not.toHaveProperty('adDisabledAt');
    expect(requestProjection).not.toHaveProperty('adDisabledBy');
    expect(requestProjection).not.toHaveProperty('adDisabledReason');
  });

  it('does not project disabled when the final locked AD read observes a concurrent enable', async () => {
    configureDirectOffboarding({ userAccountControl: '514' });
    mocks.searchLDAPUser
      .mockResolvedValueOnce({
        objectName: 'CN=Recipient,OU=Users,DC=example,DC=test',
        attributes: [
          { type: 'sAMAccountName', values: ['recipient'] },
          { type: 'mail', values: ['recipient@example.test'] },
          { type: 'userAccountControl', values: ['514'] },
          { type: 'memberOf', values: [] },
          { type: 'objectGUID', values: ['guid-recipient'] },
        ],
      })
      .mockResolvedValueOnce({
        objectName: 'CN=Recipient,OU=Users,DC=example,DC=test',
        attributes: [
          { type: 'sAMAccountName', values: ['recipient'] },
          { type: 'mail', values: ['recipient@example.test'] },
          { type: 'userAccountControl', values: ['512'] },
          { type: 'memberOf', values: [] },
          { type: 'objectGUID', values: ['guid-recipient'] },
        ],
      });

    const results = await processOffboardCampaigns({ campaignId: 'campaign-direct', actor: 'direct-admin', limit: 1 });

    expect(results[0]).toMatchObject({ failures: 1, enforced: 0, finalNoticesSent: 0 });
    expect(mocks.prisma.accessRequest.updateMany).not.toHaveBeenCalled();
    expect(mocks.sendOffboardDirectCompletedEmail).not.toHaveBeenCalled();
  });

  it('revalidates and converges an already-disabled AD projection during verified-complete reconciliation', async () => {
    configureDirectOffboarding({
      userAccountControl: '514',
      recipientStatus: 'enforcement_reconciliation_required',
    });

    await reconcileOffboardEnforcement({
      campaignId: 'campaign-direct',
      recipientId: 'recipient-direct',
      actor: 'reconcile-admin',
      resolution: 'verified_complete',
      evidence: 'Confirmed session and provider cleanup in ticket INC-1234',
    });

    expect(mocks.searchLDAPUser).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.accessRequest.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'request-1',
        status: 'approved',
        version: 7,
      },
      data: expect.objectContaining({
        status: 'offboarded',
        adAccountStatus: 'disabled',
      }),
    });
  });

  it.each([
    ['a changed username', 'other-user', 'guid-recipient', '514'],
    ['a replaced object GUID', 'recipient', 'replacement-guid', '514'],
    ['an enabled account', 'recipient', 'guid-recipient', '512'],
    ['missing UAC evidence', 'recipient', 'guid-recipient', ''],
    ['malformed UAC evidence', 'recipient', 'guid-recipient', '514invalid'],
  ])('rejects already-disabled reconciliation with %s', async (_label, username, objectGuid, uac) => {
    configureDirectOffboarding({ recipientStatus: 'enforcement_reconciliation_required' });
    mocks.searchLDAPUser.mockResolvedValue({
      objectName: 'CN=Recipient,OU=Users,DC=example,DC=test',
      attributes: [
        { type: 'sAMAccountName', values: [username] },
        { type: 'objectGUID', values: [objectGuid] },
        { type: 'userAccountControl', values: [uac] },
        { type: 'memberOf', values: [] },
      ],
    });

    await expect(reconcileOffboardEnforcement({
      campaignId: 'campaign-direct',
      recipientId: 'recipient-direct',
      actor: 'reconcile-admin',
      resolution: 'verified_complete',
      evidence: 'Confirmed session and provider cleanup in ticket INC-1234',
    })).rejects.toThrow('not confirmed disabled');

    expect(mocks.prisma.accessRequest.updateMany).not.toHaveBeenCalled();
    expect(mocks.prisma.requestComment.create).not.toHaveBeenCalled();
  });

  it('does not downgrade a deleted AD projection during already-disabled reconciliation', async () => {
    configureDirectOffboarding({
      recipientStatus: 'enforcement_reconciliation_required',
      userAccountControl: '514',
      portalAdAccountStatus: 'deleted',
    });

    await expect(reconcileOffboardEnforcement({
      campaignId: 'campaign-direct',
      recipientId: 'recipient-direct',
      actor: 'reconcile-admin',
      resolution: 'verified_complete',
      evidence: 'Confirmed session and provider cleanup in ticket INC-1234',
    })).rejects.toThrow('cannot be downgraded');

    expect(mocks.prisma.accessRequest.updateMany).not.toHaveBeenCalled();
  });

  it('keeps reconciliation unresolved when the request version changes after disabled confirmation', async () => {
    configureDirectOffboarding({
      recipientStatus: 'enforcement_reconciliation_required',
      userAccountControl: '514',
    });
    mocks.prisma.accessRequest.updateMany.mockResolvedValue({ count: 0 });

    await expect(reconcileOffboardEnforcement({
      campaignId: 'campaign-direct',
      recipientId: 'recipient-direct',
      actor: 'reconcile-admin',
      resolution: 'verified_complete',
      evidence: 'Confirmed session and provider cleanup in ticket INC-1234',
    })).rejects.toThrow('Portal request changed');

    expect(mocks.prisma.requestComment.create).not.toHaveBeenCalled();
    expect(mocks.prisma.offboardCampaignRecipient.updateMany).not.toHaveBeenCalled();
  });

  it('continues AD, session, and request offboarding when the linked VPN is already revoked', async () => {
    configureDirectOffboarding({ vpnStatus: 'revoked' });

    const results = await processOffboardCampaigns({ campaignId: 'campaign-direct', actor: 'direct-admin', limit: 1 });

    expect(results[0]).toMatchObject({ enforced: 1, finalNoticesSent: 1 });
    expect(mocks.processLifecycleAction).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.accountLifecycleAction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ actionType: 'disable_ad' }),
    });
    expect(mocks.prisma.accountLifecycleAction.create).not.toHaveBeenCalledWith({
      data: expect.objectContaining({ actionType: 'revoke_vpn' }),
    });
    expect(mocks.revokeUserSessionsEverywhere).toHaveBeenCalledTimes(1);
    expect(mocks.sendOffboardDirectCompletedEmail).toHaveBeenCalledTimes(1);
  });

  it('blocks before external effects when a live VPN appears after a no-VPN review', async () => {
    configureDirectOffboarding();
    mocks.prisma.vPNAccount.findMany.mockResolvedValue([{ id: 'vpn-unreviewed' }]);

    const results = await processOffboardCampaigns({ campaignId: 'campaign-direct', actor: 'direct-admin', limit: 1 });

    expect(results[0]).toMatchObject({ enforcementSkipped: 1, enforced: 0 });
    expect(mocks.processLifecycleAction).not.toHaveBeenCalled();
    expect(mocks.revokeUserSessionsEverywhere).not.toHaveBeenCalled();
    expect(mocks.sendOffboardDirectCompletedEmail).not.toHaveBeenCalled();
  });

  it('rejects request-version drift between the live plan and lifecycle-action creation', async () => {
    configureDirectOffboarding();
    mocks.prisma.accessRequest.findMany.mockResolvedValue([{ id: 'request-1', version: 8 }]);

    const results = await processOffboardCampaigns({ campaignId: 'campaign-direct', actor: 'direct-admin', limit: 1 });

    expect(results[0]).toMatchObject({ failures: 1, enforced: 0 });
    expect(mocks.processLifecycleAction).not.toHaveBeenCalled();
    expect(mocks.revokeUserSessionsEverywhere).not.toHaveBeenCalled();
    expect(mocks.sendOffboardDirectCompletedEmail).not.toHaveBeenCalled();
  });
});

describe('offboard campaign administrator selection safety', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.clearAllMocks();
    process.env.LDAP_ADMIN_GROUPS = JSON.stringify([
      'CN=Tier\\2C One Admins,OU=Groups,DC=example,DC=test',
    ]);
  });

  it('excludes an exact administrator DN from a dry run', async () => {
    configureDryRun([
      'cn=Tier\\, One Admins,ou=groups,dc=EXAMPLE,dc=TEST',
    ]);

    await createOffboardDryRun(
      { includedUsernames: ['recipient'] },
      'live-admin'
    );

    expect(mocks.prisma.offboardCampaignRecipient.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          adUsername: 'recipient',
          status: 'skipped',
          skipReason: 'admin_group_member',
        }),
      ],
    });
    expect(mocks.processLifecycleAction).not.toHaveBeenCalled();
  });

  it('creates direct mode as an immediate reviewed action without a verification deadline', async () => {
    configureDryRun([]);
    mocks.prisma.accessRequest.findMany.mockResolvedValue([{
      id: 'request-1',
      status: 'approved',
      version: 7,
      accountExpiresAt: null,
      name: 'Recipient',
      email: 'recipient@example.test',
      ldapUsername: 'recipient',
      linkedAdUsername: null,
      adAccountStatus: 'active',
      vpnAccountStatus: null,
    }]);

    await createOffboardDryRun({
      workflowMode: 'direct',
      directOffboardReason: 'Approved departure confirmed by the sponsoring team',
      directOffboardReference: 'INC-1234',
      includedUsernames: ['recipient'],
    }, 'live-admin');

    expect(mocks.prisma.offboardCampaign.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        workflowMode: 'direct',
        executionPaused: true,
        directOffboardReference: 'INC-1234',
      }),
    }));
    expect(mocks.prisma.offboardCampaignRecipient.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        adUsername: 'recipient',
        status: 'dry_run_ready',
        expectedRequestVersion: 7,
        projectedDeadlineAt: null,
        projectedAction: expect.stringContaining('send completed-offboarding notice'),
      })],
    });
  });

  it('rejects direct mode without a substantive reason and reference', async () => {
    configureDryRun([]);
    await expect(createOffboardDryRun({
      workflowMode: 'direct',
      directOffboardReason: 'too short',
      directOffboardReference: 'x',
      includedUsernames: ['recipient'],
    }, 'live-admin')).rejects.toThrow(/substantive reason|ticket or change reference/);
    expect(mocks.prisma.offboardCampaign.create).not.toHaveBeenCalled();
  });

  it('conflicts a direct dry run when more than one live VPN record is linked to the AD username', async () => {
    configureDryRun([]);
    mocks.prisma.accessRequest.findMany.mockResolvedValue([{
      id: 'request-1', status: 'approved', version: 7, ldapUsername: 'recipient', linkedAdUsername: null,
    }]);
    mocks.prisma.vPNAccount.findMany.mockResolvedValue([
      { id: 'vpn-1', username: 'vpn-one', adUsername: 'recipient', status: 'active', portalType: 'Limited' },
      { id: 'vpn-2', username: 'vpn-two', adUsername: 'recipient', status: 'active', portalType: 'Limited' },
    ]);

    await createOffboardDryRun({
      workflowMode: 'direct',
      directOffboardReason: 'Approved departure confirmed by the sponsoring team',
      directOffboardReference: 'INC-1234',
      includedUsernames: ['recipient'],
    }, 'live-admin');

    expect(mocks.prisma.offboardCampaignRecipient.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        status: 'skipped',
        skipReason: 'multiple_live_vpn_accounts_linked_to_ad_username',
      })],
    });
  });

  it('selects the sole live VPN record when another historical record is already revoked', async () => {
    configureDryRun([]);
    mocks.prisma.accessRequest.findMany.mockResolvedValue([{
      id: 'request-1', status: 'approved', version: 7, ldapUsername: 'recipient', linkedAdUsername: null,
    }]);
    mocks.prisma.vPNAccount.findMany.mockResolvedValue([
      { id: 'vpn-old', username: 'vpn-old', adUsername: 'recipient', status: 'revoked', portalType: 'Limited' },
      { id: 'vpn-live', username: 'vpn-live', adUsername: 'recipient', status: 'active', portalType: 'Limited' },
    ]);

    await createOffboardDryRun({
      workflowMode: 'direct',
      directOffboardReason: 'Approved departure confirmed by the sponsoring team',
      directOffboardReference: 'INC-1234',
      includedUsernames: ['recipient'],
    }, 'live-admin');

    expect(mocks.prisma.offboardCampaignRecipient.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        status: 'dry_run_ready',
        vpnAccountId: 'vpn-live',
        linkedVpnUsername: 'vpn-live',
      })],
    });
  });

  it('rechecks exact administrator membership before activation', async () => {
    const recipient = {
      id: 'recipient-1',
      status: 'dry_run_ready',
      skipReason: null,
      adUsername: 'recipient',
      email: 'recipient@example.test',
      linkedVpnUsername: null,
      originalVpnStatus: null,
      waveNumber: 0,
    };
    mocks.prisma.offboardCampaign.findUnique.mockResolvedValue({
      id: 'dry-run-1',
      name: 'Dry run',
      status: 'dry_run',
      manualExcludedUsernames: [],
      manualExcludedEmails: [],
      recipients: [recipient],
    });
    mocks.prisma.vPNAccount.findMany.mockResolvedValue([]);
    mocks.prisma.offboardCampaignRecipient.findMany.mockResolvedValue([]);
    mocks.prisma.offboardCampaignRecipient.groupBy.mockResolvedValue([]);
    mocks.prisma.offboardCampaignExtension.findMany.mockResolvedValue([]);
    mocks.prisma.accessRequest.findMany.mockResolvedValue([]);
    mocks.prisma.offboardCampaignRecipient.update.mockResolvedValue({});
    mocks.prisma.offboardCampaign.update.mockResolvedValue({});
    mocks.prisma.offboardCampaignLog.create.mockResolvedValue({ id: 'log-1' });
    mocks.prisma.auditLog.create.mockResolvedValue({});
    mocks.prisma.$transaction.mockImplementation(async callback => callback(mocks.prisma));
    mocks.listUsersInOU.mockResolvedValue([
      ldapUser([
        'cn=Tier\\, One Admins,ou=groups,dc=EXAMPLE,dc=TEST',
      ]),
    ]);

    await activateOffboardCampaign('dry-run-1', 'live-admin');

    expect(mocks.prisma.offboardCampaignRecipient.update).toHaveBeenCalledWith({
      where: { id: 'recipient-1' },
      data: {
        status: 'skipped',
        skipReason: 'admin_group_member',
      },
    });
    expect(mocks.processLifecycleAction).not.toHaveBeenCalled();
  });
});
