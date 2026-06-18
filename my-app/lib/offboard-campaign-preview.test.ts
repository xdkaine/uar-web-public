import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prisma: {
    offboardCampaign: {
      findUnique: vi.fn(),
    },
    offboardCampaignRecipient: {
      findMany: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
    },
    offboardCampaignExtensionReminder: {
      findMany: vi.fn(),
    },
    vPNAccount: {
      findUnique: vi.fn(),
    },
    accessRequest: {
      findUnique: vi.fn(),
    },
  },
  searchLDAPUser: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('@/lib/ldap', () => ({
  listUsersInOU: vi.fn(),
  searchLDAPUser: mocks.searchLDAPUser,
}));
vi.mock('@/lib/email', () => ({
  sendOffboardInitialEmail: vi.fn(),
  sendOffboardReminderEmail: vi.fn(),
  sendOffboardExtensionEmail: vi.fn(),
  sendOffboardExtensionReminderEmail: vi.fn(),
}));
vi.mock('@/lib/lifecycle-processor', () => ({ processLifecycleAction: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  appLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@/lib/audit-log', () => ({
  AuditActions: {},
  AuditCategories: { OFFBOARD_CAMPAIGN: 'offboard_campaign' },
  sanitizeAuditDetails: (value: unknown) => value,
}));

import {
  previewOffboardDeadlineExtension,
  previewProcessAllOffboardCampaign,
} from './offboard-campaign';

describe('previewOffboardDeadlineExtension', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.offboardCampaign.findUnique.mockResolvedValue({
      id: 'campaign-1',
      status: 'active',
      cancelledAt: null,
      emergencyStoppedAt: null,
    });
    mocks.searchLDAPUser.mockResolvedValue({
      attributes: [
        { type: 'userAccountControl', values: ['514'] },
      ],
    });
    mocks.prisma.vPNAccount.findUnique.mockResolvedValue({
      status: 'revoked',
      canRestore: true,
    });
    mocks.prisma.accessRequest.findUnique.mockResolvedValue({ status: 'offboarded' });
  });

  it('separates sent, enforced, verified, and skipped recipients safely', async () => {
    const campaign = { id: 'campaign-1', name: 'Active cleanup', status: 'active' };
    mocks.prisma.offboardCampaignRecipient.findMany.mockResolvedValue([
      {
        id: 'sent-1',
        campaignId: 'campaign-1',
        campaign,
        adUsername: 'sent-user',
        status: 'sent',
        verifiedAt: null,
        deadlineAt: new Date('2026-06-15T12:00:00.000Z'),
      },
      {
        id: 'enforced-1',
        campaignId: 'campaign-1',
        campaign,
        adUsername: 'enforced-user',
        status: 'enforced',
        verifiedAt: null,
        deadlineAt: new Date('2026-06-10T12:00:00.000Z'),
        originalAdEnabled: true,
        linkedVpnUsername: 'enforced-vpn',
        originalVpnStatus: 'active',
        accessRequestId: 'request-1',
        originalSnapshot: {
          accessRequest: { status: 'approved' },
          vpn: { password: 'snapshot-password' },
        },
      },
      {
        id: 'verified-1',
        campaignId: 'campaign-1',
        campaign,
        adUsername: 'verified-user',
        status: 'verified',
        verifiedAt: new Date('2026-06-12T12:00:00.000Z'),
        deadlineAt: new Date('2026-06-15T12:00:00.000Z'),
      },
      {
        id: 'skipped-1',
        campaignId: 'campaign-1',
        campaign,
        adUsername: 'skipped-user',
        status: 'skipped',
        verifiedAt: null,
        deadlineAt: null,
      },
    ]);

    const preview = await previewOffboardDeadlineExtension('campaign-1', {
      newDeadline: '2027-06-20T12:00:00.000Z',
      reminderDates: ['2027-06-18T12:00:00.000Z'],
    });

    expect(preview).toMatchObject({
      total: 4,
      eligible: 2,
      sent: 1,
      enforced: 1,
      excluded: 2,
    });
    expect(preview.items.find(item => item.recipientId === 'verified-1')).toMatchObject({
      eligible: false,
      excludedReason: 'already_verified',
    });
    expect(preview.items.find(item => item.recipientId === 'skipped-1')).toMatchObject({
      eligible: false,
      excludedReason: 'skipped_recipient',
    });
    expect(preview.items.find(item => item.recipientId === 'enforced-1')).toMatchObject({
      eligible: true,
      reactivationRequired: true,
      actions: expect.arrayContaining(['enable_ad', 'restore_vpn', 'restore_request:approved']),
    });
  });

  it('describes all due work without treating verified or skipped recipients as runnable work', async () => {
    mocks.prisma.offboardCampaign.findUnique.mockResolvedValue({
      id: 'campaign-1',
      status: 'active',
      sendingPaused: true,
      remindersPaused: false,
      enforcementPaused: true,
      cancelledAt: null,
      emergencyStoppedAt: null,
    });
    mocks.prisma.offboardCampaignRecipient.count
      .mockResolvedValueOnce(12)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(3);
    const previewNow = new Date();
    mocks.prisma.offboardCampaignExtensionReminder.findMany.mockResolvedValue([
      {
        scheduledFor: new Date(previewNow.getTime() - 60_000),
        extension: { createdAt: new Date(previewNow.getTime() - 2 * 24 * 60 * 60 * 1000) },
      },
      {
        scheduledFor: new Date(previewNow.getTime() - 60_000),
        extension: { createdAt: new Date(previewNow.getTime() - 60 * 60 * 1000) },
      },
    ]);
    mocks.prisma.offboardCampaignRecipient.groupBy.mockResolvedValue([
      { status: 'sent', _count: { status: 8 } },
      { status: 'verified', _count: { status: 5 } },
      { status: 'enforced', _count: { status: 4 } },
      { status: 'skipped', _count: { status: 2 } },
    ]);

    const preview = await previewProcessAllOffboardCampaign('campaign-1');

    expect(preview.sections).toMatchObject({
      initialEmails: { count: 12, paused: true },
      reminders: {
        count: 6,
        day3: 3,
        day6: 2,
        extension: 1,
        suppressedExtension: 1,
        paused: false,
      },
      enforcement: { count: 4, adDisables: 4, vpnRevocations: 3, paused: true },
    });
    expect(preview.statusCounts).toEqual({
      sent: 8,
      verified: 5,
      enforced: 4,
      skipped: 2,
    });

    expect(mocks.prisma.offboardCampaignRecipient.count.mock.calls[1][0].where.deadlineAt)
      .toEqual({ gt: expect.any(Date) });
    expect(mocks.prisma.offboardCampaignRecipient.count.mock.calls[2][0].where.deadlineAt)
      .toEqual({ gt: expect.any(Date) });
    expect(mocks.prisma.offboardCampaignRecipient.count.mock.calls[1][0].where.extensions)
      .toMatchObject({
        none: {
          status: { in: ['active', 'notification_failed', 'pending_notification'] },
          newDeadlineAt: { gt: expect.any(Date) },
        },
      });
    expect(mocks.prisma.offboardCampaignRecipient.count.mock.calls[2][0].where.extensions)
      .toMatchObject({
        none: {
          status: { in: ['active', 'notification_failed', 'pending_notification'] },
          newDeadlineAt: { gt: expect.any(Date) },
        },
      });
    expect(mocks.prisma.offboardCampaignExtensionReminder.findMany.mock.calls[0][0].where.extension)
      .toMatchObject({
        newDeadlineAt: { gt: expect.any(Date) },
        recipient: { deadlineAt: { gt: expect.any(Date) } },
      });
  });

  it('treats an explicitly empty recipient selection as no recipients', async () => {
    const preview = await previewOffboardDeadlineExtension('campaign-1', {
      recipientIds: [],
      newDeadline: '2027-06-20T12:00:00.000Z',
    });

    expect(preview).toMatchObject({
      total: 0,
      eligible: 0,
      excluded: 0,
    });
    expect(mocks.prisma.offboardCampaignRecipient.findMany).not.toHaveBeenCalled();
  });
});
