import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => {
  const mock = {
    $transaction: vi.fn(),
    massEmailCampaign: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    massEmailRecipient: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
      groupBy: vi.fn(),
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
import { dedupeMassEmailRecipients, resolveMassEmailRecipients, updateMassEmailDraft } from './mass-email';

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.$transaction.mockImplementation(async (callback: (client: typeof prismaMock) => Promise<unknown>) => callback(prismaMock));
  prismaMock.massEmailRecipient.groupBy.mockResolvedValue([]);
});

describe('dedupeMassEmailRecipients', () => {
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

    expect(prismaMock.massEmailCampaign.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'campaign-1' },
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