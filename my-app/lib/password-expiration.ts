import crypto from 'crypto';
import type { Client } from 'ldapts';
import { prisma } from '@/lib/prisma';
import { createLDAPClient } from '@/lib/ldap';
import { getOptionalEnv, getRequiredEnv } from '@/lib/env-validator';
import { sendPasswordExpirationReminderEmail } from '@/lib/email';
import {
  AuditActions,
  AuditCategories,
  logAuditAction,
  type AuditOutcome,
} from '@/lib/audit-log';
import { appLogger, ldapLogger } from '@/lib/logger';
import {
  LDAP_TIMEOUT,
  sanitizeLdapError,
  withTimeout,
} from '@/lib/ldap/utils';
import { validateEmail } from '@/lib/validation';

export type PasswordExpirationStatus =
  | 'valid'
  | 'expiring_soon'
  | 'expired'
  | 'must_change'
  | 'never_expires'
  | 'unknown'
  | 'skipped';

export type PasswordReminderMilestone = 14 | 7 | 3 | 1 | 'expired' | 'must_change';

export interface PasswordExpirationPolicy {
  warningDays: number;
  maxPasswordAgeDays: number | null;
  policySource: 'ad_computed' | 'ad_domain_policy' | 'ad_unavailable';
  milestones: number[];
}

export interface PasswordExpirationRow {
  requestId: string | null;
  username: string;
  displayName: string;
  email: string;
  status: PasswordExpirationStatus;
  eligibleForNotification: boolean;
  skipReason: string | null;
  accountEnabled: boolean | null;
  passwordLastSet: string | null;
  passwordExpiresAt: string | null;
  daysRemaining: number | null;
  daysOverdue: number | null;
  reminderMilestone: PasswordReminderMilestone | null;
  reminderKey: string | null;
  lastNotificationAt: string | null;
  lastNotificationStatus: string | null;
  policySource: PasswordExpirationPolicy['policySource'];
  detail: string;
}

export interface PasswordExpirationReport {
  generatedAt: string;
  policy: PasswordExpirationPolicy;
  summary: Record<PasswordExpirationStatus | 'total' | 'eligibleForNotification', number>;
  rows: PasswordExpirationRow[];
}

export interface PasswordExpirationNotificationResult {
  username: string;
  email: string | null;
  status: PasswordExpirationStatus;
  outcome: AuditOutcome;
  message: string;
}

interface PortalManagedAccount {
  requestId: string;
  username: string;
  displayName: string;
  email: string;
}

type LdapEntry = Record<string, unknown>;

const WINDOWS_FILETIME_UNIX_EPOCH_DIFF = BigInt('116444736000000000');
const FILETIME_TICKS_PER_MS = BigInt('10000');
const AD_NEVER_EXPIRES_INTERVAL = '-9223372036854775808';
const NEVER_EXPIRES_FILETIMES = new Set(['0', '9223372036854775807']);
const UAC_ACCOUNT_DISABLED = 0x0002;
const UAC_DONT_EXPIRE_PASSWORD = 0x10000;
const UAC_PASSWORD_EXPIRED = 0x800000;
const DEFAULT_REMINDER_MILESTONES = [14, 7, 3, 1] as const;
const SCHEDULER_LOCK_KEY = 'password-expiration-scheduler:v2:lock';
const SCHEDULER_LOCK_SECONDS = 10 * 60;

interface SchedulerRedisClient {
  set(
    key: string,
    value: string,
    options?: { EX?: number; NX?: boolean }
  ): Promise<string | null>;
  eval(
    script: string,
    options: { keys: string[]; arguments: string[] }
  ): Promise<unknown>;
}

let redisPromise: Promise<SchedulerRedisClient> | null = null;

function readIntegerEnv(name: string, fallback: number, minimum: number, maximum: number) {
  const raw = process.env[name];
  if (!raw) return fallback;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }

  return parsed;
}

export function getPasswordExpirationWarningDays() {
  return readIntegerEnv('PASSWORD_EXPIRATION_WARNING_DAYS', 14, 1, 90);
}

export function isPasswordExpirationSchedulerEnabled() {
  return process.env.PASSWORD_EXPIRATION_SCHEDULER_ENABLED === 'true';
}

export function fileTimeToDate(value: unknown): Date | null {
  const normalized = String(Array.isArray(value) ? value[0] : value || '').trim();
  if (!normalized || NEVER_EXPIRES_FILETIMES.has(normalized)) return null;

  try {
    const fileTime = BigInt(normalized);
    const unixMs = Number((fileTime - WINDOWS_FILETIME_UNIX_EPOCH_DIFF) / FILETIME_TICKS_PER_MS);
    if (!Number.isFinite(unixMs) || unixMs <= 0 || unixMs > 253402300800000) {
      return null;
    }
    return new Date(unixMs);
  } catch {
    return null;
  }
}

export function adIntervalToDays(value: unknown): number | null {
  const normalized = String(Array.isArray(value) ? value[0] : value || '').trim();
  if (!normalized) return null;
  if (normalized === AD_NEVER_EXPIRES_INTERVAL || normalized === '0') return 0;

  try {
    const ticks = BigInt(normalized);
    const absoluteTicks = ticks < BigInt(0) ? -ticks : ticks;
    const ms = Number(absoluteTicks / FILETIME_TICKS_PER_MS);
    if (!Number.isFinite(ms) || ms <= 0) return null;
    return Math.max(1, Math.round(ms / 86_400_000));
  } catch {
    return null;
  }
}

function getEntryValue(entry: LdapEntry | null, name: string): string | null {
  if (!entry) return null;
  const value = entry[name];
  if (Array.isArray(value)) return value[0] ? String(value[0]) : null;
  return value === undefined || value === null ? null : String(value);
}

function isNeverExpiresFileTime(value: string | null) {
  return value === '9223372036854775807';
}

function parseUac(entry: LdapEntry | null): number | null {
  const raw = getEntryValue(entry, 'userAccountControl');
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function getPasswordReminderMilestone(
  status: PasswordExpirationStatus,
  daysRemaining: number | null,
  warningDays: number
): PasswordReminderMilestone | null {
  if (status === 'expired') return 'expired';
  if (status === 'must_change') return 'must_change';
  if (status !== 'expiring_soon' || daysRemaining === null) return null;

  const milestones = DEFAULT_REMINDER_MILESTONES.filter((milestone) => milestone <= warningDays);
  return [...milestones].reverse().find((milestone) => daysRemaining <= milestone) || null;
}

export function buildPasswordReminderKey(
  username: string,
  passwordVersion: string,
  milestone: PasswordReminderMilestone | null
) {
  return milestone ? `${username.toLowerCase()}:${passwordVersion}:${milestone}` : null;
}

async function bindServiceClient(): Promise<Client> {
  const client = createLDAPClient();
  await withTimeout(
    client.bind(getRequiredEnv('LDAP_BIND_DN'), getRequiredEnv('LDAP_BIND_PASSWORD')),
    LDAP_TIMEOUT
  );
  return client;
}

async function getDomainMaxPasswordAgeDays(client: Client): Promise<number | null> {
  try {
    let domainBase = getOptionalEnv('LDAP_DOMAIN_SEARCH_BASE', '');
    if (!domainBase) {
      const root = await withTimeout(
        client.search('', {
          scope: 'base',
          filter: '(objectClass=*)',
          attributes: ['defaultNamingContext'],
        }),
        LDAP_TIMEOUT
      );
      domainBase = String(root.searchEntries[0]?.defaultNamingContext || '');
    }

    if (!domainBase) {
      ldapLogger.warn('Unable to determine the Active Directory domain base for maxPwdAge');
      return null;
    }
    const policy = await withTimeout(
      client.search(domainBase, {
        scope: 'base',
        filter: '(objectClass=*)',
        attributes: ['maxPwdAge'],
      }),
      LDAP_TIMEOUT
    );
    const maxPwdAge = String(policy.searchEntries[0]?.maxPwdAge || '').trim();
    if (maxPwdAge === '0') return 0;
    return adIntervalToDays(maxPwdAge);
  } catch (error) {
    ldapLogger.warn('Unable to read Active Directory maxPwdAge', sanitizeLdapError(error));
    return null;
  }
}

async function listPasswordExpirationEntries(client: Client): Promise<Map<string, LdapEntry>> {
  const { searchEntries } = await withTimeout(
    client.search(getRequiredEnv('LDAP_SEARCH_BASE'), {
      filter: '(&(objectCategory=person)(objectClass=user))',
      scope: 'sub',
      attributes: [
        'sAMAccountName',
        'cn',
        'displayName',
        'mail',
        'userAccountControl',
        'pwdLastSet',
        'whenChanged',
        'msDS-UserPasswordExpiryTimeComputed',
      ],
      paged: true,
      sizeLimit: 0,
    }),
    LDAP_TIMEOUT * 2
  );

  const entries = new Map<string, LdapEntry>();
  for (const entry of searchEntries) {
    const username = String(entry.sAMAccountName || '').trim().toLowerCase();
    if (username) entries.set(username, entry);
  }
  return entries;
}

async function getPortalManagedAccounts(): Promise<PortalManagedAccount[]> {
  const requests = await prisma.accessRequest.findMany({
    where: {
      status: 'approved',
      OR: [
        { ldapUsername: { not: null } },
        { linkedAdUsername: { not: null } },
      ],
    },
    orderBy: { approvedAt: 'desc' },
    select: {
      id: true,
      name: true,
      email: true,
      ldapUsername: true,
      linkedAdUsername: true,
    },
  });

  const byUsername = new Map<string, PortalManagedAccount>();
  for (const request of requests) {
    const username = (request.linkedAdUsername || request.ldapUsername || '').trim();
    const key = username.toLowerCase();
    if (!username || byUsername.has(key)) continue;

    byUsername.set(key, {
      requestId: request.id,
      username,
      displayName: request.name,
      email: request.email,
    });
  }
  return Array.from(byUsername.values()).sort((left, right) => left.username.localeCompare(right.username));
}

function parseAuditDetails(details: string | null): Record<string, unknown> {
  if (!details) return {};
  try {
    return JSON.parse(details) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function getNotificationHistory(usernames: string[]) {
  if (usernames.length === 0) {
    return {
      latestByUsername: new Map<string, { createdAt: Date; status: string }>(),
      sentReminderKeys: new Set<string>(),
    };
  }

  const logs = await prisma.auditLog.findMany({
    where: {
      action: {
        in: [
          AuditActions.PASSWORD_EXPIRATION_EMAIL_SENT,
          AuditActions.PASSWORD_EXPIRATION_EMAIL_SKIPPED,
          AuditActions.PASSWORD_EXPIRATION_EMAIL_FAILURE,
        ],
      },
      subjectUsername: { in: usernames },
    },
    orderBy: { createdAt: 'desc' },
    select: {
      createdAt: true,
      subjectUsername: true,
      action: true,
      outcome: true,
      success: true,
      details: true,
    },
  });

  const latestByUsername = new Map<string, { createdAt: Date; status: string }>();
  const sentReminderKeys = new Set<string>();
  for (const log of logs) {
    const username = log.subjectUsername?.toLowerCase();
    if (username && !latestByUsername.has(username)) {
      latestByUsername.set(username, {
        createdAt: log.createdAt,
        status: log.outcome || log.action,
      });
    }

    if (log.action === AuditActions.PASSWORD_EXPIRATION_EMAIL_SENT && log.success) {
      const reminderKey = parseAuditDetails(log.details).reminderKey;
      if (typeof reminderKey === 'string') sentReminderKeys.add(reminderKey);
    }
  }

  return { latestByUsername, sentReminderKeys };
}

export function classifyPasswordExpirationAccount(input: {
  account: PortalManagedAccount;
  entry: LdapEntry | null;
  maxPasswordAgeDays: number | null;
  warningDays: number;
  now: Date;
  policySource: PasswordExpirationPolicy['policySource'];
  lastNotification?: { createdAt: Date; status: string };
}): PasswordExpirationRow {
  const { account, entry, now, maxPasswordAgeDays, warningDays, policySource, lastNotification } = input;
  const uac = parseUac(entry);
  const accountEnabled = uac === null ? null : (uac & UAC_ACCOUNT_DISABLED) === 0;
  const email = getEntryValue(entry, 'mail') || account.email;
  const displayName = getEntryValue(entry, 'displayName') || getEntryValue(entry, 'cn') || account.displayName || account.username;
  const pwdLastSetRaw = getEntryValue(entry, 'pwdLastSet');
  const pwdLastSet = fileTimeToDate(pwdLastSetRaw);
  const computedExpiryRaw = getEntryValue(entry, 'msDS-UserPasswordExpiryTimeComputed');
  const computedExpiry = fileTimeToDate(computedExpiryRaw);
  const computedNeverExpires = isNeverExpiresFileTime(computedExpiryRaw);
  const explicitNeverExpires = uac !== null && (uac & UAC_DONT_EXPIRE_PASSWORD) !== 0;
  const explicitExpired = uac !== null && (uac & UAC_PASSWORD_EXPIRED) !== 0;
  const domainPasswordsNeverExpire =
    policySource === 'ad_domain_policy' && maxPasswordAgeDays === null;

  let status: PasswordExpirationStatus = 'unknown';
  let skipReason: string | null = null;
  let detail = 'Password expiration could not be determined from Active Directory.';
  let passwordExpiresAt: Date | null = null;

  if (!entry) {
    status = 'skipped';
    skipReason = 'ad_user_not_found';
    detail = 'No matching Active Directory user was found.';
  } else if (accountEnabled === false) {
    status = 'skipped';
    skipReason = 'ad_account_disabled';
    detail = 'Account is disabled in Active Directory.';
  } else if (pwdLastSetRaw === '0') {
    status = 'must_change';
    detail = 'Active Directory requires this user to change their password at next sign-in.';
  } else if (explicitExpired) {
    status = 'expired';
    detail = 'Active Directory marks this password as expired.';
  } else if (explicitNeverExpires || computedNeverExpires || domainPasswordsNeverExpire) {
    status = 'never_expires';
    detail = 'Active Directory marks this password as non-expiring.';
  } else {
    passwordExpiresAt = computedExpiry || (pwdLastSet && maxPasswordAgeDays !== null
      ? new Date(pwdLastSet.getTime() + maxPasswordAgeDays * 86_400_000)
      : null);

    if (passwordExpiresAt) {
      const msUntilExpiry = passwordExpiresAt.getTime() - now.getTime();
      const daysRemaining = Math.ceil(msUntilExpiry / 86_400_000);
      if (msUntilExpiry <= 0) {
        status = 'expired';
        detail = 'Password expiration date is in the past.';
      } else if (daysRemaining <= warningDays) {
        status = 'expiring_soon';
        detail = `Password expires within ${warningDays} days.`;
      } else {
        status = 'valid';
        detail = 'Password is outside the warning window.';
      }
    }
  }

  if (!email || !validateEmail(email)) {
    skipReason = skipReason || 'missing_or_invalid_email';
  }

  const daysDelta = passwordExpiresAt
    ? Math.ceil((passwordExpiresAt.getTime() - now.getTime()) / 86_400_000)
    : null;
  const daysRemaining = daysDelta !== null && daysDelta >= 0 ? daysDelta : null;
  const reminderMilestone = getPasswordReminderMilestone(status, daysRemaining, warningDays);
  const passwordVersion = pwdLastSetRaw && pwdLastSetRaw !== '0'
    ? pwdLastSetRaw
    : getEntryValue(entry, 'whenChanged') || pwdLastSetRaw || 'unknown';
  const reminderKey = buildPasswordReminderKey(account.username, passwordVersion, reminderMilestone);
  const eligibleForNotification =
    reminderMilestone !== null &&
    accountEnabled !== false &&
    Boolean(email && validateEmail(email));

  return {
    requestId: account.requestId,
    username: account.username,
    displayName,
    email: email || '',
    status,
    eligibleForNotification,
    skipReason,
    accountEnabled,
    passwordLastSet: pwdLastSet?.toISOString() || null,
    passwordExpiresAt: passwordExpiresAt?.toISOString() || null,
    daysRemaining,
    daysOverdue: daysDelta !== null && daysDelta < 0 ? Math.abs(daysDelta) : null,
    reminderMilestone,
    reminderKey,
    lastNotificationAt: lastNotification?.createdAt.toISOString() || null,
    lastNotificationStatus: lastNotification?.status || null,
    policySource,
    detail,
  };
}

async function buildPasswordExpirationReport(now: Date) {
  const warningDays = getPasswordExpirationWarningDays();
  const accounts = await getPortalManagedAccounts();
  const notificationHistory = await getNotificationHistory(accounts.map((account) => account.username));
  const client = await bindServiceClient();

  try {
    const domainMaxAge = await getDomainMaxPasswordAgeDays(client);
    const directoryEntries = await listPasswordExpirationEntries(client);
    const domainPolicyFound = domainMaxAge !== null;
    const maxPasswordAgeDays = domainMaxAge === 0 ? null : domainMaxAge;
    const basePolicySource: PasswordExpirationPolicy['policySource'] =
      domainPolicyFound ? 'ad_domain_policy' : 'ad_unavailable';
    const rows = accounts.map((account) => {
      const entry = directoryEntries.get(account.username.toLowerCase()) || null;
      const computedExpiryRaw = getEntryValue(entry, 'msDS-UserPasswordExpiryTimeComputed');
      const hasComputedExpiry =
        Boolean(fileTimeToDate(computedExpiryRaw)) || isNeverExpiresFileTime(computedExpiryRaw);
      return classifyPasswordExpirationAccount({
        account,
        entry,
        maxPasswordAgeDays,
        warningDays,
        now,
        policySource: hasComputedExpiry ? 'ad_computed' : basePolicySource,
        lastNotification: notificationHistory.latestByUsername.get(account.username.toLowerCase()),
      });
    });

    const summary = {
      total: rows.length,
      valid: 0,
      expiring_soon: 0,
      expired: 0,
      must_change: 0,
      never_expires: 0,
      unknown: 0,
      skipped: 0,
      eligibleForNotification: 0,
    };
    for (const row of rows) {
      summary[row.status] += 1;
      if (row.eligibleForNotification) summary.eligibleForNotification += 1;
    }

    return {
      report: {
        generatedAt: now.toISOString(),
        policy: {
          warningDays,
          maxPasswordAgeDays,
          policySource: basePolicySource,
          milestones: DEFAULT_REMINDER_MILESTONES.filter((milestone) => milestone <= warningDays),
        },
        summary,
        rows,
      } satisfies PasswordExpirationReport,
      sentReminderKeys: notificationHistory.sentReminderKeys,
    };
  } catch (error) {
    ldapLogger.error('Password expiration directory scan failed', error);
    throw new Error('Active Directory password expiration scan failed');
  } finally {
    try {
      await client.unbind();
    } catch (error) {
      ldapLogger.warn('Error unbinding password expiration LDAP client', sanitizeLdapError(error));
    }
  }
}

export async function getPasswordExpirationReport(now = new Date()): Promise<PasswordExpirationReport> {
  return (await buildPasswordExpirationReport(now)).report;
}

async function logPasswordExpirationNotification(input: {
  action: string;
  actor: string;
  row: PasswordExpirationRow;
  outcome: AuditOutcome;
  success?: boolean;
  message: string;
  correlationId: string;
  errorMessage?: string;
}) {
  await logAuditAction({
    action: input.action,
    category: AuditCategories.USER,
    username: input.actor,
    actorType: input.actor === 'password-expiration-scheduler' ? 'system' : 'admin',
    targetType: 'PasswordExpiration',
    subjectUsername: input.row.username,
    subjectEmail: input.row.email || null,
    relatedRequestId: input.row.requestId,
    eventKind: 'notification',
    outcome: input.outcome,
    success: input.success ?? input.outcome === 'success',
    errorMessage: input.errorMessage,
    correlationId: input.correlationId,
    details: {
      status: input.row.status,
      reminderMilestone: input.row.reminderMilestone,
      reminderKey: input.row.reminderKey,
      passwordExpiresAt: input.row.passwordExpiresAt,
      daysRemaining: input.row.daysRemaining,
      daysOverdue: input.row.daysOverdue,
      message: input.message,
    },
  });
}

export async function sendPasswordExpirationNotifications(input: {
  actor: string;
  usernames?: string[];
  statuses?: PasswordExpirationStatus[];
  force?: boolean;
  correlationId?: string;
  now?: Date;
}) {
  const now = input.now || new Date();
  const { report, sentReminderKeys } = await buildPasswordExpirationReport(now);
  const requestedUsernames = input.usernames?.map((username) => username.toLowerCase());
  const usernameFilter = requestedUsernames ? new Set(requestedUsernames) : null;
  const requestedStatuses = new Set(input.statuses || ['expiring_soon', 'expired', 'must_change']);
  const correlationId = input.correlationId || `password-expiration:${now.getTime()}:${crypto.randomBytes(4).toString('hex')}`;
  const results: PasswordExpirationNotificationResult[] = [];

  for (const row of report.rows) {
    if (usernameFilter && !usernameFilter.has(row.username.toLowerCase())) continue;
    if (!requestedStatuses.has(row.status)) continue;

    if (!row.eligibleForNotification || !row.reminderKey) {
      const message = row.skipReason || 'not_at_reminder_milestone';
      await logPasswordExpirationNotification({
        action: AuditActions.PASSWORD_EXPIRATION_EMAIL_SKIPPED,
        actor: input.actor,
        row,
        outcome: 'skipped',
        success: true,
        message,
        correlationId,
      });
      results.push({ username: row.username, email: row.email || null, status: row.status, outcome: 'skipped', message });
      continue;
    }

    if (!input.force && sentReminderKeys.has(row.reminderKey)) {
      const message = 'reminder_milestone_already_sent';
      results.push({ username: row.username, email: row.email || null, status: row.status, outcome: 'skipped', message });
      continue;
    }

    try {
      await sendPasswordExpirationReminderEmail(row.email, {
        username: row.username,
        displayName: row.displayName,
        status: row.status,
        passwordExpiresAt: row.passwordExpiresAt,
        daysRemaining: row.daysRemaining,
        daysOverdue: row.daysOverdue,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to send password expiration email';
      await logPasswordExpirationNotification({
        action: AuditActions.PASSWORD_EXPIRATION_EMAIL_FAILURE,
        actor: input.actor,
        row,
        outcome: 'failure',
        success: false,
        message: 'send_failed',
        errorMessage,
        correlationId,
      });
      results.push({ username: row.username, email: row.email, status: row.status, outcome: 'failure', message: errorMessage });
      continue;
    }

    try {
      await logPasswordExpirationNotification({
        action: AuditActions.PASSWORD_EXPIRATION_EMAIL_SENT,
        actor: input.actor,
        row,
        outcome: 'success',
        success: true,
        message: input.force ? 'force_sent' : 'sent',
        correlationId,
      });
      sentReminderKeys.add(row.reminderKey);
      results.push({ username: row.username, email: row.email, status: row.status, outcome: 'success', message: 'sent' });
    } catch (error) {
      appLogger.error('Password expiration email sent but audit logging failed', error, {
        username: row.username,
        reminderKey: row.reminderKey,
      });
      sentReminderKeys.add(row.reminderKey);
      results.push({
        username: row.username,
        email: row.email,
        status: row.status,
        outcome: 'success',
        message: 'sent_audit_failed',
      });
    }
  }

  return {
    correlationId,
    summary: {
      total: results.length,
      sent: results.filter((result) => result.outcome === 'success').length,
      skipped: results.filter((result) => result.outcome === 'skipped').length,
      failed: results.filter((result) => result.outcome === 'failure').length,
    },
    results,
  };
}

async function getRedisClient(): Promise<SchedulerRedisClient> {
  if (redisPromise) return redisPromise;

  redisPromise = (async () => {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      throw new Error('REDIS_URL is required for guarded password expiration scheduling');
    }
    if (redisUrl.includes('upstash.io')) {
      throw new Error('Guarded password expiration scheduling currently requires a standard Redis connection URL');
    }

    const { createClient } = await import('redis');
    const client = createClient({ url: redisUrl });
    client.on('error', error => {
      appLogger.error('Password expiration scheduler Redis client error', { error });
    });
    await client.connect();
    return client as unknown as SchedulerRedisClient;
  })().catch(error => {
    redisPromise = null;
    throw error;
  });
  return redisPromise;
}

async function releaseSchedulerLock(redis: SchedulerRedisClient, token: string) {
  await redis.eval(
    'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end',
    { keys: [SCHEDULER_LOCK_KEY], arguments: [token] }
  );
}

export async function runLockedPasswordExpirationNotifications(input: {
  actor: string;
  usernames?: string[];
  statuses?: PasswordExpirationStatus[];
  force?: boolean;
  now?: Date;
}) {
  const redis = await getRedisClient();
  const token = crypto.randomUUID();
  const acquired = await redis.set(SCHEDULER_LOCK_KEY, token, { EX: SCHEDULER_LOCK_SECONDS, NX: true });
  if (!acquired) {
    return {
      status: 'busy' as const,
      message: 'Another password expiration reminder run is already active',
    };
  }

  try {
    const result = await sendPasswordExpirationNotifications({
      actor: input.actor,
      usernames: input.usernames,
      statuses: input.statuses,
      force: input.force,
      now: input.now,
    });
    return { status: 'processed' as const, result };
  } finally {
    await releaseSchedulerLock(redis, token).catch(error => {
      appLogger.error('Failed to release password expiration scheduler lock', { error });
    });
  }
}

export async function runGuardedPasswordExpirationScheduler(now = new Date()) {
  if (!isPasswordExpirationSchedulerEnabled()) {
    return {
      status: 'disabled' as const,
      message: 'PASSWORD_EXPIRATION_SCHEDULER_ENABLED is not true',
    };
  }

  const processed = await runLockedPasswordExpirationNotifications({
    actor: 'password-expiration-scheduler',
    statuses: ['expiring_soon', 'expired', 'must_change'],
    now,
  });
  if (processed.status !== 'processed') return processed;

  await logAuditAction({
    action: AuditActions.PASSWORD_EXPIRATION_SCHEDULER_RUN,
    category: AuditCategories.USER,
    username: 'password-expiration-scheduler',
    actorType: 'system',
    eventKind: 'notification',
    outcome: 'success',
    details: {
      summary: processed.result.summary,
      correlationId: processed.result.correlationId,
    },
  });

  return processed;
}
