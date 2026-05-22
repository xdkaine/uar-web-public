import { prisma } from '@/lib/prisma';
import type {
  AccessRequest,
  AccountActivationToken,
  ADAccountActivityLog,
  ADAccountMatch,
  AuditLog as PrismaAuditLog,
  PasswordResetToken,
  Prisma,
  RequestComment,
  VPNAccountActivityLog,
  VPNAccountStatusLog,
} from '@prisma/client';
import {
  AuditActions,
  AuditActorType,
  AuditEventKind,
  AuditOutcome,
  logAuditAction,
  sanitizeAuditDetails,
} from '@/lib/audit-log';
import type { ActionHistoryItem, ActionHistoryResponse } from '@/types/api';

type HistoryQuery = {
  search?: string | null;
  requestId?: string | null;
  subjectUsername?: string | null;
  subjectEmail?: string | null;
  vpnAccountId?: string | null;
  includeReads?: boolean;
  eventKind?: string | null;
  outcome?: string | null;
  page?: number;
  limit?: number;
};

type HistorySubjects = {
  requestIds: string[];
  usernames: string[];
  emails: string[];
  vpnAccountIds: string[];
};

type LifecycleActionWithHistory = Prisma.AccountLifecycleActionGetPayload<{
  include: { history: true };
}>;

type OffboardRecipientWithLogs = Prisma.OffboardCampaignRecipientGetPayload<{
  include: { logs: true };
}>;

const INSENSITIVE = 'insensitive' as const;

type LogHistoryEventInput = {
  action: string;
  category: string;
  username?: string;
  actorType?: AuditActorType;
  targetId?: string | null;
  targetType?: string | null;
  subjectUsername?: string | null;
  subjectEmail?: string | null;
  relatedRequestId?: string | null;
  relatedVpnAccountId?: string | null;
  relatedLifecycleActionId?: string | null;
  eventKind?: AuditEventKind;
  outcome?: AuditOutcome;
  success?: boolean;
  errorMessage?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  correlationId?: string | null;
};

function normalized(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed || null;
}

function addValue(values: Set<string>, value?: string | null, lower = false) {
  const current = normalized(value);
  if (!current) return;
  values.add(lower ? current.toLowerCase() : current);
}

function parseJson(value: string | null | undefined): Record<string, unknown> | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value);
    return sanitizeAuditDetails(parsed) as Record<string, unknown>;
  } catch {
    return { raw: sanitizeAuditDetails(value) };
  }
}

function stringDetail(details: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = details?.[key];
  return typeof value === 'string' ? value : undefined;
}

function formatAction(action: string): string {
  return action
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function inferEventKind(action: string, category?: string | null, explicit?: string | null): AuditEventKind {
  if (explicit) return explicit as AuditEventKind;
  if (action.startsWith('view_') || action.startsWith('search_') || action.startsWith('check_')) return 'read';
  if (action.includes('email') || action.includes('notification') || action.includes('link_sent')) return 'notification';
  if (action.includes('password') || action.includes('activation') || action.includes('login') || action.includes('token')) return 'security';
  if (action.includes('sync') || category === 'sync_status') return 'sync';
  if (action.includes('lifecycle') || category === 'lifecycle') return 'lifecycle';
  if (category === 'settings' || category === 'session' || category === 'rate_limit') return 'system';
  return 'write';
}

function inferOutcome(success: boolean | null | undefined, explicit?: string | null, fallback?: string): AuditOutcome {
  if (explicit) return explicit as AuditOutcome;
  if (fallback === 'failed' || fallback === 'error') return 'failure';
  if (fallback === 'cancelled') return 'denied';
  if (fallback === 'queued' || fallback === 'processing' || fallback === 'pending') return 'pending';
  if (fallback === 'retry') return 'pending';
  if (fallback === 'skipped') return 'skipped';
  return success === false ? 'failure' : 'success';
}

function makeItem(params: Omit<ActionHistoryItem, 'createdAt'> & { createdAt: Date | string }): ActionHistoryItem {
  return {
    ...params,
    createdAt: params.createdAt instanceof Date ? params.createdAt.toISOString() : params.createdAt,
    isReadEvent: params.eventKind === 'read',
  };
}

function addDisplayName(values: Map<string, string>, key?: string | null, name?: string | null, lower = false) {
  const currentKey = normalized(key);
  const currentName = normalized(name);
  if (!currentKey || !currentName) return;
  values.set(lower ? currentKey.toLowerCase() : currentKey, currentName);
}

export async function logActionHistoryEvent(input: LogHistoryEventInput): Promise<void> {
  try {
    await logAuditAction({
      action: input.action,
      category: input.category,
      username: input.username || input.subjectUsername || 'system',
      actorType: input.actorType || 'system',
      targetId: input.targetId || undefined,
      targetType: input.targetType || undefined,
      subjectUsername: input.subjectUsername,
      subjectEmail: input.subjectEmail,
      relatedRequestId: input.relatedRequestId,
      relatedVpnAccountId: input.relatedVpnAccountId,
      relatedLifecycleActionId: input.relatedLifecycleActionId,
      eventKind: input.eventKind,
      outcome: input.outcome,
      success: input.success,
      errorMessage: input.errorMessage,
      details: input.details,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      correlationId: input.correlationId,
    });
  } catch (error) {
    console.error('Failed to log action history event:', error);
  }
}

export async function resolveHistorySubjects(query: HistoryQuery): Promise<HistorySubjects> {
  const requestIds = new Set<string>();
  const usernames = new Set<string>();
  const emails = new Set<string>();
  const vpnAccountIds = new Set<string>();
  const searchTerm = normalized(query.search);

  addValue(requestIds, query.requestId);
  addValue(usernames, query.subjectUsername);
  addValue(emails, query.subjectEmail, true);
  addValue(vpnAccountIds, query.vpnAccountId);
  addValue(usernames, searchTerm);
  if (searchTerm?.includes('@')) addValue(emails, searchTerm, true);

  const requestLookupOr: Prisma.AccessRequestWhereInput[] = [];
  if (query.requestId) requestLookupOr.push({ id: query.requestId });
  if (query.subjectEmail) requestLookupOr.push({ email: { equals: query.subjectEmail, mode: INSENSITIVE } });
  if (query.subjectUsername) {
    requestLookupOr.push(
      { ldapUsername: { equals: query.subjectUsername, mode: INSENSITIVE } },
      { vpnUsername: { equals: query.subjectUsername, mode: INSENSITIVE } },
      { linkedAdUsername: { equals: query.subjectUsername, mode: INSENSITIVE } },
      { linkedVpnUsername: { equals: query.subjectUsername, mode: INSENSITIVE } }
    );
  }
  if (searchTerm) {
    requestLookupOr.push(
      { id: searchTerm },
      { name: { contains: searchTerm, mode: INSENSITIVE } },
      { email: { contains: searchTerm, mode: INSENSITIVE } },
      { ldapUsername: { contains: searchTerm, mode: INSENSITIVE } },
      { vpnUsername: { contains: searchTerm, mode: INSENSITIVE } },
      { linkedAdUsername: { contains: searchTerm, mode: INSENSITIVE } },
      { linkedVpnUsername: { contains: searchTerm, mode: INSENSITIVE } }
    );
  }

  const vpnLookupOr: Prisma.VPNAccountWhereInput[] = [];
  if (query.vpnAccountId) vpnLookupOr.push({ id: query.vpnAccountId });
  if (query.subjectUsername) {
    vpnLookupOr.push(
      { username: { equals: query.subjectUsername, mode: INSENSITIVE } },
      { adUsername: { equals: query.subjectUsername, mode: INSENSITIVE } }
    );
  }
  if (query.subjectEmail) vpnLookupOr.push({ email: { equals: query.subjectEmail, mode: INSENSITIVE } });
  if (searchTerm) {
    vpnLookupOr.push(
      { id: searchTerm },
      { name: { contains: searchTerm, mode: INSENSITIVE } },
      { email: { contains: searchTerm, mode: INSENSITIVE } },
      { username: { contains: searchTerm, mode: INSENSITIVE } },
      { adUsername: { contains: searchTerm, mode: INSENSITIVE } }
    );
  }

  const [requests, vpnAccounts] = await Promise.all([
    requestLookupOr.length > 0
      ? prisma.accessRequest.findMany({
          where: { OR: requestLookupOr },
          orderBy: { updatedAt: 'desc' },
          take: 10,
          select: {
            id: true,
            email: true,
            ldapUsername: true,
            vpnUsername: true,
            linkedAdUsername: true,
            linkedVpnUsername: true,
          },
        })
      : Promise.resolve([]),
    vpnLookupOr.length > 0
      ? prisma.vPNAccount.findMany({
          where: { OR: vpnLookupOr },
          orderBy: { updatedAt: 'desc' },
          take: 10,
          select: {
            id: true,
            username: true,
            email: true,
            accessRequestId: true,
            adUsername: true,
          },
        })
      : Promise.resolve([]),
  ]);

  requests.forEach((request) => {
    addValue(requestIds, request.id);
    addValue(emails, request.email, true);
    addValue(usernames, request.ldapUsername);
    addValue(usernames, request.vpnUsername);
    addValue(usernames, request.linkedAdUsername);
    addValue(usernames, request.linkedVpnUsername);
  });

  vpnAccounts.forEach((account) => {
    addValue(vpnAccountIds, account.id);
    addValue(usernames, account.username);
    addValue(usernames, account.adUsername);
    addValue(emails, account.email, true);
    addValue(requestIds, account.accessRequestId);
  });

  if (requestIds.size > 0) {
    const linkedVpnAccounts = await prisma.vPNAccount.findMany({
      where: { accessRequestId: { in: Array.from(requestIds) } },
      select: { id: true, username: true, email: true, adUsername: true },
    });

    linkedVpnAccounts.forEach((account) => {
      addValue(vpnAccountIds, account.id);
      addValue(usernames, account.username);
      addValue(usernames, account.adUsername);
      addValue(emails, account.email, true);
    });
  }

  return {
    requestIds: Array.from(requestIds),
    usernames: Array.from(usernames),
    emails: Array.from(emails),
    vpnAccountIds: Array.from(vpnAccountIds),
  };
}

export function buildAuditHistoryWhere(subjects: HistorySubjects, query: HistoryQuery): Prisma.AuditLogWhereInput {
  const or: Prisma.AuditLogWhereInput[] = [];

  subjects.requestIds.forEach((requestId) => {
    or.push(
      { relatedRequestId: requestId },
      { targetId: requestId, targetType: 'AccessRequest' },
      { details: { contains: requestId, mode: INSENSITIVE } }
    );
  });

  subjects.vpnAccountIds.forEach((vpnAccountId) => {
    or.push(
      { relatedVpnAccountId: vpnAccountId },
      { targetId: vpnAccountId, targetType: 'VPNAccount' },
      { details: { contains: vpnAccountId, mode: INSENSITIVE } }
    );
  });

  subjects.usernames.forEach((username) => {
    or.push(
      { subjectUsername: { equals: username, mode: INSENSITIVE } },
      { username: { equals: username, mode: INSENSITIVE } },
      { details: { contains: username, mode: INSENSITIVE } }
    );
  });

  subjects.emails.forEach((email) => {
    or.push(
      { subjectEmail: { equals: email, mode: INSENSITIVE } },
      { details: { contains: email, mode: INSENSITIVE } }
    );
  });

  const and: Prisma.AuditLogWhereInput[] = [];
  if (or.length > 0) and.push({ OR: or });
  if (query.eventKind && query.eventKind !== 'all') and.push({ eventKind: query.eventKind });
  if (query.outcome && query.outcome !== 'all') and.push({ outcome: query.outcome });

  return and.length > 0 ? { AND: and } : {};
}

function normalizeAuditLog(log: PrismaAuditLog): ActionHistoryItem {
  const eventKind = inferEventKind(log.action, log.category, log.eventKind);
  const details = parseJson(log.details);
  return makeItem({
    id: `audit:${log.id}`,
    source: 'audit_log',
    sourceId: log.id,
    createdAt: log.createdAt,
    title: formatAction(log.action),
    action: log.action,
    category: log.category,
    actor: log.username,
    actorType: (log.actorType as AuditActorType | null) || 'admin',
    eventKind,
    outcome: inferOutcome(log.success, log.outcome),
    targetId: log.targetId || undefined,
    targetType: log.targetType || undefined,
    subjectUsername: log.subjectUsername || undefined,
    subjectEmail: log.subjectEmail || undefined,
    relatedRequestId: log.relatedRequestId || undefined,
    relatedVpnAccountId: log.relatedVpnAccountId || undefined,
    relatedLifecycleActionId: log.relatedLifecycleActionId || undefined,
    correlationId: log.correlationId || undefined,
    ipAddress: log.ipAddress || undefined,
    userAgent: log.userAgent || undefined,
    details,
  });
}

function normalizeRequestComment(comment: RequestComment): ActionHistoryItem {
  return makeItem({
    id: `request-comment:${comment.id}`,
    source: 'request_comment',
    sourceId: comment.id,
    createdAt: comment.createdAt,
    title: comment.type === 'system' ? 'System request note' : 'Request comment',
    description: comment.comment,
    actor: comment.author,
    actorType: comment.author === 'System' ? 'system' : 'admin',
    eventKind: comment.type === 'system' ? 'system' : 'write',
    outcome: 'success',
    relatedRequestId: comment.requestId,
    isDerived: true,
    details: { type: comment.type || 'comment' },
  });
}

function requestMilestones(request: AccessRequest): ActionHistoryItem[] {
  const items: ActionHistoryItem[] = [];
  const add = (key: string, date: Date | string | null | undefined, title: string, actor: string, details?: Record<string, unknown>, outcome: AuditOutcome = 'success') => {
    if (!date) return;
    items.push(makeItem({
      id: `request-state:${request.id}:${key}`,
      source: 'request_state',
      sourceId: request.id,
      createdAt: date,
      title,
      actor,
      actorType: actor === 'system' ? 'system' : 'admin',
      eventKind: 'write',
      outcome,
      subjectUsername: request.ldapUsername || request.linkedAdUsername || request.vpnUsername || undefined,
      subjectEmail: request.email,
      relatedRequestId: request.id,
      isDerived: true,
      details: sanitizeAuditDetails(details || { status: request.status }) as Record<string, unknown>,
    }));
  };

  add('created', request.createdAt, 'Access request created', 'user', { isInternal: request.isInternal, status: request.status }, 'pending');
  add('verified', request.verifiedAt, 'Email verified', 'user', { status: request.status });
  add('acknowledged', request.acknowledgedAt, 'Student director acknowledged request', request.acknowledgedBy || 'system');
  add('sent-to-faculty', request.sentToFacultyAt, 'Request sent to faculty', request.sentToFacultyBy || 'system');
  add('account-created', request.accountCreatedAt, 'Account created or linked', request.acknowledgedBy || request.approvedBy || 'system', {
    ldapUsername: request.ldapUsername,
    vpnUsername: request.vpnUsername,
    isManuallyAssigned: request.isManuallyAssigned,
  });
  add('manual-assignment', request.manuallyAssignedAt, 'Request manually assigned to existing account', request.manuallyAssignedBy || 'system', {
    linkedAdUsername: request.linkedAdUsername,
    linkedVpnUsername: request.linkedVpnUsername,
    notes: request.manualAssignmentNotes,
  });
  add('approved', request.approvedAt, 'Request approved', request.approvedBy || 'system', { approvalMessage: request.approvalMessage });
  add('rejected', request.rejectedAt, 'Request rejected', request.rejectedBy || 'system', { rejectionReason: request.rejectionReason }, 'denied');
  add('ad-disabled', request.adDisabledAt, 'AD account disabled', request.adDisabledBy || 'system', { reason: request.adDisabledReason }, 'success');
  add('ad-enabled', request.adEnabledAt, 'AD account enabled', request.adEnabledBy || 'system');
  add('vpn-revoked', request.vpnRevokedAt, 'VPN access revoked', request.vpnRevokedBy || 'system', { reason: request.vpnRevokedReason });
  add('vpn-restored', request.vpnRestoredAt, 'VPN access restored', request.vpnRestoredBy || 'system');

  return items;
}

export async function getActionHistory(query: HistoryQuery): Promise<ActionHistoryResponse> {
  const page = Math.max(1, query.page || 1);
  const limit = Math.min(Math.max(query.limit || 50, 1), 100);
  const subjects = await resolveHistorySubjects(query);
  const hasSubject = subjects.requestIds.length || subjects.usernames.length || subjects.emails.length || subjects.vpnAccountIds.length;

  if (!hasSubject) {
    return { items: [], total: 0, page, limit, totalPages: 0, subjects };
  }

  const auditWhere = buildAuditHistoryWhere(subjects, query);
  const auditTake = Math.min(limit * 4, 200);

  const [auditLogs, requestComments, requests, lifecycleActions, adActivityLogs, vpnStatusLogs, vpnActivityLogs, adMatches, offboardRecipients, passwordTokens, activationTokens, vpnAccountsForDisplay] = await Promise.all([
    prisma.auditLog.findMany({ where: auditWhere, orderBy: { createdAt: 'desc' }, take: auditTake }),
    subjects.requestIds.length
      ? prisma.requestComment.findMany({ where: { requestId: { in: subjects.requestIds } }, orderBy: { createdAt: 'desc' }, take: 100 })
      : Promise.resolve([]),
    subjects.requestIds.length
      ? prisma.accessRequest.findMany({ where: { id: { in: subjects.requestIds } } })
      : Promise.resolve([]),
    subjects.requestIds.length || subjects.usernames.length
      ? prisma.accountLifecycleAction.findMany({
          where: {
            OR: [
              ...(subjects.requestIds.length ? [{ relatedRequestId: { in: subjects.requestIds } }, { targetUserId: { in: subjects.requestIds } }] : []),
              ...subjects.usernames.map((username) => ({ targetUsername: { equals: username, mode: INSENSITIVE } })),
            ],
          },
          include: { history: { orderBy: { createdAt: 'desc' } } },
          take: 50,
        })
      : Promise.resolve([]),
    subjects.requestIds.length || subjects.usernames.length
      ? prisma.aDAccountActivityLog.findMany({
          where: {
            OR: [
              ...(subjects.requestIds.length ? [{ accountId: { in: subjects.requestIds } }] : []),
              ...subjects.usernames.map((username) => ({ accountUsername: { equals: username, mode: INSENSITIVE } })),
            ],
          },
          orderBy: { createdAt: 'desc' },
          take: 100,
        })
      : Promise.resolve([]),
    subjects.vpnAccountIds.length
      ? prisma.vPNAccountStatusLog.findMany({ where: { accountId: { in: subjects.vpnAccountIds } }, orderBy: { createdAt: 'desc' }, take: 100 })
      : Promise.resolve([]),
    subjects.vpnAccountIds.length || subjects.usernames.length
      ? prisma.vPNAccountActivityLog.findMany({
          where: {
            OR: [
              ...(subjects.vpnAccountIds.length ? [{ accountId: { in: subjects.vpnAccountIds } }] : []),
              ...subjects.usernames.map((username) => ({ accountUsername: { equals: username, mode: INSENSITIVE } })),
            ],
          },
          orderBy: { createdAt: 'desc' },
          take: 100,
        })
      : Promise.resolve([]),
    subjects.requestIds.length || subjects.usernames.length || subjects.emails.length
      ? prisma.aDAccountMatch.findMany({
          where: {
            OR: [
              ...(subjects.requestIds.length ? [{ accessRequestId: { in: subjects.requestIds } }] : []),
              ...subjects.usernames.map((username) => ({ adUsername: { equals: username, mode: INSENSITIVE } })),
              ...subjects.usernames.map((username) => ({ vpnUsername: { equals: username, mode: INSENSITIVE } })),
              ...subjects.emails.map((email) => ({ adEmail: { equals: email, mode: INSENSITIVE } })),
              ...subjects.emails.map((email) => ({ requestEmail: { equals: email, mode: INSENSITIVE } })),
            ],
          },
          orderBy: { createdAt: 'desc' },
          take: 100,
        })
      : Promise.resolve([]),
    subjects.requestIds.length || subjects.usernames.length || subjects.emails.length || subjects.vpnAccountIds.length
      ? prisma.offboardCampaignRecipient.findMany({
          where: {
            OR: [
              ...(subjects.requestIds.length ? [{ accessRequestId: { in: subjects.requestIds } }] : []),
              ...(subjects.vpnAccountIds.length ? [{ vpnAccountId: { in: subjects.vpnAccountIds } }] : []),
              ...subjects.usernames.map((username) => ({ adUsername: { equals: username, mode: INSENSITIVE } })),
              ...subjects.usernames.map((username) => ({ linkedVpnUsername: { equals: username, mode: INSENSITIVE } })),
              ...subjects.emails.map((email) => ({ email: { equals: email, mode: INSENSITIVE } })),
            ],
          },
          include: { logs: { orderBy: { createdAt: 'desc' }, take: 25 } },
          take: 25,
        })
      : Promise.resolve([]),
    subjects.emails.length
      ? prisma.passwordResetToken.findMany({ where: { email: { in: subjects.emails } }, orderBy: { createdAt: 'desc' }, take: 25 })
      : Promise.resolve([]),
    subjects.requestIds.length
      ? prisma.accountActivationToken.findMany({ where: { accessRequestId: { in: subjects.requestIds } }, orderBy: { createdAt: 'desc' }, take: 25 })
      : Promise.resolve([]),
    subjects.vpnAccountIds.length
      ? prisma.vPNAccount.findMany({
          where: { id: { in: subjects.vpnAccountIds } },
          select: { id: true, name: true, username: true, email: true, adUsername: true, accessRequestId: true },
        })
      : Promise.resolve([]),
  ]);

  const items: ActionHistoryItem[] = [];
  const requestNameById = new Map<string, string>();
  const vpnNameById = new Map<string, string>();
  const subjectNameByUsername = new Map<string, string>();
  const subjectNameByEmail = new Map<string, string>();

  requests.forEach((request) => {
    addDisplayName(requestNameById, request.id, request.name);
    addDisplayName(subjectNameByEmail, request.email, request.name, true);
    addDisplayName(subjectNameByUsername, request.ldapUsername, request.name, true);
    addDisplayName(subjectNameByUsername, request.vpnUsername, request.name, true);
    addDisplayName(subjectNameByUsername, request.linkedAdUsername, request.name, true);
    addDisplayName(subjectNameByUsername, request.linkedVpnUsername, request.name, true);
  });

  vpnAccountsForDisplay.forEach((account) => {
    addDisplayName(vpnNameById, account.id, account.name);
    addDisplayName(subjectNameByEmail, account.email, account.name, true);
    addDisplayName(subjectNameByUsername, account.username, account.name, true);
    addDisplayName(subjectNameByUsername, account.adUsername, account.name, true);
    addDisplayName(requestNameById, account.accessRequestId, account.name);
  });

  const withSubjectName = (item: ActionHistoryItem): ActionHistoryItem => {
    let subjectName = item.relatedRequestId ? requestNameById.get(item.relatedRequestId) : undefined;
    if (!subjectName && item.relatedVpnAccountId) subjectName = vpnNameById.get(item.relatedVpnAccountId);
    if (!subjectName && item.subjectUsername) subjectName = subjectNameByUsername.get(item.subjectUsername.toLowerCase());
    if (!subjectName && item.subjectEmail) subjectName = subjectNameByEmail.get(item.subjectEmail.toLowerCase());
    return subjectName ? { ...item, subjectName } : item;
  };
  const auditedLifecycleEvents = new Set<string>();
  const auditedSyncMatchIds = new Set<string>();
  const auditedOffboardLogIds = new Set<string>();

  auditLogs.forEach((log) => {
    const details = parseJson(log.details);
    const lifecycleEvent = stringDetail(details, 'lifecycleEvent');
    const syncMatchId = stringDetail(details, 'syncMatchId');
    const offboardLogId = stringDetail(details, 'offboardLogId');

    if (log.relatedLifecycleActionId && lifecycleEvent) {
      auditedLifecycleEvents.add(`${log.relatedLifecycleActionId}:${lifecycleEvent}`);
    }
    if (syncMatchId) auditedSyncMatchIds.add(syncMatchId);
    if (offboardLogId) auditedOffboardLogIds.add(offboardLogId);
  });

  items.push(...auditLogs.map(normalizeAuditLog));
  items.push(...requestComments.map(normalizeRequestComment));
  requests.forEach((request) => items.push(...requestMilestones(request)));

  lifecycleActions.forEach((action: LifecycleActionWithHistory) => {
    action.history.forEach((history) => {
      if (auditedLifecycleEvents.has(`${action.id}:${history.event}`)) return;
      items.push(makeItem({
        id: `lifecycle-history:${history.id}`,
        source: 'lifecycle_history',
        sourceId: history.id,
        createdAt: history.createdAt,
        title: `Lifecycle ${formatAction(history.event)}`,
        description: `${formatAction(action.actionType)} for ${action.targetUsername}`,
        actor: history.performedBy || action.requestedBy || 'system',
        actorType: (history.performedBy || action.requestedBy) === 'system' ? 'system' : 'admin',
        eventKind: 'lifecycle',
        outcome: inferOutcome(action.status !== 'failed', undefined, history.event),
        subjectUsername: action.targetUsername,
        relatedRequestId: action.relatedRequestId || undefined,
        relatedLifecycleActionId: action.id,
        isDerived: true,
        details: sanitizeAuditDetails({
          actionType: action.actionType,
          targetAccountType: action.targetAccountType,
          previousStatus: history.previousStatus,
          newStatus: history.newStatus,
          details: parseJson(history.details),
        }) as Record<string, unknown>,
      }));
    });
  });

  adActivityLogs.forEach((log: ADAccountActivityLog) => items.push(makeItem({
    id: `ad-activity:${log.id}`,
    source: 'ad_activity',
    sourceId: log.id,
    createdAt: log.createdAt,
    title: `AD account ${log.actionType}`,
    actor: log.performedBy,
    actorType: log.performedBy === 'system' ? 'system' : 'admin',
    eventKind: 'lifecycle',
    outcome: log.ldapSuccess || !log.ldapError ? 'success' : 'failure',
    subjectUsername: log.accountUsername,
    subjectEmail: log.accountEmail || undefined,
    relatedRequestId: log.accountId,
    relatedLifecycleActionId: log.lifecycleActionId || undefined,
    isDerived: true,
    details: sanitizeAuditDetails({ reason: log.reason, notes: log.notes, ldapSuccess: log.ldapSuccess, ldapError: log.ldapError }) as Record<string, unknown>,
  })));

  vpnStatusLogs.forEach((log: VPNAccountStatusLog) => items.push(makeItem({
    id: `vpn-status:${log.id}`,
    source: 'vpn_status',
    sourceId: log.id,
    createdAt: log.createdAt,
    title: `VPN status changed to ${log.newStatus}`,
    description: log.oldStatus ? `From ${log.oldStatus} to ${log.newStatus}` : `Initial status ${log.newStatus}`,
    actor: log.changedBy,
    actorType: log.changedBy === 'system' ? 'system' : 'admin',
    eventKind: 'lifecycle',
    outcome: 'success',
    relatedVpnAccountId: log.accountId,
    isDerived: true,
    details: sanitizeAuditDetails({ oldStatus: log.oldStatus, newStatus: log.newStatus, reason: log.reason }) as Record<string, unknown>,
  })));

  vpnActivityLogs.forEach((log: VPNAccountActivityLog) => items.push(makeItem({
    id: `vpn-activity:${log.id}`,
    source: 'vpn_activity',
    sourceId: log.id,
    createdAt: log.createdAt,
    title: `VPN account ${formatAction(log.actionType)}`,
    actor: log.performedBy,
    actorType: log.performedBy === 'system' ? 'system' : 'admin',
    eventKind: 'lifecycle',
    outcome: 'success',
    subjectUsername: log.accountUsername,
    subjectEmail: log.accountEmail || undefined,
    relatedVpnAccountId: log.accountId,
    relatedLifecycleActionId: log.lifecycleActionId || undefined,
    isDerived: true,
    details: sanitizeAuditDetails({ reason: log.reason, oldPortalType: log.oldPortalType, newPortalType: log.newPortalType, notes: log.notes }) as Record<string, unknown>,
  })));

  adMatches.forEach((match: ADAccountMatch) => {
    if (auditedSyncMatchIds.has(match.id)) return;
    items.push(makeItem({
    id: `ad-sync:${match.id}`,
    source: 'ad_sync',
    sourceId: match.id,
    createdAt: match.createdAt,
    title: `Sync match: ${formatAction(match.matchType)}`,
    actor: 'system',
    actorType: 'system',
    eventKind: 'sync',
    outcome: match.matchType?.includes('error') ? 'failure' : 'success',
    subjectUsername: match.adUsername || match.vpnUsername || undefined,
    subjectEmail: match.adEmail || match.requestEmail || undefined,
    relatedRequestId: match.accessRequestId || undefined,
    relatedVpnAccountId: match.vpnAccountId || undefined,
    isDerived: true,
    details: sanitizeAuditDetails({ syncId: match.syncId, wasAutoAssigned: match.wasAutoAssigned, notes: match.notes }) as Record<string, unknown>,
    }));
  });

  offboardRecipients.forEach((recipient: OffboardRecipientWithLogs) => {
    recipient.logs.forEach((log) => {
      if (auditedOffboardLogIds.has(log.id)) return;
      items.push(makeItem({
      id: `offboard-log:${log.id}`,
      source: 'offboard_log',
      sourceId: log.id,
      createdAt: log.createdAt,
      title: formatAction(log.eventType),
      description: log.message,
      actor: log.actor || 'system',
      actorType: log.actor ? 'admin' : 'system',
      eventKind: 'lifecycle',
      outcome: log.level === 'error' ? 'failure' : 'success',
      subjectUsername: recipient.adUsername,
      subjectEmail: recipient.email,
      relatedRequestId: recipient.accessRequestId || undefined,
      relatedVpnAccountId: recipient.vpnAccountId || undefined,
      ipAddress: log.eventType === 'recipient_verified' ? recipient.verifiedIpAddress || undefined : undefined,
      userAgent: log.eventType === 'recipient_verified' ? recipient.verifiedUserAgent || undefined : undefined,
      isDerived: true,
      details: sanitizeAuditDetails(log.details || { campaignId: log.campaignId, status: recipient.status }) as Record<string, unknown>,
      }));
    });
  });

  passwordTokens.forEach((token: PasswordResetToken) => items.push(makeItem({
    id: `token-summary:password-reset:${token.id}`,
    source: 'token_summary',
    sourceId: token.id,
    createdAt: token.createdAt,
    title: token.used ? 'Password reset token used' : 'Password reset token issued',
    actor: 'system',
    actorType: 'system',
    eventKind: 'security',
    outcome: token.used ? 'success' : (token.expiresAt < new Date() ? 'skipped' : 'pending'),
    subjectEmail: token.email,
    isDerived: true,
    details: { expiresAt: token.expiresAt.toISOString(), usedAt: token.usedAt?.toISOString() || null, attempts: token.attempts },
  })));

  activationTokens.forEach((token: AccountActivationToken) => items.push(makeItem({
    id: `token-summary:activation:${token.id}`,
    source: 'token_summary',
    sourceId: token.id,
    createdAt: token.createdAt,
    title: token.used ? 'Activation token used' : 'Activation token issued',
    actor: 'system',
    actorType: 'system',
    eventKind: 'security',
    outcome: token.used ? 'success' : (token.expiresAt < new Date() ? 'skipped' : 'pending'),
    relatedRequestId: token.accessRequestId,
    ipAddress: token.ipAddress || undefined,
    userAgent: token.userAgent || undefined,
    isDerived: true,
    details: { expiresAt: token.expiresAt.toISOString(), usedAt: token.usedAt?.toISOString() || null, attempts: token.attempts },
  })));

  const filtered = items
    .map(withSubjectName)
    .filter((item) => query.includeReads || item.eventKind !== 'read')
    .filter((item) => !query.eventKind || query.eventKind === 'all' || item.eventKind === query.eventKind)
    .filter((item) => !query.outcome || query.outcome === 'all' || item.outcome === query.outcome)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const total = filtered.length;
  const start = (page - 1) * limit;
  const pagedItems = filtered.slice(start, start + limit);

  return {
    items: pagedItems,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    subjects,
  };
}

export { AuditActions };