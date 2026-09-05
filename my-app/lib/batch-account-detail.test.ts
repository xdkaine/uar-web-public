import { describe, expect, it } from 'vitest';

import {
  inspectBatchAccountSummary,
  projectBatchAccountDetail,
  type BatchAccountDetailSource,
} from './batch-account-detail';

function source(overrides: Partial<BatchAccountDetailSource> = {}): BatchAccountDetailSource {
  return {
    id: 'item-1',
    createdAt: '2026-08-31T01:00:00.000Z',
    updatedAt: '2026-08-31T01:04:00.000Z',
    accountType: 'AD',
    name: 'Account Person',
    email: 'account.person@example.test',
    ldapUsername: 'accountperson',
    vpnUsername: null,
    accessRequestId: 'request-1',
    accountExpiresAt: null,
    isInternal: true,
    status: 'completed',
    mutationStage: 'external_mutations_complete',
    ldapCreatedAt: '2026-08-31T01:03:00.000Z',
    vpnCreatedAt: null,
    errorMessage: null,
    completedAt: '2026-08-31T01:04:00.000Z',
    targetDirectoryDn: 'CN=accountperson,OU=Users,DC=example,DC=test',
    targetDirectoryObjectGuid: 'guid-accountperson',
    ...overrides,
  };
}

describe('batch account detail projection', () => {
  it('uses AD terminology and request tracking for directory accounts', () => {
    const account = projectBatchAccountDetail(source());

    expect(account).toMatchObject({
      accountSystem: 'AD',
      accountSystemLabel: 'Active Directory',
      username: 'accountperson',
      accessRequestId: 'request-1',
      issues: [],
      needsAttention: false,
    });
  });

  it('uses the VPN username without presenting the storage alias as LDAP', () => {
    const account = projectBatchAccountDetail(source({
      accountType: 'VPN',
      ldapUsername: 'storage-alias',
      vpnUsername: 'vpn-person',
      accessRequestId: null,
      ldapCreatedAt: null,
      vpnCreatedAt: '2026-08-31T01:03:00.000Z',
      targetDirectoryDn: null,
      targetDirectoryObjectGuid: null,
    }));

    expect(account).toMatchObject({
      accountSystem: 'VPN',
      accountSystemLabel: 'VPN',
      username: 'vpn-person',
      issues: [],
    });
    expect(account).not.toHaveProperty('ldapUsername');
  });

  it('flags legacy VPN fallback and missing AD governance evidence', () => {
    const legacyVpn = projectBatchAccountDetail(source({
      accountType: 'VPN',
      vpnUsername: null,
      ldapUsername: 'legacy-vpn',
      accessRequestId: null,
      ldapCreatedAt: null,
      vpnCreatedAt: null,
      targetDirectoryDn: null,
      targetDirectoryObjectGuid: null,
    }));
    const untrackedAd = projectBatchAccountDetail(source({
      accessRequestId: null,
      targetDirectoryObjectGuid: null,
    }));

    expect(legacyVpn.username).toBe('legacy-vpn');
    expect(legacyVpn.issues.map(issue => issue.code)).toEqual(expect.arrayContaining([
      'legacy_vpn_username_fallback',
      'missing_vpn_completion_time',
    ]));
    expect(untrackedAd.issues.map(issue => issue.code)).toEqual(expect.arrayContaining([
      'missing_access_request',
      'missing_directory_identity',
    ]));
  });

  it('flags and suppresses AD-only evidence attached to a VPN item', () => {
    const account = projectBatchAccountDetail(source({
      accountType: 'VPN',
      vpnUsername: 'vpn-person',
      accessRequestId: 'request-that-does-not-belong',
      ldapCreatedAt: '2026-08-31T01:02:00.000Z',
      vpnCreatedAt: '2026-08-31T01:03:00.000Z',
    }));

    expect(account.accessRequestId).toBeNull();
    expect(account.directoryDn).toBeNull();
    expect(account.directoryObjectGuid).toBeNull();
    expect(account.needsAttention).toBe(true);
    expect(account.issues.map(issue => issue.code)).toEqual(expect.arrayContaining([
      'unexpected_vpn_request_link',
      'unexpected_directory_evidence',
    ]));
  });

  it('flags unsupported account systems and impossible batch totals', () => {
    const invalid = projectBatchAccountDetail(source({
      accountType: 'LDAP',
      ldapUsername: '',
      status: 'failed',
      errorMessage: 'Unsupported legacy record',
    }));
    const summaryIssues = inspectBatchAccountSummary({
      status: 'completed',
      totalAccounts: 2,
      successfulAccounts: 3,
      failedAccounts: 0,
      completedAt: '2026-08-31T01:05:00.000Z',
    }, [invalid]);

    expect(invalid.accountSystem).toBe('UNKNOWN');
    expect(invalid.issues.map(issue => issue.code)).toEqual(expect.arrayContaining([
      'unsupported_account_system',
      'missing_username',
    ]));
    expect(summaryIssues.map(issue => issue.code)).toEqual(expect.arrayContaining([
      'account_count_mismatch',
      'outcome_count_mismatch',
      'incomplete_completed_summary',
      'completed_with_open_items',
    ]));
  });

  it('makes an ambiguous started mutation actionable during reconciliation', () => {
    const account = projectBatchAccountDetail(source({
      status: 'processing',
      mutationStage: 'ldap_password_started',
      ldapCreatedAt: null,
      completedAt: null,
    }), { batchStatus: 'reconciliation_required' });
    const summaryIssues = inspectBatchAccountSummary({
      status: 'reconciliation_required',
      totalAccounts: 1,
      successfulAccounts: 0,
      failedAccounts: 0,
      completedAt: null,
    }, [account]);

    expect(account.needsAttention).toBe(true);
    expect(account.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'unreconciled_external_mutation',
        message: expect.stringContaining('Do not retry or roll back'),
      }),
    ]));
    expect(summaryIssues.map(issue => issue.code)).toContain('reconciliation_targets_pending');
  });

  it('detects completed outcome counters that disagree with item states', () => {
    const accounts = [
      projectBatchAccountDetail(source({ id: 'item-1' })),
      projectBatchAccountDetail(source({ id: 'item-2', ldapUsername: 'accountperson2' })),
    ];
    const summaryIssues = inspectBatchAccountSummary({
      status: 'completed',
      totalAccounts: 2,
      successfulAccounts: 1,
      failedAccounts: 1,
      completedAt: '2026-08-31T01:05:00.000Z',
    }, accounts);

    expect(summaryIssues.map(issue => issue.code)).toContain('completed_outcome_state_mismatch');
  });
});
