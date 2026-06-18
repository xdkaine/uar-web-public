import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sendOffboardReminderEmail: vi.fn(),
  sendOffboardExtensionReminderEmail: vi.fn(),
  prisma: {
    $transaction: vi.fn(),
    offboardCampaign: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    offboardCampaignRecipient: {
      count: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
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
    offboardCampaignLog: {
      create: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
  },
}));

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('@/lib/ldap', () => ({
  listUsersInOU: vi.fn(),
  searchLDAPUser: vi.fn(),
}));
vi.mock('@/lib/email', () => ({
  sendOffboardInitialEmail: vi.fn(),
  sendOffboardReminderEmail: mocks.sendOffboardReminderEmail,
  sendOffboardExtensionEmail: vi.fn(),
  sendOffboardExtensionReminderEmail: mocks.sendOffboardExtensionReminderEmail,
}));
vi.mock('@/lib/lifecycle-processor', () => ({ processLifecycleAction: vi.fn() }));
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

import { processOffboardCampaigns } from './offboard-campaign';

const NOW = new Date('2026-06-12T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

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

describe('processOffboardCampaigns reminder safety', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.clearAllMocks();
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
    expect(mocks.prisma.offboardCampaignRecipient.findMany).not.toHaveBeenCalled();
    expect(mocks.sendOffboardReminderEmail).not.toHaveBeenCalled();
  });
});
