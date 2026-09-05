import { describe, expect, it } from 'vitest';

import { deriveAccountSyncPosture, isNewerSyncRequest, type SyncPostureInput } from './sync-status';

const base: SyncPostureInput = {
  hasAdAccount: true,
  adAccountEnabled: false,
  adEmail: 'person@cpp.edu',
  adUsername: 'person',
  hasVpnAccount: true,
  vpnUsername: 'person',
  vpnPortalType: 'Limited',
  vpnStatus: 'revoked',
  hasAccessRequest: true,
  requestStatus: 'offboarded',
};

describe('deriveAccountSyncPosture', () => {
  it('distinguishes a safely offboarded identity from an onboarded full match', () => {
    expect(deriveAccountSyncPosture(base, true)).toEqual({ status: 'offboarded', issues: [] });
  });

  it('flags live access that remains after offboarding', () => {
    expect(deriveAccountSyncPosture({
      ...base,
      adAccountEnabled: true,
      vpnStatus: 'active',
    }, true)).toEqual({
      status: 'offboarded',
      issues: [
        'Offboarded request but AD account is enabled',
        'Offboarded request but VPN status is active',
      ],
    });
  });

  it('treats missing ownership as informational for an AD-only account', () => {
    const result = deriveAccountSyncPosture({
      ...base,
      adAccountEnabled: true,
      hasVpnAccount: false,
      vpnUsername: null,
      vpnPortalType: null,
      vpnStatus: null,
      hasAccessRequest: false,
      requestStatus: null,
    }, true);
    expect(result.status).toBe('ad_only');
    expect(result.issues).toEqual([]);
  });

  it('does not require a request or VPN for an intentionally AD-only batch account', () => {
    const result = deriveAccountSyncPosture({
      ...base, hasAccessRequest: false, requestStatus: null,
      hasVpnAccount: false, vpnUsername: null, vpnStatus: null,
      ownership: {
        ownerType: 'batch_account', ownerId: 'item-1', requestId: null,
        batchItemId: 'item-1', batchRunId: 'run-1', readiness: 'ready',
        expectedSystems: ['AD'], requestHref: null, batchHref: '/admin/batch-accounts/run-1',
      },
    }, true);
    expect(result).toEqual({ status: 'ad_only', issues: [] });
  });

  it('reports incomplete batch ownership without inventing a missing request', () => {
    const result = deriveAccountSyncPosture({
      ...base, hasAccessRequest: false, requestStatus: null,
      ownership: {
        ownerType: 'batch_account', ownerId: 'item-1', requestId: null,
        batchItemId: 'item-1', batchRunId: 'run-1', readiness: 'needs_review',
        expectedSystems: ['AD'], requestHref: null, batchHref: null,
      },
    }, true);
    expect(result.issues).toContain('Portal ownership needs review');
    expect(result.issues.join(' ')).not.toContain('no access request');
  });
});

describe('isNewerSyncRequest', () => {
  it('selects the newest request when a username is reused after offboarding', () => {
    const offboarded = { id: 'request-old', status: 'offboarded', createdAt: '2026-01-01T00:00:00.000Z' };
    const reenrolled = { id: 'request-new', status: 'approved', createdAt: '2026-02-01T00:00:00.000Z' };

    expect(isNewerSyncRequest(reenrolled, offboarded)).toBe(true);
    expect(isNewerSyncRequest(offboarded, reenrolled)).toBe(false);
  });

  it('uses the request id as a stable tie-breaker', () => {
    const createdAt = '2026-01-01T00:00:00.000Z';
    expect(isNewerSyncRequest(
      { id: 'request-b', status: 'approved', createdAt },
      { id: 'request-a', status: 'offboarded', createdAt }
    )).toBe(true);
  });
});
