import crypto from 'crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { listUsersInOU, searchLDAPUser } from '@/lib/ldap';
import {
  sendOffboardExtensionEmail,
  sendOffboardExtensionReminderEmail,
  sendOffboardInitialEmail,
  sendOffboardReminderEmail,
} from '@/lib/email';
import { processLifecycleAction } from '@/lib/lifecycle-processor';
import { appLogger } from '@/lib/logger';
import { AuditActions, AuditCategories, sanitizeAuditDetails } from '@/lib/audit-log';
import {
  isOffboardExtensionReminderScheduleValid,
  validateOffboardExtensionSchedule,
} from '@/lib/offboard-extension-schedule';

export { validateOffboardExtensionSchedule } from '@/lib/offboard-extension-schedule';

const ACTIVE_LOCK_KEY = 'global';
const DAY_MS = 24 * 60 * 60 * 1000;
const ACTIVE_EXTENSION_STATUSES = ['active', 'notification_failed', 'pending_notification'];
const EMAIL_CLAIM_STALE_MS = 30 * 60 * 1000;
const REUSABLE_REQUEST_STATUSES = ['rejected', 'offboarded'];

type CampaignLogLevel = 'info' | 'warn' | 'error';

interface LdapUserSnapshot {
  dn: string;
  username: string;
  displayName: string;
  email: string;
  description: string;
  accountEnabled: boolean;
  accountExpires: string | null;
  whenCreated: string;
  memberOf: string[];
  accessRequestId?: string;
}

interface DryRunInput {
  name?: string;
  waveSize?: number;
  canarySize?: number;
  pauseAfterEachWave?: boolean;
  includedUsernames?: string[];
  excludedUsernames?: string[];
  excludedEmails?: string[];
}

interface AccountVerificationInfo {
  lastVerifiedAt: Date | null;
  lastVerifiedSource: 'offboard_campaign' | 'registration_verified' | 'registration' | 'none';
  originalRegistrationAt: Date | null;
}

type OffboardCampaignRecipientSummary = Record<string, unknown> & {
  adUsername: string;
  verifiedAt: Date | null;
};

interface OffboardCampaignStatusCount {
  status: string;
  _count: { status: number };
}

type AccountVerificationClient = Pick<typeof prisma, 'accessRequest' | 'offboardCampaignRecipient'>;
type CampaignRecipientWithCampaign = Prisma.OffboardCampaignRecipientGetPayload<{
  include: { campaign: true };
}>;

interface ProcessOptions {
  campaignId?: string;
  actor?: string;
  limit?: number;
  scheduledWindow?: {
    startExclusive: Date;
    endInclusive: Date;
  };
  processInitialEmails?: boolean;
}

export interface ProcessAllOffboardInput {
  initialEmails?: boolean;
  reminders?: boolean;
  enforcement?: boolean;
  overrideSendingPause?: boolean;
  overrideRemindersPause?: boolean;
  overrideEnforcementPause?: boolean;
}

export interface ExtendOffboardCampaignInput {
  recipientIds?: string[];
  newDeadline: string | Date;
  reminderDates?: Array<string | Date>;
  note?: string;
}

interface LifecycleProcessSummary {
  actionId: string;
  success: boolean;
  error?: string;
}

interface CampaignProcessControls {
  ignorePause?: boolean;
  bypassWaveGates?: boolean;
  dueAfter?: Date;
  dueAtOrBefore?: Date;
}

export function hashOffboardToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function generateToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

function normalize(value: string | null | undefined): string {
  return (value || '').trim().toLowerCase();
}

export function normalizeOffboardIdentifier(value: string | null | undefined): string {
  return normalize(value);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

function cleanList(values: string[] | undefined): string[] {
  return Array.from(new Set((values || []).map(v => v.trim()).filter(Boolean)));
}

function getOriginalSnapshot(recipient: any): any | null {
  if (!recipient.originalSnapshot) {
    return null;
  }

  try {
    return typeof recipient.originalSnapshot === 'string'
      ? JSON.parse(recipient.originalSnapshot)
      : recipient.originalSnapshot;
  } catch {
    return null;
  }
}

function getOriginalAccessRequestSnapshot(recipient: any): any | null {
  return getOriginalSnapshot(recipient)?.accessRequest || null;
}

function getOriginalVpnSnapshot(recipient: any): any | null {
  return getOriginalSnapshot(recipient)?.vpn || null;
}

function snapshotDate(value: unknown): Date | null {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function isUsableEmail(email: string | null | undefined): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((email || '').trim());
}

function adminGroupFragments(): string[] {
  return (process.env.LDAP_ADMIN_GROUPS || '')
    .split(',')
    .map(group => group.trim())
    .filter(Boolean);
}

function isAdminGroupMember(memberOf: string[]): boolean {
  const fragments = adminGroupFragments();
  if (fragments.length === 0) {
    return false;
  }

  return memberOf.some(group =>
    fragments.some(fragment => group.toLowerCase().includes(fragment.toLowerCase()))
  );
}

function serviceAccountPatterns(): string[] {
  return (process.env.OFFBOARD_SERVICE_ACCOUNT_PATTERNS || 'svc,svc_,svc-,service,shared,noreply,no-reply,admin,test')
    .split(',')
    .map(pattern => pattern.trim().toLowerCase())
    .filter(Boolean);
}

function isServiceOrSharedAccount(user: LdapUserSnapshot): boolean {
  const username = normalize(user.username);
  const emailLocal = normalize(user.email).split('@')[0] || '';
  const displayName = normalize(user.displayName);

  return serviceAccountPatterns().some(pattern =>
    username === pattern ||
    username.startsWith(pattern) ||
    emailLocal === pattern ||
    emailLocal.startsWith(pattern) ||
    displayName.includes(pattern)
  );
}

function safetySkipReason(
  user: LdapUserSnapshot,
  excludedUsernames: Set<string>,
  excludedEmails: Set<string>
): string | null {
  const username = normalize(user.username);
  const email = normalize(user.email);

  if (!username) return 'missing_ad_username';
  if (excludedUsernames.has(username)) return 'manually_excluded_username';
  if (email && excludedEmails.has(email)) return 'manually_excluded_email';
  if (!user.accountEnabled) return 'disabled_ad_account';
  if (!isUsableEmail(user.email)) return 'missing_usable_email';
  if (isAdminGroupMember(user.memberOf || [])) return 'admin_group_member';
  if (isServiceOrSharedAccount(user)) return 'service_or_shared_account';

  return null;
}

function getAttribute(attributes: Array<{ type: string; values: string[] }>, name: string): string | null {
  const attr = attributes.find(item => item.type.toLowerCase() === name.toLowerCase());
  return attr?.values?.[0] || null;
}

function getAttributeValues(attributes: Array<{ type: string; values: string[] }>, name: string): string[] {
  const attr = attributes.find(item => item.type.toLowerCase() === name.toLowerCase());
  return attr?.values || [];
}

function isLdapAccountEnabledFromUac(userAccountControl: string | null): boolean {
  const parsed = Number.parseInt(userAccountControl || '512', 10);
  if (!Number.isFinite(parsed)) {
    return true;
  }
  return (parsed & 2) === 0;
}

function buildVpnLookup(vpnAccounts: any[]): Map<string, any> {
  const byAdUsername = new Map<string, any>();

  for (const vpn of vpnAccounts) {
    const adKey = normalize(vpn.adUsername);
    const usernameKey = normalize(vpn.username);
    const key = adKey || usernameKey;
    if (!key) continue;

    const existing = byAdUsername.get(key);
    if (!existing || existing.status !== 'active') {
      byAdUsername.set(key, vpn);
    }
  }

  return byAdUsername;
}

function projectedActionFor(user: LdapUserSnapshot, vpn: any | null): string {
  return vpn?.username
    ? `Disable AD account ${user.username}; revoke linked VPN account ${vpn.username}`
    : `Disable AD account ${user.username}`;
}

function waveNumberForEligibleIndex(index: number, canarySize: number, waveSize: number): number {
  if (canarySize > 0 && index < canarySize) {
    return 0;
  }

  const offset = canarySize > 0 ? index - canarySize : index;
  const baseWave = canarySize > 0 ? 1 : 0;
  return baseWave + Math.floor(offset / waveSize);
}

async function createCampaignLog(
  tx: any,
  params: {
    campaignId: string;
    recipientId?: string | null;
    level?: CampaignLogLevel;
    eventType: string;
    actor?: string | null;
    message: string;
    details?: Record<string, unknown>;
  }
) {
  const log = await tx.offboardCampaignLog.create({
    data: {
      campaignId: params.campaignId,
      recipientId: params.recipientId || null,
      level: params.level || 'info',
      eventType: params.eventType,
      actor: params.actor || null,
      message: params.message,
      details: params.details || undefined,
    },
  });

  const recipient = params.recipientId
    ? await tx.offboardCampaignRecipient.findUnique({
        where: { id: params.recipientId },
        select: {
          adUsername: true,
          linkedVpnUsername: true,
          email: true,
          accessRequestId: true,
          vpnAccountId: true,
        },
      })
    : null;

  await tx.auditLog.create({
    data: {
      action: offboardAuditAction(params.eventType),
      category: AuditCategories.OFFBOARD_CAMPAIGN,
      username: params.actor || 'system',
      actorType: offboardActorType(params.actor, params.eventType),
      targetId: params.recipientId || params.campaignId,
      targetType: params.recipientId ? 'OffboardCampaignRecipient' : 'OffboardCampaign',
      subjectUsername: recipient?.adUsername || recipient?.linkedVpnUsername || null,
      subjectEmail: recipient?.email || null,
      relatedRequestId: recipient?.accessRequestId || null,
      relatedVpnAccountId: recipient?.vpnAccountId || null,
      eventKind: offboardEventKind(params.eventType),
      outcome: offboardOutcome(params.level || 'info', params.eventType),
      success: params.level !== 'error',
      errorMessage: params.level === 'error' ? params.message : null,
      correlationId: `offboard-campaign:${params.campaignId}`,
      details: JSON.stringify(sanitizeAuditDetails({
        ...(params.details || {}),
        offboardLogId: log.id,
        campaignId: params.campaignId,
        recipientId: params.recipientId || null,
        eventType: params.eventType,
        message: params.message,
      })),
    },
  });
}

function offboardAuditAction(eventType: string): string {
  if (eventType === 'dry_run_created') return AuditActions.OFFBOARD_DRY_RUN;
  if (eventType === 'dry_run_deleted') return AuditActions.DELETE_OFFBOARD_DRY_RUN;
  if (eventType === 'campaign_activated') return AuditActions.ACTIVATE_OFFBOARD_CAMPAIGN;
  if (eventType === 'campaign_completed') return AuditActions.OFFBOARD_CAMPAIGN_COMPLETED;
  if (eventType.includes('pause')) return AuditActions.PAUSE_OFFBOARD_CAMPAIGN;
  if (eventType.includes('resume') || eventType === 'wave_advanced') return AuditActions.RESUME_OFFBOARD_CAMPAIGN;
  if (eventType === 'cancel') return AuditActions.CANCEL_OFFBOARD_CAMPAIGN;
  if (eventType === 'emergency_stop') return AuditActions.EMERGENCY_STOP_OFFBOARD_CAMPAIGN;
  if (eventType === 'email_failure' || eventType === 'reminder_failure') return AuditActions.OFFBOARD_EMAIL_FAILURE;
  if (eventType === 'initial_email_sent') return AuditActions.OFFBOARD_EMAIL_SENT;
  if (eventType.includes('reminder_sent')) return AuditActions.OFFBOARD_REMINDER_SENT;
  if (eventType === 'enforcement_failure') return AuditActions.OFFBOARD_ENFORCEMENT_FAILURE;
  if (eventType === 'enforcement_completed') return AuditActions.OFFBOARD_ENFORCEMENT_COMPLETED;
  if (eventType === 'enforcement_skipped') return AuditActions.OFFBOARD_ENFORCEMENT_SKIPPED;
  if (eventType === 'recipient_verified') return AuditActions.OFFBOARD_RECIPIENT_VERIFIED;
  if (eventType === 'rollback_started') return AuditActions.OFFBOARD_ROLLBACK_START;
  if (eventType.includes('rollback_success') || eventType === 'rollback_completed') return AuditActions.OFFBOARD_ROLLBACK_SUCCESS;
  if (eventType.includes('rollback_failure') || eventType === 'rollback_completed_with_failures') return AuditActions.OFFBOARD_ROLLBACK_FAILURE;
  return AuditActions.OFFBOARD_CAMPAIGN_EVENT;
}

function offboardActorType(actor: string | null | undefined, eventType: string): 'admin' | 'user' | 'system' {
  if (!actor || actor === 'system' || actor === 'offboard-campaign') return 'system';
  if (eventType === 'recipient_verified') return 'user';
  return 'admin';
}

function offboardEventKind(eventType: string): 'write' | 'notification' | 'security' | 'lifecycle' {
  if (eventType.includes('email') || eventType.includes('reminder')) return 'notification';
  if (eventType === 'recipient_verified') return 'security';
  if (eventType.includes('enforcement') || eventType.includes('rollback') || eventType === 'campaign_completed') return 'lifecycle';
  return 'write';
}

function offboardOutcome(level: CampaignLogLevel, eventType: string): 'success' | 'failure' | 'pending' | 'skipped' | 'rollback' {
  if (level === 'error' || eventType.includes('failure') || eventType.includes('failed')) return 'failure';
  if (eventType.includes('skipped')) return 'skipped';
  if (eventType.includes('rollback')) return eventType === 'rollback_started' ? 'pending' : 'rollback';
  if (eventType === 'wave_pause' || eventType === 'rollback_started') return 'pending';
  return 'success';
}

async function findAccessRequestsByUsername(usernames: string[]): Promise<Map<string, any>> {
  if (usernames.length === 0) {
    return new Map();
  }

  const requests = await prisma.accessRequest.findMany({
    where: {
      status: { notIn: REUSABLE_REQUEST_STATUSES },
      OR: [
        { ldapUsername: { in: usernames } },
        { linkedAdUsername: { in: usernames } },
      ],
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      status: true,
      accountExpiresAt: true,
      name: true,
      email: true,
      ldapUsername: true,
      linkedAdUsername: true,
      adAccountStatus: true,
      vpnAccountStatus: true,
    },
  });

  const map = new Map<string, any>();
  for (const request of requests) {
    const ldapKey = normalize(request.ldapUsername);
    const linkedKey = normalize(request.linkedAdUsername);
    if (ldapKey && !map.has(ldapKey)) map.set(ldapKey, request);
    if (linkedKey && !map.has(linkedKey)) map.set(linkedKey, request);
  }
  return map;
}

function emptyVerificationInfo(): AccountVerificationInfo {
  return {
    lastVerifiedAt: null,
    lastVerifiedSource: 'none',
    originalRegistrationAt: null,
  };
}

export async function getAccountVerificationMap(
  usernames: string[],
  client: AccountVerificationClient = prisma
): Promise<Map<string, AccountVerificationInfo>> {
  const uniqueUsernames = cleanList(usernames);
  const result = new Map<string, AccountVerificationInfo>();
  if (uniqueUsernames.length === 0) {
    return result;
  }

  for (const username of uniqueUsernames) {
    result.set(normalize(username), emptyVerificationInfo());
  }

  const offboardVerifications = await client.offboardCampaignRecipient.findMany({
    where: {
      adUsername: { in: uniqueUsernames },
      verifiedAt: { not: null },
    },
    orderBy: { verifiedAt: 'desc' },
    select: {
      adUsername: true,
      verifiedAt: true,
    },
  });

  for (const verification of offboardVerifications) {
    const key = normalize(verification.adUsername);
    const current = result.get(key) || emptyVerificationInfo();
    if (!current.lastVerifiedAt && verification.verifiedAt) {
      current.lastVerifiedAt = verification.verifiedAt;
      current.lastVerifiedSource = 'offboard_campaign';
      result.set(key, current);
    }
  }

  const accessRequests = await client.accessRequest.findMany({
    where: {
      OR: [
        { ldapUsername: { in: uniqueUsernames } },
        { linkedAdUsername: { in: uniqueUsernames } },
      ],
    },
    orderBy: { createdAt: 'asc' },
    select: {
      createdAt: true,
      verifiedAt: true,
      ldapUsername: true,
      linkedAdUsername: true,
    },
  });

  const latestRegistrationVerification = new Map<string, Date>();
  for (const request of accessRequests) {
    const keys = [normalize(request.ldapUsername), normalize(request.linkedAdUsername)].filter(Boolean);
    for (const key of keys) {
      const current = result.get(key) || emptyVerificationInfo();
      if (!current.originalRegistrationAt || request.createdAt < current.originalRegistrationAt) {
        current.originalRegistrationAt = request.createdAt;
      }
      result.set(key, current);

      if (request.verifiedAt) {
        const existing = latestRegistrationVerification.get(key);
        if (!existing || request.verifiedAt > existing) {
          latestRegistrationVerification.set(key, request.verifiedAt);
        }
      }
    }
  }

  for (const [key, current] of result.entries()) {
    if (current.lastVerifiedAt) {
      continue;
    }

    const registrationVerifiedAt = latestRegistrationVerification.get(key);
    if (registrationVerifiedAt) {
      current.lastVerifiedAt = registrationVerifiedAt;
      current.lastVerifiedSource = 'registration_verified';
    } else if (current.originalRegistrationAt) {
      current.lastVerifiedAt = current.originalRegistrationAt;
      current.lastVerifiedSource = 'registration';
    }
  }

  return result;
}

async function markAccessRequestOffboardedByCampaign(
  tx: any,
  recipient: any,
  actor: string,
  enforcedAt: Date
): Promise<boolean> {
  if (!recipient.accessRequestId) {
    return false;
  }

  const result = await tx.accessRequest.updateMany({
    where: {
      id: recipient.accessRequestId,
      status: 'approved',
    },
    data: {
      status: 'offboarded',
      accountExpiresAt: enforcedAt,
      version: { increment: 1 },
    },
  });

  if (result.count !== 1) {
    return false;
  }

  await tx.requestComment.create({
    data: {
      requestId: recipient.accessRequestId,
      author: actor,
      type: 'offboard_campaign',
      comment: `Offboard campaign "${recipient.campaign.name}" completed for ${recipient.adUsername}. Access was disabled/revoked by the campaign, but this does not block future re-enrollment unless the email is on the block list.`,
    },
  });

  return true;
}

async function restoreAccessRequestAfterCampaignRollback(
  tx: any,
  recipient: any,
  actor: string
): Promise<boolean> {
  if (!recipient.accessRequestId) {
    return false;
  }

  const originalRequest = getOriginalAccessRequestSnapshot(recipient);
  if (!originalRequest?.status) {
    return false;
  }

  const result = await tx.accessRequest.updateMany({
    where: {
      id: recipient.accessRequestId,
      status: 'offboarded',
    },
    data: {
      status: originalRequest.status,
      accountExpiresAt: originalRequest.accountExpiresAt ? new Date(originalRequest.accountExpiresAt) : null,
      version: { increment: 1 },
    },
  });

  if (result.count !== 1) {
    return false;
  }

  await tx.requestComment.create({
    data: {
      requestId: recipient.accessRequestId,
      author: actor,
      type: 'offboard_campaign_rollback',
      comment: `Rollback restored request status to "${originalRequest.status}" after offboard campaign "${recipient.campaign.name}".`,
    },
  });

  return true;
}

export async function createOffboardDryRun(input: DryRunInput, actor: string) {
  const waveSize = Math.max(1, Math.min(Number(input.waveSize || 25), 500));
  const canarySize = Math.max(0, Math.min(Number(input.canarySize || 0), 500));
  const pauseAfterEachWave = input.pauseAfterEachWave ?? true;
  const includedUsernames = cleanList(input.includedUsernames).map(normalize);
  const excludedUsernames = cleanList(input.excludedUsernames).map(normalize);
  const excludedEmails = cleanList(input.excludedEmails).map(normalize);
  const includedUsernameSet = new Set(includedUsernames);
  const excludedUsernameSet = new Set(excludedUsernames);
  const excludedEmailSet = new Set(excludedEmails);

  if (includedUsernames.length === 0) {
    throw new Error('Select at least one account for the offboard campaign');
  }

  const existingActive = await prisma.offboardCampaign.findFirst({
    where: { activeLockKey: ACTIVE_LOCK_KEY },
    select: { id: true, name: true },
  });

  if (existingActive) {
    throw new Error(`Cannot create dry run while active campaign "${existingActive.name}" is locked`);
  }

  const [ldapUsersRaw, vpnAccounts] = await Promise.all([
    listUsersInOU(),
    prisma.vPNAccount.findMany({
      select: {
        id: true,
        username: true,
        name: true,
        email: true,
        status: true,
        portalType: true,
        isInternal: true,
        password: true,
        expiresAt: true,
        createdBy: true,
        createdByFaculty: true,
        facultyCreatedAt: true,
        disabledAt: true,
        disabledBy: true,
        disabledReason: true,
        revokedAt: true,
        revokedBy: true,
        revokedReason: true,
        restoredAt: true,
        restoredBy: true,
        notes: true,
        batchId: true,
        accessRequestId: true,
        importId: true,
        adUsername: true,
        canRestore: true,
      },
    }),
  ]);

  const uniqueUsers = new Map<string, LdapUserSnapshot>();
  for (const user of ldapUsersRaw as LdapUserSnapshot[]) {
    const key = normalize(user.username);
    if (key && !uniqueUsers.has(key)) {
      uniqueUsers.set(key, user);
    }
  }

  const targetUsers = Array.from(uniqueUsers.values())
    .filter(user => includedUsernameSet.has(normalize(user.username)));
  const missingIncludedUsernames = includedUsernames.filter(username => !uniqueUsers.has(username));

  if (targetUsers.length === 0) {
    throw new Error('None of the selected accounts were found in the configured LDAP scope');
  }

  const usernames = targetUsers.map(user => user.username);
  const accessRequestMap = await findAccessRequestsByUsername(usernames);
  const verificationMap = await getAccountVerificationMap(usernames);
  const vpnByAd = buildVpnLookup(vpnAccounts);
  const now = new Date();
  const projectedDeadline = addDays(now, 7);

  let eligibleIndex = 0;
  const recipientRows = targetUsers
    .sort((a, b) => a.username.localeCompare(b.username))
    .map(user => {
      const usernameKey = normalize(user.username);
      const vpn = vpnByAd.get(usernameKey) || null;
      const accessRequest = accessRequestMap.get(usernameKey) || null;
      const verification = verificationMap.get(usernameKey) || emptyVerificationInfo();
      const skipReason = safetySkipReason(user, excludedUsernameSet, excludedEmailSet);
      const isSkipped = Boolean(skipReason);
      const waveNumber = isSkipped ? -1 : waveNumberForEligibleIndex(eligibleIndex++, canarySize, waveSize);

      return {
        email: user.email,
        displayName: user.displayName || user.username,
        adUsername: user.username,
        adDn: user.dn,
        linkedVpnUsername: vpn?.username || null,
        accessRequestId: accessRequest?.id || user.accessRequestId || null,
        vpnAccountId: vpn?.id || null,
        originalAdEnabled: user.accountEnabled,
        originalAdStatus: user.accountEnabled ? 'active' : 'disabled',
        originalVpnStatus: vpn?.status || null,
        originalVpnPortalType: vpn?.portalType || null,
        originalSnapshot: {
          ldap: user,
          vpn: vpn || null,
          accessRequest: accessRequest || null,
          lastVerification: verification,
        },
        waveNumber,
        status: isSkipped ? 'skipped' : 'dry_run_ready',
        skipReason,
        projectedDeadlineAt: isSkipped ? null : projectedDeadline,
        projectedAction: isSkipped ? null : projectedActionFor(user, vpn),
      };
    });

  const eligibleRecipients = recipientRows.filter(row => row.status === 'dry_run_ready').length;
  const skippedRecipients = recipientRows.filter(row => row.status === 'skipped').length;

  return await prisma.$transaction(async (tx: any) => {
    const campaign = await tx.offboardCampaign.create({
      data: {
        name: input.name?.trim() || `Offboard dry run ${now.toISOString().slice(0, 10)}`,
        createdBy: actor,
        status: 'dry_run',
        dryRunAt: now,
        waveSize,
        canarySize,
        currentWave: canarySize > 0 ? 0 : 0,
        pauseAfterEachWave,
        sendingPaused: true,
        manualExcludedUsernames: excludedUsernames,
        manualExcludedEmails: excludedEmails,
        totalRecipients: recipientRows.length,
        eligibleRecipients,
        skippedRecipients,
        summaryJson: {
          ldapSearchBase: process.env.LDAP_SEARCH_BASE || null,
          vpnAccountsConsidered: vpnAccounts.length,
          scope: 'selected_accounts',
          includedUsernames,
          missingIncludedUsernames,
          exclusions: { excludedUsernames, excludedEmails },
        },
      },
    });

    if (recipientRows.length > 0) {
      await tx.offboardCampaignRecipient.createMany({
        data: recipientRows.map(row => ({
          ...row,
          campaignId: campaign.id,
        })),
      });
    }

    await createCampaignLog(tx, {
      campaignId: campaign.id,
      eventType: 'dry_run_created',
      actor,
      message: `Dry run snapshot created from ${targetUsers.length} selected accounts with ${eligibleRecipients} eligible recipients and ${skippedRecipients} skipped records`,
      details: {
        selectedAccounts: targetUsers.length,
        missingIncludedUsernames,
        totalRecipients: recipientRows.length,
        eligibleRecipients,
        skippedRecipients,
        waveSize,
        canarySize,
        pauseAfterEachWave,
      },
    });

    return await getOffboardCampaign(campaign.id, tx);
  });
}

export async function getOffboardCampaign(campaignId: string, client: any = prisma) {
  const campaign = await client.offboardCampaign.findUnique({
    where: { id: campaignId },
    include: {
      recipients: {
        orderBy: [{ waveNumber: 'asc' }, { adUsername: 'asc' }],
        take: 250,
      },
    },
  });

  if (!campaign) {
    return null;
  }

  const statusCounts = await client.offboardCampaignRecipient.groupBy({
    by: ['status'],
    where: { campaignId },
    _count: { status: true },
  });

  const verificationMap = await getAccountVerificationMap(
    campaign.recipients.map((recipient: OffboardCampaignRecipientSummary) => recipient.adUsername),
    client
  );
  const extensions = await client.offboardCampaignExtension.findMany({
    where: { campaignId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      recipientId: true,
      status: true,
      newDeadlineAt: true,
      notificationError: true,
    },
  });
  const latestExtensionByRecipient = new Map<string, typeof extensions[number]>();
  for (const extension of extensions) {
    if (!latestExtensionByRecipient.has(extension.recipientId)) {
      latestExtensionByRecipient.set(extension.recipientId, extension);
    }
  }

  const recipients = campaign.recipients.map((recipient: OffboardCampaignRecipientSummary) => {
    const verification = verificationMap.get(normalize(recipient.adUsername)) || emptyVerificationInfo();
    const lastVerifiedAt = recipient.verifiedAt || verification.lastVerifiedAt;
    const lastVerifiedSource = recipient.verifiedAt ? 'current_campaign' : verification.lastVerifiedSource;
    return {
      ...recipient,
      lastVerifiedAt,
      lastVerifiedSource,
      originalRegistrationAt: verification.originalRegistrationAt,
      latestExtension: latestExtensionByRecipient.get(String(recipient.id)) || null,
    };
  });

  return {
    ...campaign,
    recipients,
    logs: [],
    statusCounts: statusCounts.reduce((acc: Record<string, number>, item: OffboardCampaignStatusCount) => {
      acc[item.status] = item._count.status;
      return acc;
    }, {}),
  };
}

export async function listOffboardCampaignLogs(
  campaignId: string,
  options: {
    page?: number;
    pageSize?: number;
    sortKey?: 'createdAt' | 'level' | 'eventType' | 'actor' | 'message';
    sortDirection?: 'asc' | 'desc';
  } = {}
) {
  const pageSize = [10, 25, 50, 100].includes(Number(options.pageSize))
    ? Number(options.pageSize)
    : 25;
  const page = Math.max(1, Number(options.page) || 1);
  const sortKey = options.sortKey || 'createdAt';
  const sortDirection = options.sortDirection === 'asc' ? 'asc' : 'desc';
  const totalCount = await prisma.offboardCampaignLog.count({ where: { campaignId } });
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const boundedPage = Math.min(page, totalPages);

  const logs = await prisma.offboardCampaignLog.findMany({
    where: { campaignId },
    orderBy: { [sortKey]: sortDirection },
    skip: (boundedPage - 1) * pageSize,
    take: pageSize,
  });

  return {
    logs,
    pagination: {
      page: boundedPage,
      pageSize,
      totalCount,
      totalPages,
    },
  };
}

export async function listOffboardCampaigns(selectedCampaignId?: string | null) {
  const campaigns = await prisma.offboardCampaign.findMany({
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: {
      id: true,
      name: true,
      status: true,
      createdAt: true,
      dryRunAt: true,
      activatedAt: true,
      createdBy: true,
      totalRecipients: true,
      eligibleRecipients: true,
      skippedRecipients: true,
      sentCount: true,
      reminder3Count: true,
      reminder6Count: true,
      verifiedCount: true,
      enforcedCount: true,
      failedCount: true,
      rollbackState: true,
      emergencyStoppedAt: true,
      cancelledAt: true,
      sendingPaused: true,
      remindersPaused: true,
      enforcementPaused: true,
      currentWave: true,
    },
  });

  const selectedId = selectedCampaignId || campaigns[0]?.id || null;
  const selectedCampaign = selectedId ? await getOffboardCampaign(selectedId) : null;

  return { campaigns, selectedCampaign };
}

export async function deleteOffboardDryRun(campaignId: string, actor: string) {
  const campaign = await prisma.offboardCampaign.findUnique({
    where: { id: campaignId },
    select: {
      id: true,
      name: true,
      status: true,
      activeLockKey: true,
      activatedAt: true,
    },
  });

  if (!campaign) {
    throw new Error('Campaign not found');
  }

  if (campaign.status !== 'dry_run' || campaign.activatedAt || campaign.activeLockKey) {
    throw new Error('Only unactivated dry runs can be deleted');
  }

  await prisma.$transaction(async (tx: any) => {
    await createCampaignLog(tx, {
      campaignId,
      eventType: 'dry_run_deleted',
      actor,
      message: `Dry run "${campaign.name}" deleted`,
    });

    await tx.offboardCampaign.delete({
      where: { id: campaignId },
    });
  });

  return campaign;
}

export async function activateOffboardCampaign(campaignId: string, actor: string) {
  const campaign = await prisma.offboardCampaign.findUnique({
    where: { id: campaignId },
    include: { recipients: true },
  });

  if (!campaign) {
    throw new Error('Campaign not found');
  }

  if (campaign.status !== 'dry_run') {
    throw new Error(`Only dry-run campaigns can be activated. Current status: ${campaign.status}`);
  }

  const [ldapUsersRaw, vpnAccounts] = await Promise.all([
    listUsersInOU(),
    prisma.vPNAccount.findMany({
      select: {
        id: true,
        username: true,
        status: true,
        portalType: true,
        adUsername: true,
      },
    }),
  ]);

  const liveUsers = new Map<string, LdapUserSnapshot>();
  for (const user of ldapUsersRaw as LdapUserSnapshot[]) {
    liveUsers.set(normalize(user.username), user);
  }

  const vpnByAd = buildVpnLookup(vpnAccounts);
  const excludedUsernameSet = new Set<string>((campaign.manualExcludedUsernames as string[] | null || []).map(normalize));
  const excludedEmailSet = new Set<string>((campaign.manualExcludedEmails as string[] | null || []).map(normalize));

  type CampaignRecipientForActivation = {
    id: string;
    status: string;
    skipReason: string | null;
    adUsername: string;
    email: string | null;
    linkedVpnUsername: string | null;
    originalVpnStatus: string | null;
    waveNumber: number;
  };

  type CampaignActivationUpdate = {
    id: string;
    status: 'skipped' | 'pending_send';
    skipReason: string | null;
  };

  const updates: CampaignActivationUpdate[] = (campaign.recipients as CampaignRecipientForActivation[]).map((recipient) => {
    if (recipient.status === 'skipped') {
      return { id: recipient.id, status: 'skipped', skipReason: recipient.skipReason };
    }

    const live = liveUsers.get(normalize(recipient.adUsername));
    let skipReason: string | null = null;

    if (!live) {
      skipReason = 'no_longer_in_ldap_scope';
    } else {
      skipReason = safetySkipReason(live, excludedUsernameSet, excludedEmailSet);
      if (!skipReason && normalize(live.email) !== normalize(recipient.email)) {
        skipReason = 'email_changed_since_dry_run';
      }

      const liveVpn = vpnByAd.get(normalize(recipient.adUsername)) || null;
      if (!skipReason && normalize(liveVpn?.username) !== normalize(recipient.linkedVpnUsername)) {
        skipReason = 'vpn_link_changed_since_dry_run';
      }
      if (!skipReason && liveVpn && liveVpn.status !== recipient.originalVpnStatus) {
        skipReason = 'vpn_status_changed_since_dry_run';
      }
    }

    return {
      id: recipient.id,
      status: skipReason ? 'skipped' : 'pending_send',
      skipReason,
    };
  });

  const activatedCount = updates.filter(update => update.status === 'pending_send').length;
  const skippedCount = updates.filter(update => update.status === 'skipped').length;
  const firstWave = campaign.recipients
    .filter((recipient: CampaignRecipientForActivation) => updates.some(update => update.id === recipient.id && update.status === 'pending_send'))
    .reduce((min: number | null, recipient: CampaignRecipientForActivation) => min === null ? recipient.waveNumber : Math.min(min, recipient.waveNumber), null);

  return await prisma.$transaction(async (tx: any) => {
    for (const update of updates) {
      await tx.offboardCampaignRecipient.update({
        where: { id: update.id },
        data: {
          status: update.status,
          skipReason: update.skipReason,
        },
      });
    }

    await tx.offboardCampaign.update({
      where: { id: campaignId },
      data: {
        status: 'active',
        activatedAt: new Date(),
        activatedBy: actor,
        activeLockKey: ACTIVE_LOCK_KEY,
        sendingPaused: false,
        currentWave: firstWave ?? 0,
        eligibleRecipients: activatedCount,
        skippedRecipients: skippedCount,
      },
    });

    await createCampaignLog(tx, {
      campaignId,
      eventType: 'campaign_activated',
      actor,
      message: `Campaign activated with ${activatedCount} recipients queued for sending`,
      details: { activatedCount, skippedCount, firstWave },
    });

    return await getOffboardCampaign(campaignId, tx);
  });
}

export async function controlOffboardCampaign(campaignId: string, action: string, actor: string) {
  const campaign = await prisma.offboardCampaign.findUnique({ where: { id: campaignId } });
  if (!campaign) {
    throw new Error('Campaign not found');
  }

  const data: Record<string, unknown> = {};
  let eventType = action;
  let message = '';

  switch (action) {
    case 'pause_sending':
      data.sendingPaused = true;
      message = 'Sending paused';
      break;
    case 'resume_sending':
    case 'resume_wave':
      data.sendingPaused = false;
      message = 'Sending resumed';
      eventType = 'resume_sending';
      break;
    case 'pause_reminders':
      data.remindersPaused = true;
      message = 'Reminders paused';
      break;
    case 'resume_reminders':
      data.remindersPaused = false;
      message = 'Reminders resumed';
      break;
    case 'pause_enforcement':
      data.enforcementPaused = true;
      message = 'Enforcement paused';
      break;
    case 'resume_enforcement':
      data.enforcementPaused = false;
      message = 'Enforcement resumed';
      break;
    case 'cancel':
      data.status = 'cancelled';
      data.cancelledAt = new Date();
      data.cancelledBy = actor;
      data.sendingPaused = true;
      data.remindersPaused = true;
      data.enforcementPaused = true;
      data.activeLockKey = null;
      message = 'Campaign cancelled';
      break;
    case 'emergency_stop':
      data.status = 'emergency_stopped';
      data.emergencyStoppedAt = new Date();
      data.emergencyStoppedBy = actor;
      data.sendingPaused = true;
      data.remindersPaused = true;
      data.enforcementPaused = true;
      data.activeLockKey = null;
      message = 'Emergency stop activated';
      break;
    default:
      throw new Error(`Unknown campaign control action: ${action}`);
  }

  return await prisma.$transaction(async (tx: any) => {
    await tx.offboardCampaign.update({
      where: { id: campaignId },
      data,
    });

    await createCampaignLog(tx, {
      campaignId,
      eventType,
      actor,
      message,
      details: { action, data },
    });

    return await getOffboardCampaign(campaignId, tx);
  });
}

async function markStaleEmailClaims() {
  const staleBefore = new Date(Date.now() - EMAIL_CLAIM_STALE_MS);
  const result = await prisma.offboardCampaignRecipient.updateMany({
    where: {
      status: 'email_sending',
      emailClaimedAt: { lt: staleBefore },
      initialEmailSentAt: null,
    },
    data: {
      status: 'email_unknown',
      tokenHash: null,
      lastError: 'Initial email send claim became stale before a successful send was recorded',
    },
  });

  if (result.count > 0) {
    appLogger.warn('Marked stale offboard email claims as unknown', { count: result.count });
  }
}

export async function processOffboardCampaigns(options: ProcessOptions = {}) {
  const actor = options.actor || 'system';
  const limit = Math.max(1, Math.min(options.limit || 50, 250));
  await markStaleEmailClaims();

  const campaigns = await prisma.offboardCampaign.findMany({
    where: {
      status: 'active',
      ...(options.campaignId ? { id: options.campaignId } : {}),
    },
    orderBy: { activatedAt: 'asc' },
  });

  const summaries = [];
  for (const campaign of campaigns) {
    const scheduledControls: CampaignProcessControls = options.scheduledWindow
      ? {
          dueAfter: options.scheduledWindow.startExclusive,
          dueAtOrBefore: options.scheduledWindow.endInclusive,
        }
      : {};
    const shouldProcessInitialEmails = options.processInitialEmails ?? !options.scheduledWindow;
    const sendSummary = shouldProcessInitialEmails
      ? await processCampaignSending(campaign.id, actor, limit)
      : { sent: 0, failed: 0 };
    const enforcementSummary = await processCampaignEnforcement(
      campaign.id,
      actor,
      limit,
      scheduledControls
    );
    const reminderSummary = await processCampaignReminders(
      campaign.id,
      actor,
      limit,
      scheduledControls
    );
    await completeCampaignIfFinished(campaign.id);
    const sendProcessed = sendSummary.sent + sendSummary.failed;
    const reminderProcessed = reminderSummary.sent + reminderSummary.failed;
    const enforcementProcessed =
      enforcementSummary.enforced + enforcementSummary.skipped + enforcementSummary.failed;
    summaries.push({
      campaignId: campaign.id,
      sent: sendSummary.sent,
      reminders: reminderSummary.sent,
      remindersSkippedBecausePaused: reminderSummary.skippedBecausePaused,
      enforced: enforcementSummary.enforced,
      enforcementSkipped: enforcementSummary.skipped,
      enforcementSkippedBecausePaused: enforcementSummary.skippedBecausePaused,
      failures: sendSummary.failed + reminderSummary.failed + enforcementSummary.failed,
      batchLimitReached:
        sendProcessed >= limit ||
        reminderProcessed >= limit ||
        enforcementProcessed >= limit,
    });
  }

  return summaries;
}

export async function previewProcessAllOffboardCampaign(campaignId: string) {
  const campaign = await prisma.offboardCampaign.findUnique({
    where: { id: campaignId },
    select: {
      id: true,
      status: true,
      sendingPaused: true,
      remindersPaused: true,
      enforcementPaused: true,
      cancelledAt: true,
      emergencyStoppedAt: true,
    },
  });
  if (!campaign) {
    throw new Error('Campaign not found');
  }

  const now = new Date();
  const day3DueBefore = new Date(now.getTime() - 3 * DAY_MS);
  const day6DueBefore = new Date(now.getTime() - 6 * DAY_MS);
  const [
    pendingInitialEmails,
    day3Reminders,
    day6Reminders,
    extensionReminderCandidates,
    enforcementRecipients,
    enforcementVpnRevocations,
    statusCounts,
  ] = await Promise.all([
    prisma.offboardCampaignRecipient.count({
      where: { campaignId, status: 'pending_send', initialEmailSentAt: null },
    }),
    prisma.offboardCampaignRecipient.count({
      where: {
        campaignId,
        status: 'sent',
        verifiedAt: null,
        enforcedAt: null,
        deadlineAt: { gt: now },
        initialEmailSentAt: { gt: day6DueBefore, lte: day3DueBefore },
        reminder3SentAt: null,
        reminder3ClaimedAt: null,
        extensions: {
          none: {
            status: { in: ACTIVE_EXTENSION_STATUSES },
            newDeadlineAt: { gt: now },
          },
        },
      },
    }),
    prisma.offboardCampaignRecipient.count({
      where: {
        campaignId,
        status: 'sent',
        verifiedAt: null,
        enforcedAt: null,
        deadlineAt: { gt: now },
        initialEmailSentAt: { lte: day6DueBefore },
        reminder6SentAt: null,
        reminder6ClaimedAt: null,
        extensions: {
          none: {
            status: { in: ACTIVE_EXTENSION_STATUSES },
            newDeadlineAt: { gt: now },
          },
        },
      },
    }),
    prisma.offboardCampaignExtensionReminder.findMany({
      where: {
        scheduledFor: { lte: now },
        sentAt: null,
        claimedAt: null,
        extension: {
          campaignId,
          status: { in: ['active', 'notification_failed'] },
          newDeadlineAt: { gt: now },
          recipient: { status: 'sent', verifiedAt: null, deadlineAt: { gt: now } },
        },
      },
      select: {
        scheduledFor: true,
        extension: {
          select: { createdAt: true },
        },
      },
    }),
    prisma.offboardCampaignRecipient.count({
      where: {
        campaignId,
        status: 'sent',
        verifiedAt: null,
        enforcedAt: null,
        deadlineAt: { lte: now },
        enforcementClaimedAt: null,
      },
    }),
    prisma.offboardCampaignRecipient.count({
      where: {
        campaignId,
        status: 'sent',
        verifiedAt: null,
        enforcedAt: null,
        deadlineAt: { lte: now },
        enforcementClaimedAt: null,
        linkedVpnUsername: { not: null },
      },
    }),
    prisma.offboardCampaignRecipient.groupBy({
      by: ['status'],
      where: { campaignId },
      _count: { status: true },
    }),
  ]);
  const extensionReminders = extensionReminderCandidates.filter(reminder =>
    isOffboardExtensionReminderScheduleValid(
      reminder.extension.createdAt,
      reminder.scheduledFor
    )
  ).length;
  const suppressedExtensionReminders = extensionReminderCandidates.length - extensionReminders;

  return {
    campaignId,
    campaignStatus: campaign.status,
    runnable: campaign.status === 'active' && !campaign.cancelledAt && !campaign.emergencyStoppedAt,
    sections: {
      initialEmails: {
        count: pendingInitialEmails,
        paused: campaign.sendingPaused,
        description: `Send ${pendingInitialEmails} initial email${pendingInitialEmails === 1 ? '' : 's'} across every pending wave.`,
      },
      reminders: {
        count: day3Reminders + day6Reminders + extensionReminders,
        day3: day3Reminders,
        day6: day6Reminders,
        extension: extensionReminders,
        suppressedExtension: suppressedExtensionReminders,
        paused: campaign.remindersPaused,
        description: `Send ${day3Reminders + day6Reminders + extensionReminders} reminder${day3Reminders + day6Reminders + extensionReminders === 1 ? '' : 's'} currently due.`,
      },
      enforcement: {
        count: enforcementRecipients,
        adDisables: enforcementRecipients,
        vpnRevocations: enforcementVpnRevocations,
        paused: campaign.enforcementPaused,
        description: `Evaluate ${enforcementRecipients} expired recipient${enforcementRecipients === 1 ? '' : 's'} for AD disablement and ${enforcementVpnRevocations} linked VPN revocation${enforcementVpnRevocations === 1 ? '' : 's'}.`,
      },
    },
    statusCounts: statusCounts.reduce((acc: Record<string, number>, item: OffboardCampaignStatusCount) => {
      acc[item.status] = item._count.status;
      return acc;
    }, {}),
  };
}

export async function processAllOffboardCampaign(
  campaignId: string,
  input: ProcessAllOffboardInput,
  actor: string
) {
  const preview = await previewProcessAllOffboardCampaign(campaignId);
  if (!preview.runnable) {
    throw new Error(`Campaign cannot be processed while status is ${preview.campaignStatus}`);
  }

  const results = {
    campaignId,
    initialEmails: { sent: 0, failed: 0, skippedBecausePaused: false },
    reminders: { sent: 0, failed: 0, skippedBecausePaused: false },
    enforcement: { enforced: 0, skipped: 0, failed: 0, skippedBecausePaused: false },
  };

  if (input.initialEmails) {
    if (preview.sections.initialEmails.paused && !input.overrideSendingPause) {
      results.initialEmails.skippedBecausePaused = true;
    } else {
      const summary = await processCampaignSending(campaignId, actor, 5000, {
        ignorePause: Boolean(input.overrideSendingPause),
        bypassWaveGates: true,
      });
      results.initialEmails.sent = summary.sent;
      results.initialEmails.failed = summary.failed;
    }
  }

  // Expired recipients are handled first so a deadline crossing during this run
  // cannot produce a reminder immediately followed by enforcement.
  if (input.enforcement) {
    if (preview.sections.enforcement.paused && !input.overrideEnforcementPause) {
      results.enforcement.skippedBecausePaused = true;
    } else {
      const summary = await processCampaignEnforcement(campaignId, actor, 5000, {
        ignorePause: Boolean(input.overrideEnforcementPause),
      });
      results.enforcement.enforced = summary.enforced;
      results.enforcement.skipped = summary.skipped;
      results.enforcement.failed = summary.failed;
    }
  }

  if (input.reminders) {
    if (preview.sections.reminders.paused && !input.overrideRemindersPause) {
      results.reminders.skippedBecausePaused = true;
    } else {
      const summary = await processCampaignReminders(campaignId, actor, 5000, {
        ignorePause: Boolean(input.overrideRemindersPause),
      });
      results.reminders.sent = summary.sent;
      results.reminders.failed = summary.failed;
    }
  }

  await createCampaignLog(prisma, {
    campaignId,
    eventType: 'process_all_completed',
    actor,
    message: 'Process All completed for the selected work categories',
    details: { input, preview: preview.sections, results },
  });
  await completeCampaignIfFinished(campaignId);

  return {
    results,
    campaign: await getOffboardCampaign(campaignId),
  };
}

async function processCampaignSending(
  campaignId: string,
  actor: string,
  limit: number,
  controls: CampaignProcessControls = {}
) {
  const summary = { sent: 0, failed: 0 };

  while (summary.sent + summary.failed < limit) {
    const campaign = await prisma.offboardCampaign.findUnique({ where: { id: campaignId } });
    if (
      !campaign ||
      campaign.status !== 'active' ||
      (campaign.sendingPaused && !controls.ignorePause) ||
      campaign.cancelledAt ||
      campaign.emergencyStoppedAt
    ) {
      break;
    }

    const pending = await prisma.offboardCampaignRecipient.findMany({
      where: {
        campaignId,
        status: 'pending_send',
        waveNumber: campaign.currentWave,
      },
      orderBy: { adUsername: 'asc' },
      take: Math.max(1, limit - summary.sent - summary.failed),
    });

    if (pending.length === 0) {
      const nextRecipient = await prisma.offboardCampaignRecipient.findFirst({
        where: { campaignId, status: 'pending_send' },
        orderBy: [{ waveNumber: 'asc' }, { adUsername: 'asc' }],
      });

      if (!nextRecipient) {
        if (!campaign.sendingCompletedAt) {
          await prisma.offboardCampaign.update({
            where: { id: campaignId },
            data: { sendingCompletedAt: new Date(), sendingPaused: true },
          });
          await createCampaignLog(prisma, {
            campaignId,
            eventType: 'sending_completed',
            actor,
            message: 'All campaign waves have completed initial sending',
          });
        }
        break;
      }

      await prisma.offboardCampaign.update({
        where: { id: campaignId },
        data: {
          currentWave: nextRecipient.waveNumber,
          sendingPaused: controls.bypassWaveGates ? campaign.sendingPaused : campaign.pauseAfterEachWave,
        },
      });

      await createCampaignLog(prisma, {
        campaignId,
        eventType: campaign.pauseAfterEachWave && !controls.bypassWaveGates ? 'wave_pause' : 'wave_advanced',
        actor,
        message: campaign.pauseAfterEachWave && !controls.bypassWaveGates
          ? `Wave ${campaign.currentWave} finished; campaign paused before wave ${nextRecipient.waveNumber}`
          : `Advanced to wave ${nextRecipient.waveNumber}`,
        details: { previousWave: campaign.currentWave, nextWave: nextRecipient.waveNumber },
      });

      if (campaign.pauseAfterEachWave && !controls.bypassWaveGates) {
        break;
      }
      continue;
    }

    for (const recipient of pending) {
      const result = await sendInitialRecipientEmail(recipient, actor);
      if (result) summary.sent += 1;
      else summary.failed += 1;
    }
  }

  return summary;
}

async function sendInitialRecipientEmail(recipient: any, actor: string): Promise<boolean> {
  const token = generateToken();
  const tokenHash = hashOffboardToken(token);
  const claimed = await prisma.offboardCampaignRecipient.updateMany({
    where: { id: recipient.id, status: 'pending_send', initialEmailSentAt: null },
    data: {
      status: 'email_sending',
      emailClaimedAt: new Date(),
      tokenHash,
    },
  });

  if (claimed.count !== 1) {
    return false;
  }

  const sentAt = new Date();
  const deadline = addDays(sentAt, 7);

  try {
    await prisma.offboardCampaignRecipientToken.create({
      data: {
        recipientId: recipient.id,
        tokenHash,
        purpose: 'initial',
        expiresAt: deadline,
      },
    });

    const info = await sendOffboardInitialEmail({
      email: recipient.email,
      name: recipient.displayName || recipient.adUsername,
      adUsername: recipient.adUsername,
      vpnUsername: recipient.linkedVpnUsername,
      verificationToken: token,
      deadline,
    });

    await prisma.$transaction(async (tx: any) => {
      await tx.offboardCampaignRecipient.update({
        where: { id: recipient.id },
        data: {
          status: 'sent',
          initialEmailSentAt: sentAt,
          initialEmailMessageId: info.messageId || null,
          deadlineAt: deadline,
          lastError: null,
        },
      });

      await tx.offboardCampaign.update({
        where: { id: recipient.campaignId },
        data: { sentCount: { increment: 1 } },
      });

      await createCampaignLog(tx, {
        campaignId: recipient.campaignId,
        recipientId: recipient.id,
        eventType: 'initial_email_sent',
        actor,
        message: `Initial offboard email sent to ${recipient.email}`,
        details: { messageId: info.messageId, deadline },
      });
    });

    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown email failure';
    await prisma.$transaction(async (tx: any) => {
      await tx.offboardCampaignRecipient.update({
        where: { id: recipient.id },
        data: {
          status: 'email_unknown',
          tokenHash: null,
          lastError: message,
        },
      });
      await tx.offboardCampaignRecipientToken.deleteMany({
        where: { recipientId: recipient.id, tokenHash },
      });

      await tx.offboardCampaign.update({
        where: { id: recipient.campaignId },
        data: { failedCount: { increment: 1 } },
      });

      await createCampaignLog(tx, {
        campaignId: recipient.campaignId,
        recipientId: recipient.id,
        level: 'error',
        eventType: 'email_failure',
        actor,
        message: `Initial email failed for ${recipient.email}`,
        details: { error: message },
      });
    });

    return false;
  }
}

async function processCampaignReminders(
  campaignId: string,
  actor: string,
  limit: number,
  controls: CampaignProcessControls = {}
) {
  const campaign = await prisma.offboardCampaign.findUnique({ where: { id: campaignId } });
  const summary = { sent: 0, failed: 0, skippedBecausePaused: false };
  if (
    !campaign ||
    campaign.status !== 'active' ||
    campaign.cancelledAt ||
    campaign.emergencyStoppedAt
  ) {
    return summary;
  }
  if (campaign.remindersPaused && !controls.ignorePause) {
    summary.skippedBecausePaused = true;
    return summary;
  }

  const remaining = limit;
  const day3 = await sendReminderBatch(campaignId, actor, 3, remaining, controls);
  summary.sent += day3.sent;
  summary.failed += day3.failed;

  if (summary.sent + summary.failed < limit) {
    const day6 = await sendReminderBatch(
      campaignId,
      actor,
      6,
      limit - summary.sent - summary.failed,
      controls
    );
    summary.sent += day6.sent;
    summary.failed += day6.failed;
  }

  if (summary.sent + summary.failed < limit) {
    const extension = await sendExtensionReminderBatch(
      campaignId,
      actor,
      limit - summary.sent - summary.failed,
      controls
    );
    summary.sent += extension.sent;
    summary.failed += extension.failed;
  }

  return summary;
}

async function sendReminderBatch(
  campaignId: string,
  actor: string,
  reminderDay: 3 | 6,
  limit: number,
  controls: CampaignProcessControls = {}
) {
  const summary = { sent: 0, failed: 0 };
  if (limit <= 0) return summary;

  const now = controls.dueAtOrBefore || new Date();
  const sentField = reminderDay === 3 ? 'reminder3SentAt' : 'reminder6SentAt';
  const claimField = reminderDay === 3 ? 'reminder3ClaimedAt' : 'reminder6ClaimedAt';
  const dueBefore = new Date(now.getTime() - reminderDay * DAY_MS);
  const scheduledAfter = controls.dueAfter
    ? new Date(controls.dueAfter.getTime() - reminderDay * DAY_MS)
    : null;
  const day3WindowStart = new Date(now.getTime() - 6 * DAY_MS);
  const windowStart = reminderDay === 3
    ? new Date(Math.max(day3WindowStart.getTime(), scheduledAfter?.getTime() || 0))
    : scheduledAfter;
  const reminderWindow = {
    ...(windowStart ? { gt: windowStart } : {}),
    lte: dueBefore,
  };

  const recipients = await prisma.offboardCampaignRecipient.findMany({
    where: {
      campaignId,
      status: 'sent',
      verifiedAt: null,
      enforcedAt: null,
      deadlineAt: { gt: now },
      initialEmailSentAt: reminderWindow,
      [sentField]: null,
      [claimField]: null,
      extensions: {
        none: {
          status: { in: ACTIVE_EXTENSION_STATUSES },
          newDeadlineAt: { gt: now },
        },
      },
    },
    orderBy: { initialEmailSentAt: 'asc' },
    take: limit,
  });

  for (const recipient of recipients) {
    const token = generateToken();
    const tokenHash = hashOffboardToken(token);
    const claim = await prisma.offboardCampaignRecipient.updateMany({
      where: {
        id: recipient.id,
        status: 'sent',
        verifiedAt: null,
        enforcedAt: null,
        deadlineAt: { gt: now },
        initialEmailSentAt: reminderWindow,
        [sentField]: null,
        [claimField]: null,
        extensions: {
          none: {
            status: { in: ACTIVE_EXTENSION_STATUSES },
            newDeadlineAt: { gt: now },
          },
        },
      },
      data: {
        [claimField]: new Date(),
        tokenHash,
      },
    });

    if (claim.count !== 1) {
      continue;
    }

    try {
      await prisma.offboardCampaignRecipientToken.create({
        data: {
          recipientId: recipient.id,
          tokenHash,
          purpose: `day_${reminderDay}_reminder`,
          expiresAt: recipient.deadlineAt || undefined,
        },
      });

      await sendOffboardReminderEmail({
        email: recipient.email,
        name: recipient.displayName || recipient.adUsername,
        adUsername: recipient.adUsername,
        vpnUsername: recipient.linkedVpnUsername,
        verificationToken: token,
        deadline: recipient.deadlineAt || addDays(new Date(), 1),
        reminderDay,
      });

      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.offboardCampaignRecipient.update({
          where: { id: recipient.id },
          data: { [sentField]: new Date(), lastError: null },
        });
        await tx.offboardCampaign.update({
          where: { id: campaignId },
          data: reminderDay === 3 ? { reminder3Count: { increment: 1 } } : { reminder6Count: { increment: 1 } },
        });
        await createCampaignLog(tx, {
          campaignId,
          recipientId: recipient.id,
          eventType: `day_${reminderDay}_reminder_sent`,
          actor,
          message: `Day ${reminderDay} reminder sent to ${recipient.email}`,
        });
      });
      summary.sent += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown reminder failure';
      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.offboardCampaignRecipient.update({
          where: { id: recipient.id },
          data: { [claimField]: null, lastError: message },
        });
        await tx.offboardCampaignRecipientToken.deleteMany({
          where: { recipientId: recipient.id, tokenHash },
        });
        await createCampaignLog(tx, {
          campaignId,
          recipientId: recipient.id,
          level: 'error',
          eventType: 'reminder_failure',
          actor,
          message: `Day ${reminderDay} reminder failed for ${recipient.email}`,
          details: { error: message },
        });
      });
      summary.failed += 1;
    }
  }

  return summary;
}

async function sendExtensionReminderBatch(
  campaignId: string,
  actor: string,
  limit: number,
  controls: CampaignProcessControls = {}
) {
  const summary = { sent: 0, failed: 0 };
  if (limit <= 0) return summary;

  const now = controls.dueAtOrBefore || new Date();
  const reminders = await prisma.offboardCampaignExtensionReminder.findMany({
    where: {
      scheduledFor: {
        ...(controls.dueAfter ? { gt: controls.dueAfter } : {}),
        lte: now,
      },
      sentAt: null,
      claimedAt: null,
      extension: {
        campaignId,
        status: { in: ['active', 'notification_failed'] },
        newDeadlineAt: { gt: now },
        recipient: {
          status: 'sent',
          verifiedAt: null,
          deadlineAt: { gt: now },
        },
      },
    },
    orderBy: { scheduledFor: 'asc' },
    include: {
      extension: {
        include: {
          recipient: true,
        },
      },
    },
  });
  const validReminders = reminders
    .filter(reminder =>
      isOffboardExtensionReminderScheduleValid(
        reminder.extension.createdAt,
        reminder.scheduledFor
      )
    )
    .slice(0, limit);

  for (const reminder of validReminders) {
    const claim = await prisma.offboardCampaignExtensionReminder.updateMany({
      where: {
        id: reminder.id,
        sentAt: null,
        claimedAt: null,
      },
      data: { claimedAt: new Date() },
    });
    if (claim.count !== 1) continue;

    const recipient = reminder.extension.recipient;
    const token = generateToken();
    const tokenHash = hashOffboardToken(token);

    try {
      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.offboardCampaignRecipientToken.updateMany({
          where: {
            recipientId: recipient.id,
            usedAt: null,
            expiresAt: { gt: new Date() },
          },
          data: { expiresAt: new Date() },
        });
        await tx.offboardCampaignRecipientToken.create({
          data: {
            recipientId: recipient.id,
            tokenHash,
            purpose: `extension_reminder:${reminder.id}`,
            expiresAt: reminder.extension.newDeadlineAt,
          },
        });
        await tx.offboardCampaignRecipient.update({
          where: { id: recipient.id },
          data: { tokenHash },
        });
      });

      const info = await sendOffboardExtensionReminderEmail({
        email: recipient.email,
        name: recipient.displayName || recipient.adUsername,
        adUsername: recipient.adUsername,
        vpnUsername: recipient.linkedVpnUsername,
        verificationToken: token,
        deadline: reminder.extension.newDeadlineAt,
      });

      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.offboardCampaignExtensionReminder.update({
          where: { id: reminder.id },
          data: {
            sentAt: new Date(),
            messageId: info.messageId || null,
            lastError: null,
          },
        });
        await createCampaignLog(tx, {
          campaignId,
          recipientId: recipient.id,
          eventType: 'extension_reminder_sent',
          actor,
          message: `Extension reminder sent to ${recipient.email}`,
          details: {
            extensionId: reminder.extensionId,
            reminderId: reminder.id,
            scheduledFor: reminder.scheduledFor,
          },
        });
      });
      summary.sent += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown extension reminder failure';
      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.offboardCampaignExtensionReminder.update({
          where: { id: reminder.id },
          data: {
            claimedAt: null,
            lastError: message,
          },
        });
        await createCampaignLog(tx, {
          campaignId,
          recipientId: recipient.id,
          level: 'error',
          eventType: 'extension_reminder_failure',
          actor,
          message: `Extension reminder failed for ${recipient.email}`,
          details: { extensionId: reminder.extensionId, reminderId: reminder.id, error: message },
        });
      });
      summary.failed += 1;
    }
  }

  return summary;
}

async function processCampaignEnforcement(
  campaignId: string,
  actor: string,
  limit: number,
  controls: CampaignProcessControls = {}
) {
  const campaign = await prisma.offboardCampaign.findUnique({ where: { id: campaignId } });
  const summary = { enforced: 0, skipped: 0, failed: 0, skippedBecausePaused: false };
  if (
    !campaign ||
    campaign.status !== 'active' ||
    campaign.cancelledAt ||
    campaign.emergencyStoppedAt
  ) {
    return summary;
  }
  if (campaign.enforcementPaused && !controls.ignorePause) {
    summary.skippedBecausePaused = true;
    return summary;
  }

  const now = controls.dueAtOrBefore || new Date();
  const deadlineWindow = {
    ...(controls.dueAfter ? { gt: controls.dueAfter } : {}),
    lte: now,
  };
  const recipients = await prisma.offboardCampaignRecipient.findMany({
    where: {
      campaignId,
      status: 'sent',
      verifiedAt: null,
      enforcedAt: null,
      deadlineAt: deadlineWindow,
      enforcementClaimedAt: null,
    },
    orderBy: { deadlineAt: 'asc' },
    take: limit,
  });

  for (const recipient of recipients) {
    const claim = await prisma.offboardCampaignRecipient.updateMany({
      where: {
        id: recipient.id,
        status: 'sent',
        verifiedAt: null,
        enforcedAt: null,
        deadlineAt: deadlineWindow,
        enforcementClaimedAt: null,
      },
      data: {
        status: 'enforcement_processing',
        enforcementClaimedAt: new Date(),
      },
    });

    if (claim.count !== 1) {
      continue;
    }

    const result = await enforceRecipient(recipient.id, actor, controls);
    if (result === 'enforced') summary.enforced += 1;
    else if (result === 'skipped') summary.skipped += 1;
    else summary.failed += 1;
  }

  return summary;
}

async function liveEnforcementSkipReason(recipient: any): Promise<string | null> {
  const userInfo = await searchLDAPUser(recipient.adUsername);
  if (!userInfo) {
    return 'no_longer_in_ldap_scope';
  }

  const liveEmail = getAttribute(userInfo.attributes, 'mail');
  if (normalize(liveEmail) !== normalize(recipient.email)) {
    return 'email_changed_before_enforcement';
  }

  if (!isLdapAccountEnabledFromUac(getAttribute(userInfo.attributes, 'userAccountControl'))) {
    return 'ad_account_already_disabled';
  }

  if (isAdminGroupMember(getAttributeValues(userInfo.attributes, 'memberOf'))) {
    return 'became_admin_group_member';
  }

  if (recipient.linkedVpnUsername) {
    const vpn = await prisma.vPNAccount.findUnique({
      where: { username: recipient.linkedVpnUsername },
      select: { status: true, adUsername: true },
    });

    if (!vpn) {
      return 'linked_vpn_missing_before_enforcement';
    }
    if (vpn.status === 'revoked' || vpn.status === 'disabled') {
      return 'vpn_account_already_revoked_or_disabled';
    }
    if (vpn.adUsername && normalize(vpn.adUsername) !== normalize(recipient.adUsername)) {
      return 'vpn_link_changed_before_enforcement';
    }
  }

  return null;
}

async function enforceRecipient(
  recipientId: string,
  actor: string,
  controls: CampaignProcessControls = {}
): Promise<'enforced' | 'skipped' | 'failed'> {
  const recipient = await prisma.offboardCampaignRecipient.findUnique({
    where: { id: recipientId },
    include: { campaign: true },
  });

  if (!recipient) {
    return 'failed';
  }

  if (
    recipient.campaign.status !== 'active' ||
    (recipient.campaign.enforcementPaused && !controls.ignorePause) ||
    recipient.campaign.cancelledAt ||
    recipient.campaign.emergencyStoppedAt
  ) {
    await prisma.offboardCampaignRecipient.update({
      where: { id: recipientId },
      data: { status: 'sent', enforcementClaimedAt: null },
    });
    return 'skipped';
  }

  try {
    const skipReason = await liveEnforcementSkipReason(recipient);
    if (skipReason) {
      await prisma.$transaction(async (tx: any) => {
        await tx.offboardCampaignRecipient.update({
          where: { id: recipientId },
          data: {
            status: 'enforcement_skipped',
            enforcementSkippedAt: new Date(),
            skipReason,
          },
        });
        await createCampaignLog(tx, {
          campaignId: recipient.campaignId,
          recipientId,
          level: 'warn',
          eventType: 'enforcement_skipped',
          actor,
          message: `Enforcement skipped for ${recipient.adUsername}: ${skipReason}`,
          details: { skipReason },
        });
      });
      return 'skipped';
    }

    const actionResults: LifecycleProcessSummary[] = [];
    const adAction = await createAndProcessCampaignLifecycleAction({
      recipient,
      actionType: 'disable_ad',
      targetAccountType: 'AD',
      targetUsername: recipient.adUsername,
      targetUserId: recipient.accessRequestId,
      reason: `Offboard campaign ${recipient.campaign.name}: unverified by campaign deadline`,
      actor,
    });
    actionResults.push(adAction);

    let vpnAction: LifecycleProcessSummary | null = null;
    if (recipient.linkedVpnUsername) {
      vpnAction = await createAndProcessCampaignLifecycleAction({
        recipient,
        actionType: 'revoke_vpn',
        targetAccountType: 'VPN',
        targetUsername: recipient.linkedVpnUsername,
        targetUserId: recipient.vpnAccountId,
        reason: `Offboard campaign ${recipient.campaign.name}: linked AD user unverified by campaign deadline`,
        actor,
      });
      actionResults.push(vpnAction);
    }

    const allSucceeded = actionResults.every(result => result.success);
    const enforcedAt = new Date();
    await prisma.$transaction(async (tx: any) => {
      const requestMarkedOffboarded = allSucceeded
        ? await markAccessRequestOffboardedByCampaign(tx, recipient, actor, enforcedAt)
        : false;

      await tx.offboardCampaignRecipient.update({
        where: { id: recipientId },
        data: {
          status: allSucceeded ? 'enforced' : 'enforcement_failed',
          enforcedAt: allSucceeded ? enforcedAt : null,
          enforcementError: allSucceeded ? null : actionResults.filter(result => !result.success).map(result => result.error).join('; '),
          adLifecycleActionId: adAction.actionId,
          vpnLifecycleActionId: vpnAction?.actionId || null,
        },
      });

      await tx.offboardCampaign.update({
        where: { id: recipient.campaignId },
        data: allSucceeded
          ? { enforcedCount: { increment: 1 } }
          : { failedCount: { increment: 1 } },
      });

      await createCampaignLog(tx, {
        campaignId: recipient.campaignId,
        recipientId,
        level: allSucceeded ? 'info' : 'error',
        eventType: allSucceeded ? 'enforcement_completed' : 'enforcement_failure',
        actor,
        message: allSucceeded
          ? `Enforcement completed for ${recipient.adUsername}`
          : `Enforcement failed for ${recipient.adUsername}`,
        details: { actionResults, requestMarkedOffboarded },
      });
    });

    if (allSucceeded) {
      await prisma.session.deleteMany({ where: { username: recipient.adUsername } }).catch(() => {});
      return 'enforced';
    }

    return 'failed';
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown enforcement failure';
    await prisma.$transaction(async (tx: any) => {
      await tx.offboardCampaignRecipient.update({
        where: { id: recipientId },
        data: {
          status: 'enforcement_failed',
          enforcementError: message,
          lastError: message,
        },
      });
      await tx.offboardCampaign.update({
        where: { id: recipient.campaignId },
        data: { failedCount: { increment: 1 } },
      });
      await createCampaignLog(tx, {
        campaignId: recipient.campaignId,
        recipientId,
        level: 'error',
        eventType: 'enforcement_failure',
        actor,
        message: `Enforcement failed for ${recipient.adUsername}`,
        details: { error: message },
      });
    });
    return 'failed';
  }
}

async function createAndProcessCampaignLifecycleAction(params: {
  recipient: any;
  actionType: string;
  targetAccountType: string;
  targetUsername: string;
  targetUserId?: string | null;
  reason: string;
  actor: string;
}): Promise<LifecycleProcessSummary> {
  const action = await prisma.$transaction(async (tx: any) => {
    const created = await tx.accountLifecycleAction.create({
      data: {
        actionType: params.actionType,
        targetAccountType: params.targetAccountType,
        targetUsername: params.targetUsername,
        targetUserId: params.targetUserId || null,
        status: 'processing',
        reason: params.reason,
        requestedBy: 'offboard-campaign',
        requestedAt: new Date(),
        processedAt: new Date(),
        processedBy: 'system',
        relatedRequestId: params.recipient.accessRequestId || null,
        offboardCampaignId: params.recipient.campaignId,
        offboardRecipientId: params.recipient.id,
        rollbackData: JSON.stringify({
          originalAdEnabled: params.recipient.originalAdEnabled,
          originalAdStatus: params.recipient.originalAdStatus,
          originalVpnStatus: params.recipient.originalVpnStatus,
          originalVpnPortalType: params.recipient.originalVpnPortalType,
        }),
      },
    });

    await tx.accountLifecycleHistory.create({
      data: {
        actionId: created.id,
        event: 'created',
        performedBy: params.actor,
        newStatus: 'processing',
        details: JSON.stringify({
          offboardCampaignId: params.recipient.campaignId,
          offboardRecipientId: params.recipient.id,
        }),
      },
    });

    return created;
  });

  const result = await processLifecycleAction(action.id);
  return {
    actionId: action.id,
    success: result.success,
    error: result.error,
  };
}

async function recreateMissingVpnAccountForVerificationRecovery(recipient: any, actor: string): Promise<boolean> {
  if (!recipient.linkedVpnUsername) {
    return false;
  }

  const existing = await prisma.vPNAccount.findUnique({
    where: { username: recipient.linkedVpnUsername },
    select: { id: true },
  });

  if (existing) {
    return false;
  }

  const originalVpn = getOriginalVpnSnapshot(recipient);
  const accessRequest = recipient.accessRequestId
    ? await prisma.accessRequest.findUnique({ where: { id: recipient.accessRequestId } })
    : null;
  const password = originalVpn?.password || accessRequest?.accountPassword;

  if (!password) {
    throw new Error(`Cannot recreate missing VPN account ${recipient.linkedVpnUsername}: password snapshot is unavailable`);
  }

  await prisma.$transaction(async (tx: any) => {
    const vpnAccount = await tx.vPNAccount.create({
      data: {
        username: recipient.linkedVpnUsername,
        name: originalVpn?.name || accessRequest?.name || recipient.displayName || recipient.adUsername,
        email: originalVpn?.email || accessRequest?.email || recipient.email || null,
        portalType: originalVpn?.portalType || (accessRequest?.isInternal ? 'Limited' : 'External'),
        isInternal: originalVpn?.isInternal ?? accessRequest?.isInternal ?? true,
        status: 'revoked',
        password,
        expiresAt: snapshotDate(originalVpn?.expiresAt) || accessRequest?.accountExpiresAt || null,
        createdBy: originalVpn?.createdBy || actor,
        createdByFaculty: originalVpn?.createdByFaculty ?? false,
        facultyCreatedAt: snapshotDate(originalVpn?.facultyCreatedAt),
        disabledAt: snapshotDate(originalVpn?.disabledAt),
        disabledBy: originalVpn?.disabledBy || null,
        disabledReason: originalVpn?.disabledReason || null,
        revokedAt: snapshotDate(originalVpn?.revokedAt) || recipient.enforcedAt || new Date(),
        revokedBy: originalVpn?.revokedBy || 'offboard-campaign',
        revokedReason: originalVpn?.revokedReason || `Recreated from offboard campaign ${recipient.campaign.name} before verification recovery`,
        restoredAt: snapshotDate(originalVpn?.restoredAt),
        restoredBy: originalVpn?.restoredBy || null,
        canRestore: originalVpn?.canRestore ?? true,
        notes: originalVpn?.notes || null,
        batchId: originalVpn?.batchId || null,
        accessRequestId: originalVpn?.accessRequestId || recipient.accessRequestId || null,
        importId: originalVpn?.importId || null,
        adUsername: originalVpn?.adUsername || recipient.adUsername,
      },
    });

    await tx.vPNAccountStatusLog.create({
      data: {
        accountId: vpnAccount.id,
        oldStatus: null,
        newStatus: 'revoked',
        changedBy: 'offboard-campaign',
        reason: `Recreated missing VPN account from offboard campaign ${recipient.campaign.name} before verification recovery`,
      },
    });

    await createCampaignLog(tx, {
      campaignId: recipient.campaignId,
      recipientId: recipient.id,
      eventType: 'vpn_account_recreated_for_verification',
      actor,
      message: `Recreated missing VPN account ${recipient.linkedVpnUsername} before verification recovery`,
      details: { linkedVpnUsername: recipient.linkedVpnUsername },
    });
  });

  return true;
}

async function recoverVerifiedRecipientAccess(recipient: any, actor: string) {
  const results: LifecycleProcessSummary[] = [];
  const recoveryErrors: string[] = [];

  if (recipient.adLifecycleActionId && recipient.originalAdEnabled) {
    const result = await createAndProcessCampaignLifecycleAction({
      recipient,
      actionType: 'enable_ad',
      targetAccountType: 'AD',
      targetUsername: recipient.adUsername,
      targetUserId: recipient.accessRequestId,
      reason: `Verification recovery for offboard campaign ${recipient.campaign.name}`,
      actor,
    });
    results.push(result);
    await prisma.offboardCampaignRecipient.update({
      where: { id: recipient.id },
      data: { rollbackAdActionId: result.actionId },
    });
  }

  if (
    recipient.vpnLifecycleActionId &&
    recipient.linkedVpnUsername &&
    recipient.originalVpnStatus &&
    recipient.originalVpnStatus !== 'revoked'
  ) {
    try {
      await recreateMissingVpnAccountForVerificationRecovery(recipient, actor);
      const vpn = await prisma.vPNAccount.findUnique({
        where: { username: recipient.linkedVpnUsername },
        select: { status: true },
      });

      if (vpn?.status === 'revoked') {
        const result = await createAndProcessCampaignLifecycleAction({
          recipient,
          actionType: 'restore_vpn',
          targetAccountType: 'VPN',
          targetUsername: recipient.linkedVpnUsername,
          targetUserId: recipient.vpnAccountId,
          reason: `Verification recovery for offboard campaign ${recipient.campaign.name}`,
          actor,
        });
        results.push(result);
        await prisma.offboardCampaignRecipient.update({
          where: { id: recipient.id },
          data: { rollbackVpnActionId: result.actionId },
        });
      } else if (!vpn) {
        recoveryErrors.push(`VPN account ${recipient.linkedVpnUsername} is missing and could not be recreated`);
      }
    } catch (error) {
      recoveryErrors.push(error instanceof Error ? error.message : 'Failed to restore VPN access');
    }
  }

  const failedResults = results.filter(result => !result.success).map(result => result.error || 'Unknown recovery failure');
  const errors = [...recoveryErrors, ...failedResults].filter(Boolean);
  const allSucceeded = errors.length === 0;

  await prisma.$transaction(async (tx: any) => {
    const requestStatusRestored = allSucceeded
      ? await restoreAccessRequestAfterCampaignRollback(tx, recipient, actor)
      : false;

    await tx.offboardCampaignRecipient.update({
      where: { id: recipient.id },
      data: {
        rollbackStatus: allSucceeded ? 'restored_after_verification' : 'verification_recovery_failed',
        rollbackError: allSucceeded ? null : errors.join('; '),
      },
    });

    await createCampaignLog(tx, {
      campaignId: recipient.campaignId,
      recipientId: recipient.id,
      level: allSucceeded ? 'info' : 'error',
      eventType: allSucceeded ? 'verification_recovery_completed' : 'verification_recovery_failed',
      actor,
      message: allSucceeded
        ? `${recipient.adUsername} verified after enforcement; access recovery completed`
        : `${recipient.adUsername} verified after enforcement; access recovery failed`,
      details: { results, errors, requestStatusRestored },
    });
  });

  if (!allSucceeded) {
    throw new Error(`Continued access was verified, but recovery failed: ${errors.join('; ')}`);
  }
}

async function recalculateOffboardCampaignCurrentCounters(campaignId: string) {
  const [verifiedCount, enforcedCount, skippedRecipients, failedCount] = await Promise.all([
    prisma.offboardCampaignRecipient.count({ where: { campaignId, status: 'verified' } }),
    prisma.offboardCampaignRecipient.count({ where: { campaignId, status: 'enforced' } }),
    prisma.offboardCampaignRecipient.count({
      where: { campaignId, status: { in: ['skipped', 'enforcement_skipped'] } },
    }),
    prisma.offboardCampaignRecipient.count({
      where: { campaignId, status: { in: ['email_unknown', 'enforcement_failed', 'rollback_failed'] } },
    }),
  ]);

  await prisma.offboardCampaign.update({
    where: { id: campaignId },
    data: {
      verifiedCount,
      enforcedCount,
      skippedRecipients,
      failedCount,
    },
  });
}

async function previewRecipientReactivation(recipient: CampaignRecipientWithCampaign) {
  const actions: string[] = [];
  const conflicts: string[] = [];
  const originalRequest = getOriginalAccessRequestSnapshot(recipient);

  if (recipient.originalAdEnabled) {
    const userInfo = await searchLDAPUser(recipient.adUsername);
    if (!userInfo) {
      conflicts.push('AD account no longer exists in the configured LDAP scope');
    } else if (!isLdapAccountEnabledFromUac(getAttribute(userInfo.attributes, 'userAccountControl'))) {
      actions.push('enable_ad');
    }
  }

  if (
    recipient.linkedVpnUsername &&
    recipient.originalVpnStatus &&
    recipient.originalVpnStatus !== 'revoked'
  ) {
    const vpn = await prisma.vPNAccount.findUnique({
      where: { username: recipient.linkedVpnUsername },
      select: { status: true, canRestore: true },
    });
    if (!vpn) {
      const snapshot = getOriginalVpnSnapshot(recipient);
      if (snapshot?.password || originalRequest?.accountPassword) {
        actions.push('recreate_and_restore_vpn');
      } else {
        conflicts.push(`VPN account ${recipient.linkedVpnUsername} is missing and cannot be recreated`);
      }
    } else if (vpn.status === 'revoked' && vpn.canRestore) {
      actions.push('restore_vpn');
    } else if (vpn.status !== recipient.originalVpnStatus && vpn.status !== 'active') {
      conflicts.push(`VPN account is ${vpn.status} and cannot be restored automatically`);
    }
  }

  if (recipient.accessRequestId && originalRequest?.status) {
    const request = await prisma.accessRequest.findUnique({
      where: { id: recipient.accessRequestId },
      select: { status: true },
    });
    if (!request) {
      conflicts.push('Linked access request no longer exists');
    } else if (request.status === 'offboarded') {
      actions.push(`restore_request:${originalRequest.status}`);
    } else if (request.status !== originalRequest.status) {
      conflicts.push(`Access request changed from offboarded to ${request.status}`);
    }
  }

  return { actions, conflicts, reactivationReady: conflicts.length === 0 };
}

async function getExtensionRecipients(campaignId: string, recipientIds?: string[]) {
  if (recipientIds !== undefined && cleanList(recipientIds).length === 0) {
    return [];
  }

  const ids = cleanList(recipientIds);
  return prisma.offboardCampaignRecipient.findMany({
    where: {
      campaignId,
      ...(ids.length > 0 ? { id: { in: ids } } : {}),
    },
    include: { campaign: true },
    orderBy: { adUsername: 'asc' },
  });
}

export async function previewOffboardDeadlineExtension(
  campaignId: string,
  input: ExtendOffboardCampaignInput
) {
  const { newDeadline, reminderDates } = validateOffboardExtensionSchedule(
    input.newDeadline,
    input.reminderDates
  );
  const campaign = await prisma.offboardCampaign.findUnique({ where: { id: campaignId } });
  if (!campaign) {
    throw new Error('Campaign not found');
  }
  if (campaign.status !== 'active' || campaign.cancelledAt || campaign.emergencyStoppedAt) {
    throw new Error('Deadline extensions are only available for active campaigns');
  }

  const recipients = await getExtensionRecipients(campaignId, input.recipientIds);
  const items = [];

  for (const recipient of recipients) {
    const item = {
      recipientId: recipient.id,
      adUsername: recipient.adUsername,
      status: recipient.status,
      currentDeadline: recipient.deadlineAt,
      newDeadline,
      eligible: false,
      reactivationRequired: false,
      actions: [] as string[],
      conflicts: [] as string[],
      excludedReason: null as string | null,
    };

    if (recipient.verifiedAt || recipient.status === 'verified') {
      item.excludedReason = 'already_verified';
    } else if (['skipped', 'enforcement_skipped'].includes(recipient.status)) {
      item.excludedReason = 'skipped_recipient';
    } else if (recipient.deadlineAt && newDeadline <= recipient.deadlineAt) {
      item.excludedReason = 'new_deadline_must_be_later';
    } else if (recipient.status === 'sent') {
      item.eligible = true;
      item.actions = ['replace_deadline', 'issue_new_verification_link', 'send_extension_email'];
    } else if (recipient.status === 'enforced') {
      const reactivation = await previewRecipientReactivation(recipient);
      item.reactivationRequired = true;
      item.actions = [
        ...reactivation.actions,
        'replace_deadline',
        'issue_new_verification_link',
        'send_extension_email',
      ];
      item.conflicts = reactivation.conflicts;
      item.eligible = reactivation.reactivationReady;
      if (!item.eligible) item.excludedReason = 'reactivation_conflict';
    } else {
      item.excludedReason = `status_${recipient.status}_not_extendable`;
    }

    items.push(item);
  }

  return {
    campaignId,
    newDeadline,
    reminderDates,
    total: items.length,
    eligible: items.filter(item => item.eligible).length,
    sent: items.filter(item => item.eligible && !item.reactivationRequired).length,
    enforced: items.filter(item => item.eligible && item.reactivationRequired).length,
    excluded: items.filter(item => !item.eligible).length,
    items,
  };
}

async function restoreAccessRequestForExtension(
  tx: Prisma.TransactionClient,
  recipient: CampaignRecipientWithCampaign,
  actor: string
) {
  if (!recipient.accessRequestId) return true;
  const originalRequest = getOriginalAccessRequestSnapshot(recipient);
  if (!originalRequest?.status) return true;

  const current = await tx.accessRequest.findUnique({
    where: { id: recipient.accessRequestId },
    select: { status: true },
  });
  if (!current) return false;
  if (current.status === originalRequest.status) return true;
  if (current.status !== 'offboarded') return false;

  const restored = await restoreAccessRequestAfterCampaignRollback(tx, recipient, actor);
  if (restored) {
    await tx.requestComment.create({
      data: {
        requestId: recipient.accessRequestId,
        author: actor,
        type: 'offboard_campaign_extension',
        comment: `Access was restored so the offboard deadline could be extended for campaign "${recipient.campaign.name}".`,
      },
    });
  }
  return restored;
}

async function reactivateEnforcedRecipientForExtension(
  recipient: CampaignRecipientWithCampaign,
  actor: string
) {
  const preview = await previewRecipientReactivation(recipient);
  if (!preview.reactivationReady) {
    return {
      success: false,
      errors: preview.conflicts,
      adActionId: null as string | null,
      vpnActionId: null as string | null,
    };
  }

  const errors: string[] = [];
  let adActionId: string | null = null;
  let vpnActionId: string | null = null;

  if (preview.actions.includes('enable_ad')) {
    const result = await createAndProcessCampaignLifecycleAction({
      recipient,
      actionType: 'enable_ad',
      targetAccountType: 'AD',
      targetUsername: recipient.adUsername,
      targetUserId: recipient.accessRequestId,
      reason: `Deadline extension reactivation for offboard campaign ${recipient.campaign.name}`,
      actor,
    });
    adActionId = result.actionId;
    if (!result.success) errors.push(result.error || 'Failed to enable AD account');
  }

  if (errors.length === 0 && preview.actions.includes('recreate_and_restore_vpn')) {
    try {
      await recreateMissingVpnAccountForVerificationRecovery(recipient, actor);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'Failed to recreate VPN account');
    }
  }

  if (
    errors.length === 0 &&
    recipient.linkedVpnUsername &&
    (preview.actions.includes('restore_vpn') || preview.actions.includes('recreate_and_restore_vpn'))
  ) {
    const result = await createAndProcessCampaignLifecycleAction({
      recipient,
      actionType: 'restore_vpn',
      targetAccountType: 'VPN',
      targetUsername: recipient.linkedVpnUsername,
      targetUserId: recipient.vpnAccountId,
      reason: `Deadline extension reactivation for offboard campaign ${recipient.campaign.name}`,
      actor,
    });
    vpnActionId = result.actionId;
    if (!result.success) errors.push(result.error || 'Failed to restore VPN account');
  }

  if (errors.length === 0) {
    const requestRestored = await prisma.$transaction(async (tx: Prisma.TransactionClient) =>
      restoreAccessRequestForExtension(tx, recipient, actor)
    );
    if (!requestRestored) {
      errors.push('Linked access request could not be restored');
    }
  }

  return {
    success: errors.length === 0,
    errors,
    adActionId,
    vpnActionId,
  };
}

async function createRecipientExtension(
  recipient: CampaignRecipientWithCampaign,
  params: {
    newDeadline: Date;
    reminderDates: Date[];
    note?: string;
    actor: string;
    reactivationAdActionId?: string | null;
    reactivationVpnActionId?: string | null;
  }
) {
  const token = generateToken();
  const tokenHash = hashOffboardToken(token);
  const extension = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const claimed = await tx.offboardCampaignRecipient.updateMany({
      where: {
        id: recipient.id,
        campaignId: recipient.campaignId,
        status: recipient.status,
        verifiedAt: null,
        deadlineAt: recipient.deadlineAt,
        tokenHash: recipient.tokenHash,
      },
      data: {
        status: 'sent',
        deadlineAt: params.newDeadline,
        tokenHash,
        enforcedAt: null,
        enforcementClaimedAt: null,
        enforcementSkippedAt: null,
        enforcementError: null,
        adLifecycleActionId: null,
        vpnLifecycleActionId: null,
        rollbackStatus: recipient.status === 'enforced' ? 'reactivated_for_extension' : recipient.rollbackStatus,
        rollbackError: null,
        lastError: null,
      },
    });
    if (claimed.count !== 1) {
      throw new Error(`${recipient.adUsername} changed after preview and was not extended`);
    }

    await tx.offboardCampaignExtension.updateMany({
      where: {
        recipientId: recipient.id,
        status: { in: ['active', 'notification_failed', 'pending_notification'] },
      },
      data: { status: 'superseded' },
    });

    await tx.offboardCampaignRecipientToken.updateMany({
      where: { recipientId: recipient.id, usedAt: null },
      data: { expiresAt: new Date() },
    });
    await tx.offboardCampaignRecipientToken.create({
      data: {
        recipientId: recipient.id,
        tokenHash,
        purpose: 'deadline_extension',
        expiresAt: params.newDeadline,
      },
    });

    const created = await tx.offboardCampaignExtension.create({
      data: {
        campaignId: recipient.campaignId,
        recipientId: recipient.id,
        createdBy: params.actor,
        note: params.note?.trim() || null,
        previousDeadlineAt: recipient.deadlineAt,
        newDeadlineAt: params.newDeadline,
        previousStatus: recipient.status,
        reactivationRequired: recipient.status === 'enforced',
        reactivationAdActionId: params.reactivationAdActionId || null,
        reactivationVpnActionId: params.reactivationVpnActionId || null,
        reminders: {
          create: params.reminderDates.map(scheduledFor => ({ scheduledFor })),
        },
      },
      include: { reminders: true },
    });

    await createCampaignLog(tx, {
      campaignId: recipient.campaignId,
      recipientId: recipient.id,
      eventType: recipient.status === 'enforced'
        ? 'recipient_reactivated_for_extension'
        : 'recipient_deadline_extended',
      actor: params.actor,
      message: `${recipient.adUsername} deadline extended to ${params.newDeadline.toISOString()}`,
      details: {
        extensionId: created.id,
        previousDeadlineAt: recipient.deadlineAt,
        newDeadlineAt: params.newDeadline,
        reminderDates: params.reminderDates,
        previousStatus: recipient.status,
      },
    });

    return created;
  });

  try {
    const info = await sendOffboardExtensionEmail({
      email: recipient.email,
      name: recipient.displayName || recipient.adUsername,
      adUsername: recipient.adUsername,
      vpnUsername: recipient.linkedVpnUsername,
      verificationToken: token,
      deadline: params.newDeadline,
      previousDeadline: recipient.deadlineAt,
      note: params.note,
    });
    await prisma.offboardCampaignExtension.update({
      where: { id: extension.id },
      data: {
        status: 'active',
        notificationSentAt: new Date(),
        notificationMessageId: info.messageId || null,
        notificationError: null,
      },
    });
    return { extensionId: extension.id, success: true, notificationSent: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to send extension notification';
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.offboardCampaignExtension.update({
        where: { id: extension.id },
        data: { status: 'notification_failed', notificationError: message },
      });
      await tx.offboardCampaignRecipient.update({
        where: { id: recipient.id },
        data: { lastError: `Extension notification failed: ${message}` },
      });
      await createCampaignLog(tx, {
        campaignId: recipient.campaignId,
        recipientId: recipient.id,
        level: 'error',
        eventType: 'extension_notification_failure',
        actor: params.actor,
        message: `Deadline was extended for ${recipient.adUsername}, but the notification failed`,
        details: { extensionId: extension.id, error: message },
      });
    });
    return {
      extensionId: extension.id,
      success: true,
      notificationSent: false,
      error: message,
    };
  }
}

export async function extendOffboardCampaignDeadline(
  campaignId: string,
  input: ExtendOffboardCampaignInput,
  actor: string
) {
  const preview = await previewOffboardDeadlineExtension(campaignId, input);
  const recipients = await getExtensionRecipients(
    campaignId,
    preview.items.filter(item => item.eligible).map(item => item.recipientId)
  );
  const results = [];

  for (const recipient of recipients) {
    let reactivationAdActionId: string | null = null;
    let reactivationVpnActionId: string | null = null;

    if (recipient.status === 'enforced') {
      const reactivation = await reactivateEnforcedRecipientForExtension(recipient, actor);
      reactivationAdActionId = reactivation.adActionId;
      reactivationVpnActionId = reactivation.vpnActionId;
      if (!reactivation.success) {
        const extension = await prisma.offboardCampaignExtension.create({
          data: {
            campaignId,
            recipientId: recipient.id,
            createdBy: actor,
            note: input.note?.trim() || null,
            previousDeadlineAt: recipient.deadlineAt,
            newDeadlineAt: preview.newDeadline,
            previousStatus: recipient.status,
            status: 'reactivation_failed',
            reactivationRequired: true,
            reactivationAdActionId,
            reactivationVpnActionId,
            notificationError: reactivation.errors.join('; '),
          },
        });
        await createCampaignLog(prisma, {
          campaignId,
          recipientId: recipient.id,
          level: 'error',
          eventType: 'extension_reactivation_failure',
          actor,
          message: `Could not reactivate ${recipient.adUsername} for a deadline extension`,
          details: { extensionId: extension.id, errors: reactivation.errors },
        });
        results.push({
          recipientId: recipient.id,
          adUsername: recipient.adUsername,
          success: false,
          errors: reactivation.errors,
        });
        continue;
      }
    }

    try {
      const result = await createRecipientExtension(recipient, {
        newDeadline: preview.newDeadline,
        reminderDates: preview.reminderDates,
        note: input.note,
        actor,
        reactivationAdActionId,
        reactivationVpnActionId,
      });
      results.push({
        recipientId: recipient.id,
        adUsername: recipient.adUsername,
        ...result,
      });
    } catch (error) {
      results.push({
        recipientId: recipient.id,
        adUsername: recipient.adUsername,
        success: false,
        errors: [error instanceof Error ? error.message : 'Deadline extension failed'],
      });
    }
  }

  await recalculateOffboardCampaignCurrentCounters(campaignId);
  return {
    preview,
    results,
    campaign: await getOffboardCampaign(campaignId),
  };
}

export async function retryOffboardExtensionNotification(
  campaignId: string,
  extensionId: string,
  actor: string
) {
  const extension = await prisma.offboardCampaignExtension.findUnique({
    where: { id: extensionId },
    include: {
      campaign: true,
      recipient: true,
    },
  });
  if (!extension) throw new Error('Extension not found');
  if (extension.campaignId !== campaignId) {
    throw new Error('Extension does not belong to this campaign');
  }
  if (extension.campaign.status !== 'active') {
    throw new Error('Extension notifications can only be retried for active campaigns');
  }
  if (extension.status !== 'notification_failed') {
    throw new Error('Only failed extension notifications can be retried');
  }
  if (extension.recipient.status !== 'sent' || extension.recipient.verifiedAt) {
    throw new Error('This recipient no longer needs an extension notification');
  }
  if (
    !extension.recipient.deadlineAt ||
    extension.recipient.deadlineAt.getTime() !== extension.newDeadlineAt.getTime()
  ) {
    throw new Error('This extension has been superseded by a newer deadline');
  }
  if (extension.newDeadlineAt <= new Date()) {
    throw new Error('The extended deadline has already passed');
  }

  const token = generateToken();
  const tokenHash = hashOffboardToken(token);
  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const claimed = await tx.offboardCampaignRecipient.updateMany({
      where: {
        id: extension.recipientId,
        status: 'sent',
        verifiedAt: null,
        deadlineAt: extension.newDeadlineAt,
      },
      data: { tokenHash },
    });
    if (claimed.count !== 1) {
      throw new Error('This extension changed before the notification retry could start');
    }

    await tx.offboardCampaignRecipientToken.updateMany({
      where: { recipientId: extension.recipientId, usedAt: null },
      data: { expiresAt: new Date() },
    });
    await tx.offboardCampaignRecipientToken.create({
      data: {
        recipientId: extension.recipientId,
        tokenHash,
        purpose: `extension_retry:${extension.id}`,
        expiresAt: extension.newDeadlineAt,
      },
    });
  });

  try {
    const info = await sendOffboardExtensionEmail({
      email: extension.recipient.email,
      name: extension.recipient.displayName || extension.recipient.adUsername,
      adUsername: extension.recipient.adUsername,
      vpnUsername: extension.recipient.linkedVpnUsername,
      verificationToken: token,
      deadline: extension.newDeadlineAt,
      previousDeadline: extension.previousDeadlineAt,
      note: extension.note,
    });
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.offboardCampaignExtension.update({
        where: { id: extension.id },
        data: {
          status: 'active',
          notificationSentAt: new Date(),
          notificationMessageId: info.messageId || null,
          notificationError: null,
        },
      });
      await tx.offboardCampaignRecipient.update({
        where: { id: extension.recipientId },
        data: { lastError: null },
      });
      await createCampaignLog(tx, {
        campaignId: extension.campaignId,
        recipientId: extension.recipientId,
        eventType: 'extension_notification_retried',
        actor,
        message: `Extension notification resent to ${extension.recipient.email}`,
        details: { extensionId: extension.id },
      });
    });
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Extension notification retry failed';
    await prisma.offboardCampaignExtension.update({
      where: { id: extension.id },
      data: { status: 'notification_failed', notificationError: message },
    });
    throw new Error(message);
  }
}

export async function getOffboardRecipientVerificationContext(token: string) {
  const tokenHash = hashOffboardToken(token);
  const tokenRecord = await prisma.offboardCampaignRecipientToken.findUnique({
    where: { tokenHash },
    include: {
      recipient: {
        include: { campaign: true },
      },
    },
  });
  const now = new Date();
  if (tokenRecord?.expiresAt && tokenRecord.expiresAt <= now) {
    throw new Error('Invalid or expired verification link');
  }
  const recipient = tokenRecord?.recipient || await prisma.offboardCampaignRecipient.findUnique({
    where: { tokenHash },
    include: { campaign: true },
  });

  if (!recipient) {
    throw new Error('Invalid or expired verification link');
  }

  const context = {
    recipientId: recipient.id,
    campaignId: recipient.campaignId,
    adUsername: recipient.adUsername,
    adDn: recipient.adDn,
    email: recipient.email,
    displayName: recipient.displayName,
    alreadyVerified: Boolean(recipient.verifiedAt),
  };

  if (recipient.verifiedAt) {
    return context;
  }

  if (!recipient.deadlineAt || recipient.deadlineAt <= now) {
    throw new Error('This verification link has expired');
  }

  return context;
}

export async function verifyOffboardRecipientToken(token: string, ipAddress?: string, userAgent?: string) {
  const tokenHash = hashOffboardToken(token);
  const tokenRecord = await prisma.offboardCampaignRecipientToken.findUnique({
    where: { tokenHash },
    include: {
      recipient: {
        include: { campaign: true },
      },
    },
  });
  const now = new Date();
  if (tokenRecord?.expiresAt && tokenRecord.expiresAt <= now) {
    throw new Error('Invalid or expired verification link');
  }
  const recipient = tokenRecord?.recipient || await prisma.offboardCampaignRecipient.findUnique({
    where: { tokenHash },
    include: { campaign: true },
  });

  if (!recipient) {
    throw new Error('Invalid or expired verification link');
  }

  if (recipient.verifiedAt) {
    return { recipientId: recipient.id, campaignId: recipient.campaignId, alreadyVerified: true };
  }

  if (!recipient.deadlineAt || recipient.deadlineAt <= now) {
    throw new Error('This verification link has expired');
  }

  const shouldRecoverAccess = Boolean(
    recipient.status === 'enforced' ||
    recipient.enforcedAt ||
    recipient.adLifecycleActionId ||
    recipient.vpnLifecycleActionId
  );

  const updated = await prisma.$transaction(async (tx: any) => {
    const result = await tx.offboardCampaignRecipient.updateMany({
      where: {
        id: recipient.id,
        status: { in: ['sent', 'enforced', 'enforcement_failed'] },
        verifiedAt: null,
        deadlineAt: { gt: now },
      },
      data: {
        status: 'verified',
        verifiedAt: now,
        verifiedIpAddress: ipAddress || null,
        verifiedUserAgent: userAgent || null,
      },
    });

    if (result.count !== 1) {
      return false;
    }

    await tx.offboardCampaign.update({
      where: { id: recipient.campaignId },
      data: { verifiedCount: { increment: 1 } },
    });

    if (tokenRecord) {
      await tx.offboardCampaignRecipientToken.update({
        where: { id: tokenRecord.id },
        data: { usedAt: now },
      });
    }

    await tx.offboardCampaignExtension.updateMany({
      where: {
        recipientId: recipient.id,
        status: { in: ['active', 'notification_failed', 'pending_notification'] },
      },
      data: { status: 'completed' },
    });

    await createCampaignLog(tx, {
      campaignId: recipient.campaignId,
      recipientId: recipient.id,
      eventType: 'recipient_verified',
      actor: recipient.adUsername,
      message: `${recipient.adUsername} verified continued access`,
      details: { ipAddress, userAgent },
    });

    return true;
  });

  if (!updated) {
    throw new Error('This account can no longer be verified because enforcement has started or completed');
  }

  if (shouldRecoverAccess) {
    await recoverVerifiedRecipientAccess(recipient, recipient.adUsername);
  }

  return { recipientId: recipient.id, campaignId: recipient.campaignId };
}

async function completeCampaignIfFinished(campaignId: string) {
  const campaign = await prisma.offboardCampaign.findUnique({ where: { id: campaignId } });
  if (!campaign || campaign.status !== 'active') {
    return;
  }

  const remaining = await prisma.offboardCampaignRecipient.count({
    where: {
      campaignId,
      status: {
        in: ['dry_run_ready', 'pending_send', 'email_sending', 'sent', 'enforcement_processing'],
      },
    },
  });

  if (remaining === 0) {
    await prisma.$transaction(async (tx: any) => {
      await tx.offboardCampaign.update({
        where: { id: campaignId },
        data: {
          status: 'completed',
          completedAt: new Date(),
          activeLockKey: null,
          sendingPaused: true,
          remindersPaused: true,
          enforcementPaused: true,
        },
      });
      await createCampaignLog(tx, {
        campaignId,
        eventType: 'campaign_completed',
        actor: 'system',
        message: 'Campaign completed because all recipients reached a terminal state',
      });
    });
  }
}

export async function previewOffboardRollback(campaignId: string) {
  const recipients = await prisma.offboardCampaignRecipient.findMany({
    where: {
      campaignId,
      OR: [
        { status: 'enforced' },
        { adLifecycleActionId: { not: null } },
        { vpnLifecycleActionId: { not: null } },
      ],
    },
    orderBy: { adUsername: 'asc' },
  });

  const items = [];
  for (const recipient of recipients) {
    const actions: string[] = [];
    const conflicts: string[] = [];
    const originalRequest = getOriginalAccessRequestSnapshot(recipient);

    if (recipient.adLifecycleActionId && recipient.originalAdEnabled) {
      const request = recipient.accessRequestId
        ? await prisma.accessRequest.findUnique({
            where: { id: recipient.accessRequestId },
            select: { adAccountStatus: true, status: true },
          })
        : await prisma.accessRequest.findFirst({
            where: {
              OR: [
                { ldapUsername: recipient.adUsername },
                { linkedAdUsername: recipient.adUsername },
              ],
            },
            select: { adAccountStatus: true, status: true },
          });
      if (request?.adAccountStatus === 'disabled') {
        actions.push('enable_ad');
      } else {
        conflicts.push('AD account is not disabled in the portal database');
      }
      if (originalRequest?.status === 'approved' && request?.status !== 'offboarded') {
        conflicts.push('Access request status changed after campaign enforcement');
      }
    }

    if (recipient.vpnLifecycleActionId && recipient.linkedVpnUsername && recipient.originalVpnStatus && recipient.originalVpnStatus !== 'revoked') {
      const vpn = await prisma.vPNAccount.findUnique({
        where: { username: recipient.linkedVpnUsername },
        select: { status: true },
      });
      if (vpn?.status === 'revoked') {
        actions.push('restore_vpn');
      } else {
        conflicts.push('VPN account is not revoked in the portal database');
      }
    }

    items.push({
      recipientId: recipient.id,
      adUsername: recipient.adUsername,
      linkedVpnUsername: recipient.linkedVpnUsername,
      actions,
      conflicts,
      rollbackable: actions.length > 0 && conflicts.length === 0,
    });
  }

  return {
    campaignId,
    total: items.length,
    rollbackable: items.filter(item => item.rollbackable).length,
    conflicts: items.filter(item => item.conflicts.length > 0).length,
    items,
  };
}

export async function executeOffboardRollback(campaignId: string, actor: string) {
  const campaign = await prisma.offboardCampaign.findUnique({ where: { id: campaignId } });
  if (!campaign) {
    throw new Error('Campaign not found');
  }

  const preview = await previewOffboardRollback(campaignId);

  await prisma.$transaction(async (tx: any) => {
    await tx.offboardCampaign.update({
      where: { id: campaignId },
      data: {
        rollbackState: 'processing',
        rollbackStartedAt: new Date(),
        rollbackStartedBy: actor,
      },
    });
    await createCampaignLog(tx, {
      campaignId,
      eventType: 'rollback_started',
      actor,
      message: `Rollback started for ${preview.rollbackable} recipients`,
      details: preview,
    });
  });

  let successCount = 0;
  let failureCount = 0;

  for (const item of preview.items) {
    const recipient = await prisma.offboardCampaignRecipient.findUnique({
      where: { id: item.recipientId },
      include: { campaign: true },
    });
    if (!recipient) continue;

    if (!item.rollbackable) {
      failureCount += 1;
      await prisma.offboardCampaignRecipient.update({
        where: { id: recipient.id },
        data: {
          rollbackStatus: 'rollback_conflict',
          rollbackError: item.conflicts.join('; ') || 'No rollback action available',
        },
      });
      continue;
    }

    try {
      const results: LifecycleProcessSummary[] = [];
      if (item.actions.includes('enable_ad')) {
        const result = await createAndProcessCampaignLifecycleAction({
          recipient,
          actionType: 'enable_ad',
          targetAccountType: 'AD',
          targetUsername: recipient.adUsername,
          targetUserId: recipient.accessRequestId,
          reason: `Rollback for offboard campaign ${campaign.name}`,
          actor,
        });
        results.push(result);
        await prisma.offboardCampaignRecipient.update({
          where: { id: recipient.id },
          data: { rollbackAdActionId: result.actionId },
        });
      }

      if (item.actions.includes('restore_vpn') && recipient.linkedVpnUsername) {
        const result = await createAndProcessCampaignLifecycleAction({
          recipient,
          actionType: 'restore_vpn',
          targetAccountType: 'VPN',
          targetUsername: recipient.linkedVpnUsername,
          targetUserId: recipient.vpnAccountId,
          reason: `Rollback for offboard campaign ${campaign.name}`,
          actor,
        });
        results.push(result);
        await prisma.offboardCampaignRecipient.update({
          where: { id: recipient.id },
          data: { rollbackVpnActionId: result.actionId },
        });
      }

      const allSucceeded = results.every(result => result.success);
      if (allSucceeded) {
        successCount += 1;
      } else {
        failureCount += 1;
      }

      await prisma.$transaction(async (tx: any) => {
        const requestStatusRestored = allSucceeded
          ? await restoreAccessRequestAfterCampaignRollback(tx, recipient, actor)
          : false;

        await tx.offboardCampaignRecipient.update({
          where: { id: recipient.id },
          data: {
            status: allSucceeded ? 'rolled_back' : 'rollback_failed',
            rollbackStatus: allSucceeded ? 'rolled_back' : 'rollback_failed',
            rollbackError: allSucceeded ? null : results.filter(result => !result.success).map(result => result.error).join('; '),
          },
        });
        await createCampaignLog(tx, {
          campaignId,
          recipientId: recipient.id,
          level: allSucceeded ? 'info' : 'error',
          eventType: allSucceeded ? 'rollback_success' : 'rollback_failure',
          actor,
          message: allSucceeded
            ? `Rollback completed for ${recipient.adUsername}`
            : `Rollback failed for ${recipient.adUsername}`,
          details: { results, requestStatusRestored },
        });
      });
    } catch (error) {
      failureCount += 1;
      const message = error instanceof Error ? error.message : 'Unknown rollback failure';
      await prisma.$transaction(async (tx: any) => {
        await tx.offboardCampaignRecipient.update({
          where: { id: recipient.id },
          data: {
            status: 'rollback_failed',
            rollbackStatus: 'rollback_failed',
            rollbackError: message,
          },
        });
        await createCampaignLog(tx, {
          campaignId,
          recipientId: recipient.id,
          level: 'error',
          eventType: 'rollback_failure',
          actor,
          message: `Rollback failed for ${recipient.adUsername}`,
          details: { error: message },
        });
      });
    }
  }

  await prisma.$transaction(async (tx: any) => {
    await tx.offboardCampaign.update({
      where: { id: campaignId },
      data: {
        rollbackState: failureCount === 0 ? 'completed' : 'failed',
        rollbackCompletedAt: new Date(),
        rollbackSuccessCount: successCount,
        rollbackFailureCount: failureCount,
      },
    });
    await createCampaignLog(tx, {
      campaignId,
      level: failureCount === 0 ? 'info' : 'error',
      eventType: failureCount === 0 ? 'rollback_completed' : 'rollback_completed_with_failures',
      actor,
      message: `Rollback finished: ${successCount} succeeded, ${failureCount} failed`,
      details: { successCount, failureCount },
    });
  });

  return await getOffboardCampaign(campaignId);
}
