import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    accessRequest: { findMany: vi.fn() },
    auditLog: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
  },
}));

vi.mock('@/lib/ldap', () => ({
  createLDAPClient: vi.fn(),
}));

vi.mock('@/lib/email', () => ({
  sendPasswordExpirationReminderEmail: vi.fn(),
}));

vi.mock('@/lib/audit-log', async () => {
  const actual = await vi.importActual<typeof import('@/lib/audit-log')>('@/lib/audit-log');
  return {
    ...actual,
    logAuditAction: vi.fn(),
  };
});

vi.mock('@/lib/logger', () => ({
  appLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  ldapLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  adIntervalToDays,
  buildPasswordReminderKey,
  classifyPasswordExpirationAccount,
  fileTimeToDate,
  getPasswordReminderMilestone,
  getPasswordExpirationWarningDays,
  isPasswordExpirationSchedulerEnabled,
  runGuardedPasswordExpirationScheduler,
} from './password-expiration';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('fileTimeToDate', () => {
  it('converts Windows FILETIME values to UTC dates', () => {
    expect(fileTimeToDate('133801632000000000')?.toISOString()).toBe('2025-01-01T00:00:00.000Z');
  });

  it('treats AD never-expire sentinel values as null', () => {
    expect(fileTimeToDate('0')).toBeNull();
    expect(fileTimeToDate('9223372036854775807')).toBeNull();
  });

  it('returns null for invalid or out-of-range values', () => {
    expect(fileTimeToDate('not-a-filetime')).toBeNull();
    expect(fileTimeToDate('-1')).toBeNull();
  });
});

describe('adIntervalToDays', () => {
  it('treats the AD Int64 minimum sentinel as a non-expiring policy', () => {
    expect(adIntervalToDays('-9223372036854775808')).toBe(0);
  });

  it('converts negative AD duration ticks to days', () => {
    expect(adIntervalToDays('-77760000000000')).toBe(90);
  });

  it('accepts positive interval values defensively', () => {
    expect(adIntervalToDays('12096000000000')).toBe(14);
  });
});

describe('password reminder milestones', () => {
  it('uses the next applicable 14/7/3/1-day milestone', () => {
    expect(getPasswordReminderMilestone('expiring_soon', 14, 14)).toBe(14);
    expect(getPasswordReminderMilestone('expiring_soon', 13, 14)).toBe(14);
    expect(getPasswordReminderMilestone('expiring_soon', 7, 14)).toBe(7);
    expect(getPasswordReminderMilestone('expiring_soon', 2, 14)).toBe(3);
    expect(getPasswordReminderMilestone('expiring_soon', 1, 14)).toBe(1);
  });

  it('creates distinct keys for milestone and state transitions', () => {
    expect(buildPasswordReminderKey('Fixture', 'password-v1', 14)).toBe('fixture:password-v1:14');
    expect(buildPasswordReminderKey('Fixture', 'password-v1', 'expired')).toBe('fixture:password-v1:expired');
  });
});

describe('classifyPasswordExpirationAccount', () => {
  const account = {
    requestId: 'request-1',
    username: 'fixture',
    displayName: 'Fixture User',
    email: 'fixture@example.test',
  };
  const now = new Date('2026-06-17T12:00:00.000Z');
  const baseInput = {
    account,
    maxPasswordAgeDays: 90,
    warningDays: 14,
    now,
    policySource: 'ad_domain_policy' as const,
  };

  it('skips disabled AD accounts', () => {
    const row = classifyPasswordExpirationAccount({
      ...baseInput,
      entry: {
        sAMAccountName: 'fixture',
        userAccountControl: String(0x0200 | 0x0002),
        mail: account.email,
      },
    });
    expect(row).toMatchObject({
      status: 'skipped',
      skipReason: 'ad_account_disabled',
      eligibleForNotification: false,
    });
  });

  it('marks pwdLastSet zero as must-change and does not invent a last-set date', () => {
    const row = classifyPasswordExpirationAccount({
      ...baseInput,
      entry: {
        sAMAccountName: 'fixture',
        userAccountControl: '512',
        pwdLastSet: '0',
        whenChanged: '20260617120000.0Z',
        mail: account.email,
      },
    });
    expect(row).toMatchObject({
      status: 'must_change',
      passwordLastSet: null,
      reminderMilestone: 'must_change',
      eligibleForNotification: true,
    });
  });

  it('honors the AD non-expiring password flag', () => {
    const row = classifyPasswordExpirationAccount({
      ...baseInput,
      entry: {
        sAMAccountName: 'fixture',
        userAccountControl: String(0x0200 | 0x10000),
        mail: account.email,
      },
    });
    expect(row.status).toBe('never_expires');
    expect(row.eligibleForNotification).toBe(false);
  });

  it('honors computed and domain-wide non-expiring policies', () => {
    const computed = classifyPasswordExpirationAccount({
      ...baseInput,
      entry: {
        sAMAccountName: 'fixture',
        userAccountControl: '512',
        pwdLastSet: '133801632000000000',
        mail: account.email,
        'msDS-UserPasswordExpiryTimeComputed': '9223372036854775807',
      },
    });
    const domainWide = classifyPasswordExpirationAccount({
      ...baseInput,
      maxPasswordAgeDays: null,
      entry: {
        sAMAccountName: 'fixture',
        userAccountControl: '512',
        pwdLastSet: '133801632000000000',
        mail: account.email,
      },
    });

    expect(computed.status).toBe('never_expires');
    expect(domainWide.status).toBe('never_expires');
  });

  it('does not invent an expiry when the AD domain policy is unavailable', () => {
    const row = classifyPasswordExpirationAccount({
      ...baseInput,
      maxPasswordAgeDays: null,
      policySource: 'ad_unavailable',
      entry: {
        sAMAccountName: 'fixture',
        userAccountControl: '512',
        pwdLastSet: '133801632000000000',
        mail: account.email,
      },
    });

    expect(row).toMatchObject({
      status: 'unknown',
      passwordExpiresAt: null,
      policySource: 'ad_unavailable',
      eligibleForNotification: false,
    });
  });

  it('keeps an actionable row visible but ineligible when email is missing', () => {
    const row = classifyPasswordExpirationAccount({
      ...baseInput,
      account: { ...account, email: '' },
      entry: {
        sAMAccountName: 'fixture',
        userAccountControl: '512',
        pwdLastSet: '0',
      },
    });
    expect(row).toMatchObject({
      status: 'must_change',
      skipReason: 'missing_or_invalid_email',
      eligibleForNotification: false,
    });
  });

  it('assigns expiring and expired states from computed AD expiry', () => {
    const toFileTime = (date: Date) => (
      BigInt(date.getTime()) * BigInt(10000) + BigInt('116444736000000000')
    ).toString();
    const passwordLastSet = toFileTime(new Date('2026-03-31T12:00:00.000Z'));
    const expiring = classifyPasswordExpirationAccount({
      ...baseInput,
      entry: {
        sAMAccountName: 'fixture',
        userAccountControl: '512',
        pwdLastSet: passwordLastSet,
        mail: account.email,
        'msDS-UserPasswordExpiryTimeComputed': toFileTime(new Date('2026-06-20T12:00:00.000Z')),
      },
    });
    const expired = classifyPasswordExpirationAccount({
      ...baseInput,
      entry: {
        sAMAccountName: 'fixture',
        userAccountControl: '512',
        pwdLastSet: passwordLastSet,
        mail: account.email,
        'msDS-UserPasswordExpiryTimeComputed': toFileTime(new Date('2026-06-16T12:00:00.000Z')),
      },
    });

    expect(expiring).toMatchObject({
      status: 'expiring_soon',
      daysRemaining: 3,
      reminderMilestone: 3,
    });
    expect(expired).toMatchObject({
      status: 'expired',
      daysOverdue: 1,
      reminderMilestone: 'expired',
    });
    expect(expiring.reminderKey).not.toBe(expired.reminderKey);
  });
});

describe('password expiration config', () => {
  it('uses 14 days as the default warning window', () => {
    expect(getPasswordExpirationWarningDays()).toBe(14);
  });

  it('reads the configured warning window', () => {
    vi.stubEnv('PASSWORD_EXPIRATION_WARNING_DAYS', '30');
    expect(getPasswordExpirationWarningDays()).toBe(30);
  });

  it('requires explicit scheduler enablement', () => {
    expect(isPasswordExpirationSchedulerEnabled()).toBe(false);
    vi.stubEnv('PASSWORD_EXPIRATION_SCHEDULER_ENABLED', 'true');
    expect(isPasswordExpirationSchedulerEnabled()).toBe(true);
  });

  it('does not process the guarded scheduler while disabled', async () => {
    await expect(runGuardedPasswordExpirationScheduler()).resolves.toMatchObject({
      status: 'disabled',
    });
  });
});

describe('duplicate notification prevention', () => {
  it('produces distinct reminder keys for different milestones on the same password', () => {
    const key14 = buildPasswordReminderKey('testuser', 'pwd-v1', 14);
    const key7 = buildPasswordReminderKey('testuser', 'pwd-v1', 7);
    const key3 = buildPasswordReminderKey('testuser', 'pwd-v1', 3);
    const key1 = buildPasswordReminderKey('testuser', 'pwd-v1', 1);
    const keyExpired = buildPasswordReminderKey('testuser', 'pwd-v1', 'expired');
    const keyMustChange = buildPasswordReminderKey('testuser', 'pwd-v1', 'must_change');

    const allKeys = [key14, key7, key3, key1, keyExpired, keyMustChange];
    expect(new Set(allKeys).size).toBe(allKeys.length);
  });

  it('produces fresh reminder keys when the password version changes', () => {
    const oldKey = buildPasswordReminderKey('testuser', '133801632000000000', 7);
    const newKey = buildPasswordReminderKey('testuser', '133810000000000000', 7);
    expect(oldKey).not.toBe(newKey);
  });

  it('returns null for milestones that do not apply', () => {
    expect(getPasswordReminderMilestone('valid', 30, 14)).toBeNull();
    expect(getPasswordReminderMilestone('never_expires', null, 14)).toBeNull();
    expect(getPasswordReminderMilestone('skipped', null, 14)).toBeNull();
    expect(getPasswordReminderMilestone('unknown', null, 14)).toBeNull();
  });

  it('returns null reminder key when milestone is null', () => {
    expect(buildPasswordReminderKey('testuser', 'pwd-v1', null)).toBeNull();
  });

  it('normalizes username case in reminder keys', () => {
    const upper = buildPasswordReminderKey('TestUser', 'pwd-v1', 7);
    const lower = buildPasswordReminderKey('testuser', 'pwd-v1', 7);
    expect(upper).toBe(lower);
  });

  it('assigns correct milestone at exact boundary values', () => {
    expect(getPasswordReminderMilestone('expiring_soon', 14, 14)).toBe(14);
    expect(getPasswordReminderMilestone('expiring_soon', 8, 14)).toBe(14);
    expect(getPasswordReminderMilestone('expiring_soon', 7, 14)).toBe(7);
    expect(getPasswordReminderMilestone('expiring_soon', 4, 14)).toBe(7);
    expect(getPasswordReminderMilestone('expiring_soon', 3, 14)).toBe(3);
    expect(getPasswordReminderMilestone('expiring_soon', 2, 14)).toBe(3);
    expect(getPasswordReminderMilestone('expiring_soon', 1, 14)).toBe(1);
    expect(getPasswordReminderMilestone('expiring_soon', 0, 14)).toBe(1);
  });

  it('respects warningDays and excludes milestones above the threshold', () => {
    expect(getPasswordReminderMilestone('expiring_soon', 7, 7)).toBe(7);
    expect(getPasswordReminderMilestone('expiring_soon', 5, 7)).toBe(7);
    expect(getPasswordReminderMilestone('expiring_soon', 3, 3)).toBe(3);
    expect(getPasswordReminderMilestone('expiring_soon', 1, 1)).toBe(1);
  });

  it('always returns expired/must_change milestones regardless of days', () => {
    expect(getPasswordReminderMilestone('expired', null, 14)).toBe('expired');
    expect(getPasswordReminderMilestone('expired', 0, 14)).toBe('expired');
    expect(getPasswordReminderMilestone('must_change', null, 14)).toBe('must_change');
  });
});

describe('classifyPasswordExpirationAccount edge cases', () => {
  const account = {
    requestId: 'request-1',
    username: 'edgecase',
    displayName: 'Edge Case User',
    email: 'edge@example.test',
  };
  const now = new Date('2026-06-17T12:00:00.000Z');
  const baseInput = {
    account,
    maxPasswordAgeDays: 90,
    warningDays: 14,
    now,
    policySource: 'ad_domain_policy' as const,
  };

  it('marks as skipped when AD entry is null', () => {
    const row = classifyPasswordExpirationAccount({ ...baseInput, entry: null });
    expect(row).toMatchObject({
      status: 'skipped',
      skipReason: 'ad_user_not_found',
      eligibleForNotification: false,
    });
  });

  it('marks as ineligible when email is syntactically invalid', () => {
    const row = classifyPasswordExpirationAccount({
      ...baseInput,
      account: { ...account, email: 'not-an-email' },
      entry: {
        sAMAccountName: 'edgecase',
        userAccountControl: '512',
        pwdLastSet: '0',
      },
    });
    expect(row.status).toBe('must_change');
    expect(row.skipReason).toBe('missing_or_invalid_email');
    expect(row.eligibleForNotification).toBe(false);
  });

  it('prefers AD mail attribute over portal email', () => {
    const row = classifyPasswordExpirationAccount({
      ...baseInput,
      entry: {
        sAMAccountName: 'edgecase',
        userAccountControl: '512',
        pwdLastSet: '0',
        mail: 'ad-email@example.test',
      },
    });
    expect(row.email).toBe('ad-email@example.test');
  });

  it('falls back to portal email when AD mail is empty', () => {
    const row = classifyPasswordExpirationAccount({
      ...baseInput,
      entry: {
        sAMAccountName: 'edgecase',
        userAccountControl: '512',
        pwdLastSet: '0',
        mail: '',
      },
    });
    expect(row.email).toBe(account.email);
  });

  it('uses whenChanged as fallback password version when pwdLastSet is zero', () => {
    const row = classifyPasswordExpirationAccount({
      ...baseInput,
      entry: {
        sAMAccountName: 'edgecase',
        userAccountControl: '512',
        pwdLastSet: '0',
        whenChanged: '20260617120000.0Z',
        mail: account.email,
      },
    });
    expect(row.status).toBe('must_change');
    expect(row.reminderKey).toContain('20260617120000.0Z');
  });

  it('classifies expired UAC flag with higher priority than computed expiry', () => {
    const toFileTime = (date: Date) => (
      BigInt(date.getTime()) * BigInt(10000) + BigInt('116444736000000000')
    ).toString();
    const row = classifyPasswordExpirationAccount({
      ...baseInput,
      entry: {
        sAMAccountName: 'edgecase',
        userAccountControl: String(0x0200 | 0x800000),
        pwdLastSet: toFileTime(new Date('2026-03-01T00:00:00Z')),
        mail: account.email,
        'msDS-UserPasswordExpiryTimeComputed': toFileTime(new Date('2026-12-01T00:00:00Z')),
      },
    });
    expect(row.status).toBe('expired');
    expect(row.detail).toContain('marks this password as expired');
  });
});
