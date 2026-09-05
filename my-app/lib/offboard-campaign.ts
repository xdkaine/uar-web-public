import crypto from 'crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { listUsersInOU, searchLDAPUser } from '@/lib/ldap';
import {
  isMemberOfAdminGroup as matchesConfiguredAdminGroup,
  parseAdminGroupDns,
} from '@/lib/ldap/admin-groups';
import {
  sendOffboardExtensionEmail,
  sendOffboardExtensionReminderEmail,
  sendOffboardDirectCompletedEmail,
  sendOffboardInitialEmail,
  sendOffboardReminderEmail,
} from '@/lib/email';
import { processLifecycleAction } from '@/lib/lifecycle-processor';
import { LIFECYCLE_READY_NON_NULL_PROVISIONING_STATES } from '@/lib/access-request-lifecycle-readiness';
import { revokeUserSessionsEverywhere } from '@/lib/auth/provider-logout-audit';
import { isModuleEnabled, isModuleEnabledStrict } from '@/lib/modules/core';
import { appLogger } from '@/lib/logger';
import { getConfigValue } from '@/lib/config/resolver';
import { AuditActions, AuditCategories, sanitizeAuditDetails } from '@/lib/audit-log';
import {
  isOffboardExtensionReminderScheduleValid,
  validateOffboardExtensionSchedule,
} from '@/lib/offboard-extension-schedule';

export { validateOffboardExtensionSchedule } from '@/lib/offboard-extension-schedule';

const ACTIVE_LOCK_KEY = 'global';
const DAY_MS = 24 * 60 * 60 * 1000;
const OPERATION_PREVIEW_TTL_MS = 15 * 60 * 1000;
const OPERATION_CLAIM_MS = 30 * 60 * 1000;
const ACTIVE_EXTENSION_STATUSES = ['active', 'notification_failed', 'pending_notification'];
const EMAIL_CLAIM_STALE_MS = 30 * 60 * 1000;
const ENFORCEMENT_CLAIM_MS = 30 * 60 * 1000;
const FINAL_NOTICE_CLAIM_MS = 30 * 60 * 1000;
const REUSABLE_REQUEST_STATUSES = ['rejected', 'offboarded'];
const DIRECT_OFFBOARD_POLICY_VERSION = 'direct-offboard-v1';
const VPN_IDENTITY_OFFBOARD_FENCE_LOCK_NAMESPACE = 904772;
const DIRECTORY_EXECUTION_LOCK_NAMESPACE = 873211;

type CampaignLogLevel = 'info' | 'warn' | 'error';

export class OffboardOperationError extends Error {
  constructor(
    message: string,
    public readonly code: 'PREVIEW_EXPIRED' | 'PREVIEW_STALE' | 'PREVIEW_CONFLICT' | 'PREVIEW_INVALID' | 'OPERATION_IN_PROGRESS' | 'RECONCILIATION_REQUIRED'
  ) {
    super(message);
  }
}

type OperationKind = 'activation' | 'rollback';

interface OperationPreviewItem {
  recipientId: string;
  adUsername: string;
  linkedVpnUsername: string | null;
  actions: string[];
  conflicts: string[];
  expectedState: Record<string, unknown>;
  executable: boolean;
}

function canonicalOperationDigest(kind: OperationKind, campaignId: string, items: OperationPreviewItem[]) {
  return crypto.createHash('sha256').update(JSON.stringify({
    kind,
    campaignId,
    items: items.map(item => ({
      recipientId: item.recipientId,
      actions: [...item.actions].sort(),
      conflicts: [...item.conflicts].sort(),
      expectedState: item.expectedState,
    })),
  })).digest('hex');
}

function jsonArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function operationJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

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

interface OriginalAccessRequestSnapshot {
  id?: string;
  status?: string;
  version?: number;
  accountExpiresAt?: string | null;
  accountPassword?: string | null;
}

interface OriginalVpnSnapshot {
  id?: string;
  username?: string;
  name?: string | null;
  email?: string | null;
  status?: string;
  portalType?: string;
  isInternal?: boolean;
  password?: string | null;
  expiresAt?: string | null;
  createdBy?: string | null;
  createdByFaculty?: boolean;
  facultyCreatedAt?: string | null;
  disabledAt?: string | null;
  disabledBy?: string | null;
  disabledReason?: string | null;
  revokedAt?: string | null;
  revokedBy?: string | null;
  revokedReason?: string | null;
  restoredAt?: string | null;
  restoredBy?: string | null;
  canRestore?: boolean;
  notes?: string | null;
  batchId?: string | null;
  accessRequestId?: string | null;
  importId?: string | null;
  adUsername?: string | null;
}

interface OriginalSnapshot {
  ldap?: unknown;
  vpn?: OriginalVpnSnapshot | null;
  accessRequest?: OriginalAccessRequestSnapshot | null;
  lastVerification?: unknown;
}

interface VpnAccountLookupEntry {
  id: string;
  username: string;
  status: string;
  portalType: string | null;
  adUsername: string | null;
}

interface AccessRequestSummaryRow {
  id: string;
  status: string;
  version: number;
  accountExpiresAt: Date | null;
  name: string;
  email: string;
  ldapUsername: string | null;
  linkedAdUsername: string | null;
  adAccountStatus: string | null;
  vpnAccountStatus: string | null;
}

interface DryRunInput {
  name?: string;
  workflowMode?: 'verification' | 'direct';
  directOffboardReason?: string;
  directOffboardReference?: string;
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
type OffboardCampaignRecipientRow = Prisma.OffboardCampaignRecipientGetPayload<Record<never, never>>;

interface ProcessOptions {
  campaignId?: string;
  actor?: string;
  limit?: number;
  scheduledWindow?: {
    startExclusive: Date;
    endInclusive: Date;
  };
  processInitialEmails?: boolean;
  allowDirect?: boolean;
}

export interface ProcessAllOffboardInput {
  initialEmails?: boolean;
  reminders?: boolean;
  enforcement?: boolean;
  directOffboarding?: boolean;
  overrideSendingPause?: boolean;
  overrideRemindersPause?: boolean;
  overrideEnforcementPause?: boolean;
  overrideExecutionPause?: boolean;
  previewDigest?: string;
  previewedAt?: string;
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

function getOriginalSnapshot(recipient: { originalSnapshot?: unknown }): OriginalSnapshot | null {
  if (!recipient.originalSnapshot) {
    return null;
  }

  try {
    const snapshot = typeof recipient.originalSnapshot === 'string'
      ? JSON.parse(recipient.originalSnapshot)
      : recipient.originalSnapshot;
    return snapshot as OriginalSnapshot;
  } catch {
    return null;
  }
}

function getOriginalAccessRequestSnapshot(recipient: { originalSnapshot?: unknown }): OriginalAccessRequestSnapshot | null {
  return getOriginalSnapshot(recipient)?.accessRequest || null;
}

function getOriginalVpnSnapshot(recipient: { originalSnapshot?: unknown }): OriginalVpnSnapshot | null {
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

async function adminGroupConfiguration(): Promise<string> {
  const configuredGroups = await getConfigValue<string[]>('ldap.adminGroups');
  if (!Array.isArray(configuredGroups) || configuredGroups.length === 0) {
    throw new Error('LDAP_ADMIN_GROUPS requires at least one complete administrator-group DN to protect administrators from offboarding');
  }

  return JSON.stringify(configuredGroups);
}

async function validateAdminGroupConfiguration(): Promise<string> {
  const configuration = await adminGroupConfiguration();
  parseAdminGroupDns(configuration);
  return configuration;
}

function isAdminGroupMember(memberOf: string[], configuration: string): boolean {
  return matchesConfiguredAdminGroup(memberOf, configuration);
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
  excludedEmails: Set<string>,
  adminGroups: string,
): string | null {
  const username = normalize(user.username);
  const email = normalize(user.email);

  if (!username) return 'missing_ad_username';
  if (excludedUsernames.has(username)) return 'manually_excluded_username';
  if (email && excludedEmails.has(email)) return 'manually_excluded_email';
  if (!user.accountEnabled) return 'disabled_ad_account';
  if (!isUsableEmail(user.email)) return 'missing_usable_email';
  if (isAdminGroupMember(user.memberOf || [], adminGroups)) return 'admin_group_member';
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

function buildVpnLookup<T extends VpnAccountLookupEntry>(vpnAccounts: T[]): Map<string, T> {
  const byAdUsername = new Map<string, T>();

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

function ambiguousLiveVpnLinks<T extends VpnAccountLookupEntry>(vpnAccounts: T[]): Set<string> {
  const liveCounts = new Map<string, number>();
  for (const vpn of vpnAccounts) {
    if (vpn.status === 'revoked' || vpn.status === 'disabled') continue;
    const key = normalize(vpn.adUsername) || normalize(vpn.username);
    if (!key) continue;
    liveCounts.set(key, (liveCounts.get(key) || 0) + 1);
  }
  return new Set([...liveCounts.entries()].filter(([, count]) => count > 1).map(([key]) => key));
}

function projectedActionFor(user: LdapUserSnapshot, vpn: VpnAccountLookupEntry | null): string {
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
  tx: Prisma.TransactionClient,
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
      details: (params.details || undefined) as Prisma.InputJsonValue | undefined,
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

async function findAccessRequestsByUsername(usernames: string[]): Promise<Map<string, AccessRequestSummaryRow>> {
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
      version: true,
      accountExpiresAt: true,
      name: true,
      email: true,
      ldapUsername: true,
      linkedAdUsername: true,
      adAccountStatus: true,
      vpnAccountStatus: true,
    },
  });

  const map = new Map<string, AccessRequestSummaryRow>();
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
  tx: Prisma.TransactionClient,
  recipient: CampaignRecipientWithCampaign,
  actor: string,
  enforcedAt: Date,
  options: { confirmedAdDisabled?: boolean } = {}
): Promise<boolean> {
  if (!recipient.accessRequestId) {
    return false;
  }

  let disabledConfirmation: {
    observedAt: Date;
    directoryDn: string;
    objectGuid: string;
    username: string;
    userAccountControl: string;
  } | null = null;
  let projectConfirmedDisabled = false;

  if (recipient.campaign.workflowMode === 'direct' && options.confirmedAdDisabled) {
    const canonicalUsername = normalize(recipient.adUsername);
    await tx.$queryRaw<Array<{ lock_acquired: string }>>`
      SELECT 'locked'::text AS lock_acquired
      FROM pg_advisory_xact_lock(hashtextextended(${canonicalUsername}, ${DIRECTORY_EXECUTION_LOCK_NAMESPACE}))
    `;

    const userInfo = await searchLDAPUser(recipient.adUsername);
    const liveUsername = userInfo ? getAttribute(userInfo.attributes, 'sAMAccountName') : null;
    const liveObjectGuid = userInfo ? getAttribute(userInfo.attributes, 'objectGUID') : null;
    const rawUac = userInfo ? getAttribute(userInfo.attributes, 'userAccountControl') : null;
    if (
      !userInfo
      || normalize(liveUsername) !== canonicalUsername
      || userInfo.objectName !== recipient.adDn
      || !recipient.targetDirectoryObjectGuid
      || liveObjectGuid !== recipient.targetDirectoryObjectGuid
      || !rawUac
      || !/^\d+$/.test(rawUac)
      || !Number.isSafeInteger(Number(rawUac))
      || isLdapAccountEnabledFromUac(rawUac)
    ) {
      throw new Error('The exact reviewed AD account is not confirmed disabled under the directory execution lock; reconciliation is required');
    }
    if (isAdminGroupMember(
      getAttributeValues(userInfo.attributes, 'memberOf'),
      await validateAdminGroupConfiguration(),
    )) {
      throw new Error('The exact reviewed AD account is now protected by administrator-group membership; reconciliation is required');
    }

    const requestProjection = await tx.accessRequest.findUnique({
      where: { id: recipient.accessRequestId },
      select: {
        adAccountStatus: true,
      },
    });
    if (requestProjection?.adAccountStatus === 'deleted') {
      throw new Error('The portal AD projection is already deleted and cannot be downgraded to disabled');
    }
    projectConfirmedDisabled = requestProjection?.adAccountStatus !== 'disabled';
    disabledConfirmation = {
      observedAt: new Date(),
      directoryDn: userInfo.objectName,
      objectGuid: liveObjectGuid,
      username: liveUsername!,
      userAccountControl: rawUac!,
    };
  }

  const result = await tx.accessRequest.updateMany({
    where: {
      id: recipient.accessRequestId,
      status: 'approved',
      ...(recipient.campaign.workflowMode === 'direct'
        ? { version: recipient.expectedRequestVersion ?? -1 }
        : {}),
    },
    data: {
      status: 'offboarded',
      accountExpiresAt: enforcedAt,
      ...(projectConfirmedDisabled
        ? {
            adAccountStatus: 'disabled',
          }
        : {}),
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
      comment: disabledConfirmation
        ? `Offboard campaign "${recipient.campaign.name}" completed for ${recipient.adUsername}. No LDAP disable write was issued: the exact reviewed object was confirmed disabled at ${disabledConfirmation.observedAt.toISOString()} under the directory execution lock (username=${disabledConfirmation.username}, DN=${disabledConfirmation.directoryDn}, objectGUID=${disabledConfirmation.objectGuid}, userAccountControl=${disabledConfirmation.userAccountControl}). The original disable time and actor remain unknown unless already recorded. Access was revoked by the campaign, but this does not block future re-enrollment unless the email is on the block list.`
        : `Offboard campaign "${recipient.campaign.name}" completed for ${recipient.adUsername}. Access was disabled/revoked by the campaign, but this does not block future re-enrollment unless the email is on the block list.`,
    },
  });

  return true;
}

async function restoreAccessRequestAfterCampaignRollback(
  tx: Prisma.TransactionClient,
  recipient: CampaignRecipientWithCampaign,
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
  const adminGroups = await validateAdminGroupConfiguration();
  const ldapSearchBase = await getConfigValue<string>('ldap.searchBase');

  const workflowMode = input.workflowMode === 'direct' ? 'direct' : 'verification';
  const directOffboardReason = input.directOffboardReason?.trim() || '';
  const directOffboardReference = input.directOffboardReference?.trim() || '';
  if (workflowMode === 'direct') {
    if (directOffboardReason.length < 10 || directOffboardReason.length > 2_000) {
      throw new Error('Direct offboarding requires a substantive reason between 10 and 2,000 characters');
    }
    if (directOffboardReference.length < 3 || directOffboardReference.length > 200) {
      throw new Error('Direct offboarding requires a ticket or change reference between 3 and 200 characters');
    }
  }
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
  const ambiguousVpnLinks = ambiguousLiveVpnLinks(vpnAccounts);
  const vpnModuleEnabled = workflowMode === 'direct' ? await isModuleEnabledStrict('vpn.management') : true;
  const now = new Date();
  const projectedDeadline = workflowMode === 'verification' ? addDays(now, 7) : null;

  let eligibleIndex = 0;
  const recipientRows = targetUsers
    .sort((a, b) => a.username.localeCompare(b.username))
    .map(user => {
      const usernameKey = normalize(user.username);
      const vpn = vpnByAd.get(usernameKey) || null;
      const accessRequest = accessRequestMap.get(usernameKey) || null;
      const verification = verificationMap.get(usernameKey) || emptyVerificationInfo();
      let skipReason = safetySkipReason(
        workflowMode === 'direct' ? { ...user, accountEnabled: true } : user,
        excludedUsernameSet,
        excludedEmailSet,
        adminGroups,
      );
      if (!skipReason && workflowMode === 'direct' && (!accessRequest || accessRequest.status !== 'approved')) {
        skipReason = 'direct_offboarding_requires_approved_portal_request';
      }
      if (!skipReason && workflowMode === 'direct' && ambiguousVpnLinks.has(usernameKey)) {
        skipReason = 'multiple_live_vpn_accounts_linked_to_ad_username';
      }
      if (!skipReason && workflowMode === 'direct' && vpn && !vpnModuleEnabled) {
        skipReason = 'vpn_module_disabled';
      }
      const isSkipped = Boolean(skipReason);
      const waveNumber = isSkipped ? -1 : waveNumberForEligibleIndex(eligibleIndex++, canarySize, waveSize);

      return {
        email: user.email,
        displayName: user.displayName || user.username,
        adUsername: user.username,
        adDn: user.dn,
        linkedVpnUsername: vpn?.username || null,
        accessRequestId: accessRequest?.id || user.accessRequestId || null,
        expectedRequestVersion: accessRequest?.version ?? null,
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
        projectedAction: isSkipped ? null : workflowMode === 'direct'
          ? `${projectedActionFor(user, vpn)}; revoke sessions; send completed-offboarding notice`
          : projectedActionFor(user, vpn),
      };
    });

  const eligibleRecipients = recipientRows.filter(row => row.status === 'dry_run_ready').length;
  const skippedRecipients = recipientRows.filter(row => row.status === 'skipped').length;

  return await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const campaign = await tx.offboardCampaign.create({
      data: {
        name: input.name?.trim() || `Offboard dry run ${now.toISOString().slice(0, 10)}`,
        createdBy: actor,
        workflowMode,
        status: 'dry_run',
        dryRunAt: now,
        waveSize,
        canarySize,
        currentWave: canarySize > 0 ? 0 : 0,
        pauseAfterEachWave,
        sendingPaused: true,
        executionPaused: true,
        directOffboardReason: workflowMode === 'direct' ? directOffboardReason : null,
        directOffboardReference: workflowMode === 'direct' ? directOffboardReference : null,
        manualExcludedUsernames: excludedUsernames,
        manualExcludedEmails: excludedEmails,
        totalRecipients: recipientRows.length,
        eligibleRecipients,
        skippedRecipients,
        summaryJson: {
          ldapSearchBase: ldapSearchBase || null,
          vpnAccountsConsidered: vpnAccounts.length,
          scope: 'selected_accounts',
          workflowMode,
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
          originalSnapshot: row.originalSnapshot as unknown as Prisma.InputJsonValue,
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
        workflowMode,
        directOffboardReference: workflowMode === 'direct' ? directOffboardReference : null,
      },
    });

    return await getOffboardCampaign(campaign.id, tx);
  });
}

export async function getOffboardCampaign(campaignId: string, client: Prisma.TransactionClient = prisma) {
  const campaign = await client.offboardCampaign.findUnique({
    where: { id: campaignId },
    include: {
      recipients: {
        orderBy: [{ waveNumber: 'asc' }, { adUsername: 'asc' }],
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
      workflowMode: true,
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
      executionPaused: true,
      directOffboardReason: true,
      directOffboardReference: true,
      finalNoticeSentCount: true,
      finalNoticeFailureCount: true,
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

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
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

async function buildActivationOperationItems(campaignId: string): Promise<OperationPreviewItem[]> {
  const adminGroups = await validateAdminGroupConfiguration();
  const campaign = await prisma.offboardCampaign.findUnique({
    where: { id: campaignId },
    include: { recipients: true },
  });
  if (!campaign) throw new Error('Campaign not found');

  const [ldapUsersRaw, vpnAccounts] = await Promise.all([
    listUsersInOU(),
    prisma.vPNAccount.findMany({ select: { id: true, username: true, status: true, portalType: true, adUsername: true } }),
  ]);
  const liveUsers = new Map<string, LdapUserSnapshot>();
  for (const user of ldapUsersRaw as LdapUserSnapshot[]) liveUsers.set(normalize(user.username), user);
  const vpnByAd = buildVpnLookup(vpnAccounts);
  const ambiguousVpnLinks = ambiguousLiveVpnLinks(vpnAccounts);
  const excludedUsernameSet = new Set<string>((campaign.manualExcludedUsernames as string[] | null || []).map(normalize));
  const excludedEmailSet = new Set<string>((campaign.manualExcludedEmails as string[] | null || []).map(normalize));
  const directMode = campaign.workflowMode === 'direct';
  const vpnModuleEnabled = directMode ? await isModuleEnabledStrict('vpn.management') : true;
  const items: OperationPreviewItem[] = [];
  for (const recipient of campaign.recipients) {
    let conflict: string | null = null;
    if (recipient.status === 'skipped') conflict = recipient.skipReason || 'already_skipped';
    const live = liveUsers.get(normalize(recipient.adUsername));
    const liveDirectory = directMode && !conflict ? await searchLDAPUser(recipient.adUsername) : null;
    const liveObjectGuid = liveDirectory ? getAttribute(liveDirectory.attributes, 'objectGUID') : null;
    const liveRequest = directMode && recipient.accessRequestId
      ? await prisma.accessRequest.findUnique({
          where: { id: recipient.accessRequestId },
          select: { id: true, status: true, version: true },
        })
      : null;
    if (!conflict && !live) conflict = 'no_longer_in_ldap_scope';
    if (!conflict && directMode && ambiguousVpnLinks.has(normalize(recipient.adUsername))) {
      conflict = 'multiple_live_vpn_accounts_linked_to_ad_username';
    }
    if (!conflict && live) {
      conflict = safetySkipReason(
        directMode ? { ...live, accountEnabled: true } : live,
        excludedUsernameSet,
        excludedEmailSet,
        adminGroups,
      );
      if (!conflict && normalize(live.email) !== normalize(recipient.email)) conflict = 'email_changed_since_dry_run';
      const liveVpn = vpnByAd.get(normalize(recipient.adUsername)) || null;
      if (!conflict && normalize(liveVpn?.username) !== normalize(recipient.linkedVpnUsername)) conflict = 'vpn_link_changed_since_dry_run';
      if (
        !conflict
        && liveVpn
        && liveVpn.status !== recipient.originalVpnStatus
        && !(directMode && ['revoked', 'disabled'].includes(liveVpn.status))
      ) conflict = 'vpn_status_changed_since_dry_run';
      if (!conflict && liveVpn && liveVpn.id !== recipient.vpnAccountId) conflict = 'vpn_identity_changed_since_dry_run';
      if (!conflict && directMode && liveVpn && !vpnModuleEnabled) conflict = 'vpn_module_disabled';
      if (!conflict && directMode && (!liveDirectory || liveDirectory.objectName !== recipient.adDn || !liveObjectGuid)) conflict = 'directory_identity_changed_since_dry_run';
      if (!conflict && directMode && (!liveRequest || liveRequest.status !== 'approved' || liveRequest.version !== recipient.expectedRequestVersion)) conflict = 'request_state_changed_since_dry_run';
    }
    const liveVpn = vpnByAd.get(normalize(recipient.adUsername)) || null;
    const actions = conflict
      ? []
      : directMode
        ? [
            ...(live?.accountEnabled ? ['disable_ad'] : []),
            ...(liveVpn && !['revoked', 'disabled'].includes(liveVpn.status) ? ['revoke_vpn'] : []),
            'revoke_sessions',
            'mark_request_offboarded',
            'send_final_notice',
          ]
        : ['queue_initial_email'];
    items.push({
      recipientId: recipient.id,
      adUsername: recipient.adUsername,
      linkedVpnUsername: recipient.linkedVpnUsername,
      actions,
      conflicts: conflict ? [conflict] : [],
      expectedState: {
        workflowMode: campaign.workflowMode,
        campaignUpdatedAt: campaign.updatedAt.toISOString(),
        campaignStatus: campaign.status,
        campaignWaveSize: campaign.waveSize,
        campaignCanarySize: campaign.canarySize,
        campaignCurrentWave: campaign.currentWave,
        campaignPauseAfterEachWave: campaign.pauseAfterEachWave,
        campaignSendingPaused: campaign.sendingPaused,
        recipientUpdatedAt: recipient.updatedAt.toISOString(),
        recipientStatus: recipient.status,
        recipientWaveNumber: recipient.waveNumber,
        adUsername: recipient.adUsername,
        email: recipient.email,
        linkedVpnUsername: recipient.linkedVpnUsername,
        originalVpnStatus: recipient.originalVpnStatus,
        liveAdDn: live?.dn ?? null,
        liveAdObjectGuid: liveObjectGuid,
        liveAdEnabled: live?.accountEnabled ?? null,
        liveAdExpires: live?.accountExpires ?? null,
        liveVpnStatus: (vpnByAd.get(normalize(recipient.adUsername)) || null)?.status ?? null,
        liveVpnId: (vpnByAd.get(normalize(recipient.adUsername)) || null)?.id ?? null,
        liveVpnPortalType: (vpnByAd.get(normalize(recipient.adUsername)) || null)?.portalType ?? null,
        liveRequestId: liveRequest?.id ?? null,
        liveRequestStatus: liveRequest?.status ?? null,
        liveRequestVersion: liveRequest?.version ?? null,
      },
      executable: !conflict,
    });
  }
  return items;
}

async function buildRollbackOperationItems(campaignId: string): Promise<OperationPreviewItem[]> {
  const preview = await previewOffboardRollback(campaignId);
  return preview.items.map(item => ({
    recipientId: item.recipientId,
    adUsername: item.adUsername,
    linkedVpnUsername: item.linkedVpnUsername,
    actions: item.actions,
    conflicts: item.conflicts,
    expectedState: {
      rollbackable: item.rollbackable,
      actions: item.actions,
      conflicts: item.conflicts,
      recipientUpdatedAt: item.recipientUpdatedAt,
      recipientStatus: item.recipientStatus,
      rollbackStatus: item.rollbackStatus,
      currentAdStatus: item.currentAdStatus,
      currentRequestStatus: item.currentRequestStatus,
      currentVpnStatus: item.currentVpnStatus,
    },
    executable: item.rollbackable,
  }));
}

export async function createOffboardOperationPreview(campaignId: string, kind: OperationKind, actor: string) {
  const campaign = await prisma.offboardCampaign.findUnique({
    where: { id: campaignId },
    select: { workflowMode: true },
  });
  if (!campaign) throw new Error('Campaign not found');
  if (kind === 'rollback' && campaign.workflowMode === 'direct') {
    throw new Error('Direct offboarding cannot be rolled back; future access requires a new account request');
  }
  const items = kind === 'activation'
    ? await buildActivationOperationItems(campaignId)
    : await buildRollbackOperationItems(campaignId);
  const digest = canonicalOperationDigest(kind, campaignId, items);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + OPERATION_PREVIEW_TTL_MS);
  const summary = {
    workflowMode: campaign.workflowMode,
    total: items.length,
    executable: items.filter(item => item.executable).length,
    conflicts: items.filter(item => item.conflicts.length > 0).length,
  };
  const run = await prisma.offboardOperationRun.create({
    data: {
      campaignId,
      actor,
      kind,
      digest,
      expiresAt,
      policyVersion: kind === 'activation' && campaign.workflowMode === 'direct'
        ? DIRECT_OFFBOARD_POLICY_VERSION
        : null,
      summary,
      items: {
        create: items.map((item, position) => ({
          recipientId: item.recipientId,
          position,
          expectedState: operationJson(item.expectedState),
          actions: operationJson(item.actions),
          conflicts: operationJson(item.conflicts),
          status: item.executable ? 'previewed' : 'skipped',
        })),
      },
    },
    include: { items: { orderBy: { position: 'asc' } } },
  });
  return {
    previewId: run.id,
    digest,
    expiresAt,
    kind,
    summary,
    pageInfo: { page: 1, pageSize: Math.min(100, items.length), total: items.length, totalPages: Math.max(1, Math.ceil(items.length / 100)) },
    downloadUrl: `/api/admin/offboard-campaigns/${campaignId}/operations/${run.id}?download=csv`,
    items: run.items.slice(0, 100).map((item, index: number) => ({
      ...items[index],
      status: item.status,
    })),
  };
}

export async function getOffboardOperationPreview(runId: string, actor: string, campaignId: string, page = 1, pageSize = 100) {
  const take = Math.min(Math.max(pageSize, 1), 5000);
  const skip = Math.max(page - 1, 0) * take;
  const run = await prisma.offboardOperationRun.findFirst({
    where: { id: runId, actor, campaignId },
    include: { items: { orderBy: { position: 'asc' }, skip, take }, _count: { select: { items: true } } },
  });
  if (!run) throw new Error('Operation preview not found');
  return {
    previewId: run.id,
    digest: run.digest,
    expiresAt: run.expiresAt,
    kind: run.kind,
    status: run.status,
    summary: run.summary,
    downloadUrl: `/api/admin/offboard-campaigns/${run.campaignId}/operations/${run.id}?download=csv`,
    pageInfo: { page, pageSize: take, total: run._count.items, totalPages: Math.max(1, Math.ceil(run._count.items / take)) },
    items: run.items.map(item => ({
      recipientId: item.recipientId,
      actions: jsonArray(item.actions),
      conflicts: jsonArray(item.conflicts),
      expectedState: item.expectedState,
      status: item.status,
      outcome: item.outcome,
    })),
  };
}

async function claimOffboardOperation(params: { campaignId: string; kind: OperationKind; actor: string; previewId: string; digest: string; idempotencyKey: string }) {
  const existing = await prisma.offboardOperationRun.findUnique({ where: { idempotencyKey: params.idempotencyKey } });
  if (existing) {
    if (!sameOffboardOperationScope(existing, params)) {
      throw new OffboardOperationError('Idempotency-Key was already used for a different operation', 'PREVIEW_CONFLICT');
    }
    if (existing.status === 'claimed') {
      if (existing.claimedUntil && existing.claimedUntil <= new Date()) {
        await prisma.offboardOperationRun.updateMany({
          where: { id: existing.id, status: 'claimed', claimedUntil: { lte: new Date() } },
          data: { status: 'reconciliation_required', claimedUntil: null },
        });
        throw new OffboardOperationError('The execution claim expired after work may have started; reconcile its outcomes before retrying', 'RECONCILIATION_REQUIRED');
      }
      throw new OffboardOperationError('This exact operation is still being processed', 'OPERATION_IN_PROGRESS');
    }
    return { run: existing, duplicate: true };
  }
  const now = new Date();
  const claimId = crypto.randomUUID();
  const claimed = await prisma.offboardOperationRun.updateMany({
    where: { id: params.previewId, campaignId: params.campaignId, kind: params.kind, actor: params.actor, digest: params.digest, status: 'previewed', expiresAt: { gt: now }, idempotencyKey: null },
    data: { status: 'claimed', claimId, claimedAt: now, claimedUntil: new Date(now.getTime() + OPERATION_CLAIM_MS), idempotencyKey: params.idempotencyKey },
  });
  if (claimed.count !== 1) {
    const duplicate = await prisma.offboardOperationRun.findUnique({ where: { idempotencyKey: params.idempotencyKey } });
    if (duplicate) {
      if (!sameOffboardOperationScope(duplicate, params)) {
        throw new OffboardOperationError('Idempotency-Key was already used for a different operation', 'PREVIEW_CONFLICT');
      }
      if (duplicate.status === 'claimed') {
        if (duplicate.claimedUntil && duplicate.claimedUntil <= now) {
          await prisma.offboardOperationRun.updateMany({
            where: { id: duplicate.id, status: 'claimed', claimedUntil: { lte: now } },
            data: { status: 'reconciliation_required', claimedUntil: null },
          });
          throw new OffboardOperationError('The execution claim expired after work may have started; reconcile its outcomes before retrying', 'RECONCILIATION_REQUIRED');
        }
        throw new OffboardOperationError('This exact operation is still being processed', 'OPERATION_IN_PROGRESS');
      }
      return { run: duplicate, duplicate: true };
    }
    const run = await prisma.offboardOperationRun.findUnique({ where: { id: params.previewId } });
    if (run && run.expiresAt <= now) throw new OffboardOperationError('Preview expired; create a new exact preview', 'PREVIEW_EXPIRED');
    throw new OffboardOperationError('Preview was already claimed or no longer matches this operation', 'PREVIEW_CONFLICT');
  }
  return { run: await prisma.offboardOperationRun.findUniqueOrThrow({ where: { id: params.previewId }, include: { items: { orderBy: { position: 'asc' } } } }), duplicate: false };
}

function sameOffboardOperationScope(
  run: { id: string; campaignId: string; kind: string; actor: string; digest: string },
  params: { campaignId: string; kind: OperationKind; actor: string; previewId: string; digest: string },
): boolean {
  return run.id === params.previewId
    && run.campaignId === params.campaignId
    && run.kind === params.kind
    && run.actor === params.actor
    && run.digest === params.digest;
}

export async function executeOffboardOperation(params: {
  campaignId: string;
  kind: OperationKind;
  actor: string;
  previewId: string;
  digest: string;
  idempotencyKey: string;
  directAcknowledgement?: string;
  irreversibleAcknowledgement?: boolean;
  authorizationEvidence?: Record<string, unknown>;
}) {
  if (!params.idempotencyKey || params.idempotencyKey.length > 200) {
    throw new OffboardOperationError('A valid Idempotency-Key is required', 'PREVIEW_INVALID');
  }
  const duplicate = await prisma.offboardOperationRun.findUnique({ where: { idempotencyKey: params.idempotencyKey } });
  if (duplicate) {
    if (!sameOffboardOperationScope(duplicate, params)) {
      throw new OffboardOperationError('Idempotency-Key was already used for a different operation', 'PREVIEW_CONFLICT');
    }
    if (duplicate.status === 'claimed') {
      if (duplicate.claimedUntil && duplicate.claimedUntil <= new Date()) {
        await prisma.offboardOperationRun.updateMany({
          where: { id: duplicate.id, status: 'claimed', claimedUntil: { lte: new Date() } },
          data: { status: 'reconciliation_required', claimedUntil: null },
        });
        throw new OffboardOperationError('The execution claim expired after work may have started; reconcile its outcomes before retrying', 'RECONCILIATION_REQUIRED');
      }
      throw new OffboardOperationError('This exact operation is still being processed', 'OPERATION_IN_PROGRESS');
    }
    return { duplicate: true, run: duplicate, campaign: null };
  }
  const run = await prisma.offboardOperationRun.findFirst({ where: { id: params.previewId, campaignId: params.campaignId, kind: params.kind, actor: params.actor } });
  if (!run || run.digest !== params.digest) throw new OffboardOperationError('Preview does not match this operation', 'PREVIEW_STALE');
  if (run.expiresAt <= new Date()) throw new OffboardOperationError('Preview expired; create a new exact preview', 'PREVIEW_EXPIRED');
  const campaignMode = await prisma.offboardCampaign.findUnique({
    where: { id: params.campaignId },
    select: { workflowMode: true },
  });
  if (!campaignMode) throw new OffboardOperationError('Campaign not found', 'PREVIEW_INVALID');
  if (params.kind === 'rollback' && campaignMode.workflowMode === 'direct') {
    throw new OffboardOperationError('Direct offboarding cannot be rolled back; future access requires a new account request', 'PREVIEW_INVALID');
  }
  const runSummary = run.summary && typeof run.summary === 'object' && !Array.isArray(run.summary)
    ? run.summary as Record<string, unknown>
    : {};
  if (params.kind === 'activation' && campaignMode.workflowMode === 'direct') {
    const executable = Number(runSummary.executable || 0);
    const expectedAcknowledgement = `DIRECT OFFBOARD ${executable} ${executable === 1 ? 'ACCOUNT' : 'ACCOUNTS'}`;
    if (run.policyVersion !== DIRECT_OFFBOARD_POLICY_VERSION) {
      throw new OffboardOperationError('Direct-offboarding policy evidence is missing; create a new preview', 'PREVIEW_INVALID');
    }
    if (!params.irreversibleAcknowledgement || params.directAcknowledgement !== expectedAcknowledgement) {
      throw new OffboardOperationError(`Type ${expectedAcknowledgement} and acknowledge the immediate access changes`, 'PREVIEW_INVALID');
    }
  }
  const freshItems = params.kind === 'activation'
    ? await buildActivationOperationItems(params.campaignId)
    : await buildRollbackOperationItems(params.campaignId);
  if (canonicalOperationDigest(params.kind, params.campaignId, freshItems) !== params.digest) {
    await prisma.offboardOperationRun.update({ where: { id: run.id }, data: { status: 'stale' } });
    throw new OffboardOperationError('Live state changed since preview; create a new exact preview', 'PREVIEW_STALE');
  }
  const claimed = await claimOffboardOperation(params);
  if (claimed.duplicate) return { duplicate: true, run: claimed.run, campaign: null };
  if (params.kind === 'activation' && campaignMode.workflowMode === 'direct') {
    await prisma.offboardOperationRun.update({
      where: { id: params.previewId },
      data: {
        authorizationEvidence: operationJson({
          policyVersion: DIRECT_OFFBOARD_POLICY_VERSION,
          acknowledgedAt: new Date().toISOString(),
          acknowledgement: params.directAcknowledgement,
          irreversibleAcknowledgement: true,
          ...(params.authorizationEvidence || {}),
        }),
      },
    });
  }
  try {
    let campaign;
    let finalRunStatus = 'completed';
    if (params.kind === 'activation') {
      campaign = await activateOffboardCampaign(params.campaignId, params.actor, params.previewId);
      const activatedCampaign = campaign!;
      if (activatedCampaign.workflowMode === 'direct') {
        const waveCount = await prisma.offboardCampaignRecipient.count({
          where: { campaignId: params.campaignId, status: 'direct_pending', waveNumber: activatedCampaign.currentWave },
        });
        if (waveCount > 0) await processDirectOffboarding(params.campaignId, params.actor, waveCount);
      } else {
        const waveCount = await prisma.offboardCampaignRecipient.count({
          where: { campaignId: params.campaignId, status: 'pending_send', waveNumber: activatedCampaign.currentWave },
        });
        if (waveCount > 0) await processCampaignSending(params.campaignId, params.actor, waveCount);
      }
      campaign = await getOffboardCampaign(params.campaignId);
      const outcomes = await prisma.offboardCampaignRecipient.findMany({
        where: { campaignId: params.campaignId },
        select: {
          id: true,
          status: true,
          waveNumber: true,
          initialEmailSentAt: true,
          enforcedAt: true,
          finalNoticeStatus: true,
          finalNoticeSentAt: true,
          lastError: true,
        },
      });
      const outcomeById = new Map(outcomes.map((outcome) => [outcome.id, outcome]));
      const claimedItems = await prisma.offboardOperationRunItem.findMany({ where: { runId: params.previewId } });
      const outcomeUpdates = claimedItems.map((item) => {
        const outcome = item.recipientId ? outcomeById.get(item.recipientId) : null;
        const directPending = campaignMode.workflowMode === 'direct' && Boolean(outcome) && (
          ['direct_pending', 'enforcement_processing'].includes(outcome!.status)
          || (outcome!.status === 'enforced' && ['pending', 'sending'].includes(outcome!.finalNoticeStatus))
        );
        const directUncertain = campaignMode.workflowMode === 'direct' && Boolean(outcome) && (
          outcome!.status === 'enforcement_reconciliation_required'
          || ['failed', 'reconciliation_required'].includes(outcome!.finalNoticeStatus)
        );
        const uncertain = item.status !== 'skipped' && (!outcome
          || outcome.status === 'email_unknown'
          || outcome.status === 'email_sending'
          || outcome.status === 'enforcement_reconciliation_required'
          || outcome.finalNoticeStatus === 'sending'
          || outcome.finalNoticeStatus === 'reconciliation_required'
          || directUncertain);
        if (uncertain) finalRunStatus = 'reconciliation_required';
        else if (directPending && finalRunStatus === 'completed') finalRunStatus = 'in_progress';
        return prisma.offboardOperationRunItem.update({
          where: { id: item.id },
          data: {
            status: item.status === 'skipped'
              ? 'skipped'
              : uncertain
                ? 'reconciliation_required'
                : directPending
                  ? 'pending'
                  : 'completed',
            outcome: operationJson(outcome ? {
              recipientStatus: outcome.status,
              waveNumber: outcome.waveNumber,
              initialEmailSentAt: outcome.initialEmailSentAt,
              enforcedAt: outcome.enforcedAt,
              finalNoticeStatus: outcome.finalNoticeStatus,
              finalNoticeSentAt: outcome.finalNoticeSentAt,
              error: outcome.lastError,
            } : { error: 'Recipient disappeared after activation' }),
          },
        });
      });
      if (outcomeUpdates.length > 0) await prisma.$transaction(outcomeUpdates);
    } else {
      const claimedRun = await prisma.offboardOperationRun.findUniqueOrThrow({
        where: { id: params.previewId },
        include: { items: { orderBy: { position: 'asc' } } },
      });
      campaign = await executeOffboardRollback(params.campaignId, params.actor, claimedRun);
      const uncertainItems = await prisma.offboardOperationRunItem.count({
        where: { runId: params.previewId, status: 'reconciliation_required' },
      });
      if (uncertainItems > 0) finalRunStatus = 'reconciliation_required';
    }
    await prisma.offboardOperationRun.update({ where: { id: params.previewId }, data: { status: finalRunStatus, claimedUntil: null } });
    return { duplicate: false, run: await prisma.offboardOperationRun.findUnique({ where: { id: params.previewId } }), campaign };
  } catch (error) {
    const directActivation = params.kind === 'activation' && campaignMode.workflowMode === 'direct';
    const [possibleDirectEffects, activatedCampaign] = directActivation
      ? await Promise.all([
          prisma.accountLifecycleAction.count({ where: { offboardOperationRunId: params.previewId } }),
          prisma.offboardCampaign.findUnique({
            where: { id: params.campaignId },
            select: { activationOperationRunId: true },
          }),
        ])
      : [0, null];
    const activationCommitted = activatedCampaign?.activationOperationRunId === params.previewId;
    await prisma.offboardOperationRun.update({
      where: { id: params.previewId },
      data: {
        status: possibleDirectEffects > 0 || activationCommitted ? 'reconciliation_required' : 'failed',
        claimedUntil: null,
      },
    });
    throw error;
  }
}

export async function activateOffboardCampaign(campaignId: string, actor: string, activationOperationRunId?: string) {
  const adminGroups = await validateAdminGroupConfiguration();

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

  if (campaign.workflowMode === 'direct') {
    if (!activationOperationRunId) {
      throw new Error('Direct offboarding requires an exact claimed activation preview');
    }
    return activateDirectOffboardCampaign(campaign, actor, activationOperationRunId);
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
      skipReason = safetySkipReason(live, excludedUsernameSet, excludedEmailSet, adminGroups);
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

  return await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
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

async function activateDirectOffboardCampaign(
  campaign: Prisma.OffboardCampaignGetPayload<{ include: { recipients: true } }>,
  actor: string,
  activationOperationRunId: string,
) {
  const operationRun = await prisma.offboardOperationRun.findFirst({
    where: {
      id: activationOperationRunId,
      campaignId: campaign.id,
      kind: 'activation',
      actor,
      status: 'claimed',
      policyVersion: DIRECT_OFFBOARD_POLICY_VERSION,
    },
    include: { items: true },
  });
  if (!operationRun?.authorizationEvidence) {
    throw new Error('Direct offboarding requires durable authorization evidence before activation');
  }

  const operationItems = new Map(operationRun.items.map(item => [item.recipientId, item]));
  const updates = campaign.recipients.map(recipient => {
    const item = operationItems.get(recipient.id);
    if (!item || item.status === 'skipped' || recipient.status === 'skipped') {
      return {
        id: recipient.id,
        status: 'skipped' as const,
        skipReason: recipient.skipReason || jsonArray(item?.conflicts)[0] || 'not_authorized_by_activation_preview',
        targetDirectoryObjectGuid: null,
      };
    }
    const expected = item.expectedState && typeof item.expectedState === 'object' && !Array.isArray(item.expectedState)
      ? item.expectedState as Record<string, unknown>
      : {};
    const targetDirectoryObjectGuid = typeof expected.liveAdObjectGuid === 'string'
      ? expected.liveAdObjectGuid
      : null;
    if (!targetDirectoryObjectGuid) {
      throw new Error(`Direct activation preview lacks immutable directory identity for ${recipient.adUsername}`);
    }
    return {
      id: recipient.id,
      status: 'direct_pending' as const,
      skipReason: null,
      targetDirectoryObjectGuid,
    };
  });

  const activatedCount = updates.filter(update => update.status === 'direct_pending').length;
  if (activatedCount < 1) {
    throw new Error('Direct offboarding has no conflict-free recipients to execute');
  }
  const activatedIds = new Set(updates.filter(update => update.status === 'direct_pending').map(update => update.id));
  const firstWave = campaign.recipients
    .filter(recipient => activatedIds.has(recipient.id))
    .reduce((minimum: number | null, recipient) => minimum === null
      ? recipient.waveNumber
      : Math.min(minimum, recipient.waveNumber), null);

  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    for (const update of updates) {
      await tx.offboardCampaignRecipient.update({
        where: { id: update.id },
        data: {
          status: update.status,
          skipReason: update.skipReason,
          targetDirectoryObjectGuid: update.targetDirectoryObjectGuid,
          tokenHash: null,
          projectedDeadlineAt: null,
          deadlineAt: null,
          finalNoticeStatus: update.status === 'direct_pending' ? 'pending' : 'not_applicable',
        },
      });
    }
    await tx.offboardCampaign.update({
      where: { id: campaign.id },
      data: {
        status: 'active',
        activatedAt: new Date(),
        activatedBy: actor,
        activeLockKey: ACTIVE_LOCK_KEY,
        activationOperationRunId,
        directAcknowledgedAt: new Date(),
        directAcknowledgedBy: actor,
        executionPaused: false,
        sendingPaused: true,
        remindersPaused: true,
        enforcementPaused: false,
        currentWave: firstWave ?? 0,
        eligibleRecipients: activatedCount,
        skippedRecipients: updates.length - activatedCount,
      },
    });
    await createCampaignLog(tx, {
      campaignId: campaign.id,
      eventType: 'direct_offboarding_activated',
      actor,
      message: `Direct offboarding activated with ${activatedCount} reviewed recipient${activatedCount === 1 ? '' : 's'}`,
      details: {
        activationOperationRunId,
        policyVersion: DIRECT_OFFBOARD_POLICY_VERSION,
        activatedCount,
        skippedCount: updates.length - activatedCount,
        firstWave,
        reference: campaign.directOffboardReference,
      },
    });
    return getOffboardCampaign(campaign.id, tx);
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
    case 'pause_execution':
      if (campaign.workflowMode !== 'direct') throw new Error('Execution controls apply only to direct offboarding');
      data.executionPaused = true;
      message = 'Direct offboarding paused before the next recipient claim';
      break;
    case 'resume_execution':
      if (campaign.workflowMode !== 'direct') throw new Error('Execution controls apply only to direct offboarding');
      data.executionPaused = false;
      message = 'Direct offboarding resumed';
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
      data.executionPaused = true;
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
      data.executionPaused = true;
      data.activeLockKey = null;
      message = 'Emergency stop activated';
      break;
    default:
      throw new Error(`Unknown campaign control action: ${action}`);
  }

  return await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
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

async function markStaleFinalNoticeClaims() {
  const now = new Date();
  const stale = await prisma.offboardCampaignRecipient.findMany({
    where: { finalNoticeStatus: 'sending', finalNoticeClaimedUntil: { lte: now }, finalNoticeSentAt: null },
    select: { id: true, campaignId: true },
  });
  let reconciliations = 0;
  for (const recipient of stale) {
    let transitioned = false;
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const result = await tx.offboardCampaignRecipient.updateMany({
        where: {
          id: recipient.id,
          finalNoticeStatus: 'sending',
          finalNoticeClaimedUntil: { lte: now },
          finalNoticeSentAt: null,
        },
        data: {
          finalNoticeStatus: 'reconciliation_required',
          finalNoticeClaimId: null,
          finalNoticeClaimedUntil: null,
          finalNoticeError: 'Final-notice lease expired after SMTP delivery may have started',
          lastError: 'Final notice delivery requires operator reconciliation before retry',
        },
      });
      if (result.count !== 1) return;
      transitioned = true;
      reconciliations += 1;
      await tx.offboardCampaign.update({
        where: { id: recipient.campaignId },
        data: { finalNoticeFailureCount: { increment: 1 } },
      });
      await createCampaignLog(tx, {
        campaignId: recipient.campaignId,
        recipientId: recipient.id,
        level: 'error',
        eventType: 'direct_final_notice_claim_expired',
        actor: 'system',
        message: 'Final-notice delivery claim expired and requires reconciliation',
      });
    });
    if (transitioned) {
      await syncDirectActivationRunOutcome(recipient.campaignId, recipient.id);
    }
  }
  if (reconciliations > 0) {
    appLogger.warn('Marked stale direct-offboarding final notices for reconciliation', { count: reconciliations });
  }
}

export async function processOffboardCampaigns(options: ProcessOptions = {}) {
  await validateAdminGroupConfiguration();

  const actor = options.actor || 'system';
  const limit = Math.max(1, Math.min(options.limit || 50, 250));
  await markStaleEmailClaims();
  if (options.allowDirect !== false) {
    await markStaleFinalNoticeClaims();
    await markAllStaleDirectEnforcementClaims(new Date(), actor);
  }

  const campaigns = await prisma.offboardCampaign.findMany({
    where: {
      status: 'active',
      ...(options.campaignId ? { id: options.campaignId } : {}),
      ...(options.allowDirect === false ? { workflowMode: { not: 'direct' } } : {}),
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
    if (campaign.workflowMode === 'direct') {
      const directSummary = await processDirectOffboarding(campaign.id, actor, limit);
      await completeCampaignIfFinished(campaign.id);
      const directProcessed = directSummary.enforced + directSummary.skipped + directSummary.failed;
      summaries.push({
        campaignId: campaign.id,
        workflowMode: 'direct',
        sent: 0,
        reminders: 0,
        remindersSkippedBecausePaused: true,
        enforced: directSummary.enforced,
        enforcementSkipped: directSummary.skipped,
        enforcementSkippedBecausePaused: directSummary.skippedBecausePaused,
        finalNoticesSent: directSummary.finalNoticesSent,
        finalNoticesReconciliationRequired: directSummary.finalNoticesReconciliationRequired,
        failures: directSummary.failed + directSummary.finalNoticesReconciliationRequired,
        batchLimitReached: directProcessed >= limit,
      });
      continue;
    }
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

export async function previewProcessAllOffboardCampaign(campaignId: string, cutoff = new Date()) {
  const campaign = await prisma.offboardCampaign.findUnique({
    where: { id: campaignId },
    select: {
      id: true,
      status: true,
      workflowMode: true,
      executionPaused: true,
      currentWave: true,
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

  const now = cutoff;
  const day3DueBefore = new Date(now.getTime() - 3 * DAY_MS);
  const day6DueBefore = new Date(now.getTime() - 6 * DAY_MS);
  const [
    pendingInitialEmails,
    day3Reminders,
    day6Reminders,
    extensionReminderCandidates,
    enforcementRecipients,
    enforcementVpnRevocations,
    directRecipients,
    directVpnRevocations,
    statusCounts,
    stateRows,
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
    prisma.offboardCampaignRecipient.count({
      where: {
        campaignId,
        status: 'direct_pending',
        waveNumber: campaign.currentWave,
      },
    }),
    prisma.offboardCampaignRecipient.count({
      where: {
        campaignId,
        status: 'direct_pending',
        waveNumber: campaign.currentWave,
        linkedVpnUsername: { not: null },
      },
    }),
    prisma.offboardCampaignRecipient.groupBy({
      by: ['status'],
      where: { campaignId },
      _count: { status: true },
    }),
    prisma.offboardCampaignRecipient.findMany({
      where: { campaignId },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        updatedAt: true,
        status: true,
        extensions: {
          orderBy: { id: 'asc' },
          select: { id: true, updatedAt: true, status: true },
        },
      },
    }),
  ]);
  const extensionReminders = extensionReminderCandidates.filter(reminder =>
    isOffboardExtensionReminderScheduleValid(
      reminder.extension.createdAt,
      reminder.scheduledFor
    )
  ).length;
  const suppressedExtensionReminders = extensionReminderCandidates.length - extensionReminders;
  const previewDigest = crypto.createHash('sha256').update(JSON.stringify({
    cutoff: now.toISOString(),
    campaign: {
      id: campaign.id,
      status: campaign.status,
      workflowMode: campaign.workflowMode,
      executionPaused: campaign.executionPaused,
      currentWave: campaign.currentWave,
      sendingPaused: campaign.sendingPaused,
      remindersPaused: campaign.remindersPaused,
      enforcementPaused: campaign.enforcementPaused,
      cancelledAt: campaign.cancelledAt,
      emergencyStoppedAt: campaign.emergencyStoppedAt,
    },
    stateRows,
  })).digest('hex');

  return {
    campaignId,
    previewDigest,
    previewedAt: now.toISOString(),
    campaignStatus: campaign.status,
    workflowMode: campaign.workflowMode,
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
      directOffboarding: {
        count: directRecipients,
        adDisables: directRecipients,
        vpnRevocations: directVpnRevocations,
        sessionRevocations: directRecipients,
        finalNotices: directRecipients,
        paused: campaign.executionPaused || campaign.enforcementPaused,
        description: `Recheck and converge AD, VPN, session, and request state for ${directRecipients} reviewed recipient${directRecipients === 1 ? '' : 's'} in wave ${campaign.currentWave}; already-safe components are not mutated again.`,
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
  const previewedAt = typeof input.previewedAt === 'string' ? new Date(input.previewedAt) : new Date(Number.NaN);
  if (
    Number.isNaN(previewedAt.getTime())
    || previewedAt.getTime() > Date.now() + 30_000
    || Date.now() - previewedAt.getTime() > 5 * 60_000
  ) {
    throw new Error('OFFBOARD_PROCESS_ALL_PREVIEW_STALE');
  }
  const preview = await previewProcessAllOffboardCampaign(campaignId, previewedAt);
  if (!preview.runnable) {
    throw new Error(`Campaign cannot be processed while status is ${preview.campaignStatus}`);
  }
  if (!input.previewDigest || input.previewDigest !== preview.previewDigest) {
    throw new Error('OFFBOARD_PROCESS_ALL_PREVIEW_STALE');
  }

  const results = {
    campaignId,
    initialEmails: { sent: 0, failed: 0, skippedBecausePaused: false },
    reminders: { sent: 0, failed: 0, skippedBecausePaused: false },
    enforcement: { enforced: 0, skipped: 0, failed: 0, skippedBecausePaused: false },
    directOffboarding: {
      enforced: 0,
      skipped: 0,
      failed: 0,
      finalNoticesSent: 0,
      finalNoticesReconciliationRequired: 0,
      skippedBecausePaused: false,
    },
  };

  if (preview.workflowMode === 'direct') {
    if (input.initialEmails || input.reminders || input.enforcement) {
      throw new Error('Direct offboarding cannot run verification emails, reminders, or deadline enforcement');
    }
    if (input.directOffboarding) {
      if (preview.sections.directOffboarding.paused && !input.overrideExecutionPause) {
        results.directOffboarding.skippedBecausePaused = true;
      } else {
        const summary = await processDirectOffboarding(campaignId, actor, 5000, {
          ignorePause: Boolean(input.overrideExecutionPause),
          bypassWaveGates: false,
        });
        Object.assign(results.directOffboarding, summary);
      }
    }
    await createCampaignLog(prisma, {
      campaignId,
      eventType: 'process_all_completed',
      actor,
      message: 'Process All completed for direct offboarding',
      details: { input, preview: preview.sections.directOffboarding, results: results.directOffboarding },
    });
    await completeCampaignIfFinished(campaignId);
    return { results, campaign: await getOffboardCampaign(campaignId) };
  }
  if (input.directOffboarding) {
    throw new Error('Direct offboarding is not available for verification campaigns');
  }

  if (input.initialEmails) {
    if (preview.sections.initialEmails.paused && !input.overrideSendingPause) {
      results.initialEmails.skippedBecausePaused = true;
    } else {
      const summary = await processCampaignSending(campaignId, actor, 5000, {
        ignorePause: Boolean(input.overrideSendingPause),
        // Process All may override the current sending pause, but it must not
        // silently cross a configured pause-after-wave approval boundary.
        bypassWaveGates: false,
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
        dueAtOrBefore: previewedAt,
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
        dueAtOrBefore: previewedAt,
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

async function sendInitialRecipientEmail(recipient: OffboardCampaignRecipientRow, actor: string): Promise<boolean> {
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

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
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
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
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

async function deliverDirectOffboardFinalNotice(
  recipientId: string,
  actor: string,
): Promise<'sent' | 'reconciliation_required' | 'skipped'> {
  const claimId = crypto.randomUUID();
  const claimedAt = new Date();
  const claim = await prisma.offboardCampaignRecipient.updateMany({
    where: {
      id: recipientId,
      status: 'enforced',
      finalNoticeStatus: 'pending',
      finalNoticeSentAt: null,
      campaign: { workflowMode: 'direct' },
    },
    data: {
      finalNoticeStatus: 'sending',
      finalNoticeClaimId: claimId,
      finalNoticeClaimedAt: claimedAt,
      finalNoticeClaimedUntil: new Date(claimedAt.getTime() + FINAL_NOTICE_CLAIM_MS),
      finalNoticeError: null,
    },
  });
  if (claim.count !== 1) return 'skipped';

  const recipient = await prisma.offboardCampaignRecipient.findUnique({
    where: { id: recipientId },
    include: { campaign: true },
  });
  if (!recipient || recipient.campaign.workflowMode !== 'direct') return 'skipped';

  try {
    const info = await sendOffboardDirectCompletedEmail({
      email: recipient.email,
      name: recipient.displayName || recipient.adUsername,
      adUsername: recipient.adUsername,
      vpnUsername: recipient.linkedVpnUsername,
    });
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const finalized = await tx.offboardCampaignRecipient.updateMany({
        where: { id: recipientId, finalNoticeStatus: 'sending', finalNoticeClaimId: claimId },
        data: {
          finalNoticeStatus: 'sent',
          finalNoticeSentAt: new Date(),
          finalNoticeMessageId: info.messageId || null,
          finalNoticeClaimId: null,
          finalNoticeClaimedUntil: null,
          finalNoticeError: null,
          lastError: null,
        },
      });
      if (finalized.count !== 1) throw new Error('Final-notice claim ownership was lost after SMTP delivery');
      await tx.offboardCampaign.update({
        where: { id: recipient.campaignId },
        data: { finalNoticeSentCount: { increment: 1 } },
      });
      await createCampaignLog(tx, {
        campaignId: recipient.campaignId,
        recipientId,
        eventType: 'direct_final_notice_sent',
        actor,
        message: `Completed-offboarding notice sent to ${recipient.email}`,
        details: { messageId: info.messageId || null },
      });
    });
    return 'sent';
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown final-notice delivery outcome';
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const uncertain = await tx.offboardCampaignRecipient.updateMany({
        where: { id: recipientId, finalNoticeStatus: 'sending', finalNoticeClaimId: claimId },
        data: {
          finalNoticeStatus: 'reconciliation_required',
          finalNoticeClaimId: null,
          finalNoticeClaimedUntil: null,
          finalNoticeError: message,
          lastError: 'Access was removed, but final notice delivery requires reconciliation',
        },
      });
      if (uncertain.count !== 1) return;
      await tx.offboardCampaign.update({
        where: { id: recipient.campaignId },
        data: { finalNoticeFailureCount: { increment: 1 } },
      });
      await createCampaignLog(tx, {
        campaignId: recipient.campaignId,
        recipientId,
        level: 'error',
        eventType: 'direct_final_notice_reconciliation_required',
        actor,
        message: `Final-notice delivery outcome is uncertain for ${recipient.email}`,
        details: { error: message },
      });
    });
    return 'reconciliation_required';
  }
}

async function markStaleEnforcementClaims(campaignId: string, now: Date, actor: string) {
  const stale = await prisma.offboardCampaignRecipient.findMany({
    where: { campaignId, status: 'enforcement_processing', enforcementClaimedUntil: { lte: now } },
    select: { id: true, adUsername: true, enforcementFailureCounted: true },
  });
  for (const recipient of stale) {
    let transitioned = false;
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const updated = await tx.offboardCampaignRecipient.updateMany({
        where: {
          id: recipient.id,
          campaignId,
          status: 'enforcement_processing',
          enforcementClaimedUntil: { lte: now },
        },
        data: {
          status: 'enforcement_reconciliation_required',
          enforcementClaimId: null,
          enforcementClaimedUntil: null,
          enforcementError: 'Enforcement lease expired after external effects may have started',
          enforcementFailureCounted: true,
          lastError: 'Operator evidence is required before enforcement can continue',
        },
      });
      if (updated.count !== 1) return;
      transitioned = true;
      if (!recipient.enforcementFailureCounted) {
        await tx.offboardCampaign.update({
          where: { id: campaignId },
          data: { failedCount: { increment: 1 } },
        });
      }
      await createCampaignLog(tx, {
        campaignId,
        recipientId: recipient.id,
        level: 'error',
        eventType: 'enforcement_claim_expired',
        actor,
        message: `Enforcement claim expired for ${recipient.adUsername}; reconciliation is required`,
      });
    });
    if (transitioned) {
      await syncDirectActivationRunOutcome(campaignId, recipient.id);
    }
  }
}

async function markAllStaleDirectEnforcementClaims(now: Date, actor: string) {
  const campaigns = await prisma.offboardCampaignRecipient.findMany({
    where: {
      status: 'enforcement_processing',
      enforcementClaimedUntil: { lte: now },
      campaign: { workflowMode: 'direct' },
    },
    distinct: ['campaignId'],
    select: { campaignId: true },
  });
  for (const campaign of campaigns) {
    await markStaleEnforcementClaims(campaign.campaignId, now, actor);
  }
}

async function syncDirectActivationRunOutcome(campaignId: string, recipientId: string): Promise<void> {
  const [campaign, recipient] = await Promise.all([
    prisma.offboardCampaign.findUnique({
      where: { id: campaignId },
      select: { workflowMode: true, activationOperationRunId: true },
    }),
    prisma.offboardCampaignRecipient.findUnique({
      where: { id: recipientId },
      select: {
        status: true,
        enforcedAt: true,
        finalNoticeStatus: true,
        finalNoticeSentAt: true,
        enforcementError: true,
        lastError: true,
      },
    }),
  ]);
  if (campaign?.workflowMode !== 'direct' || !campaign.activationOperationRunId || !recipient) return;

  const isPending = ['direct_pending', 'enforcement_processing'].includes(recipient.status)
    || (recipient.status === 'enforced' && ['pending', 'sending'].includes(recipient.finalNoticeStatus));
  const isUncertain = recipient.status === 'enforcement_reconciliation_required'
    || ['failed', 'reconciliation_required'].includes(recipient.finalNoticeStatus);
  const itemStatus = isUncertain
    ? 'reconciliation_required'
    : isPending
      ? 'pending'
      : ['enforced', 'enforcement_skipped'].includes(recipient.status)
        ? 'completed'
        : 'failed';

  await prisma.offboardOperationRunItem.updateMany({
    where: { runId: campaign.activationOperationRunId, recipientId },
    data: {
      status: itemStatus,
      outcome: operationJson({
        recipientStatus: recipient.status,
        enforcedAt: recipient.enforcedAt,
        finalNoticeStatus: recipient.finalNoticeStatus,
        finalNoticeSentAt: recipient.finalNoticeSentAt,
        error: recipient.enforcementError || recipient.lastError,
      }),
    },
  });

  const expiredRunClaim = await prisma.offboardOperationRun.updateMany({
    where: {
      id: campaign.activationOperationRunId,
      kind: 'activation',
      status: 'claimed',
      claimedUntil: { lte: new Date() },
    },
    data: {
      status: 'reconciliation_required',
      claimId: null,
      claimedUntil: null,
    },
  });

  const statuses = await prisma.offboardOperationRunItem.groupBy({
    by: ['status'],
    where: { runId: campaign.activationOperationRunId },
    _count: { status: true },
  });
  const counts = new Map(statuses.map(entry => [entry.status, entry._count.status]));
  const runStatus = expiredRunClaim.count > 0
    ? 'reconciliation_required'
    : (counts.get('reconciliation_required') || 0) > 0
    ? 'reconciliation_required'
    : (counts.get('failed') || 0) > 0
      ? 'failed'
      : ((counts.get('pending') || 0) + (counts.get('previewed') || 0)) > 0
        ? 'in_progress'
        : 'completed';
  await prisma.offboardOperationRun.updateMany({
    where: {
      id: campaign.activationOperationRunId,
      kind: 'activation',
      status: { not: 'claimed' },
    },
    data: { status: runStatus, claimedUntil: null },
  });
}

async function claimDirectRecipientWithVpnFence(params: {
  recipientId: string;
  campaignId: string;
  adUsername: string;
  accessRequestId: string | null;
  claimId: string;
  claimedAt: Date;
}) {
  const canonicalAdUsername = params.adUsername.trim().toLowerCase();
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$queryRaw<Array<{ lock_acquired: string }>>`
      SELECT 'locked'::text AS lock_acquired
      FROM pg_advisory_xact_lock(
        hashtextextended(${canonicalAdUsername}, ${VPN_IDENTITY_OFFBOARD_FENCE_LOCK_NAMESPACE})
      )
    `;
    const claim = await tx.offboardCampaignRecipient.updateMany({
      where: {
        id: params.recipientId,
        campaignId: params.campaignId,
        status: 'direct_pending',
        enforcementClaimId: null,
      },
      data: {
        status: 'enforcement_processing',
        enforcementClaimId: params.claimId,
        enforcementClaimedAt: params.claimedAt,
        enforcementClaimedUntil: new Date(params.claimedAt.getTime() + ENFORCEMENT_CLAIM_MS),
      },
    });
    if (claim.count !== 1) return claim;

    await tx.vpnIdentityOffboardFence.upsert({
      where: { canonicalAdUsername },
      create: {
        canonicalAdUsername,
        campaignId: params.campaignId,
        recipientId: params.recipientId,
        blockedAccessRequestId: params.accessRequestId,
      },
      update: {
        campaignId: params.campaignId,
        recipientId: params.recipientId,
        blockedAccessRequestId: params.accessRequestId,
      },
    });
    return claim;
  });
}

async function processDirectOffboarding(
  campaignId: string,
  actor: string,
  limit: number,
  controls: CampaignProcessControls = {},
) {
  const summary = {
    enforced: 0,
    skipped: 0,
    failed: 0,
    finalNoticesSent: 0,
    finalNoticesReconciliationRequired: 0,
    skippedBecausePaused: false,
  };

  const initialCampaign = await prisma.offboardCampaign.findUnique({ where: { id: campaignId } });
  if (!initialCampaign || initialCampaign.workflowMode !== 'direct' || initialCampaign.status !== 'active'
    || initialCampaign.cancelledAt || initialCampaign.emergencyStoppedAt) {
    return summary;
  }
  if ((initialCampaign.executionPaused || initialCampaign.enforcementPaused) && !controls.ignorePause) {
    summary.skippedBecausePaused = true;
    return summary;
  }

  const pendingNotices = await prisma.offboardCampaignRecipient.findMany({
    where: {
      campaignId,
      status: 'enforced',
      finalNoticeStatus: 'pending',
      finalNoticeSentAt: null,
      campaign: { workflowMode: 'direct' },
    },
    orderBy: { adUsername: 'asc' },
    take: limit,
    select: { id: true },
  });
  for (const recipient of pendingNotices) {
    const noticeGate = await prisma.offboardCampaign.findUnique({ where: { id: campaignId } });
    if (!noticeGate || noticeGate.status !== 'active' || noticeGate.cancelledAt || noticeGate.emergencyStoppedAt
      || ((noticeGate.executionPaused || noticeGate.enforcementPaused) && !controls.ignorePause)) {
      summary.skippedBecausePaused = true;
      break;
    }
    const notice = await deliverDirectOffboardFinalNotice(recipient.id, actor);
    if (notice === 'sent') summary.finalNoticesSent += 1;
    if (notice === 'reconciliation_required') summary.finalNoticesReconciliationRequired += 1;
    await syncDirectActivationRunOutcome(campaignId, recipient.id);
  }

  while (summary.enforced + summary.skipped + summary.failed < limit) {
    const campaign = await prisma.offboardCampaign.findUnique({ where: { id: campaignId } });
    if (!campaign || campaign.workflowMode !== 'direct' || campaign.status !== 'active'
      || campaign.cancelledAt || campaign.emergencyStoppedAt) {
      break;
    }
    if ((campaign.executionPaused || campaign.enforcementPaused) && !controls.ignorePause) {
      summary.skippedBecausePaused = true;
      break;
    }

    const now = new Date();
    await markStaleEnforcementClaims(campaignId, now, actor);

    const pending = await prisma.offboardCampaignRecipient.findMany({
      where: { campaignId, status: 'direct_pending', waveNumber: campaign.currentWave },
      orderBy: { adUsername: 'asc' },
      take: Math.max(1, limit - summary.enforced - summary.skipped - summary.failed),
    });
    if (pending.length === 0) {
      const currentWaveBlockers = await prisma.offboardCampaignRecipient.count({
        where: {
          campaignId,
          waveNumber: campaign.currentWave,
          OR: [
            { status: { in: ['direct_pending', 'enforcement_processing', 'enforcement_reconciliation_required'] } },
            {
              status: 'enforced',
              finalNoticeStatus: { in: ['pending', 'sending', 'failed', 'reconciliation_required'] },
            },
          ],
        },
      });
      if (currentWaveBlockers > 0) {
        break;
      }
      const nextRecipient = await prisma.offboardCampaignRecipient.findFirst({
        where: { campaignId, status: 'direct_pending' },
        orderBy: [{ waveNumber: 'asc' }, { adUsername: 'asc' }],
      });
      if (!nextRecipient) {
        if (!campaign.directExecutionCompletedAt) {
          await prisma.offboardCampaign.update({
            where: { id: campaignId },
            data: { directExecutionCompletedAt: new Date(), executionPaused: true },
          });
          await createCampaignLog(prisma, {
            campaignId,
            eventType: 'direct_execution_completed',
            actor,
            message: 'All direct-offboarding recipients reached an enforcement outcome',
          });
        }
        break;
      }
      const pauseAtBoundary = !controls.bypassWaveGates && campaign.pauseAfterEachWave;
      const advanced = await prisma.offboardCampaign.updateMany({
        where: {
          id: campaignId,
          currentWave: campaign.currentWave,
          executionPaused: false,
          enforcementPaused: false,
          status: 'active',
        },
        data: {
          currentWave: nextRecipient.waveNumber,
          ...(pauseAtBoundary ? { executionPaused: true } : {}),
        },
      });
      if (advanced.count !== 1) {
        continue;
      }
      await createCampaignLog(prisma, {
        campaignId,
        eventType: pauseAtBoundary ? 'direct_wave_paused' : 'direct_wave_advanced',
        actor,
        message: pauseAtBoundary
          ? `Direct offboarding paused before wave ${nextRecipient.waveNumber}`
          : `Direct offboarding advanced to wave ${nextRecipient.waveNumber}`,
        details: { nextWave: nextRecipient.waveNumber },
      });
      if (pauseAtBoundary) {
        summary.skippedBecausePaused = true;
        break;
      }
      continue;
    }

    for (const recipient of pending) {
      const claimGate = await prisma.offboardCampaign.findUnique({
        where: { id: campaignId },
        select: {
          status: true,
          workflowMode: true,
          currentWave: true,
          executionPaused: true,
          enforcementPaused: true,
          cancelledAt: true,
          emergencyStoppedAt: true,
        },
      });
      if (
        !claimGate
        || claimGate.workflowMode !== 'direct'
        || claimGate.status !== 'active'
        || claimGate.currentWave !== recipient.waveNumber
        || claimGate.cancelledAt
        || claimGate.emergencyStoppedAt
        || ((claimGate.executionPaused || claimGate.enforcementPaused) && !controls.ignorePause)
      ) {
        summary.skippedBecausePaused = Boolean(claimGate?.executionPaused || claimGate?.enforcementPaused);
        break;
      }
      const claimId = crypto.randomUUID();
      const claimedAt = new Date();
      const claim = await claimDirectRecipientWithVpnFence({
        recipientId: recipient.id,
        campaignId,
        adUsername: recipient.adUsername,
        accessRequestId: recipient.accessRequestId,
        claimId,
        claimedAt,
      });
      if (claim.count !== 1) continue;
      const result = await enforceRecipient(recipient.id, claimId, actor, controls);
      if (result === 'enforced') {
        summary.enforced += 1;
        const notice = await deliverDirectOffboardFinalNotice(recipient.id, actor);
        if (notice === 'sent') summary.finalNoticesSent += 1;
        if (notice === 'reconciliation_required') summary.finalNoticesReconciliationRequired += 1;
      } else if (result === 'skipped') {
        summary.skipped += 1;
      } else {
        summary.failed += 1;
      }
      await syncDirectActivationRunOutcome(campaignId, recipient.id);
      if (summary.enforced + summary.skipped + summary.failed >= limit) break;
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
  await markStaleEnforcementClaims(campaignId, now, actor);
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
      enforcementClaimId: null,
    },
    orderBy: { deadlineAt: 'asc' },
    take: limit,
  });

  for (const recipient of recipients) {
    const claimId = crypto.randomUUID();
    const claim = await prisma.offboardCampaignRecipient.updateMany({
      where: {
        id: recipient.id,
        status: 'sent',
        verifiedAt: null,
        enforcedAt: null,
        deadlineAt: deadlineWindow,
        enforcementClaimedAt: null,
        enforcementClaimId: null,
      },
      data: {
        status: 'enforcement_processing',
        enforcementClaimedAt: new Date(),
        enforcementClaimId: claimId,
        enforcementClaimedUntil: new Date(Date.now() + ENFORCEMENT_CLAIM_MS),
      },
    });

    if (claim.count !== 1) {
      continue;
    }

    const result = await enforceRecipient(recipient.id, claimId, actor, controls);
    if (result === 'enforced') summary.enforced += 1;
    else if (result === 'skipped') summary.skipped += 1;
    else summary.failed += 1;
  }

  return summary;
}

type LiveEnforcementPlan = {
  skipReason: string | null;
  adActionRequired: boolean;
  vpnActionRequired: boolean;
};

async function findLiveVpnCandidates(adUsername: string) {
  return prisma.vPNAccount.findMany({
    where: {
      status: { notIn: ['revoked', 'disabled'] },
      OR: [
        { adUsername: { equals: adUsername, mode: 'insensitive' } },
        { username: { equals: adUsername, mode: 'insensitive' } },
      ],
    },
    select: { id: true },
    take: 2,
  });
}

async function liveEnforcementPlan(recipient: CampaignRecipientWithCampaign): Promise<LiveEnforcementPlan> {
  const userInfo = await searchLDAPUser(recipient.adUsername);
  if (!userInfo) {
    return { skipReason: 'no_longer_in_ldap_scope', adActionRequired: false, vpnActionRequired: false };
  }

  const liveEmail = getAttribute(userInfo.attributes, 'mail');
  if (normalize(liveEmail) !== normalize(recipient.email)) {
    return { skipReason: 'email_changed_before_enforcement', adActionRequired: false, vpnActionRequired: false };
  }

  const adActionRequired = isLdapAccountEnabledFromUac(getAttribute(userInfo.attributes, 'userAccountControl'));
  if (!adActionRequired && recipient.campaign.workflowMode !== 'direct') {
    return { skipReason: 'ad_account_already_disabled', adActionRequired: false, vpnActionRequired: false };
  }

  if (isAdminGroupMember(
    getAttributeValues(userInfo.attributes, 'memberOf'),
    await validateAdminGroupConfiguration(),
  )) {
    return { skipReason: 'became_admin_group_member', adActionRequired: false, vpnActionRequired: false };
  }

  if (recipient.campaign.workflowMode === 'direct') {
    const liveObjectGuid = getAttribute(userInfo.attributes, 'objectGUID');
    if (!recipient.targetDirectoryObjectGuid || liveObjectGuid !== recipient.targetDirectoryObjectGuid || userInfo.objectName !== recipient.adDn) {
      return { skipReason: 'directory_identity_changed_before_direct_offboarding', adActionRequired: false, vpnActionRequired: false };
    }
    if (!recipient.accessRequestId || recipient.expectedRequestVersion === null) {
      return { skipReason: 'missing_reviewed_request_identity', adActionRequired: false, vpnActionRequired: false };
    }
    const request = await prisma.accessRequest.findUnique({
      where: { id: recipient.accessRequestId },
      select: { status: true, version: true },
    });
    if (!request || request.status !== 'approved' || request.version !== recipient.expectedRequestVersion) {
      return { skipReason: 'request_state_changed_before_direct_offboarding', adActionRequired: false, vpnActionRequired: false };
    }
  }

  let vpnActionRequired = false;
  if (recipient.campaign.workflowMode === 'direct') {
    const liveCandidates = await findLiveVpnCandidates(recipient.adUsername);
    if (liveCandidates.length > 1) {
      return { skipReason: 'multiple_live_vpn_accounts_linked_to_ad_username', adActionRequired: false, vpnActionRequired: false };
    }
    if (!recipient.linkedVpnUsername && liveCandidates.length > 0) {
      return { skipReason: 'vpn_link_appeared_before_direct_offboarding', adActionRequired: false, vpnActionRequired: false };
    }
    if (liveCandidates.length === 1 && liveCandidates[0].id !== recipient.vpnAccountId) {
      return { skipReason: 'vpn_identity_changed_before_direct_offboarding', adActionRequired: false, vpnActionRequired: false };
    }
  }
  if (recipient.linkedVpnUsername) {
    const vpn = await prisma.vPNAccount.findUnique({
      where: { username: recipient.linkedVpnUsername },
      select: { id: true, status: true, adUsername: true },
    });

    if (!vpn) {
      return { skipReason: 'linked_vpn_missing_before_enforcement', adActionRequired: false, vpnActionRequired: false };
    }
    if (vpn.status === 'revoked' || vpn.status === 'disabled') {
      if (recipient.campaign.workflowMode !== 'direct') {
        return { skipReason: 'vpn_account_already_revoked_or_disabled', adActionRequired: false, vpnActionRequired: false };
      }
    } else {
      vpnActionRequired = true;
    }
    if (vpn.adUsername && normalize(vpn.adUsername) !== normalize(recipient.adUsername)) {
      return { skipReason: 'vpn_link_changed_before_enforcement', adActionRequired: false, vpnActionRequired: false };
    }
    if (recipient.campaign.workflowMode === 'direct' && vpn.id !== recipient.vpnAccountId) {
      return { skipReason: 'vpn_identity_changed_before_direct_offboarding', adActionRequired: false, vpnActionRequired: false };
    }
  }

  return { skipReason: null, adActionRequired, vpnActionRequired };
}

async function enforceRecipient(
  recipientId: string,
  claimId: string,
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
  if (recipient.status !== 'enforcement_processing' || recipient.enforcementClaimId !== claimId) {
    return 'failed';
  }

  if (
    recipient.campaign.status !== 'active' ||
    (recipient.campaign.workflowMode === 'direct' && recipient.campaign.executionPaused && !controls.ignorePause) ||
    (recipient.campaign.enforcementPaused && !controls.ignorePause) ||
    recipient.campaign.cancelledAt ||
    recipient.campaign.emergencyStoppedAt
  ) {
    await prisma.offboardCampaignRecipient.updateMany({
      where: { id: recipientId, status: 'enforcement_processing', enforcementClaimId: claimId },
      data: {
        status: recipient.campaign.workflowMode === 'direct' ? 'direct_pending' : 'sent',
        enforcementClaimedAt: null,
        enforcementClaimId: null,
        enforcementClaimedUntil: null,
      },
    });
    return 'skipped';
  }

  try {
    const enforcementPlan = await liveEnforcementPlan(recipient);
    const { skipReason } = enforcementPlan;
    if (skipReason) {
      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const skipped = await tx.offboardCampaignRecipient.updateMany({
          where: { id: recipientId, status: 'enforcement_processing', enforcementClaimId: claimId },
          data: {
            status: 'enforcement_skipped',
            enforcementSkippedAt: new Date(),
            skipReason,
            enforcementClaimId: null,
            enforcementClaimedUntil: null,
            ...(recipient.campaign.workflowMode === 'direct' ? { finalNoticeStatus: 'not_applicable' } : {}),
          },
        });
        if (skipped.count !== 1) throw new Error('Enforcement claim ownership was lost before skip finalization');
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

    const vpnModuleEnabled = recipient.campaign.workflowMode === 'direct'
      ? await isModuleEnabledStrict('vpn.management')
      : await isModuleEnabled('vpn.management');
    if (recipient.campaign.workflowMode === 'direct' && recipient.linkedVpnUsername && !vpnModuleEnabled) {
      throw new Error('VPN management became disabled after the reviewed direct-offboarding preview');
    }
    const expectsAdAction = enforcementPlan.adActionRequired;
    const expectsVpnAction = vpnModuleEnabled && enforcementPlan.vpnActionRequired;
    const expectationRecorded = await prisma.offboardCampaignRecipient.updateMany({
      where: { id: recipientId, status: 'enforcement_processing', enforcementClaimId: claimId },
      data: { enforcementExpectedAd: expectsAdAction, enforcementExpectedVpn: expectsVpnAction },
    });
    if (expectationRecorded.count !== 1) throw new Error('Enforcement claim ownership was lost before action planning');

    const actionResults: LifecycleProcessSummary[] = [];
    const directReason = recipient.campaign.workflowMode === 'direct'
      ? `Direct offboarding ${recipient.campaign.name}: ${recipient.campaign.directOffboardReason} [${recipient.campaign.directOffboardReference}]`
      : null;
    let adAction: LifecycleProcessSummary | null = null;
    if (expectsAdAction) {
      adAction = await createAndProcessCampaignLifecycleAction({
        recipient,
        actionType: 'disable_ad',
        targetAccountType: 'AD',
        targetUsername: recipient.adUsername,
        targetUserId: recipient.accessRequestId,
        reason: directReason || `Offboard campaign ${recipient.campaign.name}: unverified by campaign deadline`,
        actor,
        idempotencyKey: `offboard-enforcement:${recipient.id}:disable-ad`,
      });
      actionResults.push(adAction);
      const adActionRecorded = await prisma.offboardCampaignRecipient.updateMany({
        where: { id: recipientId, status: 'enforcement_processing', enforcementClaimId: claimId },
        data: { adLifecycleActionId: adAction.actionId },
      });
      if (adActionRecorded.count !== 1) throw new Error('Enforcement claim ownership was lost after AD action');
    }

    let vpnAction: LifecycleProcessSummary | null = null;
    // VPN revocation only runs while VPN management is enabled; campaigns
    // degrade to AD-only enforcement and record the skip.
    if (expectsVpnAction && recipient.linkedVpnUsername) {
      vpnAction = await createAndProcessCampaignLifecycleAction({
        recipient,
        actionType: 'revoke_vpn',
        targetAccountType: 'VPN',
        targetUsername: recipient.linkedVpnUsername,
        targetUserId: recipient.vpnAccountId,
        reason: directReason || `Offboard campaign ${recipient.campaign.name}: linked AD user unverified by campaign deadline`,
        actor,
        idempotencyKey: `offboard-enforcement:${recipient.id}:revoke-vpn`,
      });
      actionResults.push(vpnAction);
      const vpnActionRecorded = await prisma.offboardCampaignRecipient.updateMany({
        where: { id: recipientId, status: 'enforcement_processing', enforcementClaimId: claimId },
        data: { vpnLifecycleActionId: vpnAction.actionId },
      });
      if (vpnActionRecorded.count !== 1) throw new Error('Enforcement claim ownership was lost after VPN action');
    }

    if (recipient.campaign.workflowMode === 'direct') {
      const remainingLiveVpn = await findLiveVpnCandidates(recipient.adUsername);
      if (remainingLiveVpn.length > 0) {
        throw new Error('Live VPN access remains or appeared after the reviewed revocation step; reconciliation is required');
      }
    }

    const allSucceeded = actionResults.every(result => result.success);
    if (allSucceeded) {
      const sessionResult = await revokeUserSessionsEverywhere(recipient.adUsername, {
        actor,
        actorType: 'system',
        reason: 'offboard_enforcement',
      });
      if (sessionResult.providerLogoutsReconciliationRequired > 0) {
        throw new Error(`${sessionResult.providerLogoutsReconciliationRequired} provider logout(s) require reconciliation`);
      }
    }
    const enforcedAt = new Date();
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const requestMarkedOffboarded = allSucceeded
        ? await markAccessRequestOffboardedByCampaign(tx, recipient, actor, enforcedAt, {
            confirmedAdDisabled: recipient.campaign.workflowMode === 'direct' && !enforcementPlan.adActionRequired,
          })
        : false;
      if (allSucceeded && recipient.campaign.workflowMode === 'direct' && !requestMarkedOffboarded) {
        throw new Error('Portal request changed after external access removal; reconciliation is required');
      }

      const finalized = await tx.offboardCampaignRecipient.updateMany({
        where: { id: recipientId, status: 'enforcement_processing', enforcementClaimId: claimId },
        data: {
          status: allSucceeded ? 'enforced' : 'enforcement_reconciliation_required',
          enforcedAt: allSucceeded ? enforcedAt : null,
          enforcementError: allSucceeded ? null : actionResults.filter(result => !result.success).map(result => result.error).join('; '),
          adLifecycleActionId: adAction?.actionId || null,
          vpnLifecycleActionId: vpnAction?.actionId || null,
          enforcementClaimId: null,
          enforcementClaimedUntil: null,
          enforcementFailureCounted: !allSucceeded,
        },
      });
      if (finalized.count !== 1) throw new Error('Enforcement claim ownership was lost during finalization');

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

    if (allSucceeded) return 'enforced';

    return 'failed';
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown enforcement failure';
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const reconciled = await tx.offboardCampaignRecipient.updateMany({
        where: { id: recipientId, status: 'enforcement_processing', enforcementClaimId: claimId },
        data: {
          status: 'enforcement_reconciliation_required',
          enforcementError: message,
          lastError: message,
          enforcementClaimId: null,
          enforcementClaimedUntil: null,
          enforcementFailureCounted: true,
        },
      });
      if (reconciled.count !== 1) return;
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
  recipient: CampaignRecipientWithCampaign;
  actionType: string;
  targetAccountType: string;
  targetUsername: string;
  targetUserId?: string | null;
  reason: string;
  actor: string;
  idempotencyKey?: string;
}): Promise<LifecycleProcessSummary> {
  if (params.idempotencyKey) {
    const existing = await prisma.accountLifecycleAction.findUnique({
      where: { idempotencyKey: params.idempotencyKey },
      select: { id: true, status: true, errorMessage: true },
    });
    if (existing) {
      if (existing.status === 'completed') {
        return { actionId: existing.id, success: true };
      }
      if (existing.status === 'queued') {
        const resumed = await processLifecycleAction(existing.id);
        return { actionId: existing.id, success: resumed.success, error: resumed.error };
      }
      return {
        actionId: existing.id,
        success: false,
        error: existing.errorMessage || `Existing lifecycle action is ${existing.status}`,
      };
    }
  }

  const requiresDirectoryEvidence = ['disable_ad', 'enable_ad', 'disable_both', 'enable_both']
    .includes(params.actionType);
  let directoryEvidence: {
    targetDirectoryDn: string;
    targetDirectoryObjectGuid: string;
    preflightSnapshot: Prisma.InputJsonObject;
    policyVersion: string;
  } | null = null;
  if (requiresDirectoryEvidence) {
    const relatedRequestId = params.recipient.accessRequestId;
    if (!relatedRequestId) {
      throw new Error(`Campaign lifecycle action for ${params.targetUsername} has no portal request owner`);
    }
    const allowedStatuses = ['enable_ad', 'enable_both'].includes(params.actionType)
      ? ['approved', 'offboarded']
      : ['approved'];
    const owners = await prisma.accessRequest.findMany({
      where: {
        AND: [{ OR: [
          { ldapUsername: { equals: params.targetUsername, mode: 'insensitive' } },
          { linkedAdUsername: { equals: params.targetUsername, mode: 'insensitive' } },
        ] }, { OR: [
          { provisioningState: null },
          { provisioningState: { in: [...LIFECYCLE_READY_NON_NULL_PROVISIONING_STATES] } },
        ] }],
        status: { in: allowedStatuses },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 2,
      select: { id: true, version: true },
    });
    if (owners.length !== 1 || owners[0].id !== relatedRequestId) {
      throw new Error(`Campaign lifecycle action for ${params.targetUsername} has ambiguous portal ownership`);
    }
    const directoryUser = await searchLDAPUser(params.targetUsername);
    if (!directoryUser) {
      throw new Error(`Campaign lifecycle target ${params.targetUsername} no longer exists in LDAP`);
    }
    const liveUsername = getAttribute(directoryUser.attributes, 'sAMAccountName');
    const objectGuid = getAttribute(directoryUser.attributes, 'objectGUID');
    const rawUac = getAttribute(directoryUser.attributes, 'userAccountControl');
    if (
      normalize(liveUsername) !== normalize(params.targetUsername)
      || !directoryUser.objectName
      || !objectGuid
      || !rawUac
      || !/^\d+$/.test(rawUac)
    ) {
      throw new Error(`Campaign lifecycle target ${params.targetUsername} lacks immutable directory identity evidence`);
    }
    if (params.recipient.campaign.workflowMode === 'direct' && (
      !params.recipient.adDn
      || !params.recipient.targetDirectoryObjectGuid
      || owners[0].version !== params.recipient.expectedRequestVersion
      || directoryUser.objectName.toLowerCase() !== params.recipient.adDn.toLowerCase()
      || objectGuid !== params.recipient.targetDirectoryObjectGuid
    )) {
      throw new Error(`Campaign lifecycle target ${params.targetUsername} no longer matches the reviewed directory object`);
    }
    const targetDirectoryDn = params.recipient.campaign.workflowMode === 'direct'
      ? params.recipient.adDn!
      : directoryUser.objectName;
    const targetDirectoryObjectGuid = params.recipient.campaign.workflowMode === 'direct'
      ? params.recipient.targetDirectoryObjectGuid!
      : objectGuid;
    directoryEvidence = {
      targetDirectoryDn,
      targetDirectoryObjectGuid,
      preflightSnapshot: {
        relatedRequestId,
        requestVersion: params.recipient.campaign.workflowMode === 'direct'
          ? params.recipient.expectedRequestVersion
          : owners[0].version,
        dn: targetDirectoryDn,
        username: liveUsername,
        objectGuid: targetDirectoryObjectGuid,
        userAccountControl: Number(rawUac),
        enabled: isLdapAccountEnabledFromUac(rawUac),
        observedAt: new Date().toISOString(),
        bindingMode: 'portal_request_and_object_guid',
      },
      policyVersion: 'governed-directory-identity-v1',
    };
  }

  const action = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const created = await tx.accountLifecycleAction.create({
      data: {
        actionType: params.actionType,
        targetAccountType: params.targetAccountType,
        targetUsername: params.targetUsername,
        targetUserId: params.targetUserId || null,
        status: 'queued',
        reason: params.reason,
        requestedBy: 'offboard-campaign',
        requestedAt: new Date(),
        relatedRequestId: params.recipient.accessRequestId || null,
        offboardCampaignId: params.recipient.campaignId,
        offboardRecipientId: params.recipient.id,
        offboardOperationRunId: params.recipient.campaign.activationOperationRunId || null,
        idempotencyKey: params.idempotencyKey,
        ...(directoryEvidence || {}),
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
        newStatus: 'queued',
        details: JSON.stringify({
          offboardCampaignId: params.recipient.campaignId,
          offboardRecipientId: params.recipient.id,
          offboardOperationRunId: params.recipient.campaign.activationOperationRunId || null,
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

export async function reconcileOffboardEnforcement(params: {
  campaignId: string;
  recipientId: string;
  actor: string;
  resolution: 'not_applied' | 'verified_complete';
  evidence: string;
}) {
  const evidence = params.evidence.trim();
  if (evidence.length < 10) {
    throw new Error('Reconciliation evidence must contain at least 10 characters');
  }

  const recipient = await prisma.offboardCampaignRecipient.findUnique({
    where: { id: params.recipientId },
    include: { campaign: true },
  });
  if (!recipient || recipient.campaignId !== params.campaignId) {
    throw new Error('Offboard recipient not found');
  }
  if (recipient.status !== 'enforcement_reconciliation_required') {
    throw new Error('Only enforcement_reconciliation_required recipients can be reconciled');
  }

  // Query the relation, not only the denormalized IDs: a crash can happen
  // after an action row is created but before its ID is copied to recipient.
  const actions = await prisma.accountLifecycleAction.findMany({
    where: { offboardRecipientId: recipient.id },
    select: { id: true, status: true, actionType: true },
  });
  const completedActions = actions.filter((action) => action.status === 'completed');
  const providerTasks = await prisma.providerLogoutTask.findMany({
    where: { username: recipient.adUsername },
    select: { id: true, status: true },
  });
  const liveSessionCount = await prisma.session.count({ where: { username: recipient.adUsername } });
  if (params.resolution === 'not_applied' && (actions.length > 0 || providerTasks.length > 0)) {
    throw new Error('Durable lifecycle or provider-logout evidence exists; this enforcement cannot be certified as not applied');
  }
  if (params.resolution === 'verified_complete' && completedActions.length !== actions.length) {
    throw new Error('Every recorded lifecycle action must be completed before enforcement can be certified complete');
  }
  if (params.resolution === 'verified_complete') {
    if (recipient.enforcementExpectedAd !== false && !completedActions.some((action) => action.actionType === 'disable_ad')) {
      throw new Error('A completed AD-disable lifecycle action is required before enforcement can be certified complete');
    }
    if (recipient.enforcementExpectedVpn && !completedActions.some((action) => action.actionType === 'revoke_vpn')) {
      throw new Error('A completed VPN-revoke lifecycle action is required before enforcement can be certified complete');
    }
    if (providerTasks.some((task) => task.status !== 'completed')) {
      throw new Error('Every provider logout task must be completed before enforcement can be certified complete');
    }
    if (liveSessionCount > 0) {
      throw new Error('Live portal sessions remain; enforcement cannot be certified complete');
    }
  }

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const now = new Date();
    if (params.resolution === 'verified_complete') {
      const requestMarked = await markAccessRequestOffboardedByCampaign(tx, recipient, params.actor, now, {
        confirmedAdDisabled: recipient.campaign.workflowMode === 'direct' && recipient.enforcementExpectedAd === false,
      });
      if (recipient.campaign.workflowMode === 'direct' && !requestMarked) {
        throw new Error('Portal request changed after external access removal; keep this recipient in reconciliation');
      }
    }

    const updated = await tx.offboardCampaignRecipient.updateMany({
      where: {
        id: params.recipientId,
        campaignId: params.campaignId,
        status: 'enforcement_reconciliation_required',
      },
      data: params.resolution === 'not_applied'
        ? {
            status: recipient.campaign.workflowMode === 'direct' ? 'direct_pending' : 'sent',
            enforcementClaimedAt: null,
            enforcementClaimId: null,
            enforcementClaimedUntil: null,
            enforcementError: null,
            enforcementFailureCounted: false,
            lastError: `Retry authorized by ${params.actor}: ${evidence}`,
          }
        : {
            status: 'enforced',
            enforcedAt: now,
            enforcementClaimedAt: null,
            enforcementClaimId: null,
            enforcementClaimedUntil: null,
            enforcementError: null,
            enforcementFailureCounted: false,
            lastError: null,
          },
    });
    if (updated.count !== 1) throw new Error('Offboard enforcement reconciliation conflict');

    await tx.offboardCampaign.update({
      where: { id: params.campaignId },
      data: {
        ...(recipient.enforcementFailureCounted ? { failedCount: { decrement: 1 } } : {}),
        ...(params.resolution === 'verified_complete' ? { enforcedCount: { increment: 1 } } : {}),
      },
    });
    await createCampaignLog(tx, {
      campaignId: params.campaignId,
      recipientId: params.recipientId,
      eventType: `enforcement_reconciled_${params.resolution}`,
      actor: params.actor,
      message: params.resolution === 'verified_complete'
        ? `Operator certified enforcement complete for ${recipient.adUsername}`
        : `Operator certified no enforcement effects for ${recipient.adUsername}; retry is re-armed`,
      details: { resolution: params.resolution, evidence },
    });
  });

  await syncDirectActivationRunOutcome(params.campaignId, params.recipientId);

  return getOffboardCampaign(params.campaignId);
}

export async function reconcileOffboardFinalNotice(params: {
  campaignId: string;
  recipientId: string;
  actor: string;
  resolution: 'not_delivered' | 'verified_delivered';
  evidence: string;
}) {
  const evidence = params.evidence.trim();
  if (evidence.length < 10) {
    throw new Error('Final-notice reconciliation evidence must contain at least 10 characters');
  }
  const recipient = await prisma.offboardCampaignRecipient.findUnique({
    where: { id: params.recipientId },
    include: { campaign: true },
  });
  if (!recipient || recipient.campaignId !== params.campaignId) throw new Error('Offboard recipient not found');
  if (recipient.campaign.workflowMode !== 'direct' || recipient.status !== 'enforced') {
    throw new Error('Final-notice reconciliation is available only after direct offboarding completed');
  }
  if (recipient.finalNoticeStatus !== 'reconciliation_required') {
    throw new Error('Only reconciliation_required final notices can be reconciled');
  }

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const updated = await tx.offboardCampaignRecipient.updateMany({
      where: {
        id: params.recipientId,
        campaignId: params.campaignId,
        status: 'enforced',
        finalNoticeStatus: 'reconciliation_required',
      },
      data: params.resolution === 'not_delivered'
        ? {
            finalNoticeStatus: 'pending',
            finalNoticeClaimedAt: null,
            finalNoticeClaimId: null,
            finalNoticeClaimedUntil: null,
            finalNoticeError: null,
            lastError: `Final-notice retry authorized by ${params.actor}: ${evidence}`,
          }
        : {
            finalNoticeStatus: 'sent',
            finalNoticeSentAt: new Date(),
            finalNoticeClaimedAt: null,
            finalNoticeClaimId: null,
            finalNoticeClaimedUntil: null,
            finalNoticeError: null,
            lastError: null,
          },
    });
    if (updated.count !== 1) throw new Error('Final-notice reconciliation conflict');
    await tx.offboardCampaign.update({
      where: { id: params.campaignId },
      data: {
        finalNoticeFailureCount: { decrement: 1 },
        ...(params.resolution === 'verified_delivered' ? { finalNoticeSentCount: { increment: 1 } } : {}),
      },
    });
    await createCampaignLog(tx, {
      campaignId: params.campaignId,
      recipientId: params.recipientId,
      eventType: `direct_final_notice_reconciled_${params.resolution}`,
      actor: params.actor,
      message: params.resolution === 'verified_delivered'
        ? `Operator verified final notice delivery for ${recipient.email}`
        : `Operator verified final notice was not delivered for ${recipient.email}; retry is re-armed`,
      details: { resolution: params.resolution, evidence },
    });
  });
  if (params.resolution === 'not_delivered') {
    await deliverDirectOffboardFinalNotice(params.recipientId, params.actor);
  }
  await syncDirectActivationRunOutcome(params.campaignId, params.recipientId);
  await completeCampaignIfFinished(params.campaignId);
  return getOffboardCampaign(params.campaignId);
}

async function recreateMissingVpnAccountForVerificationRecovery(recipient: CampaignRecipientWithCampaign, actor: string): Promise<boolean> {
  const linkedVpnUsername = recipient.linkedVpnUsername;
  if (!linkedVpnUsername) {
    return false;
  }

  const existing = await prisma.vPNAccount.findUnique({
    where: { username: linkedVpnUsername },
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
    throw new Error(`Cannot recreate missing VPN account ${linkedVpnUsername}: password snapshot is unavailable`);
  }

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const vpnAccount = await tx.vPNAccount.create({
      data: {
        username: linkedVpnUsername,
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
        liveAccountId: vpnAccount.id,
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

async function recoverVerifiedRecipientAccess(recipient: CampaignRecipientWithCampaign, actor: string) {
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

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
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
  if (campaign.workflowMode !== 'verification') {
    throw new Error('Direct offboarding cannot be extended or converted into a verification campaign');
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
    (await isModuleEnabled('vpn.management')) &&
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
  if (recipient.campaign.workflowMode !== 'verification') {
    throw new Error('Direct-offboarding records cannot be verified or reactivated');
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
  if (recipient.campaign.workflowMode !== 'verification') {
    throw new Error('Direct-offboarding records cannot be verified or reactivated');
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

  const updated = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
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
    where: campaign.workflowMode === 'direct'
      ? {
          campaignId,
          OR: [
            { status: { in: ['dry_run_ready', 'direct_pending', 'enforcement_processing', 'enforcement_reconciliation_required'] } },
            { finalNoticeStatus: { in: ['pending', 'sending', 'reconciliation_required'] } },
          ],
        }
      : {
          campaignId,
          status: {
            in: ['dry_run_ready', 'pending_send', 'email_sending', 'sent', 'enforcement_processing', 'enforcement_reconciliation_required'],
          },
        },
  });

  if (remaining === 0) {
    const exceptionCount = await prisma.offboardCampaignRecipient.count({
      where: {
        campaignId,
        OR: [
          { status: { in: ['skipped', 'enforcement_skipped', 'enforcement_failed'] } },
          { finalNoticeStatus: 'failed' },
        ],
      },
    });
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.offboardCampaign.update({
        where: { id: campaignId },
        data: {
          status: exceptionCount > 0 ? 'completed_with_exceptions' : 'completed',
          completedAt: new Date(),
          activeLockKey: null,
          sendingPaused: true,
          remindersPaused: true,
          enforcementPaused: true,
          executionPaused: true,
        },
      });
      await createCampaignLog(tx, {
        campaignId,
        eventType: exceptionCount > 0 ? 'campaign_completed_with_exceptions' : 'campaign_completed',
        actor: 'system',
        message: exceptionCount > 0
          ? `Campaign completed with ${exceptionCount} recipient exception${exceptionCount === 1 ? '' : 's'}`
          : 'Campaign completed because all recipients reached a terminal state',
        details: { exceptionCount, workflowMode: campaign.workflowMode },
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
    let currentAdStatus: string | null = null;
    let currentRequestStatus: string | null = null;
    let currentVpnStatus: string | null = null;

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
      currentAdStatus = request?.adAccountStatus ?? null;
      currentRequestStatus = request?.status ?? null;
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
      currentVpnStatus = vpn?.status ?? null;
    }

    items.push({
      recipientId: recipient.id,
      adUsername: recipient.adUsername,
      linkedVpnUsername: recipient.linkedVpnUsername,
      actions,
      conflicts,
      rollbackable: actions.length > 0 && conflicts.length === 0,
      recipientUpdatedAt: recipient.updatedAt.toISOString(),
      recipientStatus: recipient.status,
      rollbackStatus: recipient.rollbackStatus,
      currentAdStatus,
      currentRequestStatus,
      currentVpnStatus,
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

export async function executeOffboardRollback(campaignId: string, actor: string, operationRun?: { id: string; items: Array<{ recipientId: string | null; actions: unknown; conflicts: unknown }> }) {
  const campaign = await prisma.offboardCampaign.findUnique({ where: { id: campaignId } });
  if (!campaign) {
    throw new Error('Campaign not found');
  }

  const preview = operationRun
    ? {
        campaignId,
        total: operationRun.items.length,
        rollbackable: operationRun.items.filter(item => jsonArray(item.actions).length > 0 && jsonArray(item.conflicts).length === 0).length,
        conflicts: operationRun.items.filter(item => jsonArray(item.conflicts).length > 0).length,
        items: operationRun.items.map(item => ({
          recipientId: item.recipientId || '',
          adUsername: '',
          linkedVpnUsername: null,
          actions: jsonArray(item.actions),
          conflicts: jsonArray(item.conflicts),
          rollbackable: jsonArray(item.actions).length > 0 && jsonArray(item.conflicts).length === 0,
        })),
      }
    : await previewOffboardRollback(campaignId);

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
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
      if (operationRun) {
        await prisma.offboardOperationRunItem.updateMany({
          where: { runId: operationRun.id, recipientId: recipient.id },
          data: { status: 'skipped', outcome: { reason: item.conflicts.join('; ') || 'No rollback action available' } },
        });
      }
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
          idempotencyKey: operationRun ? `${operationRun.id}:${recipient.id}:enable_ad` : undefined,
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
          idempotencyKey: operationRun ? `${operationRun.id}:${recipient.id}:restore_vpn` : undefined,
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

      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
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
      if (operationRun) {
        await prisma.offboardOperationRunItem.updateMany({
          where: { runId: operationRun.id, recipientId: recipient.id },
          data: {
            status: allSucceeded ? 'completed' : 'reconciliation_required',
            outcome: operationJson({ results, requestStatusRestored: allSucceeded }),
          },
        });
      }
    } catch (error) {
      failureCount += 1;
      const message = error instanceof Error ? error.message : 'Unknown rollback failure';
      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
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
      if (operationRun) {
        await prisma.offboardOperationRunItem.updateMany({
          where: { runId: operationRun.id, recipientId: recipient.id },
          data: { status: 'reconciliation_required', outcome: operationJson({ error: message }) },
        });
      }
    }
  }

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
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
