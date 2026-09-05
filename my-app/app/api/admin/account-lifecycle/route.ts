import { actorCanOperateLifecycleAction } from '@/lib/lifecycle-authorization';
import { findAccountUsernamesByName, resolveAccountDisplayNames } from '@/lib/account-display-names';
import { NextRequest, NextResponse } from 'next/server';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { actorHasPermission } from '@/lib/rbac/core';
import { logAuditAction, AuditActions, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';
import { prisma } from '@/lib/prisma';
import { processLifecycleAction } from '@/lib/lifecycle-processor';
import { secureJsonResponse } from '@/lib/apiResponse';
import { isModuleEnabled, isModuleEnabledStrict } from '@/lib/modules/core';
import { Prisma, type BatchAccountItem } from '@prisma/client';
import { CollectionQueryError, collectionFingerprint, collectionPage, decodeCollectionCursor, parseCollectionDirection, parseCollectionLimit, parseCollectionSort, type CollectionDirection } from '@/lib/admin/collections';
import { searchLDAPUser } from '@/lib/ldap';
import { isProductionCloneReadOnly } from '@/lib/clone-safety';
import { isLifecycleProvisioningReady, LIFECYCLE_READY_NON_NULL_PROVISIONING_STATES } from '@/lib/access-request-lifecycle-readiness';
import { isAccessRequestDirectoryIdentityConsistent } from '@/lib/access-request-directory-identity';
import { acquireVpnOwnershipFence } from '@/lib/vpn-ownership-fence';
import { assertLifecycleAccountNotProtected } from '@/lib/lifecycle-protection';
import { redactLifecycleExceptionEvidence } from '@/lib/lifecycle-evidence';
import {
  BATCH_GOVERNED_DIRECTORY_DELETE_POLICY_VERSION,
  DIRECTORY_DELETE_METHOD,
  DIRECTORY_DELETE_METHOD_EVIDENCE_KEY,
  GOVERNED_DIRECTORY_DELETE_POLICY_VERSION,
  hasCurrentDirectoryDeleteMethod,
  planContainsDirectoryDeletion,
  UNMANAGED_DIRECTORY_DELETE_POLICY_VERSION,
} from '@/lib/lifecycle-directory-deletion-policy';

const LIFECYCLE_SORTS = ['createdAt', 'status', 'targetUsername'] as const;
const LIFECYCLE_STATUSES = new Set(['pending', 'queued', 'processing', 'completed', 'failed', 'reconciliation_required', 'cancelled']);
const LIFECYCLE_ACTION_TYPES = new Set(['disable_ad', 'enable_ad', 'delete_ad', 'revoke_vpn', 'restore_vpn', 'delete_vpn_record', 'promote_vpn_role', 'demote_vpn_role', 'disable_both', 'enable_both', 'add_group_member', 'add_to_group', 'remove_from_group']);
const LIFECYCLE_ACCOUNT_TYPES = new Set(['AD', 'VPN', 'BOTH']);
const DIRECTORY_OVERRIDE_POLICY_VERSION = 'directory-override-v1';
const GOVERNED_DIRECTORY_IDENTITY_POLICY_VERSION = 'governed-directory-identity-v1';
const VPN_RECORD_DELETE_POLICY_VERSION = 'vpn-record-delete-v1';
const AD_ACTIONS = new Set(['disable_ad', 'enable_ad', 'delete_ad', 'disable_both', 'enable_both']);
const VPN_ACTIONS = new Set(['revoke_vpn', 'restore_vpn', 'delete_vpn_record', 'promote_vpn_role', 'demote_vpn_role', 'disable_both', 'enable_both']);
const ACTIVE_BATCH_OWNERSHIP_STATUSES = ['processing', 'completed', 'reconciliation_required'];
const VALID_LIFECYCLE_MUTATION_ACTIONS = [
  'disable_ad',
  'enable_ad',
  'delete_ad',
  'revoke_vpn',
  'restore_vpn',
  'delete_vpn_record',
  'promote_vpn_role',
  'demote_vpn_role',
  'disable_both',
  'enable_both',
] as const;
const TARGET_TYPE_FOR_ACTION: Record<string, 'AD' | 'VPN' | 'BOTH'> = {
  disable_ad: 'AD',
  enable_ad: 'AD',
  delete_ad: 'AD',
  revoke_vpn: 'VPN',
  restore_vpn: 'VPN',
  delete_vpn_record: 'VPN',
  promote_vpn_role: 'VPN',
  demote_vpn_role: 'VPN',
  disable_both: 'BOTH',
  enable_both: 'BOTH',
};

type LifecycleOwnershipCandidate = {
  id: string;
  status: string;
  provisioningState: string | null;
  ldapUsername: string | null;
  linkedAdUsername: string | null;
};

type VpnRequestClaimant = {
  id: string;
  version: number;
};

type VpnBatchOwnershipClaim = BatchAccountItem;

async function findActiveVpnBatchOwnershipClaims(
  findMany: (args: Prisma.BatchAccountItemFindManyArgs) => Promise<VpnBatchOwnershipClaim[]>,
  username: string
): Promise<VpnBatchOwnershipClaim[]> {
  return findMany({
    where: {
      lifecycleOwnerKind: 'batch_item',
      accessRequestId: null,
      accountType: { in: ['VPN', 'BOTH'] },
      status: { in: ACTIVE_BATCH_OWNERSHIP_STATUSES },
      OR: [
        { vpnUsername: { equals: username, mode: 'insensitive' } },
        // A reservation may have its directory name before the VPN username is
        // projected. It is still a claim, but cannot be selected as coherent.
        { ldapUsername: { equals: username, mode: 'insensitive' } },
      ],
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 2,
  });
}

function sameVpnUsername(left: string | null | undefined, right: string): boolean {
  return Boolean(left?.trim()) && left!.trim().toLowerCase() === right.trim().toLowerCase();
}

async function findActiveVpnRequestClaimants(
  findMany: (args: Prisma.AccessRequestFindManyArgs) => Promise<VpnRequestClaimant[]>,
  username: string
): Promise<VpnRequestClaimant[]> {
  return findMany({
    where: {
      status: { notIn: ['rejected', 'offboarded'] },
      OR: [
        { vpnUsername: { equals: username, mode: 'insensitive' } },
        { linkedVpnUsername: { equals: username, mode: 'insensitive' } },
      ],
    },
    select: { id: true, version: true },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 2,
  });
}

class LifecyclePreflightChangedError extends Error {
  code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'LifecyclePreflightChangedError';
    this.code = code;
  }
}

async function findLifecycleOwnershipCandidates(
  findMany: (args: Prisma.AccessRequestFindManyArgs) => Promise<LifecycleOwnershipCandidate[]>,
  targetUsername: string,
  allowOffboardedFallback: boolean
): Promise<LifecycleOwnershipCandidate[]> {
  const base = {
    OR: [
      { ldapUsername: { equals: targetUsername, mode: 'insensitive' as const } },
      { linkedAdUsername: { equals: targetUsername, mode: 'insensitive' as const } },
    ],
  };
  const activeOwners = await findMany({
    where: { ...base, status: { notIn: ['rejected', 'offboarded'] } },
    select: { id: true, status: true, provisioningState: true, ldapUsername: true, linkedAdUsername: true },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 2,
  });
  if (activeOwners.length > 0 || !allowOffboardedFallback) return activeOwners;
  return findMany({
    where: { ...base, status: 'offboarded' },
    select: { id: true, status: true, provisioningState: true, ldapUsername: true, linkedAdUsername: true },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 2,
  });
}

function directoryAttribute(
  user: Awaited<ReturnType<typeof searchLDAPUser>>,
  name: string
): string | null {
  return user?.attributes.find((attribute) => attribute.type.toLowerCase() === name.toLowerCase())?.values?.[0] ?? null;
}

function directoryPreflightSnapshot(user: NonNullable<Awaited<ReturnType<typeof searchLDAPUser>>>): Prisma.InputJsonObject {
  const rawUserAccountControl = directoryAttribute(user, 'userAccountControl');
  const userAccountControl = rawUserAccountControl && /^\d+$/.test(rawUserAccountControl)
    ? Number(rawUserAccountControl)
    : null;
  return {
    observedAt: new Date().toISOString(),
    dn: user.objectName,
    username: directoryAttribute(user, 'sAMAccountName'),
    enabled: userAccountControl === null ? null : (userAccountControl & 2) === 0,
    userAccountControl,
    objectGuid: directoryAttribute(user, 'objectGUID'),
  };
}

type LifecycleCollectionQuery = {
  search: string; status: string | null; actionType: string | null; accountType: string | null; batchId: string | null;
  sort: typeof LIFECYCLE_SORTS[number]; direction: CollectionDirection; limit: number; cursor: { value: string; id: string } | null; fingerprint: string;
};

function parseLifecycleCollectionQuery(params: URLSearchParams): LifecycleCollectionQuery {
  const status = params.get('status');
  const actionType = params.get('actionType');
  const accountType = params.get('accountType');
  if (status !== null && !LIFECYCLE_STATUSES.has(status)) throw new CollectionQueryError('status is not supported');
  if (actionType !== null && !LIFECYCLE_ACTION_TYPES.has(actionType)) throw new CollectionQueryError('actionType is not supported');
  if (accountType !== null && !LIFECYCLE_ACCOUNT_TYPES.has(accountType)) throw new CollectionQueryError('accountType is not supported');
  const search = (params.get('search') || params.get('username') || '').trim().slice(0, 120);
  const sort = parseCollectionSort(params.get('sort'), LIFECYCLE_SORTS, 'createdAt');
  const direction = parseCollectionDirection(params.get('direction'));
  const batchId = params.get('batchId');
  const fingerprint = collectionFingerprint({ search, status, actionType, accountType, batchId, sort, direction });
  const cursor = decodeCollectionCursor(params.get('cursor'), fingerprint);
  if (cursor && sort === 'createdAt' && Number.isNaN(Date.parse(cursor.value))) throw new CollectionQueryError('cursor contains an invalid createdAt value');
  return { search, status, actionType, accountType, batchId, sort, direction, limit: parseCollectionLimit(params.get('limit')), cursor, fingerprint };
}

function lifecycleWhere(query: LifecycleCollectionQuery, nameMatches: string[] = []): Prisma.AccountLifecycleActionWhereInput {
  const filters: Prisma.AccountLifecycleActionWhereInput[] = [];
  if (query.status) filters.push({ status: query.status });
  if (query.actionType === 'add_group_member') {
    // Include legacy rows emitted as add_to_group before the canonical action
    // name was aligned with the processor and workflow engine.
    filters.push({ actionType: { in: ['add_group_member', 'add_to_group'] } });
  } else if (query.actionType) {
    filters.push({ actionType: query.actionType });
  }
  if (query.accountType) filters.push({ targetAccountType: query.accountType });
  if (query.batchId) filters.push({ batchId: query.batchId });
  if (query.search) filters.push({ OR: [
    ...(nameMatches.length ? [{ targetUsername: { in: nameMatches, mode: 'insensitive' as const } }, { requestedBy: { in: nameMatches, mode: 'insensitive' as const } }] : []),
    { targetUsername: { contains: query.search, mode: 'insensitive' } }, { reason: { contains: query.search, mode: 'insensitive' } },
    { requestedBy: { contains: query.search, mode: 'insensitive' } }, { notes: { contains: query.search, mode: 'insensitive' } },
    { relatedRequestId: { contains: query.search, mode: 'insensitive' } }, { relatedTicketId: { contains: query.search, mode: 'insensitive' } }, { id: { contains: query.search, mode: 'insensitive' } },
  ] });
  if (query.cursor) {
    const value = query.sort === 'createdAt' ? new Date(query.cursor.value) : query.cursor.value;
    const comparator = query.direction === 'asc' ? 'gt' : 'lt';
    filters.push({ OR: [{ [query.sort]: { [comparator]: value } }, { [query.sort]: value, id: { [comparator]: query.cursor.id } }] } as Prisma.AccountLifecycleActionWhereInput);
  }
  return filters.length ? { AND: filters } : {};
}

/**
 * GET /api/admin/account-lifecycle
 * Get all lifecycle actions with filtering
 */
export async function GET(request: NextRequest) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!actorHasPermission(admin, 'lifecycle.read')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const query = parseLifecycleCollectionQuery(request.nextUrl.searchParams);
    const nameMatches = query.search ? await findAccountUsernamesByName(query.search) : [];
    const where = lifecycleWhere(query, nameMatches);
    const normalizedWhere = lifecycleWhere({ ...query, cursor: null }, nameMatches);
    const [rows, total, statusCounts] = await Promise.all([
      prisma.accountLifecycleAction.findMany({
        where, orderBy: [{ [query.sort]: query.direction }, { id: query.direction }], take: query.limit + 1,
        include: { history: { orderBy: { createdAt: 'desc' }, take: 3 }, _count: { select: { history: true } } },
      }),
      prisma.accountLifecycleAction.count({ where: normalizedWhere }),
      prisma.accountLifecycleAction.groupBy({ by: ['status'], where: normalizedWhere, _count: { _all: true } }),
    ]);
    const displayNames = await resolveAccountDisplayNames(rows.slice(0, query.limit).flatMap((action) => [
      action.targetUsername, action.requestedBy, ...action.history.map((entry) => entry.performedBy),
    ]));
    const now = Date.now();
    const canViewOverrideEvidence = actorHasPermission(admin, 'lifecycle.override');
    const canViewDeletionEvidence = actorHasPermission(admin, 'lifecycle.delete');
    const enriched = rows.map(({ _count, ...action }) => {
      const canViewEvidence = action.actionType === 'delete_ad'
        ? canViewDeletionEvidence
        : action.actionType === 'delete_vpn_record'
          ? actorHasPermission(admin, 'vpn.delete')
        : canViewOverrideEvidence;
      const visibleAction = redactLifecycleExceptionEvidence(action, canViewEvidence);
      return {
        ...visibleAction,
        canRetry: actorCanOperateLifecycleAction(admin, action),
        canCancel: actorHasPermission(admin, 'lifecycle.manage'),
        canReconcile: actorCanOperateLifecycleAction(admin, action),
        targetDisplayName: displayNames.get(action.targetUsername.toLowerCase()) ?? null,
        requestedByDisplayName: displayNames.get(action.requestedBy.toLowerCase()) ?? null,
        history: action.history.map((entry) => ({ ...entry, performedByDisplayName: entry.performedBy ? displayNames.get(entry.performedBy.toLowerCase()) ?? null : null })),
        historyTotal: _count.history,
        // Lifecycle claims have a fixed ten-minute lease; derive elapsed claim age without adding a schema field.
        claimAgeSeconds: action.claimedUntil ? Math.max(0, Math.floor((10 * 60 * 1000 - Math.max(0, action.claimedUntil.getTime() - now)) / 1000)) : null,
        recoveryEligible: action.status === 'reconciliation_required',
      };
    });
    const page = collectionPage({ rows: enriched, limit: query.limit, total, summary: Object.fromEntries(statusCounts.map((entry) => [entry.status, entry._count._all])), fingerprint: query.fingerprint, cursorFor: (row) => ({ value: row[query.sort], id: row.id }) });
    return NextResponse.json(page);
  } catch (error) {
    if (error instanceof CollectionQueryError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error('Error fetching lifecycle actions:', error);
    return NextResponse.json(
      { error: 'Failed to fetch lifecycle actions' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/account-lifecycle
 * Create a new account lifecycle action (disable/enable/revoke/restore/role change)
 * Actions are processed immediately and results returned
 */
export async function POST(request: NextRequest) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!actorHasPermission(admin, 'lifecycle.manage')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (isProductionCloneReadOnly()) {
      return NextResponse.json({
        error: 'Account lifecycle mutations are disabled in this production-clone environment.',
        code: 'CLONE_READ_ONLY',
      }, { status: 409 });
    }

    const body = await request.json();
    const {
      actionType,
      targetAccountType,
      targetUsername,
      reason,
      scheduledFor,
      relatedRequestId,
      relatedTicketId,
      vpnRoleChange,
      notes,
      operationMode: requestedOperationMode = 'governed',
      exceptionEvidence,
      overrideAcknowledgement,
      destructiveAcknowledgement,
      irreversibleAcknowledgement,
      idempotencyKey,
      deletionPlanId,
      planTargetKey,
      relatedBatchAccountItemId,
    } = body;
    const suppliedIdempotencyKey = typeof idempotencyKey === 'string' ? idempotencyKey : request.headers.get('idempotency-key');
    const normalizedIdempotencyKey = typeof suppliedIdempotencyKey === 'string' && suppliedIdempotencyKey.trim()
      ? suppliedIdempotencyKey.trim()
      : null;
    if (!normalizedIdempotencyKey) {
      return NextResponse.json({ error: 'A stable idempotency key is required for lifecycle confirmation.' }, { status: 400 });
    }
    if (normalizedIdempotencyKey && (normalizedIdempotencyKey.length < 16 || normalizedIdempotencyKey.length > 128)) {
      return NextResponse.json({ error: 'idempotencyKey must be between 16 and 128 characters.' }, { status: 400 });
    }
    if (normalizedIdempotencyKey) {
      const existing = await prisma.accountLifecycleAction.findUnique({ where: { idempotencyKey: normalizedIdempotencyKey } });
      if (existing) {
        if (existing.requestedBy !== admin.username) {
          return NextResponse.json({ error: 'Idempotency key is already in use.' }, { status: 409 });
        }
        return secureJsonResponse({
          success: existing.status === 'completed',
          action: redactLifecycleExceptionEvidence(
            existing,
            existing.actionType === 'delete_ad'
              ? actorHasPermission(admin, 'lifecycle.delete')
              : existing.actionType === 'delete_vpn_record'
                ? actorHasPermission(admin, 'vpn.delete')
              : actorHasPermission(admin, 'lifecycle.override')
          ),
          replayed: true,
          processResult: {
            success: existing.status === 'completed',
            actionId: existing.id,
            reconciliationRequired: existing.status === 'reconciliation_required',
            error: existing.errorMessage,
          },
        }, 200);
      }
    }

    const explicitRelatedRequestId = typeof relatedRequestId === 'string' && relatedRequestId.trim()
      ? relatedRequestId.trim()
      : null;
    const explicitBatchAccountItemId = typeof relatedBatchAccountItemId === 'string' && relatedBatchAccountItemId.trim()
      ? relatedBatchAccountItemId.trim()
      : null;
    const normalizedReason = typeof reason === 'string' ? reason.trim() : '';
    let operationMode = requestedOperationMode;
    let reviewedDeletionPlan: {
      id: string;
      selectionDigest: string;
      typedAcknowledgement: string;
      targetCount: number;
      recordCount: number;
      targetKey: string;
      targetDirectoryDn: string | null;
      targetDirectoryObjectGuid: string | null;
      targetVpnRecordId: string | null;
      sourceRequestId: string | null;
      sourceBatchItemId: string | null;
      planOrdinal: number;
      reason: string;
      reference: string;
      notes: string | null;
    } | null = null;
    if (typeof deletionPlanId === 'string' && deletionPlanId.trim()) {
      const plan = await prisma.accountLifecycleBatch.findUnique({ where: { id: deletionPlanId.trim() } });
      if (
        !plan
        || plan.policyVersion !== 'reviewed-lifecycle-deletion-plan-v1'
        || plan.status !== 'processing'
        || plan.requestedBy !== admin.username
        || !plan.confirmedAt
        || !plan.expiresAt
        || plan.expiresAt.getTime() <= Date.now()
        || !plan.selectionDigest
        || !plan.authorizationEvidence
        || typeof plan.authorizationEvidence !== 'object'
        || Array.isArray(plan.authorizationEvidence)
      ) {
        return NextResponse.json({ error: 'The reviewed deletion plan is missing, expired, or does not belong to this operator.' }, { status: 409 });
      }
      const planEvidence = plan.authorizationEvidence;
      if (typeof planEvidence.auditRecordedAt !== 'string') {
        return NextResponse.json({ error: 'The reviewed deletion plan does not have a durable confirmation audit record.' }, { status: 409 });
      }
      const manifest = Array.isArray(planEvidence.manifest) ? planEvidence.manifest : [];
      const children = Array.isArray(planEvidence.children) ? planEvidence.children : [];
      const targetKey = typeof planTargetKey === 'string' ? planTargetKey : '';
      const targetValue = manifest.find((item) => item && typeof item === 'object' && !Array.isArray(item) && item.key === targetKey);
      const plannedAction = planEvidence.action;
      if (planContainsDirectoryDeletion(plannedAction) && !hasCurrentDirectoryDeleteMethod(planEvidence)) {
        return NextResponse.json({
          error: 'This reviewed deletion plan uses an earlier AD deletion method. Refresh the account state and review a new deletion plan before executing any of its records.',
          code: 'DELETION_PLAN_REVIEW_REFRESH_REQUIRED',
        }, { status: 409 });
      }
      const allowedChild = plannedAction === actionType
        || (plannedAction === 'delete_both_records' && (actionType === 'delete_ad' || actionType === 'delete_vpn_record'));
      if (!targetValue || !allowedChild || (actionType !== 'delete_ad' && actionType !== 'delete_vpn_record')) {
        return NextResponse.json({ error: 'This action is not part of the reviewed deletion plan.' }, { status: 409 });
      }
      const plannedChildValue = children.find((item) => item && typeof item === 'object' && !Array.isArray(item)
        && item.targetKey === targetKey && item.actionType === actionType);
      const plannedChild = plannedChildValue && typeof plannedChildValue === 'object' && !Array.isArray(plannedChildValue)
        ? plannedChildValue as Prisma.JsonObject
        : null;
      if (!plannedChild || typeof plannedChild.ordinal !== 'number' || !Number.isInteger(plannedChild.ordinal)) {
        return NextResponse.json({ error: 'The reviewed deletion plan is missing its server-owned child order.' }, { status: 409 });
      }
      const target = targetValue as Prisma.JsonObject;
      const plannedDirectory = target.directory && typeof target.directory === 'object' && !Array.isArray(target.directory) ? target.directory : null;
      const plannedVpn = target.vpn && typeof target.vpn === 'object' && !Array.isArray(target.vpn) ? target.vpn : null;
      const identityMatches = actionType === 'delete_ad'
        ? plannedDirectory?.username === targetUsername
          && (target.requestId ?? null) === explicitRelatedRequestId
          && (target.sourceBatchItemId ?? null) === explicitBatchAccountItemId
        : plannedVpn?.username === targetUsername;
      if (!identityMatches) {
        return NextResponse.json({ error: 'The requested account does not match the reviewed deletion target.' }, { status: 409 });
      }
      operationMode = target.operationMode === 'directory_override'
        ? 'directory_override'
        : target.operationMode === 'batch_governed'
          ? 'batch_governed'
          : 'governed';
      reviewedDeletionPlan = {
        id: plan.id,
        selectionDigest: plan.selectionDigest,
        typedAcknowledgement: String(planEvidence.typedAcknowledgement ?? ''),
        targetCount: Number(planEvidence.targetCount ?? 0),
        recordCount: Number(planEvidence.recordCount ?? 0),
        targetKey,
        targetDirectoryDn: typeof plannedDirectory?.dn === 'string' ? plannedDirectory.dn : null,
        targetDirectoryObjectGuid: typeof plannedDirectory?.objectGuid === 'string' ? plannedDirectory.objectGuid : null,
        targetVpnRecordId: typeof plannedVpn?.id === 'string' ? plannedVpn.id : null,
        sourceRequestId: typeof target.requestId === 'string' ? target.requestId : null,
        sourceBatchItemId: typeof target.sourceBatchItemId === 'string' ? target.sourceBatchItemId : null,
        planOrdinal: plannedChild.ordinal,
        reason: plan.description,
        reference: plan.relatedTicketId ?? '',
        notes: plan.notes?.trim() || null,
      };
    }

    if (reviewedDeletionPlan && (
      normalizedReason !== reviewedDeletionPlan.reason
      || (typeof relatedTicketId === 'string' ? relatedTicketId.trim() : '') !== reviewedDeletionPlan.reference
      || (typeof notes === 'string' && notes.trim() ? notes.trim() : null) !== reviewedDeletionPlan.notes
    )) {
      return NextResponse.json({ error: 'Reason, reference, or notes changed after deletion-plan confirmation.' }, { status: 409 });
    }

    // Validate required fields
    if (!actionType || !targetAccountType || !targetUsername || !normalizedReason) {
      return NextResponse.json(
        { error: 'actionType, targetAccountType, targetUsername, and reason are required' },
        { status: 400 }
      );
    }
    if (normalizedReason.length > 2_000) {
      return NextResponse.json({ error: 'reason must be 2,000 characters or fewer.' }, { status: 400 });
    }

    // Validate actionType
    if (!VALID_LIFECYCLE_MUTATION_ACTIONS.includes(actionType as typeof VALID_LIFECYCLE_MUTATION_ACTIONS[number])) {
      return NextResponse.json(
        { error: `Invalid actionType. Must be one of: ${VALID_LIFECYCLE_MUTATION_ACTIONS.join(', ')}` },
        { status: 400 }
      );
    }
    if (AD_ACTIONS.has(actionType) && !actorHasPermission(admin, 'users.manage')) {
      return NextResponse.json({ error: 'Directory account changes require users.manage.' }, { status: 403 });
    }
    if (actionType === 'delete_ad' && !actorHasPermission(admin, 'lifecycle.delete')) {
      return NextResponse.json({ error: 'Permanent directory deletion requires lifecycle.delete.' }, { status: 403 });
    }
    if (actionType === 'delete_vpn_record' && !actorHasPermission(admin, 'vpn.delete')) {
      return NextResponse.json({ error: 'Permanent VPN record deletion requires vpn.delete.' }, { status: 403 });
    }
    if (VPN_ACTIONS.has(actionType) && !actorHasPermission(admin, 'vpn.manage')) {
      return NextResponse.json({ error: 'VPN account changes require vpn.manage.' }, { status: 403 });
    }
    const effectiveTargetAccountType = TARGET_TYPE_FOR_ACTION[actionType];
    if (targetAccountType !== effectiveTargetAccountType) {
      return NextResponse.json(
        { error: `${actionType} requires targetAccountType ${effectiveTargetAccountType}` },
        { status: 400 }
      );
    }
    if (scheduledFor) {
      return NextResponse.json(
        { error: 'Scheduled lifecycle actions are not supported by this immediate-action form.' },
        { status: 400 }
      );
    }

    const deleteAd = actionType === 'delete_ad';
    const deleteVpnRecord = actionType === 'delete_vpn_record';
    const ticketReference = typeof relatedTicketId === 'string' ? relatedTicketId.trim() : '';
    if (deleteAd) {
      if (!['governed', 'batch_governed'].includes(operationMode) && !(operationMode === 'directory_override' && reviewedDeletionPlan)) {
        return NextResponse.json({ error: 'Permanent directory deletion is available only for governed accounts.' }, { status: 400 });
      }
      if (!explicitRelatedRequestId && !explicitBatchAccountItemId && operationMode !== 'directory_override') {
        return NextResponse.json({ error: 'Permanent directory deletion requires its owning request or batch item.' }, { status: 400 });
      }
      if (!ticketReference) {
        return NextResponse.json({ error: 'Permanent directory deletion requires a ticket or change reference.' }, { status: 400 });
      }
      if (ticketReference.length < 3 || ticketReference.length > 200) {
        return NextResponse.json({ error: 'The deletion ticket or change reference must be between 3 and 200 characters.' }, { status: 400 });
      }
      if (normalizedReason.length < 10) {
        return NextResponse.json({ error: 'Permanent directory deletion requires a substantive reason of at least 10 characters.' }, { status: 400 });
      }
      const requiredDeletionPhrase = `DELETE ${targetUsername}`;
      if (!reviewedDeletionPlan && destructiveAcknowledgement !== requiredDeletionPhrase) {
        return NextResponse.json({ error: `Type ${requiredDeletionPhrase} exactly to confirm permanent deletion.` }, { status: 400 });
      }
      if (!reviewedDeletionPlan && irreversibleAcknowledgement !== true) {
        return NextResponse.json({ error: 'Acknowledge that permanent directory deletion cannot be restored by the portal.' }, { status: 400 });
      }
    }
    if (deleteVpnRecord) {
      if (operationMode !== 'governed') {
        return NextResponse.json({ error: 'Permanent VPN record deletion does not support directory override.' }, { status: 400 });
      }
      if (!ticketReference) {
        return NextResponse.json({ error: 'Permanent VPN record deletion requires a ticket or change reference.' }, { status: 400 });
      }
      if (ticketReference.length < 3 || ticketReference.length > 200) {
        return NextResponse.json({ error: 'The deletion ticket or change reference must be between 3 and 200 characters.' }, { status: 400 });
      }
      if (normalizedReason.length < 10) {
        return NextResponse.json({ error: 'Permanent VPN record deletion requires a substantive reason of at least 10 characters.' }, { status: 400 });
      }
      const requiredDeletionPhrase = `DELETE VPN RECORD ${targetUsername}`;
      if (!reviewedDeletionPlan && destructiveAcknowledgement !== requiredDeletionPhrase) {
        return NextResponse.json({ error: `Type ${requiredDeletionPhrase} exactly to confirm permanent deletion.` }, { status: 400 });
      }
      if (!reviewedDeletionPlan && irreversibleAcknowledgement !== true) {
        return NextResponse.json({ error: 'Acknowledge that the live VPN record and retained credential will be permanently removed.' }, { status: 400 });
      }
    }

    // Any action that promises a VPN change requires the VPN module. AD-only
    // actions remain available when the module is disabled.
    let vpnModuleEnabled: boolean;
    try {
      vpnModuleEnabled = deleteVpnRecord
        ? await isModuleEnabledStrict('vpn.management')
        : await isModuleEnabled('vpn.management');
    } catch (error) {
      console.error('Unable to verify VPN module state for destructive lifecycle action:', error);
      return NextResponse.json({
        error: 'VPN module state could not be verified; permanent deletion is blocked.',
        code: 'MODULE_STATE_UNAVAILABLE',
        moduleId: 'vpn.management',
      }, { status: 503 });
    }
    if (
      !vpnModuleEnabled &&
      VPN_ACTIONS.has(actionType)
    ) {
      return NextResponse.json(
        {
          error: 'VPN management is disabled; VPN lifecycle actions are unavailable.',
          code: 'MODULE_DISABLED',
          moduleId: 'vpn.management',
        },
        { status: 409 }
      );
    }

    if (!['governed', 'batch_governed', 'directory_override'].includes(operationMode)) {
      return NextResponse.json({ error: 'operationMode is not supported.' }, { status: 400 });
    }

    const directoryOverride = operationMode === 'directory_override';
    const batchGoverned = operationMode === 'batch_governed';
    let targetDirectoryDn: string | null = null;
    let targetDirectoryObjectGuid: string | null = null;
    let bindingFailureCode: string | null = null;
    let preflightSnapshot: Prisma.InputJsonObject | undefined;
    let authorizationEvidence: Prisma.InputJsonObject | undefined;
    let policyVersion: string | null = null;

    if (directoryOverride) {
      if (!actorHasPermission(admin, 'lifecycle.override')) {
        return NextResponse.json({ error: 'Directory-only exceptions require lifecycle.override.' }, { status: 403 });
      }
      if (deleteAd && !actorHasPermission(admin, 'lifecycle.delete_unmanaged')) {
        return NextResponse.json({ error: 'Deleting an unowned directory account requires lifecycle.delete_unmanaged.' }, { status: 403 });
      }
      if (!['disable_ad', 'enable_ad', 'delete_ad'].includes(actionType)) {
        return NextResponse.json({ error: 'Directory-only exceptions support only AD enable, disable, or reviewed deletion actions.' }, { status: 400 });
      }
      const evidence = reviewedDeletionPlan
        ? normalizedReason
        : typeof exceptionEvidence === 'string' ? exceptionEvidence.trim() : '';
      const minimumEvidenceLength = reviewedDeletionPlan ? 10 : 20;
      if (evidence.length < minimumEvidenceLength || evidence.length > 5_000 || !ticketReference) {
        return NextResponse.json({
          error: `Directory-only exceptions require a ticket/reference and at least ${minimumEvidenceLength} characters of justification.`,
        }, { status: 400 });
      }
      if (!reviewedDeletionPlan && overrideAcknowledgement !== targetUsername) {
        return NextResponse.json({ error: 'Type the exact target username to confirm this directory-only exception.' }, { status: 400 });
      }
      const directoryUser = await searchLDAPUser(targetUsername);
      if (!directoryUser) {
        return NextResponse.json({ error: `AD account ${targetUsername} was not found.`, code: 'DIRECTORY_ACCOUNT_NOT_FOUND' }, { status: 404 });
      }
      await assertLifecycleAccountNotProtected(directoryUser);
      const anyLinkedRequest = await prisma.accessRequest.findFirst({
        where: {
          status: { not: 'rejected' },
          OR: [
            { ldapUsername: { equals: targetUsername, mode: 'insensitive' } },
            { linkedAdUsername: { equals: targetUsername, mode: 'insensitive' } },
          ],
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      if (anyLinkedRequest) {
        return NextResponse.json({
          error: 'This directory account has an application record. Resolve its governed state instead of using directory override.',
          code: 'DIRECTORY_OVERRIDE_NOT_ALLOWED',
        }, { status: 409 });
      }
      const anyBatchOwner = await prisma.batchAccountItem.findFirst({
        where: {
          lifecycleOwnerKind: 'batch_item',
          accessRequestId: null,
          accountType: { in: ['AD', 'BOTH'] },
          status: { in: ['processing', 'completed', 'reconciliation_required'] },
          ldapUsername: { equals: targetUsername, mode: 'insensitive' },
          OR: [{ adAccountStatus: null }, { adAccountStatus: { not: 'deleted' } }],
        },
        select: { id: true, batchId: true },
      });
      if (anyBatchOwner) {
        return NextResponse.json({
          error: 'This directory account belongs to a batch run. Use its batch-governed lifecycle record instead of directory override.',
          code: 'DIRECTORY_OVERRIDE_NOT_ALLOWED',
        }, { status: 409 });
      }
      preflightSnapshot = directoryPreflightSnapshot(directoryUser);
      if (typeof preflightSnapshot.objectGuid !== 'string' || !preflightSnapshot.objectGuid) {
        return NextResponse.json({ error: 'Directory immutable identity could not be read; override is blocked.' }, { status: 409 });
      }
      targetDirectoryDn = directoryUser.objectName;
      targetDirectoryObjectGuid = typeof preflightSnapshot.objectGuid === 'string'
        ? preflightSnapshot.objectGuid
        : null;
      bindingFailureCode = 'APPLICATION_REQUEST_LINK_MISSING';
      if (deleteAd && preflightSnapshot.enabled !== false) {
        return NextResponse.json({ error: 'The unmanaged directory account must be disabled before permanent deletion.' }, { status: 409 });
      }
      policyVersion = deleteAd ? UNMANAGED_DIRECTORY_DELETE_POLICY_VERSION : DIRECTORY_OVERRIDE_POLICY_VERSION;
      authorizationEvidence = {
        ...(deleteAd ? { destructiveAction: 'delete_ad', [DIRECTORY_DELETE_METHOD_EVIDENCE_KEY]: DIRECTORY_DELETE_METHOD } : {}),
        ticketReference,
        justification: evidence,
        typedAcknowledgement: reviewedDeletionPlan?.typedAcknowledgement ?? overrideAcknowledgement,
        ...(deleteAd ? { irreversibleImpactAcknowledged: true } : {}),
        ...(reviewedDeletionPlan ? {
          bulkPlanId: reviewedDeletionPlan.id,
          selectionDigest: reviewedDeletionPlan.selectionDigest,
          targetCount: reviewedDeletionPlan.targetCount,
          recordCount: reviewedDeletionPlan.recordCount,
        } : {}),
        actor: admin.username,
        authorizedPrivileges: {
          lifecycleManage: actorHasPermission(admin, 'lifecycle.manage'),
          lifecycleOverride: actorHasPermission(admin, 'lifecycle.override'),
          usersManage: actorHasPermission(admin, 'users.manage'),
          lifecycleDelete: actorHasPermission(admin, 'lifecycle.delete'),
          lifecycleDeleteUnmanaged: actorHasPermission(admin, 'lifecycle.delete_unmanaged'),
        },
        viaLegacyAdminFallback: admin.viaLegacyAdminFallback,
        viaLocalBreakGlass: Boolean(admin.viaLocalBreakGlass),
        ipAddress: getIpAddress(request) ?? null,
        userAgent: getUserAgent(request) ?? null,
        confirmedAt: new Date().toISOString(),
        ...(deleteAd ? { safetyChecks: {
          reviewedPlan: Boolean(reviewedDeletionPlan),
          unmanagedOperation: true,
          noPortalOwnerVerified: true,
          liveDirectoryDisabledVerified: preflightSnapshot.enabled === false,
          protectedAccountPolicyPassed: true,
          immutableIdentityCaptured: Boolean(targetDirectoryDn && targetDirectoryObjectGuid),
          irreversibleImpactAcknowledged: true,
        } } : {}),
      };
    }

    // Check if target account exists
    let targetUserId = null;
    let resolvedRelatedRequestId = explicitRelatedRequestId;
    let resolvedBatchAccountItemId = explicitBatchAccountItemId;
    if (!directoryOverride && (effectiveTargetAccountType === 'AD' || effectiveTargetAccountType === 'BOTH')) {
      if (batchGoverned) {
        if (effectiveTargetAccountType !== 'AD' || !explicitBatchAccountItemId || explicitRelatedRequestId) {
          return NextResponse.json({ error: 'Batch-governed lifecycle actions require one AD batch item and no access request.' }, { status: 400 });
        }
        const batchItem = await prisma.batchAccountItem.findUnique({
          where: { id: explicitBatchAccountItemId },
          include: { batch: { select: { id: true, description: true } } },
        });
        const requestOwners = await findLifecycleOwnershipCandidates(
          (args) => prisma.accessRequest.findMany(args),
          targetUsername,
          true
        );
        const batchOwners = await prisma.batchAccountItem.findMany({
          where: {
            lifecycleOwnerKind: 'batch_item',
            accessRequestId: null,
            accountType: { in: ['AD', 'BOTH'] },
            status: { in: ['processing', 'completed', 'reconciliation_required'] },
            ldapUsername: { equals: targetUsername, mode: 'insensitive' },
            OR: [{ adAccountStatus: null }, { adAccountStatus: { not: 'deleted' } }],
          },
          select: { id: true },
          take: 2,
        });
        if (
          !batchItem
          || batchItem.lifecycleOwnerKind !== 'batch_item'
          || batchItem.accessRequestId
          || !['AD', 'BOTH'].includes(batchItem.accountType)
          || batchItem.status !== 'completed'
          || batchItem.ldapUsername.trim().toLowerCase() !== targetUsername.trim().toLowerCase()
          || requestOwners.length > 0
          || batchOwners.length !== 1
          || batchOwners[0].id !== batchItem.id
        ) {
          return NextResponse.json({ error: 'The selected batch item is not the unique lifecycle owner for this AD account.', code: 'BATCH_ACCOUNT_LINK_REQUIRED' }, { status: 409 });
        }
        const directoryUser = await searchLDAPUser(targetUsername);
        if (!directoryUser) return NextResponse.json({ error: `AD account ${targetUsername} was not found.`, code: 'DIRECTORY_ACCOUNT_NOT_FOUND' }, { status: 404 });
        await assertLifecycleAccountNotProtected(directoryUser);
        const snapshot = directoryPreflightSnapshot(directoryUser);
        const snapshotUsername = typeof snapshot.username === 'string' ? snapshot.username.trim().toLowerCase() : '';
        const objectGuid = typeof snapshot.objectGuid === 'string' ? snapshot.objectGuid : '';
        if (
          snapshotUsername !== targetUsername.trim().toLowerCase()
          || !directoryUser.objectName
          || !objectGuid
          || !batchItem.targetDirectoryDn
          || !batchItem.targetDirectoryObjectGuid
          || batchItem.targetDirectoryDn.toLowerCase() !== directoryUser.objectName.toLowerCase()
          || batchItem.targetDirectoryObjectGuid !== objectGuid
        ) {
          return NextResponse.json({ error: 'The live directory identity no longer matches the batch creation evidence.', code: 'DIRECTORY_IDENTITY_CHANGED' }, { status: 409 });
        }
        if (reviewedDeletionPlan && (
          reviewedDeletionPlan.sourceBatchItemId !== batchItem.id
          || reviewedDeletionPlan.targetDirectoryDn?.toLowerCase() !== directoryUser.objectName.toLowerCase()
          || reviewedDeletionPlan.targetDirectoryObjectGuid !== objectGuid
        )) return NextResponse.json({ error: 'The batch or directory object changed after deletion-plan confirmation.' }, { status: 409 });
        const expectedEnabled = actionType === 'disable_ad';
        if (snapshot.enabled !== expectedEnabled) {
          return NextResponse.json({ error: deleteAd ? 'The AD account must be disabled before it can be permanently deleted.' : `The AD account is already ${expectedEnabled ? 'disabled' : 'enabled'}.`, code: 'AD_ACTION_NOT_APPLICABLE' }, { status: 409 });
        }
        if (deleteAd && batchItem.adAccountStatus !== 'disabled') {
          return NextResponse.json({ error: 'The batch account record must show disabled before permanent deletion.', code: 'AD_DELETE_REQUIRES_DISABLED_RECORD' }, { status: 409 });
        }
        if (actionType === 'disable_ad' && batchItem.adAccountStatus !== 'active') {
          return NextResponse.json({ error: 'The batch account record is not in an active state that can be disabled.', code: 'AD_ACTION_NOT_APPLICABLE' }, { status: 409 });
        }
        if (actionType === 'enable_ad' && batchItem.adAccountStatus !== 'disabled') {
          return NextResponse.json({ error: 'The batch account record is not in a disabled state that can be enabled.', code: 'AD_ACTION_NOT_APPLICABLE' }, { status: 409 });
        }
        targetDirectoryDn = directoryUser.objectName;
        targetDirectoryObjectGuid = objectGuid;
        targetUserId = batchItem.id;
        resolvedBatchAccountItemId = batchItem.id;
        preflightSnapshot = {
          ...snapshot,
          bindingMode: 'batch_item_and_object_guid',
          relatedBatchAccountItemId: batchItem.id,
          sourceBatchId: batchItem.batchId,
          batchItemVersion: batchItem.version,
          portalState: {
            adAccountStatus: batchItem.adAccountStatus ?? null,
            disabledAt: batchItem.adDisabledAt?.toISOString() ?? null,
            disabledBy: batchItem.adDisabledBy ?? null,
            disabledReason: batchItem.adDisabledReason ?? null,
          },
        };
        policyVersion = deleteAd ? BATCH_GOVERNED_DIRECTORY_DELETE_POLICY_VERSION : 'batch-governed-directory-identity-v1';
        if (deleteAd) authorizationEvidence = {
          destructiveAction: 'delete_ad', [DIRECTORY_DELETE_METHOD_EVIDENCE_KEY]: DIRECTORY_DELETE_METHOD, ticketReference,
          typedAcknowledgement: reviewedDeletionPlan?.typedAcknowledgement ?? destructiveAcknowledgement,
          irreversibleImpactAcknowledged: irreversibleAcknowledgement === true,
          ...(reviewedDeletionPlan ? { bulkPlanId: reviewedDeletionPlan.id, selectionDigest: reviewedDeletionPlan.selectionDigest, targetCount: reviewedDeletionPlan.targetCount, recordCount: reviewedDeletionPlan.recordCount } : {}),
          actor: admin.username, confirmedAt: new Date().toISOString(),
          safetyChecks: {
            singleAccountOnly: !reviewedDeletionPlan, reviewedPlan: Boolean(reviewedDeletionPlan),
            batchGovernedOperation: true, uniqueBatchOwnerVerified: true, batchLifecycleReady: true,
            portalDisabledVerified: batchItem.adAccountStatus === 'disabled', liveDirectoryDisabledVerified: snapshot.enabled === false,
            protectedAccountPolicyPassed: true, immutableIdentityCaptured: true, irreversibleImpactAcknowledged: irreversibleAcknowledgement === true,
          },
          authorizedPrivileges: { lifecycleManage: true, lifecycleDelete: actorHasPermission(admin, 'lifecycle.delete'), usersManage: actorHasPermission(admin, 'users.manage') },
          ipAddress: getIpAddress(request) ?? null, userAgent: getUserAgent(request) ?? null,
        };
      } else {
      const adAccount = explicitRelatedRequestId
        ? await prisma.accessRequest.findUnique({
            where: { id: explicitRelatedRequestId },
          })
        : await prisma.accessRequest.findFirst({
            where: {
              AND: [{ OR: [
                { ldapUsername: { equals: targetUsername, mode: 'insensitive' } },
                { linkedAdUsername: { equals: targetUsername, mode: 'insensitive' } },
              ] }, { OR: [
                { provisioningState: null },
                { provisioningState: { in: [...LIFECYCLE_READY_NON_NULL_PROVISIONING_STATES] } },
              ] }],
              status: ['enable_ad', 'enable_both', 'delete_ad'].includes(actionType)
                ? { in: ['approved', 'offboarded'] }
                : { notIn: ['rejected', 'offboarded'] },
            },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          });
      if (explicitRelatedRequestId && !adAccount) {
        return NextResponse.json({
          error: 'The selected access request no longer exists.',
          code: 'ACCESS_REQUEST_LINK_REQUIRED',
        }, { status: 409 });
      }
      if (adAccount) {
        if (!isAccessRequestDirectoryIdentityConsistent(adAccount)) {
          return NextResponse.json({
            error: 'The linked access request contains conflicting AD identity aliases. Resolve the request before lifecycle processing.',
            code: 'ACCESS_REQUEST_DIRECTORY_IDENTITY_CONFLICT',
          }, { status: 409 });
        }
        const boundUsernames = [adAccount.ldapUsername, adAccount.linkedAdUsername]
          .filter((value): value is string => Boolean(value))
          .map((value) => value.toLowerCase());
        if (explicitRelatedRequestId && !boundUsernames.includes(targetUsername.toLowerCase())) {
          return NextResponse.json(
            { error: 'The related request is not bound to the target AD username.' },
            { status: 409 }
          );
        }
        const allowedRequestStatuses = ['enable_ad', 'enable_both', 'delete_ad'].includes(actionType)
          ? ['approved', 'offboarded']
          : ['approved'];
        if (!allowedRequestStatuses.includes(adAccount.status) || !isLifecycleProvisioningReady(adAccount.provisioningState)) {
          return NextResponse.json({
            error: 'The linked access request has not completed governed provisioning or reconciliation.',
            code: 'ACCESS_REQUEST_NOT_LIFECYCLE_READY',
          }, { status: 409 });
        }
        const ownershipMatches = await findLifecycleOwnershipCandidates(
          (args) => prisma.accessRequest.findMany(args),
          targetUsername,
          ['enable_ad', 'enable_both', 'delete_ad'].includes(actionType)
        );
        if (ownershipMatches.length !== 1 || ownershipMatches[0].id !== adAccount.id) {
          return NextResponse.json({
            error: ownershipMatches.length > 1
              ? 'More than one request claims this AD username.'
              : 'The selected request is not the unique request owner for this AD username.',
            code: ownershipMatches.length > 1 ? 'AMBIGUOUS_ACCESS_REQUEST_LINK' : 'ACCESS_REQUEST_LINK_REQUIRED',
          }, { status: 409 });
        }
        const directoryUser = await searchLDAPUser(targetUsername);
        if (!directoryUser) {
          return NextResponse.json({
            error: `AD account ${targetUsername} was not found.`,
            code: 'DIRECTORY_ACCOUNT_NOT_FOUND',
          }, { status: 404 });
        }
        await assertLifecycleAccountNotProtected(directoryUser);
        const snapshot = directoryPreflightSnapshot(directoryUser);
        const snapshotUsername = typeof snapshot.username === 'string' ? snapshot.username.trim().toLowerCase() : '';
        const objectGuid = typeof snapshot.objectGuid === 'string' ? snapshot.objectGuid : '';
        if (snapshotUsername !== targetUsername.trim().toLowerCase() || !directoryUser.objectName || !objectGuid) {
          return NextResponse.json({
            error: 'The live directory identity could not be confirmed for this username.',
            code: 'DIRECTORY_IDENTITY_REQUIRED',
          }, { status: 409 });
        }
        if (reviewedDeletionPlan && (
          reviewedDeletionPlan.targetDirectoryDn?.toLowerCase() !== directoryUser.objectName.toLowerCase()
          || reviewedDeletionPlan.targetDirectoryObjectGuid !== objectGuid
        )) {
          return NextResponse.json({ error: 'The directory object changed after deletion-plan confirmation.' }, { status: 409 });
        }
        const expectedEnabled = ['disable_ad', 'disable_both'].includes(actionType);
        if (snapshot.enabled !== expectedEnabled) {
          return NextResponse.json({
            error: deleteAd
              ? 'The AD account must be disabled before it can be permanently deleted.'
              : `The AD account is already ${expectedEnabled ? 'disabled' : 'enabled'}.`,
            code: 'AD_ACTION_NOT_APPLICABLE',
          }, { status: 409 });
        }
        if (deleteAd && adAccount.adAccountStatus !== 'disabled') {
          return NextResponse.json({
            error: 'The portal account record must show disabled before permanent deletion.',
            code: 'AD_DELETE_REQUIRES_DISABLED_RECORD',
          }, { status: 409 });
        }
        targetDirectoryDn = directoryUser.objectName;
        targetDirectoryObjectGuid = objectGuid;
        preflightSnapshot = {
          ...snapshot,
          bindingMode: 'portal_request_and_object_guid',
          relatedRequestId: adAccount.id,
          requestVersion: adAccount.version,
          portalState: {
            adAccountStatus: adAccount.adAccountStatus ?? null,
            disabledAt: adAccount.adDisabledAt?.toISOString() ?? null,
            disabledBy: adAccount.adDisabledBy ?? null,
            disabledReason: adAccount.adDisabledReason ?? null,
          },
        };
        policyVersion = deleteAd ? GOVERNED_DIRECTORY_DELETE_POLICY_VERSION : GOVERNED_DIRECTORY_IDENTITY_POLICY_VERSION;
        targetUserId = adAccount.id;
        resolvedRelatedRequestId = adAccount.id;
        if (deleteAd) {
          authorizationEvidence = {
            destructiveAction: 'delete_ad',
            [DIRECTORY_DELETE_METHOD_EVIDENCE_KEY]: DIRECTORY_DELETE_METHOD,
            ticketReference,
            typedAcknowledgement: reviewedDeletionPlan?.typedAcknowledgement ?? destructiveAcknowledgement,
            irreversibleImpactAcknowledged: irreversibleAcknowledgement === true,
            ...(reviewedDeletionPlan ? {
              bulkPlanId: reviewedDeletionPlan.id,
              selectionDigest: reviewedDeletionPlan.selectionDigest,
              targetCount: reviewedDeletionPlan.targetCount,
              recordCount: reviewedDeletionPlan.recordCount,
            } : {}),
            actor: admin.username,
            confirmedAt: new Date().toISOString(),
            safetyChecks: {
              singleAccountOnly: !reviewedDeletionPlan,
              reviewedPlan: Boolean(reviewedDeletionPlan),
              governedOperation: true,
              uniqueRequestOwnerVerified: true,
              requestLifecycleReady: true,
              portalDisabledVerified: adAccount.adAccountStatus === 'disabled',
              liveDirectoryDisabledVerified: snapshot.enabled === false,
              protectedAccountPolicyPassed: true,
              immutableIdentityCaptured: Boolean(directoryUser.objectName && objectGuid),
              irreversibleImpactAcknowledged: irreversibleAcknowledgement === true,
            },
            authorizedPrivileges: {
              lifecycleManage: actorHasPermission(admin, 'lifecycle.manage'),
              lifecycleDelete: actorHasPermission(admin, 'lifecycle.delete'),
              usersManage: actorHasPermission(admin, 'users.manage'),
            },
            ipAddress: getIpAddress(request) ?? null,
            userAgent: getUserAgent(request) ?? null,
          };
        }

        if (effectiveTargetAccountType === 'BOTH') {
          const requestVpnUsernames = [adAccount.linkedVpnUsername, adAccount.vpnUsername]
            .filter((value): value is string => Boolean(value));
          const linkedVpnAccounts = await prisma.vPNAccount.findMany({
            where: {
              OR: [
                { accessRequestId: adAccount.id },
                { adUsername: { equals: targetUsername, mode: 'insensitive' } },
                ...requestVpnUsernames.map((username) => ({
                  username: { equals: username, mode: 'insensitive' as const },
                })),
              ],
            },
            orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
            take: 2,
          });
          if (linkedVpnAccounts.length !== 1) {
            return NextResponse.json({
              error: linkedVpnAccounts.length > 1
                ? 'More than one VPN account claims this request or AD username. Use a single-system action after reviewing the VPN records.'
                : 'No unique VPN account is available for this combined action.',
              code: linkedVpnAccounts.length > 1 ? 'AMBIGUOUS_VPN_TARGET' : 'VPN_ACCOUNT_LINK_REQUIRED',
            }, { status: 409 });
          }
          const [linkedVpnAccount] = linkedVpnAccounts;
          const normalizedVpnUsername = linkedVpnAccount.username.trim().toLowerCase();
          const requestMatchesVpn = requestVpnUsernames.length > 0
            ? requestVpnUsernames.some((username) => username.trim().toLowerCase() === normalizedVpnUsername)
            : linkedVpnAccount.accessRequestId === adAccount.id;
          const requestIdMatches = linkedVpnAccount.accessRequestId === adAccount.id;
          const adUsernameMatches = !linkedVpnAccount.adUsername
            || linkedVpnAccount.adUsername.trim().toLowerCase() === targetUsername.trim().toLowerCase();
          if (!requestMatchesVpn || !requestIdMatches || !adUsernameMatches) {
            return NextResponse.json({
              error: 'The VPN account and request contain conflicting identity evidence. Use a single-system action after reviewing the VPN records.',
              code: 'VPN_REQUEST_LINK_CONFLICT',
            }, { status: 409 });
          }
          const vpnStatus = linkedVpnAccount.status.toLowerCase();
          const vpnActionNotApplicable = actionType === 'disable_both'
            ? ['revoked', 'disabled'].includes(vpnStatus)
            : vpnStatus !== 'revoked' || !linkedVpnAccount.canRestore;
          if (vpnActionNotApplicable) {
            return NextResponse.json({
              error: 'The VPN portion of this combined action does not apply to the account current state or restore policy.',
              code: 'VPN_ACTION_NOT_APPLICABLE',
            }, { status: 409 });
          }
        }
      }
      }
    } else if (effectiveTargetAccountType === 'VPN') {
      const vpnAccount = await prisma.vPNAccount.findUnique({
        where: { username: targetUsername },
      });
      if (vpnAccount) {
        if (vpnAccount.username.toLowerCase() !== targetUsername.toLowerCase()) {
          return NextResponse.json({ error: 'The VPN account is not bound to the target username.' }, { status: 409 });
        }
        if (reviewedDeletionPlan && reviewedDeletionPlan.targetVpnRecordId !== vpnAccount.id) {
          return NextResponse.json({ error: 'The VPN record changed after deletion-plan confirmation.' }, { status: 409 });
        }
        if (reviewedDeletionPlan && (vpnAccount.accessRequestId ?? null) !== reviewedDeletionPlan.sourceRequestId) {
          return NextResponse.json(
            { error: 'The VPN request ownership changed after deletion-plan confirmation.' },
            { status: 409 }
          );
        }
        if (explicitRelatedRequestId && vpnAccount.accessRequestId !== explicitRelatedRequestId) {
          return NextResponse.json(
            { error: 'The related request is not bound to the target VPN account.' },
            { status: 409 }
          );
        }
        const linkedRequest = vpnAccount.accessRequestId
          ? await prisma.accessRequest.findUnique({ where: { id: vpnAccount.accessRequestId } })
          : null;
        let linkedBatchItem = explicitBatchAccountItemId
          ? await prisma.batchAccountItem.findUnique({ where: { id: explicitBatchAccountItemId } })
          : vpnAccount.batchAccountItemId
            ? await prisma.batchAccountItem.findUnique({ where: { id: vpnAccount.batchAccountItemId } })
            : vpnAccount.accessRequestId
              ? await prisma.batchAccountItem.findUnique({ where: { accessRequestId: vpnAccount.accessRequestId } })
              : null;
        if (vpnAccount.accessRequestId && !linkedRequest) {
          return NextResponse.json({
            error: 'The VPN account points to a request that no longer exists. Reconcile the VPN link before continuing.',
            code: 'VPN_REQUEST_LINK_CONFLICT',
          }, { status: 409 });
        }
        if (explicitBatchAccountItemId && (
          !linkedBatchItem
          || linkedBatchItem.batchId !== vpnAccount.batchId
          || linkedBatchItem.vpnUsername?.trim().toLowerCase() !== vpnAccount.username.trim().toLowerCase()
          || (vpnAccount.batchAccountItemId && vpnAccount.batchAccountItemId !== linkedBatchItem.id)
        )) {
          return NextResponse.json({
            error: 'The VPN record no longer matches the selected batch item. Refresh the account inventory before continuing.',
            code: 'VPN_BATCH_LINK_CONFLICT',
          }, { status: 409 });
        }
        if (deleteVpnRecord) {
          const vpnBatchOwners = await findActiveVpnBatchOwnershipClaims(
            (args) => prisma.batchAccountItem.findMany(args),
            vpnAccount.username
          );
          const explicitLegacyBatchValid = Boolean(
            linkedBatchItem && vpnAccount.accessRequestId
            && linkedBatchItem.lifecycleOwnerKind === 'access_request_legacy'
            && linkedBatchItem.accessRequestId === vpnAccount.accessRequestId
            && (!linkedBatchItem.vpnUsername || sameVpnUsername(linkedBatchItem.vpnUsername, vpnAccount.username))
            && (!vpnAccount.batchId || linkedBatchItem.batchId === vpnAccount.batchId)
          );
          const explicitBatchOwner = vpnAccount.batchAccountItemId
            ? vpnBatchOwners.find((item) => item.id === vpnAccount.batchAccountItemId && sameVpnUsername(item.vpnUsername, vpnAccount.username)) ?? null
            : null;
          const legacyBatchOwners = !vpnAccount.batchAccountItemId && vpnAccount.batchId
            ? vpnBatchOwners.filter((item) => item.batchId === vpnAccount.batchId && sameVpnUsername(item.vpnUsername, vpnAccount.username))
            : [];
          if (
            vpnBatchOwners.length > 1
            || (vpnAccount.batchAccountItemId && !explicitLegacyBatchValid && (!explicitBatchOwner || vpnBatchOwners.length !== 1))
            || (!vpnAccount.batchAccountItemId && vpnAccount.batchId && vpnBatchOwners.length > 0 && legacyBatchOwners.length !== 1)
          ) {
            return NextResponse.json({
              error: 'Batch ownership for this VPN record is incomplete or conflicting. Reconcile the linkage before deletion.',
              code: 'VPN_BATCH_LINK_CONFLICT',
            }, { status: 409 });
          }
          const vpnBatchOwner = explicitBatchOwner ?? legacyBatchOwners[0] ?? null;
          if (vpnBatchOwners.length > 0 && vpnAccount.accessRequestId) {
            return NextResponse.json({
              error: 'A request and a standalone batch item both claim this VPN record. Reconcile the linkage before deletion.',
              code: 'VPN_REQUEST_BATCH_OWNERSHIP_CONFLICT',
            }, { status: 409 });
          }
          if (vpnBatchOwners.length > 0 && !vpnBatchOwner) {
            return NextResponse.json({
              error: 'A batch item claims this VPN record, but its recorded linkage needs review.',
              code: 'VPN_BATCH_LINK_CONFLICT',
            }, { status: 409 });
          }
          if (vpnBatchOwner?.status !== undefined && vpnBatchOwner.status !== 'completed') {
            return NextResponse.json({
              error: 'The batch-owned VPN record is not ready for deletion.',
              code: 'VPN_BATCH_DELETE_NOT_READY',
            }, { status: 409 });
          }
          if (
            explicitBatchAccountItemId
            && linkedBatchItem?.lifecycleOwnerKind === 'batch_item'
            && (!vpnBatchOwner || vpnBatchOwner.id !== linkedBatchItem.id)
          ) {
            return NextResponse.json({
              error: 'The selected batch item no longer holds an active VPN ownership claim.',
              code: 'VPN_BATCH_LINK_CONFLICT',
            }, { status: 409 });
          }
          if (vpnBatchOwner) {
            linkedBatchItem = vpnBatchOwner;
            resolvedBatchAccountItemId = vpnBatchOwner.id;
          }
          if (reviewedDeletionPlan && (resolvedBatchAccountItemId ?? null) !== reviewedDeletionPlan.sourceBatchItemId) {
            return NextResponse.json({
              error: 'The VPN batch ownership changed after deletion-plan confirmation.',
              code: 'VPN_BATCH_LINK_CONFLICT',
            }, { status: 409 });
          }
        }
        if (linkedRequest) {
          const requestVpnUsernames = [linkedRequest.vpnUsername, linkedRequest.linkedVpnUsername]
            .filter((value): value is string => Boolean(value))
            .map((value) => value.trim().toLowerCase());
          const requestAdUsernames = [linkedRequest.ldapUsername, linkedRequest.linkedAdUsername]
            .filter((value): value is string => Boolean(value))
            .map((value) => value.trim().toLowerCase());
          const vpnUsernameMatches = requestVpnUsernames.length === 0
            || requestVpnUsernames.includes(vpnAccount.username.trim().toLowerCase());
          const adUsernameMatches = !vpnAccount.adUsername
            || requestAdUsernames.includes(vpnAccount.adUsername.trim().toLowerCase());
          if (!vpnUsernameMatches || !adUsernameMatches) {
            return NextResponse.json({
              error: 'The VPN account and request contain conflicting identity evidence. Reconcile the link before continuing.',
              code: 'VPN_REQUEST_LINK_CONFLICT',
            }, { status: 409 });
          }
        }
        const activeRequestClaimants = deleteVpnRecord
          ? await findActiveVpnRequestClaimants(
              (args) => prisma.accessRequest.findMany(args),
              vpnAccount.username
            )
          : [];
        if (
          deleteVpnRecord
          && (
            activeRequestClaimants.length > 1
            || (activeRequestClaimants.length === 1
              && activeRequestClaimants[0].id !== vpnAccount.accessRequestId)
          )
        ) {
          return NextResponse.json({
            error: 'A valid access request claims this VPN username but is not coherently linked to the VPN record. Reconcile the link before deletion.',
            code: 'VPN_REQUEST_LINK_CONFLICT',
          }, { status: 409 });
        }
        const vpnStatus = vpnAccount.status.toLowerCase();
        const actionNotApplicable = (
          (actionType === 'revoke_vpn' && ['revoked', 'disabled'].includes(vpnStatus))
          || (actionType === 'restore_vpn' && (vpnStatus !== 'revoked' || !vpnAccount.canRestore))
          || (actionType === 'delete_vpn_record' && vpnStatus !== 'revoked')
          || (actionType === 'promote_vpn_role' && vpnAccount.portalType !== 'Limited')
          || (actionType === 'demote_vpn_role' && vpnAccount.portalType !== 'Management')
        );
        if (actionNotApplicable) {
          return NextResponse.json({
            error: 'The selected VPN action does not apply to the account\'s current status or portal role.',
            code: 'VPN_ACTION_NOT_APPLICABLE',
          }, { status: 409 });
        }
        if (deleteVpnRecord) {
          const latestStatusLog = await prisma.vPNAccountStatusLog.findFirst({
            where: { accountId: vpnAccount.id },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          });
          if (
            !vpnAccount.revokedAt
            || !vpnAccount.revokedBy?.trim()
            || !vpnAccount.revokedReason?.trim()
            || latestStatusLog?.newStatus !== 'revoked'
          ) {
            return NextResponse.json({
              error: 'The VPN record does not have complete revocation evidence. Revoke or reconcile it before deletion.',
              code: 'VPN_DELETE_REVOCATION_EVIDENCE_REQUIRED',
            }, { status: 409 });
          }
          policyVersion = VPN_RECORD_DELETE_POLICY_VERSION;
          preflightSnapshot = {
            observedAt: new Date().toISOString(),
            vpnAccountId: vpnAccount.id,
            username: vpnAccount.username,
            status: vpnAccount.status,
            revokedAt: vpnAccount.revokedAt.toISOString(),
            revokedBy: vpnAccount.revokedBy,
            revokedReason: vpnAccount.revokedReason,
            latestStatusLogId: latestStatusLog.id,
            latestStatus: latestStatusLog.newStatus,
            accessRequestId: vpnAccount.accessRequestId,
            accessRequestVersion: linkedRequest?.version ?? null,
            batchAccountItemId: linkedBatchItem?.id ?? null,
            batchAccountItemVersion: linkedBatchItem?.version ?? null,
            sourceBatchId: linkedBatchItem?.batchId ?? vpnAccount.batchId ?? null,
            activeRequestClaimantIds: activeRequestClaimants.map((claimant) => claimant.id),
          };
          authorizationEvidence = {
            ticketReference,
            typedAcknowledgement: reviewedDeletionPlan?.typedAcknowledgement ?? destructiveAcknowledgement,
            irreversibleImpactAcknowledged: true,
            ...(reviewedDeletionPlan ? {
              bulkPlanId: reviewedDeletionPlan.id,
              selectionDigest: reviewedDeletionPlan.selectionDigest,
              targetCount: reviewedDeletionPlan.targetCount,
              recordCount: reviewedDeletionPlan.recordCount,
            } : {}),
            actor: admin.username,
            authorizedPrivileges: {
              lifecycleManage: actorHasPermission(admin, 'lifecycle.manage'),
              vpnManage: actorHasPermission(admin, 'vpn.manage'),
              vpnDelete: actorHasPermission(admin, 'vpn.delete'),
            },
            retainedData: ['status logs', 'comments', 'activity logs', 'lifecycle history', 'audit history', 'request linkage'],
            removedData: ['live VPN account record', 'encrypted VPN credential'],
            ipAddress: getIpAddress(request) ?? null,
            userAgent: getUserAgent(request) ?? null,
            confirmedAt: new Date().toISOString(),
          };
        }
        targetUserId = vpnAccount.id;
        resolvedRelatedRequestId = explicitRelatedRequestId || vpnAccount.accessRequestId || null;
      }
    }

    if (!directoryOverride && (effectiveTargetAccountType === 'AD' || effectiveTargetAccountType === 'BOTH') && !resolvedRelatedRequestId && !resolvedBatchAccountItemId) {
      return NextResponse.json({
        error: `No request or batch owner is linked to AD username ${targetUsername}. Resolve the account linkage in Sync Status before running lifecycle actions.`,
        code: 'LIFECYCLE_OWNER_REQUIRED',
      }, { status: 409 });
    }
    if (effectiveTargetAccountType === 'VPN' && !targetUserId) {
      return NextResponse.json({
        error: `No managed VPN account is linked to username ${targetUsername}. Resolve the account linkage in Sync Status before running lifecycle actions.`,
        code: 'VPN_ACCOUNT_LINK_REQUIRED',
      }, { status: 409 });
    }

    // Persist first, then let the processor acquire the exclusive side-effect claim.
    const action = await prisma.$transaction(async (tx) => {
      if (reviewedDeletionPlan) {
        await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id"::text AS id
          FROM "AccountLifecycleBatch"
          WHERE "id" = ${reviewedDeletionPlan.id}
          FOR UPDATE
        `;
        const lockedPlan = await tx.accountLifecycleBatch.findUnique({ where: { id: reviewedDeletionPlan.id } });
        const lockedEvidence = lockedPlan?.authorizationEvidence;
        if (
          !lockedPlan
          || lockedPlan.status !== 'processing'
          || lockedPlan.policyVersion !== 'reviewed-lifecycle-deletion-plan-v1'
          || lockedPlan.requestedBy !== admin.username
          || lockedPlan.selectionDigest !== reviewedDeletionPlan.selectionDigest
          || !lockedPlan.confirmedAt
          || !lockedPlan.expiresAt
          || lockedPlan.expiresAt.getTime() <= Date.now()
          || lockedPlan.description !== reviewedDeletionPlan.reason
          || (lockedPlan.relatedTicketId ?? '') !== reviewedDeletionPlan.reference
          || (lockedPlan.notes?.trim() || null) !== reviewedDeletionPlan.notes
          || !lockedEvidence
          || typeof lockedEvidence !== 'object'
          || Array.isArray(lockedEvidence)
          || typeof lockedEvidence.auditRecordedAt !== 'string'
          || (planContainsDirectoryDeletion(lockedEvidence.action) && !hasCurrentDirectoryDeleteMethod(lockedEvidence))
        ) {
          throw new LifecyclePreflightChangedError('The reviewed deletion plan is no longer accepting child actions. Refresh and review a new plan for the current AD deletion method.', 'DELETION_PLAN_REVIEW_REFRESH_REQUIRED');
        }
        const earlierChildren = await tx.accountLifecycleAction.findMany({
          where: { batchId: reviewedDeletionPlan.id, planOrdinal: { lt: reviewedDeletionPlan.planOrdinal } },
          select: { planOrdinal: true, status: true },
          orderBy: { planOrdinal: 'asc' },
        });
        if (
          earlierChildren.length !== reviewedDeletionPlan.planOrdinal
          || earlierChildren.some((child, index) => child.planOrdinal !== index || !['completed', 'failed', 'cancelled'].includes(child.status))
        ) {
          throw new LifecyclePreflightChangedError('Earlier deletion-plan records must reach a known outcome before this record can start.', 'DELETION_PLAN_ORDER_REQUIRED');
        }
      }
      if (effectiveTargetAccountType === 'AD' || effectiveTargetAccountType === 'BOTH') {
        const canonicalAdUsername = targetUsername.trim().toLowerCase();
        await tx.$queryRaw<Array<{ lock_acquired: string }>>`
          SELECT 'locked'::text AS lock_acquired
          FROM pg_advisory_xact_lock(hashtextextended(${canonicalAdUsername}, 873211))
        `;
        if (directoryOverride) {
          const [lockedRequestOwner, lockedBatchOwner] = await Promise.all([
            tx.accessRequest.findFirst({
              where: {
                status: { not: 'rejected' },
                OR: [
                  { ldapUsername: { equals: targetUsername, mode: 'insensitive' } },
                  { linkedAdUsername: { equals: targetUsername, mode: 'insensitive' } },
                ],
              },
              select: { id: true },
            }),
            tx.batchAccountItem.findFirst({
              where: {
                lifecycleOwnerKind: 'batch_item',
                accessRequestId: null,
                accountType: { in: ['AD', 'BOTH'] },
                status: { in: ['processing', 'completed', 'reconciliation_required'] },
                ldapUsername: { equals: targetUsername, mode: 'insensitive' },
                OR: [{ adAccountStatus: null }, { adAccountStatus: { not: 'deleted' } }],
              },
              select: { id: true },
            }),
          ]);
          if (lockedRequestOwner || lockedBatchOwner) {
            throw new LifecyclePreflightChangedError(
              'A portal request or batch item now owns this directory username. Refresh the account inventory and use the governed action path.',
              'DIRECTORY_OVERRIDE_NOT_ALLOWED'
            );
          }
          if (deleteAd) {
            const competingDelete = await tx.accountLifecycleAction.findFirst({
              where: {
                actionType: 'delete_ad',
                targetDirectoryObjectGuid,
                status: { in: ['queued', 'processing', 'reconciliation_required'] },
              },
              select: { id: true },
            });
            if (competingDelete) {
              throw new LifecyclePreflightChangedError(
                'A permanent deletion for this directory object is already active or awaiting reconciliation.',
                'AD_DELETE_ALREADY_ACTIVE'
              );
            }
          }
        } else if (batchGoverned) {
          const lockedRows = await tx.$queryRaw<Array<{ id: string }>>`
            SELECT "id"::text AS id
            FROM "BatchAccountItem"
            WHERE "id" = ${resolvedBatchAccountItemId}
            FOR UPDATE
          `;
          const lockedBatchItem = resolvedBatchAccountItemId
            ? await tx.batchAccountItem.findUnique({ where: { id: resolvedBatchAccountItemId } })
            : null;
          const requestOwners = await findLifecycleOwnershipCandidates(
            (args) => tx.accessRequest.findMany(args),
            targetUsername,
            true
          );
          const batchOwners = await tx.batchAccountItem.findMany({
            where: {
              lifecycleOwnerKind: 'batch_item', accessRequestId: null,
              accountType: { in: ['AD', 'BOTH'] }, status: { in: ['processing', 'completed', 'reconciliation_required'] },
              ldapUsername: { equals: targetUsername, mode: 'insensitive' },
              OR: [{ adAccountStatus: null }, { adAccountStatus: { not: 'deleted' } }],
            },
            select: { id: true }, take: 2,
          });
          if (
            lockedRows.length !== 1
            || !lockedBatchItem
            || lockedBatchItem.lifecycleOwnerKind !== 'batch_item'
            || lockedBatchItem.accessRequestId
            || lockedBatchItem.status !== 'completed'
            || lockedBatchItem.ldapUsername.trim().toLowerCase() !== canonicalAdUsername
            || requestOwners.length > 0
            || batchOwners.length !== 1
            || batchOwners[0].id !== lockedBatchItem.id
            || lockedBatchItem.version !== preflightSnapshot?.batchItemVersion
            || lockedBatchItem.targetDirectoryDn?.toLowerCase() !== targetDirectoryDn?.toLowerCase()
            || lockedBatchItem.targetDirectoryObjectGuid !== targetDirectoryObjectGuid
            || (deleteAd && lockedBatchItem.adAccountStatus !== 'disabled')
            || (actionType === 'disable_ad' && lockedBatchItem.adAccountStatus !== 'active')
            || (actionType === 'enable_ad' && lockedBatchItem.adAccountStatus !== 'disabled')
          ) {
            throw new LifecyclePreflightChangedError(
              'Batch ownership, lifecycle state, or immutable directory evidence changed before the action could be queued.',
              'BATCH_LIFECYCLE_PREFLIGHT_CHANGED'
            );
          }
          if (deleteAd) {
            const competingDelete = await tx.accountLifecycleAction.findFirst({
              where: { actionType: 'delete_ad', targetDirectoryObjectGuid, status: { in: ['queued', 'processing', 'reconciliation_required'] } },
              select: { id: true },
            });
            if (competingDelete) throw new LifecyclePreflightChangedError('A permanent deletion for this directory object is already active or awaiting reconciliation.', 'AD_DELETE_ALREADY_ACTIVE');
          }
        } else {
          const lockedOwnershipMatches = await findLifecycleOwnershipCandidates(
            (args) => tx.accessRequest.findMany(args),
            targetUsername,
            ['enable_ad', 'enable_both', 'delete_ad'].includes(actionType)
          );
          const lockedOwner = lockedOwnershipMatches[0];
          const allowedLockedStatuses = ['enable_ad', 'enable_both', 'delete_ad'].includes(actionType)
            ? ['approved', 'offboarded']
            : ['approved'];
          if (
            lockedOwnershipMatches.length !== 1
            || lockedOwner?.id !== resolvedRelatedRequestId
            || !lockedOwner
            || !isAccessRequestDirectoryIdentityConsistent(lockedOwner)
            || !allowedLockedStatuses.includes(lockedOwner.status)
            || !isLifecycleProvisioningReady(lockedOwner.provisioningState)
          ) {
            throw new LifecyclePreflightChangedError(
              'Lifecycle ownership or readiness changed before the action could be queued. Refresh the account inventory and try again.',
              'LIFECYCLE_PREFLIGHT_CHANGED'
            );
          }
          if (deleteAd) {
            const lockedPortalAccount = await tx.accessRequest.findUnique({
              where: { id: resolvedRelatedRequestId! },
              select: { adAccountStatus: true, version: true },
            });
            const confirmedRequestVersion = preflightSnapshot?.requestVersion;
            if (
              lockedPortalAccount?.adAccountStatus !== 'disabled'
              || lockedPortalAccount.version !== confirmedRequestVersion
            ) {
              throw new LifecyclePreflightChangedError(
                'The portal disabled-account record changed before deletion could be queued. Refresh the account inventory and review the evidence again.',
                'AD_DELETE_PREFLIGHT_CHANGED'
              );
            }
            const competingDelete = await tx.accountLifecycleAction.findFirst({
              where: {
                actionType: 'delete_ad',
                targetDirectoryObjectGuid,
                status: { in: ['queued', 'processing', 'reconciliation_required'] },
              },
              select: { id: true },
            });
            if (competingDelete) {
              throw new LifecyclePreflightChangedError(
                'A permanent deletion for this directory object is already active or awaiting reconciliation.',
                'AD_DELETE_ALREADY_ACTIVE'
              );
            }
          }
        }
      }
      if (effectiveTargetAccountType === 'VPN') {
        const canonicalVpnUsername = targetUsername.trim().toLowerCase();
        if (deleteVpnRecord) {
          await acquireVpnOwnershipFence(tx, canonicalVpnUsername);
        }
        await tx.$queryRaw<Array<{ lock_acquired: string }>>`
          SELECT 'locked'::text AS lock_acquired
          FROM pg_advisory_xact_lock(hashtextextended(${canonicalVpnUsername}, 904771))
        `;
        const lockedRows = await tx.$queryRaw<Array<{ locked_id: string }>>`
          SELECT "id"::text AS locked_id
          FROM "VPNAccount"
          WHERE "id" = ${targetUserId}
          FOR UPDATE
        `;
        if (lockedRows.length !== 1) {
          throw new LifecyclePreflightChangedError(
            'The selected VPN account no longer exists. Refresh the account inventory.',
            'VPN_ACCOUNT_NOT_FOUND'
          );
        }
        const lockedVpnAccount = await tx.vPNAccount.findUnique({ where: { id: targetUserId! } });
        if (!lockedVpnAccount || lockedVpnAccount.username.trim().toLowerCase() !== canonicalVpnUsername) {
          throw new LifecyclePreflightChangedError(
            'The selected VPN account identity changed before the action could be queued.',
            'VPN_TARGET_CHANGED'
          );
        }
        if (deleteVpnRecord) {
          const latestStatusLog = await tx.vPNAccountStatusLog.findFirst({
            where: { accountId: lockedVpnAccount.id },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          });
          const lockedLinkedRequest = lockedVpnAccount.accessRequestId
            ? await tx.accessRequest.findUnique({ where: { id: lockedVpnAccount.accessRequestId } })
            : null;
          let lockedBatchItem = resolvedBatchAccountItemId
            ? await tx.batchAccountItem.findUnique({ where: { id: resolvedBatchAccountItemId } })
            : lockedVpnAccount.batchAccountItemId
              ? await tx.batchAccountItem.findUnique({ where: { id: lockedVpnAccount.batchAccountItemId } })
              : lockedVpnAccount.accessRequestId
                ? await tx.batchAccountItem.findUnique({ where: { accessRequestId: lockedVpnAccount.accessRequestId } })
                : null;
          const lockedVpnBatchOwners = await findActiveVpnBatchOwnershipClaims(
            (args) => tx.batchAccountItem.findMany(args),
            lockedVpnAccount.username
          );
          const lockedExplicitLegacyBatchValid = Boolean(
            lockedBatchItem && lockedVpnAccount.accessRequestId
            && lockedBatchItem.lifecycleOwnerKind === 'access_request_legacy'
            && lockedBatchItem.accessRequestId === lockedVpnAccount.accessRequestId
            && (!lockedBatchItem.vpnUsername || sameVpnUsername(lockedBatchItem.vpnUsername, lockedVpnAccount.username))
            && (!lockedVpnAccount.batchId || lockedBatchItem.batchId === lockedVpnAccount.batchId)
          );
          const lockedExplicitBatchOwner = lockedVpnAccount.batchAccountItemId
            ? lockedVpnBatchOwners.find((item) => item.id === lockedVpnAccount.batchAccountItemId && sameVpnUsername(item.vpnUsername, lockedVpnAccount.username)) ?? null
            : null;
          const lockedLegacyBatchOwners = !lockedVpnAccount.batchAccountItemId && lockedVpnAccount.batchId
            ? lockedVpnBatchOwners.filter((item) => item.batchId === lockedVpnAccount.batchId && sameVpnUsername(item.vpnUsername, lockedVpnAccount.username))
            : [];
          const lockedVpnBatchOwner = lockedExplicitBatchOwner ?? lockedLegacyBatchOwners[0] ?? null;
          const lockedBatchOwnershipConflict = (
            lockedVpnBatchOwners.length > 1
            || (lockedVpnAccount.batchAccountItemId && !lockedExplicitLegacyBatchValid && (!lockedExplicitBatchOwner || lockedVpnBatchOwners.length !== 1))
            || (!lockedVpnAccount.batchAccountItemId && lockedVpnAccount.batchId && lockedVpnBatchOwners.length > 0 && lockedLegacyBatchOwners.length !== 1)
            || (lockedVpnBatchOwners.length > 0 && lockedVpnAccount.accessRequestId !== null)
            || (lockedVpnBatchOwners.length > 0 && !lockedVpnBatchOwner)
            || (lockedVpnBatchOwner !== null && lockedVpnBatchOwner.status !== 'completed')
          );
          if (lockedVpnBatchOwner) lockedBatchItem = lockedVpnBatchOwner;
          const lockedActiveClaimants = await findActiveVpnRequestClaimants(
            (args) => tx.accessRequest.findMany(args),
            lockedVpnAccount.username
          );
          const confirmedClaimantIds = Array.isArray(preflightSnapshot?.activeRequestClaimantIds)
            ? preflightSnapshot.activeRequestClaimantIds
            : [];
          if (
            lockedVpnAccount.status !== 'revoked'
            || !lockedVpnAccount.revokedAt
            || !lockedVpnAccount.revokedBy?.trim()
            || !lockedVpnAccount.revokedReason?.trim()
            || latestStatusLog?.newStatus !== 'revoked'
            || lockedVpnAccount.id !== preflightSnapshot?.vpnAccountId
            || lockedVpnAccount.username !== preflightSnapshot?.username
            || lockedVpnAccount.revokedAt.toISOString() !== preflightSnapshot?.revokedAt
            || lockedVpnAccount.revokedBy !== preflightSnapshot?.revokedBy
            || lockedVpnAccount.revokedReason !== preflightSnapshot?.revokedReason
            || latestStatusLog.id !== preflightSnapshot?.latestStatusLogId
            || lockedBatchOwnershipConflict
            || (lockedVpnAccount.accessRequestId ?? null) !== (preflightSnapshot?.accessRequestId ?? null)
            || (lockedLinkedRequest?.version ?? null) !== (preflightSnapshot?.accessRequestVersion ?? null)
            || (lockedBatchItem?.id ?? null) !== (preflightSnapshot?.batchAccountItemId ?? null)
            || (lockedBatchItem?.version ?? null) !== (preflightSnapshot?.batchAccountItemVersion ?? null)
            || (lockedBatchItem?.batchId ?? lockedVpnAccount.batchId ?? null) !== (preflightSnapshot?.sourceBatchId ?? null)
            || (lockedVpnAccount.batchAccountItemId && lockedVpnAccount.batchAccountItemId !== lockedBatchItem?.id)
            || lockedActiveClaimants.length !== confirmedClaimantIds.length
            || lockedActiveClaimants.some((claimant, index) => claimant.id !== confirmedClaimantIds[index])
          ) {
            throw new LifecyclePreflightChangedError(
              'VPN revocation evidence changed before deletion could be queued. Refresh and review the account again.',
              'VPN_DELETE_PREFLIGHT_CHANGED'
            );
          }
          const competingDelete = await tx.accountLifecycleAction.findFirst({
            where: {
              actionType: 'delete_vpn_record',
              targetUserId: lockedVpnAccount.id,
              status: { in: ['queued', 'processing', 'reconciliation_required'] },
            },
            select: { id: true },
          });
          if (competingDelete) {
            throw new LifecyclePreflightChangedError(
              'A permanent deletion for this VPN record is already active.',
              'VPN_DELETE_ALREADY_ACTIVE'
            );
          }
        }
      }
      const created = await tx.accountLifecycleAction.create({
        data: {
          actionType,
          targetAccountType: effectiveTargetAccountType,
          targetUsername,
          targetUserId,
          operationMode,
          targetDirectoryDn,
          targetDirectoryObjectGuid,
          bindingFailureCode,
          preflightSnapshot,
          authorizationEvidence,
          policyVersion,
          idempotencyKey: normalizedIdempotencyKey,
          reason: normalizedReason,
          requestedBy: admin.username,
          scheduledFor: null,
          relatedRequestId: resolvedRelatedRequestId,
          relatedBatchAccountItemId: resolvedBatchAccountItemId,
          relatedTicketId: deleteAd || deleteVpnRecord ? ticketReference : relatedTicketId,
          vpnRoleChange,
          notes,
          batchId: reviewedDeletionPlan?.id ?? null,
          planTargetKey: reviewedDeletionPlan?.targetKey ?? null,
          planOrdinal: reviewedDeletionPlan?.planOrdinal ?? null,
          canRestore: !deleteAd && !deleteVpnRecord,
          status: 'queued',
        },
      });
      await tx.accountLifecycleHistory.create({
        data: {
          actionId: created.id,
          event: 'created',
          performedBy: admin.username,
          newStatus: 'queued',
          details: JSON.stringify({
            actionType,
            targetAccountType: effectiveTargetAccountType,
            targetUsername,
            reason: normalizedReason,
            operationMode,
            bindingFailureCode,
            ...(deleteAd || deleteVpnRecord ? {
              policyVersion,
              relatedRequestId: resolvedRelatedRequestId,
              relatedBatchAccountItemId: resolvedBatchAccountItemId,
              ticketReference,
              safetyChecks: authorizationEvidence?.safetyChecks,
              duplicateActiveDeleteAbsent: true,
              usernameExecutionLockAcquired: true,
            } : {}),
          }),
        },
      });
      return created;
    }, deleteVpnRecord ? {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 30_000,
      timeout: 60_000,
    } : undefined);

    // Process the action immediately
    let processResult;
    try {
      processResult = await processLifecycleAction(action.id);
    } catch (error) {
      processResult = {
        success: false,
        actionId: action.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }

    // Fetch the updated action with all details
    let updatedAction: unknown = action;
    try {
      updatedAction = await prisma.accountLifecycleAction.findUnique({
        where: { id: action.id },
        include: {
          batch: true,
          history: {
            orderBy: { createdAt: 'desc' },
          },
          adActivityLogs: {
            orderBy: { createdAt: 'desc' },
          },
          vpnActivityLogs: {
            orderBy: { createdAt: 'desc' },
          },
        },
      }) ?? action;
    } catch (readError) {
      console.error('Lifecycle action committed but response enrichment failed:', readError);
    }

    // Log audit action
    try {
      await logAuditAction({
        action: AuditActions.CREATE_LIFECYCLE_ACTION,
        category: AuditCategories.USER,
        username: admin.username,
        targetId: action.id,
        targetType: 'AccountLifecycleAction',
        success: processResult.success,
        details: {
          actionType,
          targetAccountType: effectiveTargetAccountType,
          targetUsername,
          reason: normalizedReason,
          status: typeof updatedAction === 'object' && updatedAction && 'status' in updatedAction
            ? updatedAction.status
            : action.status,
          operationMode,
          bindingFailureCode,
          ...(deleteAd || deleteVpnRecord ? {
            policyVersion,
            relatedRequestId: resolvedRelatedRequestId,
            relatedBatchAccountItemId: resolvedBatchAccountItemId,
            ticketReference,
            irreversibleImpactAcknowledged: true,
            safetyChecks: authorizationEvidence?.safetyChecks,
          } : {}),
        },
        errorMessage: processResult.success ? undefined : processResult.error,
        ipAddress: getIpAddress(request),
        userAgent: getUserAgent(request),
      });
    } catch (auditError) {
      console.error('Lifecycle action committed but secondary audit emission failed:', auditError);
    }

    return secureJsonResponse(
      {
        success: processResult.success,
        action: updatedAction,
        processResult,
        message: processResult.success 
          ? 'Account lifecycle action completed successfully' 
          : `Action failed: ${processResult.error}`,
      },
      processResult.success ? 200 : 207
    );
  } catch (error) {
    console.error('Error creating lifecycle action:', error);
    
    const { admin } = await checkAdminAuthWithRateLimit(request);
    if (admin) {
      await logAuditAction({
        action: AuditActions.CREATE_LIFECYCLE_ACTION,
        category: AuditCategories.USER,
        username: admin.username,
        targetType: 'AccountLifecycleAction',
        success: false,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        ipAddress: getIpAddress(request),
        userAgent: getUserAgent(request),
      });
    }

    const uniqueConflict = (error as { code?: string }).code === 'P2002';
    const status = error instanceof LifecyclePreflightChangedError || uniqueConflict ? 409 : 500;
    const code = error instanceof LifecyclePreflightChangedError
      ? error.code
      : uniqueConflict
        ? 'LIFECYCLE_IDEMPOTENCY_CONFLICT'
        : undefined;
    return NextResponse.json(
      {
        error: uniqueConflict
          ? 'This lifecycle action or deletion-plan slot was already recorded. Retry with the same idempotency key to read its durable outcome.'
          : error instanceof Error ? error.message : 'Failed to create lifecycle action',
        code,
      },
      { status }
    );
  }
}
