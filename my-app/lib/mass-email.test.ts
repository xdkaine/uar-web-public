import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => {
  const mock = {
    $transaction: vi.fn(),
    massEmailCampaign: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    massEmailRecipient: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
      groupBy: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
    },
    massEmailLog: {
      create: vi.fn(),
    },
  };

  mock.$transaction.mockImplementation(async (callback: (client: typeof mock) => Promise<unknown>) => callback(mock));
  return mock;
});

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/ldap', () => ({ getLDAPGroupMembers: vi.fn(), listUsersInOU: vi.fn() }));
vi.mock('@/lib/email', () => ({ sendMassEmail: vi.fn() }));

import { getLDAPGroupMembers, listUsersInOU } from '@/lib/ldap';
import {
  activateMassEmailCampaign,
  dedupeMassEmailRecipients,
  massEmailPreviewDigest,
  massEmailResolutionDigest,
  processMassEmailCampaigns,
  reconcileMassEmailRecipient,
  resolveMassEmailRecipients,
  updateMassEmailDraft,
} from './mass-email';

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.$transaction.mockImplementation(async (callback: (client: typeof prismaMock) => Promise<unknown>) => callback(prismaMock));
  prismaMock.massEmailRecipient.groupBy.mockResolvedValue([]);
  prismaMock.massEmailCampaign.updateMany.mockResolvedValue({ count: 1 });
});

describe('mass email delivery ownership', () => {
  it('moves a stale send claim to delivery_unknown and counts it once', async () => {
    prismaMock.massEmailRecipient.findMany.mockResolvedValueOnce([{
      id: 'recipient-1',
      campaignId: 'campaign-1',
      email: 'user@example.test',
      emailClaimId: 'stale-claim',
    }]);
    prismaMock.massEmailRecipient.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.massEmailCampaign.findMany.mockResolvedValue([]);

    await processMassEmailCampaigns();

    expect(prismaMock.massEmailRecipient.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ emailClaimId: 'stale-claim' }),
      data: expect.objectContaining({
        status: 'delivery_unknown',
        deliveryFailureCounted: true,
      }),
    }));
    expect(prismaMock.massEmailCampaign.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { failedCount: { increment: 1 } },
    }));
  });

  it('re-resolves recipients and rejects a stale activation digest', async () => {
    prismaMock.massEmailCampaign.findUnique.mockResolvedValue({
      id: 'campaign-1',
      status: 'draft',
      updatedAt: new Date('2026-08-29T00:00:00.000Z'),
      eligibleRecipients: 1,
      subject: 'Notice',
      html: '<p>Hello</p>',
      targetSnapshot: {
        targets: { selectedUsernames: ['user1'], selectedGroups: [], includeAllDomainUsers: false },
        previewDigest: 'stale-digest',
      },
    });
    vi.mocked(listUsersInOU).mockResolvedValue([{
      username: 'user1', displayName: 'User One', email: 'user1@example.test',
      dn: 'CN=user1,OU=Users,DC=example,DC=test', description: '', accountEnabled: true,
      accountExpires: null, whenCreated: '', memberOf: [],
    }] as Awaited<ReturnType<typeof listUsersInOU>>);

    await expect(activateMassEmailCampaign('campaign-1', 'admin')).rejects.toThrow('MASS_EMAIL_PREVIEW_STALE');
    expect(prismaMock.massEmailCampaign.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'activating' }),
    }));
  });

  it('does not decrement a failure counter that was never incremented', async () => {
    prismaMock.massEmailRecipient.findUnique.mockResolvedValue({
      id: 'recipient-1', campaignId: 'campaign-1', email: 'user@example.test',
      status: 'delivery_unknown', deliveryFailureCounted: false,
    });
    prismaMock.massEmailRecipient.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.massEmailRecipient.count.mockResolvedValue(1);
    prismaMock.massEmailCampaign.findUnique.mockResolvedValue({ id: 'campaign-1', recipients: [], logs: [] });

    await reconcileMassEmailRecipient(
      'campaign-1',
      'recipient-1',
      'admin',
      'not_delivered',
      'SMTP provider confirms no acceptance'
    );

    expect(prismaMock.massEmailCampaign.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.not.objectContaining({ failedCount: expect.anything() }),
    }));
  });
});

describe('dedupeMassEmailRecipients', () => {
  it('binds a preview digest to the exact eligible audience', () => {
    const base = {
      candidates: [],
      recipients: [{
        email: 'alice@example.test', displayName: 'Alice', adUsername: 'alice', adDn: null,
        accountEnabled: true, sources: [{ type: 'manual' as const, label: 'Selected user' }],
      }],
      skipped: [],
      summary: { totalCandidates: 1, eligibleRecipients: 1, skippedRecipients: 0, duplicateSourcesMerged: 0 },
      targets: { selectedUsernames: ['alice'], selectedGroups: [], includeAllDomainUsers: false },
    };

    expect(massEmailResolutionDigest(base)).toMatch(/^[a-f0-9]{64}$/);
    expect(massEmailResolutionDigest(base)).not.toBe(massEmailResolutionDigest({
      ...base,
      recipients: [{ ...base.recipients[0], email: 'bob@example.test' }],
    }));
    expect(massEmailPreviewDigest(base, 'Notice', '<p>Hello</p>')).not.toBe(
      massEmailPreviewDigest(base, 'Changed', '<p>Hello</p>')
    );
    expect(massEmailPreviewDigest(base, 'Notice', '<p>Hello</p>')).not.toBe(
      massEmailPreviewDigest(base, 'Notice', '<p>Changed</p>')
    );
  });

  it('deduplicates by normalized email and preserves all sources', () => {
    const result = dedupeMassEmailRecipients([
      {
        email: 'Fixture.User@Example.test',
        displayName: 'Fixture User',
        adUsername: 'fixtureuser',
        adDn: 'CN=fixtureuser,OU=Users,DC=example,DC=test',
        accountEnabled: true,
        sources: [{ type: 'manual', label: 'Selected user' }],
      },
      {
        email: ' fixture.user@example.test ',
        displayName: 'Fixture User',
        adUsername: 'fixtureuser',
        adDn: 'CN=fixtureuser,OU=Users,DC=example,DC=test',
        accountEnabled: true,
        sources: [{ type: 'group', label: 'Test group', groupDn: 'CN=TestGroup,OU=Groups,DC=example,DC=test' }],
      },
    ]);

    expect(result.recipients).toHaveLength(1);
    expect(result.recipients[0].email).toBe('fixture.user@example.test');
    expect(result.recipients[0].sources).toEqual([
      { type: 'manual', label: 'Selected user' },
      { type: 'group', label: 'Test group', groupDn: 'CN=TestGroup,OU=Groups,DC=example,DC=test' },
    ]);
    expect(result.skipped).toHaveLength(0);
  });

  it('skips invalid email addresses and disabled AD accounts', () => {
    const result = dedupeMassEmailRecipients([
      { email: 'not-email', reason: 'candidate', sources: [{ type: 'manual', label: 'Selected user' }] },
      {
        email: 'disabled.user@example.test',
        displayName: 'Disabled Fixture User',
        adUsername: 'disabled',
        adDn: 'CN=disabled,OU=Users,DC=example,DC=test',
        accountEnabled: false,
        sources: [{ type: 'group', label: 'Test group' }],
      },
    ]);

    expect(result.recipients).toHaveLength(0);
    expect(result.skipped.map((item) => item.reason)).toEqual(['missing_or_invalid_email', 'disabled_ad_account']);
  });

  it('returns candidate, eligible, and skipped rows for dry-run review', async () => {
    vi.mocked(listUsersInOU).mockResolvedValue([
      {
        username: 'eligible',
        displayName: 'Eligible Fixture User',
        email: 'eligible.user@example.test',
        dn: 'CN=eligible,OU=Users,DC=example,DC=test',
        description: '',
        accountEnabled: true,
        accountExpires: null,
        whenCreated: '',
        memberOf: [],
      },
      {
        username: 'disabled',
        displayName: 'Disabled Fixture User',
        email: 'disabled.user@example.test',
        dn: 'CN=disabled,OU=Users,DC=example,DC=test',
        description: '',
        accountEnabled: false,
        accountExpires: null,
        whenCreated: '',
        memberOf: [],
      },
    ] as Awaited<ReturnType<typeof listUsersInOU>>);
    vi.mocked(getLDAPGroupMembers).mockResolvedValue([]);

    const result = await resolveMassEmailRecipients({ selectedUsernames: ['eligible', 'disabled', 'missing'] });

    expect(result.candidates).toHaveLength(3);
    expect(result.recipients.map((item) => item.adUsername)).toEqual(['eligible']);
    expect(result.skipped.map((item) => item.reason)).toEqual(['disabled_ad_account', 'user_not_found']);
    expect(result.summary).toMatchObject({
      totalCandidates: 3,
      eligibleRecipients: 1,
      skippedRecipients: 2,
    });
  });

  it('accepts manual usernames, AD-linked emails, and standalone valid emails', async () => {
    vi.mocked(listUsersInOU).mockResolvedValue([
      {
        username: 'manualuser',
        displayName: 'Manual Fixture User',
        email: 'manual.user@example.test',
        dn: 'CN=manualuser,OU=Users,DC=example,DC=test',
        description: '',
        accountEnabled: true,
        accountExpires: null,
        whenCreated: '',
        memberOf: [],
      },
      {
        username: 'linkeduser',
        displayName: 'Linked Fixture User',
        email: 'linked.user@example.test',
        dn: 'CN=linkeduser,OU=Users,DC=example,DC=test',
        description: '',
        accountEnabled: true,
        accountExpires: null,
        whenCreated: '',
        memberOf: [],
      },
    ] as Awaited<ReturnType<typeof listUsersInOU>>);
    vi.mocked(getLDAPGroupMembers).mockResolvedValue([]);

    const result = await resolveMassEmailRecipients({
      selectedUsernames: ['manualuser', 'linked.user@example.test', 'standalone@example.test', 'missing-user'],
    });

    expect(result.candidates).toHaveLength(4);
    expect(result.recipients.map((item) => item.email)).toEqual([
      'linked.user@example.test',
      'manual.user@example.test',
      'standalone@example.test',
    ]);
    expect(result.recipients.find((item) => item.email === 'linked.user@example.test')?.adUsername).toBe('linkeduser');
    expect(result.recipients.find((item) => item.email === 'standalone@example.test')?.adUsername).toBeNull();
    expect(result.skipped.map((item) => item.reason)).toEqual(['user_not_found']);
    expect(result.summary).toMatchObject({
      totalCandidates: 4,
      eligibleRecipients: 3,
      skippedRecipients: 1,
    });
  });

  it('updates draft content and replaces ready recipients with an activity log', async () => {
    vi.mocked(listUsersInOU).mockResolvedValue([
      {
        username: 'eligible',
        displayName: 'Eligible Fixture User',
        email: 'eligible.user@example.test',
        dn: 'CN=eligible,OU=Users,DC=example,DC=test',
        description: '',
        accountEnabled: true,
        accountExpires: null,
        whenCreated: '',
        memberOf: [],
      },
    ] as Awaited<ReturnType<typeof listUsersInOU>>);
    vi.mocked(getLDAPGroupMembers).mockResolvedValue([]);

    prismaMock.massEmailCampaign.findUnique
      .mockResolvedValueOnce({
        id: 'campaign-1',
        status: 'draft',
        updatedAt: new Date('2026-08-29T00:00:00.000Z'),
        subject: 'Old subject',
        html: '<p>Old message</p>',
        totalRecipients: 1,
        eligibleRecipients: 1,
        skippedRecipients: 0,
      })
      .mockResolvedValueOnce({
        id: 'campaign-1',
        status: 'draft',
        subject: 'New subject',
        html: '<p>New message</p>',
        recipients: [],
        logs: [],
      });
    prismaMock.massEmailRecipient.groupBy.mockResolvedValue([{ status: 'ready', _count: { status: 1 } }]);

    await updateMassEmailDraft('campaign-1', {
      subject: 'New subject',
      html: '<p>New message</p>',
      targets: { selectedUsernames: ['eligible'] },
    }, 'admin');

    expect(prismaMock.massEmailCampaign.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'campaign-1', status: 'draft' }),
      data: expect.objectContaining({
        subject: 'New subject',
        eligibleRecipients: 1,
        skippedRecipients: 0,
      }),
    }));
    expect(prismaMock.massEmailRecipient.deleteMany).toHaveBeenCalledWith({ where: { campaignId: 'campaign-1' } });
    expect(prismaMock.massEmailRecipient.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({
        campaignId: 'campaign-1',
        email: 'eligible.user@example.test',
        status: 'ready',
      })],
    }));
    expect(prismaMock.massEmailLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        campaignId: 'campaign-1',
        eventType: 'draft_updated',
        actor: 'admin',
      }),
    }));
  });
});
