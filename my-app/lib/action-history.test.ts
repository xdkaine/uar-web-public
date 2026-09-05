import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  accessRequestFindMany: vi.fn(),
  vpnAccountFindMany: vi.fn(),
  auditLogFindMany: vi.fn(),
  requestCommentFindMany: vi.fn(),
  lifecycleActionFindMany: vi.fn(),
  adActivityFindMany: vi.fn(),
  vpnStatusFindMany: vi.fn(),
  vpnActivityFindMany: vi.fn(),
  adMatchFindMany: vi.fn(),
  offboardRecipientFindMany: vi.fn(),
  passwordTokenFindMany: vi.fn(),
  activationTokenFindMany: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    accessRequest: { findMany: mocks.accessRequestFindMany },
    vPNAccount: { findMany: mocks.vpnAccountFindMany },
    auditLog: { findMany: mocks.auditLogFindMany },
    requestComment: { findMany: mocks.requestCommentFindMany },
    accountLifecycleAction: { findMany: mocks.lifecycleActionFindMany },
    aDAccountActivityLog: { findMany: mocks.adActivityFindMany },
    vPNAccountStatusLog: { findMany: mocks.vpnStatusFindMany },
    vPNAccountActivityLog: { findMany: mocks.vpnActivityFindMany },
    aDAccountMatch: { findMany: mocks.adMatchFindMany },
    offboardCampaignRecipient: { findMany: mocks.offboardRecipientFindMany },
    passwordResetToken: { findMany: mocks.passwordTokenFindMany },
    accountActivationToken: { findMany: mocks.activationTokenFindMany },
  },
}));
import {
  activityIsRepresentedByAudit,
  adActivityOwnershipLinks,
  getActionHistory,
  vpnStatusIdsRepresentedByActivity,
} from './action-history';

beforeEach(() => {
  vi.clearAllMocks();
  for (const mock of Object.values(mocks)) mock.mockResolvedValue([]);
});

describe('action history evidence consolidation', () => {
  it('uses the canonical audit event when an activity row names the same lifecycle action', () => {
    expect(activityIsRepresentedByAudit('action-1', new Set(['action-1']))).toBe(true);
    expect(activityIsRepresentedByAudit('action-2', new Set(['action-1']))).toBe(false);
  });

  it('does not present a batch account item as an access-request link', () => {
    const links = adActivityOwnershipLinks(
      'batch-item-1',
      'action-1',
      new Map([['action-1', {
        id: 'action-1',
        relatedRequestId: null,
        relatedBatchAccountItemId: 'batch-item-1',
      }]]),
      ['request-1'],
    );

    expect(links).toEqual({
      relatedRequestId: undefined,
      relatedBatchAccountItemId: 'batch-item-1',
    });
  });

  it('retains a genuine request-owned AD activity link', () => {
    expect(adActivityOwnershipLinks(
      'request-1',
      null,
      new Map(),
      ['request-1'],
    )).toEqual({ relatedRequestId: 'request-1', relatedBatchAccountItemId: undefined });
  });

  it('maps legacy restored activity to active status without relying on identical labels', () => {
    const createdAt = new Date('2026-09-05T12:00:00.000Z');
    const represented = vpnStatusIdsRepresentedByActivity(
      [{
        id: 'status-1',
        accountId: 'vpn-1',
        newStatus: 'active',
        changedBy: 'admin',
        createdAt: new Date(createdAt.getTime() + 100),
        lifecycleActionId: null,
      }],
      [{
        id: 'activity-1',
        accountId: 'vpn-1',
        actionType: 'restored',
        performedBy: 'admin',
        createdAt,
        lifecycleActionId: 'action-1',
      }],
    );

    expect(represented).toEqual(new Set(['status-1']));
  });

  it('does not collapse ambiguous independent legacy VPN mutations within the same time window', () => {
    const createdAt = new Date('2026-09-05T12:00:00.000Z');
    const represented = vpnStatusIdsRepresentedByActivity(
      [
        { id: 'status-1', accountId: 'vpn-1', newStatus: 'revoked', changedBy: 'admin', createdAt, lifecycleActionId: null },
        { id: 'status-2', accountId: 'vpn-1', newStatus: 'revoked', changedBy: 'admin', createdAt: new Date(createdAt.getTime() + 500), lifecycleActionId: null },
      ],
      [
        { id: 'activity-1', accountId: 'vpn-1', actionType: 'revoked', performedBy: 'admin', createdAt, lifecycleActionId: 'action-1' },
        { id: 'activity-2', accountId: 'vpn-1', actionType: 'revoked', performedBy: 'admin', createdAt: new Date(createdAt.getTime() + 500), lifecycleActionId: 'action-2' },
      ],
    );

    expect(represented).toEqual(new Set());
  });

  it('uses durable lifecycle correlation for independent VPN mutations', () => {
    const createdAt = new Date('2026-09-05T12:00:00.000Z');
    const represented = vpnStatusIdsRepresentedByActivity(
      [
        { id: 'status-1', accountId: 'vpn-1', newStatus: 'revoked', changedBy: 'admin', createdAt, lifecycleActionId: 'action-1' },
        { id: 'status-2', accountId: 'vpn-1', newStatus: 'revoked', changedBy: 'admin', createdAt, lifecycleActionId: 'action-2' },
      ],
      [
        { id: 'activity-1', accountId: 'vpn-1', actionType: 'revoked', performedBy: 'admin', createdAt, lifecycleActionId: 'action-1' },
        { id: 'activity-2', accountId: 'vpn-1', actionType: 'revoked', performedBy: 'admin', createdAt, lifecycleActionId: 'action-2' },
      ],
    );

    expect(represented).toEqual(new Set(['status-1', 'status-2']));
  });

  it('suppresses request lifecycle projections when canonical completed audits exist', async () => {
    const createdAt = new Date('2026-09-05T12:00:00.000Z');
    mocks.accessRequestFindMany
      .mockResolvedValueOnce([{
        id: 'request-1',
        email: 'person@example.org',
        ldapUsername: 'person',
        vpnUsername: 'person',
        linkedAdUsername: null,
        linkedVpnUsername: null,
      }])
      .mockResolvedValueOnce([{
        id: 'request-1',
        name: 'Person One',
        email: 'person@example.org',
        ldapUsername: 'person',
        vpnUsername: 'person',
        linkedAdUsername: null,
        linkedVpnUsername: null,
        createdAt,
        adDisabledAt: createdAt,
        adDisabledBy: 'admin',
        vpnRevokedAt: createdAt,
        vpnRevokedBy: 'admin',
        vpnRestoredAt: createdAt,
        vpnRestoredBy: 'admin',
        status: 'approved',
        isInternal: true,
      }]);
    mocks.auditLogFindMany.mockResolvedValue([
      lifecycleAudit('audit-disable', 'action-disable', 'disable_ad', createdAt),
      lifecycleAudit('audit-revoke', 'action-revoke', 'revoke_vpn', createdAt),
      lifecycleAudit('audit-restore', 'action-restore', 'restore_vpn', createdAt),
    ]);

    const result = await getActionHistory({ requestId: 'request-1', includeReads: true });
    const titles = result.items.map((item) => item.title);

    expect(titles).not.toContain('AD account disabled');
    expect(titles).not.toContain('VPN access revoked');
    expect(titles).not.toContain('VPN access restored');
    expect(result.items.filter((item) => item.source === 'audit_log')).toHaveLength(3);
  });
});

function lifecycleAudit(
  id: string,
  lifecycleActionId: string,
  actionType: string,
  createdAt: Date,
) {
  return {
    id,
    createdAt,
    action: actionType,
    category: 'lifecycle',
    username: 'system',
    actorType: 'system',
    targetId: lifecycleActionId,
    targetType: 'AccountLifecycleAction',
    subjectUsername: 'person',
    subjectEmail: null,
    relatedRequestId: 'request-1',
    relatedVpnAccountId: null,
    relatedLifecycleActionId: lifecycleActionId,
    eventKind: 'lifecycle',
    outcome: 'success',
    correlationId: `lifecycle:${lifecycleActionId}`,
    clientId: null,
    providerSid: null,
    riskLevel: null,
    details: JSON.stringify({ lifecycleEvent: 'completed', actionType }),
    ipAddress: null,
    userAgent: null,
    success: true,
    errorMessage: null,
  };
}
