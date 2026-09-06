import { createHash } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';

import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { getIpAddress, getUserAgent, logAuditAction, AuditActions, AuditCategories } from '@/lib/audit-log';
import { isLifecycleProvisioningReady } from '@/lib/access-request-lifecycle-readiness';
import { isAccessRequestDirectoryIdentityConsistent } from '@/lib/access-request-directory-identity';
import { isProductionCloneReadOnly } from '@/lib/clone-safety';
import { searchLDAPUser } from '@/lib/ldap';
import { ldapAccountIsEnabled } from '@/lib/ldap/account-status';
import { assertLifecycleAccountNotProtected } from '@/lib/lifecycle-protection';
import { isModuleEnabledStrict } from '@/lib/modules/core';
import { prisma } from '@/lib/prisma';
import { actorHasPermission } from '@/lib/rbac/core';
import { DIRECTORY_DELETE_METHOD, DIRECTORY_DELETE_METHOD_EVIDENCE_KEY, hasCurrentDirectoryDeleteMethod, planContainsDirectoryDeletion } from '@/lib/lifecycle-directory-deletion-policy';
import { MAX_DELETION_PLAN_TARGETS } from './deletion-plan-policy';

const PLAN_POLICY_VERSION = 'reviewed-lifecycle-deletion-plan-v1';
const PLAN_TTL_MS = 15 * 60 * 1000;
const BATCH_OWNERSHIP_STATUSES = ['processing', 'completed', 'reconciliation_required'];

type PlanAction = 'delete_ad' | 'delete_vpn_record' | 'delete_both_records';
type RequestedTarget = {
  accountRef?: unknown;
  requestId?: unknown;
  sourceBatchId?: unknown;
  directoryUsername?: unknown;
  vpnUsername?: unknown;
  vpnRecordId?: unknown;
};

type PlanTarget = {
  key: string;
  operationMode: 'governed' | 'batch_governed' | 'directory_override';
  requestId: string | null;
  sourceBatchId: string | null;
  sourceBatchItemId: string | null;
  directory: { username: string; dn: string; objectGuid: string } | null;
  vpn: { id: string; username: string } | null;
};

type PlanChild = {
  ordinal: number;
  targetKey: string;
  actionType: 'delete_ad' | 'delete_vpn_record';
};

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function confirmationPhrase(targets: number, records: number): string {
  return `DELETE ${targets} ${targets === 1 ? 'ACCOUNT' : 'ACCOUNTS'} / ${records} ${records === 1 ? 'RECORD' : 'RECORDS'}`;
}

function objectGuid(user: NonNullable<Awaited<ReturnType<typeof searchLDAPUser>>>): string | null {
  return user.attributes.find((attribute) => attribute.type.toLowerCase() === 'objectguid')?.values?.[0] ?? null;
}

function inputFingerprint(input: {
  action: PlanAction;
  targets: RequestedTarget[];
  reason: string;
  reference: string;
  acknowledgement: string;
}): string {
  const normalizedTargets = input.targets.map((target) => ({
    accountRef: text(target.accountRef),
    requestId: text(target.requestId),
    sourceBatchId: text(target.sourceBatchId),
    directoryUsername: text(target.directoryUsername)?.toLowerCase() ?? null,
    vpnUsername: text(target.vpnUsername)?.toLowerCase() ?? null,
    vpnRecordId: text(target.vpnRecordId),
  })).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return createHash('sha256').update(JSON.stringify({
    action: input.action,
    targets: normalizedTargets,
    reason: input.reason,
    reference: input.reference,
    acknowledgement: input.acknowledgement,
  })).digest('hex');
}

function planError(message: string, code: string, status = 409): NextResponse {
  return NextResponse.json({ error: message, code }, { status });
}

export async function GET(request: NextRequest) {
  const { admin, response } = await checkAdminAuthWithRateLimit(request);
  if (!admin || response) return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!actorHasPermission(admin, 'lifecycle.read')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const requestedLimit = Number(request.nextUrl.searchParams.get('limit') ?? 10);
  const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 50) : 10;
  const unfinishedOnly = request.nextUrl.searchParams.get('unfinished') === 'true';
  const plans = await prisma.accountLifecycleBatch.findMany({
    where: { policyVersion: PLAN_POLICY_VERSION, ...(unfinishedOnly ? { status: { in: ['processing', 'reconciliation_required'] } } : {}) },
    // Recovery must not lose old interrupted work behind newer terminal runs.
    orderBy: [{ createdAt: unfinishedOnly ? 'asc' : 'desc' }, { id: unfinishedOnly ? 'asc' : 'desc' }],
    take: limit,
    select: {
      id: true,
      createdAt: true,
      description: true,
      requestedBy: true,
      relatedTicketId: true,
      notes: true,
      status: true,
      totalTargets: true,
      totalActions: true,
      completedActions: true,
      failedActions: true,
      sourceBatchId: true,
      expiresAt: true,
      completedAt: true,
      resultSummary: true,
      _count: { select: { actions: true } },
    },
  });
  return NextResponse.json({
    plans: plans.map(({ _count, ...plan }) => ({
      ...plan,
      recordedActions: _count.actions,
      canFinalize: plan.requestedBy === admin.username,
      isExpired: Boolean(plan.expiresAt && plan.expiresAt.getTime() <= Date.now()),
    })),
  });
}

export async function POST(request: NextRequest) {
  const { admin, response } = await checkAdminAuthWithRateLimit(request);
  if (!admin || response) return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!actorHasPermission(admin, 'lifecycle.manage')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (isProductionCloneReadOnly()) return planError('Lifecycle mutations are disabled in this production-clone environment.', 'CLONE_READ_ONLY');

  const body = await request.json() as {
    action?: unknown;
    targets?: unknown;
    reason?: unknown;
    reference?: unknown;
    notes?: unknown;
    irreversibleAcknowledgement?: unknown;
    destructiveAcknowledgement?: unknown;
    idempotencyKey?: unknown;
  };
  const action = body.action;
  if (action !== 'delete_ad' && action !== 'delete_vpn_record' && action !== 'delete_both_records') {
    return planError('A supported permanent deletion action is required.', 'INVALID_DELETION_ACTION', 400);
  }
  if (!Array.isArray(body.targets) || body.targets.length < 1 || body.targets.length > MAX_DELETION_PLAN_TARGETS) {
    return planError(`Select between 1 and ${MAX_DELETION_PLAN_TARGETS} accounts.`, 'INVALID_TARGET_COUNT', 400);
  }
  const targets = body.targets as RequestedTarget[];
  const reason = text(body.reason) ?? '';
  const reference = text(body.reference) ?? '';
  const notes = text(body.notes);
  const acknowledgement = text(body.destructiveAcknowledgement) ?? '';
  const idempotencyKey = text(body.idempotencyKey) ?? '';
  if (reason.length < 10 || reason.length > 2_000) return planError('A substantive reason between 10 and 2,000 characters is required.', 'INVALID_REASON', 400);
  if (reference.length < 3 || reference.length > 200) return planError('A ticket or change reference between 3 and 200 characters is required.', 'INVALID_REFERENCE', 400);
  if (body.irreversibleAcknowledgement !== true) return planError('Acknowledge that the selected records will be permanently deleted.', 'ACKNOWLEDGEMENT_REQUIRED', 400);
  if (idempotencyKey.length < 16 || idempotencyKey.length > 128) return planError('A stable idempotency key between 16 and 128 characters is required.', 'INVALID_IDEMPOTENCY_KEY', 400);

  const wantsAd = action === 'delete_ad' || action === 'delete_both_records';
  const wantsVpn = action === 'delete_vpn_record' || action === 'delete_both_records';
  if (wantsAd && !actorHasPermission(admin, 'lifecycle.delete')) return planError('Permanent directory deletion requires lifecycle.delete.', 'MISSING_DIRECTORY_DELETE_PERMISSION', 403);
  if (wantsAd && !actorHasPermission(admin, 'users.manage')) return planError('Permanent directory deletion requires users.manage.', 'MISSING_DIRECTORY_MANAGE_PERMISSION', 403);
  if (wantsVpn && !actorHasPermission(admin, 'vpn.delete')) return planError('Permanent VPN deletion requires vpn.delete.', 'MISSING_VPN_DELETE_PERMISSION', 403);
  if (wantsVpn && !actorHasPermission(admin, 'vpn.manage')) return planError('Permanent VPN deletion requires vpn.manage.', 'MISSING_VPN_MANAGE_PERMISSION', 403);
  if (wantsVpn) {
    try {
      if (!(await isModuleEnabledStrict('vpn.management'))) return planError('VPN management is disabled.', 'MODULE_DISABLED');
    } catch {
      return planError('VPN module state could not be verified; permanent deletion is blocked.', 'MODULE_STATE_UNAVAILABLE', 503);
    }
  }

  const expectedRecordCount = targets.reduce((count, target) => (
    count + (wantsAd && text(target.directoryUsername) ? 1 : 0) + (wantsVpn && text(target.vpnRecordId) ? 1 : 0)
  ), 0);
  const requiredPhrase = confirmationPhrase(targets.length, expectedRecordCount);
  if (acknowledgement !== requiredPhrase) return planError(`Type ${requiredPhrase} exactly to confirm this deletion plan.`, 'CONFIRMATION_MISMATCH', 400);
  const fingerprint = inputFingerprint({ action, targets, reason, reference, acknowledgement });
  const replayExistingPlan = async (
    existingPlan: NonNullable<Awaited<ReturnType<typeof prisma.accountLifecycleBatch.findUnique>>>
  ) => {
    const evidence = existingPlan.authorizationEvidence;
    const previousFingerprint = evidence && typeof evidence === 'object' && !Array.isArray(evidence) ? evidence.inputFingerprint : null;
    if (existingPlan.requestedBy !== admin.username || previousFingerprint !== fingerprint) {
      return planError('The idempotency key is already bound to a different deletion plan.', 'IDEMPOTENCY_CONFLICT');
    }
    if (
      planContainsDirectoryDeletion(evidence && typeof evidence === 'object' && !Array.isArray(evidence) ? evidence.action : null)
      && !hasCurrentDirectoryDeleteMethod(evidence)
    ) {
      return planError('This reviewed deletion plan uses an earlier AD deletion method. Refresh the account state and review a new plan before executing its records.', 'DELETION_PLAN_REVIEW_REFRESH_REQUIRED');
    }
    let replayPlan = existingPlan;
    let replayEvidence = evidence && typeof evidence === 'object' && !Array.isArray(evidence) ? evidence : null;
    if (!replayEvidence || typeof replayEvidence.auditRecordedAt !== 'string') {
      await logAuditAction({
        action: AuditActions.CREATE_LIFECYCLE_BATCH,
        category: AuditCategories.LIFECYCLE,
        username: admin.username,
        targetId: existingPlan.id,
        targetType: 'AccountLifecycleBatch',
        success: true,
        details: { policyVersion: PLAN_POLICY_VERSION, replayedAuditRepair: true },
        ipAddress: getIpAddress(request),
        userAgent: getUserAgent(request),
      });
      replayEvidence = { ...replayEvidence, auditRecordedAt: new Date().toISOString() };
      replayPlan = await prisma.accountLifecycleBatch.update({
        where: { id: existingPlan.id },
        data: { authorizationEvidence: replayEvidence as Prisma.InputJsonObject },
      });
    }
    const replayManifest = Array.isArray(replayEvidence.manifest) ? replayEvidence.manifest : [];
    return NextResponse.json({ plan: { ...replayPlan, manifest: replayManifest, requiredPhrase }, replayed: true });
  };
  const existing = await prisma.accountLifecycleBatch.findUnique({ where: { idempotencyKey } });
  if (existing) return replayExistingPlan(existing);

  const normalizedRefs = targets.map((target) => text(target.accountRef));
  if (normalizedRefs.some((value) => !value) || new Set(normalizedRefs).size !== targets.length) {
    return planError('Every selected account must have one unique inventory reference.', 'DUPLICATE_OR_MISSING_TARGET', 400);
  }

  const manifest: PlanTarget[] = [];
  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index];
    const key = normalizedRefs[index]!;
    const directoryUsername = text(target.directoryUsername);
    const vpnUsername = text(target.vpnUsername);
    const vpnRecordId = text(target.vpnRecordId);
    const requestedRequestId = text(target.requestId);
    let mode: PlanTarget['operationMode'] = 'governed';
    let requestId: string | null = null;
    let sourceBatchId: string | null = null;
    let sourceBatchItemId: string | null = null;
    let directory: PlanTarget['directory'] = null;
    let vpn: PlanTarget['vpn'] = null;

    if (wantsAd) {
      if (!directoryUsername) return planError(`${key} has no Active Directory target.`, 'DIRECTORY_TARGET_REQUIRED');
      const user = await searchLDAPUser(directoryUsername);
      if (!user) return planError(`AD account ${directoryUsername} was not found.`, 'DIRECTORY_ACCOUNT_NOT_FOUND', 404);
      await assertLifecycleAccountNotProtected(user);
      const guid = objectGuid(user);
      if (!guid || !user.objectName) return planError(`Immutable directory identity is unavailable for ${directoryUsername}.`, 'DIRECTORY_IDENTITY_REQUIRED');
      if (ldapAccountIsEnabled(user.attributes)) return planError(`AD account ${directoryUsername} must be disabled before deletion.`, 'AD_DELETE_REQUIRES_DISABLED');

      const owners = await prisma.accessRequest.findMany({
        where: {
          status: { not: 'rejected' },
          OR: [
            { ldapUsername: { equals: directoryUsername, mode: 'insensitive' } },
            { linkedAdUsername: { equals: directoryUsername, mode: 'insensitive' } },
          ],
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 2,
      });
      const batchOwners = await prisma.batchAccountItem.findMany({
        where: {
          lifecycleOwnerKind: 'batch_item',
          accessRequestId: null,
          accountType: { in: ['AD', 'BOTH'] },
          status: { in: BATCH_OWNERSHIP_STATUSES },
          ldapUsername: { equals: directoryUsername, mode: 'insensitive' },
          OR: [{ adAccountStatus: null }, { adAccountStatus: { not: 'deleted' } }],
        },
        include: { batch: { select: { id: true, description: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 2,
      });
      if (owners.length > 1) return planError(`More than one request claims ${directoryUsername}.`, 'AMBIGUOUS_ACCESS_REQUEST_LINK');
      if (batchOwners.length > 1) return planError(`More than one batch item claims ${directoryUsername}.`, 'AMBIGUOUS_BATCH_ACCOUNT_LINK');
      if (owners.length === 1 && batchOwners.length === 1) {
        return planError(`A request and a standalone batch item both claim ${directoryUsername}.`, 'REQUEST_BATCH_OWNERSHIP_CONFLICT');
      }
      if (owners.length === 1) {
        const owner = owners[0];
        if (!isAccessRequestDirectoryIdentityConsistent(owner)) {
          return planError(`The governed request for ${directoryUsername} contains conflicting AD identity aliases.`, 'ACCESS_REQUEST_DIRECTORY_IDENTITY_CONFLICT');
        }
        if (owner.id !== requestedRequestId || !['approved', 'offboarded'].includes(owner.status) || !isLifecycleProvisioningReady(owner.provisioningState) || owner.adAccountStatus !== 'disabled') {
          return planError(`The governed record for ${directoryUsername} is not ready for deletion.`, 'GOVERNED_DELETE_NOT_READY');
        }
        requestId = owner.id;
        const batchItem = await prisma.batchAccountItem.findUnique({ where: { accessRequestId: owner.id } });
        sourceBatchId = batchItem?.batchId ?? null;
        sourceBatchItemId = batchItem?.id ?? null;
      } else {
        if (requestedRequestId) return planError(`${directoryUsername} no longer matches the selected request.`, 'ACCESS_REQUEST_LINK_CHANGED');
        const batchOwner = batchOwners[0];
        if (batchOwner) {
          if (
            batchOwner.status !== 'completed'
            ||
            text(target.sourceBatchId) !== batchOwner.batchId
            || batchOwner.adAccountStatus !== 'disabled'
            || !batchOwner.targetDirectoryDn
            || !batchOwner.targetDirectoryObjectGuid
            || batchOwner.targetDirectoryDn.toLowerCase() !== user.objectName.toLowerCase()
            || batchOwner.targetDirectoryObjectGuid !== guid
          ) {
            return planError(`The batch-owned record for ${directoryUsername} is not ready for deletion.`, 'BATCH_DELETE_NOT_READY');
          }
          mode = 'batch_governed';
          sourceBatchId = batchOwner.batchId;
          sourceBatchItemId = batchOwner.id;
        } else {
          if (!actorHasPermission(admin, 'lifecycle.delete_unmanaged')) {
            return planError('Deleting an AD account with no portal owner requires lifecycle.delete_unmanaged.', 'MISSING_UNMANAGED_DELETE_PERMISSION', 403);
          }
          if (!actorHasPermission(admin, 'lifecycle.override')) {
            return planError('Deleting an AD account with no portal owner requires lifecycle.override.', 'MISSING_DIRECTORY_OVERRIDE_PERMISSION', 403);
          }
          if (action !== 'delete_ad') return planError('Unmanaged directory accounts cannot be mixed with VPN deletion.', 'UNMANAGED_DIRECTORY_ONLY');
          const [sessions, providerTasks] = await Promise.all([
            prisma.session.count({ where: { username: { equals: directoryUsername, mode: 'insensitive' } } }),
            prisma.providerLogoutTask.findMany({ where: { username: { equals: directoryUsername, mode: 'insensitive' } }, select: { status: true } }),
          ]);
          if (sessions > 0 || providerTasks.some((task) => task.status !== 'completed')) {
            return planError(`${directoryUsername} still has active portal or provider sessions.`, 'SESSIONS_NOT_SETTLED');
          }
          mode = 'directory_override';
        }
      }
      directory = { username: directoryUsername, dn: user.objectName, objectGuid: guid };
    }

    if (action === 'delete_both_records' && mode === 'batch_governed') {
      return planError('Batch-owned accounts require separate reviewed AD and VPN deletion plans.', 'BATCH_SEPARATE_SYSTEMS_REQUIRED');
    }

    if (wantsVpn) {
      if (!vpnRecordId || !vpnUsername) {
        if (action === 'delete_both_records') {
          // A batch/service account may legitimately have no VPN record.
        } else {
          return planError(`${key} has no VPN target.`, 'VPN_TARGET_REQUIRED');
        }
      } else {
        const record = await prisma.vPNAccount.findUnique({ where: { id: vpnRecordId } });
        if (!record || record.username.toLowerCase() !== vpnUsername.toLowerCase()) return planError(`VPN identity changed for ${key}.`, 'VPN_TARGET_CHANGED');
        if (record.status !== 'revoked' || !record.revokedAt || !record.revokedBy?.trim() || !record.revokedReason?.trim()) {
          return planError(`VPN record ${vpnUsername} does not have complete revoked-state evidence.`, 'VPN_DELETE_NOT_READY');
        }
        const latestStatus = await prisma.vPNAccountStatusLog.findFirst({ where: { accountId: record.id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
        if (latestStatus?.newStatus !== 'revoked') return planError(`VPN record ${vpnUsername} has no latest revoked status log.`, 'VPN_DELETE_NOT_READY');
        if (!wantsAd && text(record.accessRequestId) !== requestedRequestId) {
          return planError(
            `VPN record ${vpnUsername} no longer matches the selected request owner.`,
            'ACCESS_REQUEST_LINK_CHANGED',
          );
        }
        if (wantsAd && record.accessRequestId !== requestId) return planError(`AD and VPN evidence does not identify the same governed account for ${key}.`, 'AD_VPN_LINK_CONFLICT');
        const vpnBatchOwners = await prisma.batchAccountItem.findMany({
          where: {
            lifecycleOwnerKind: 'batch_item',
            accessRequestId: null,
            accountType: { in: ['VPN', 'BOTH'] },
            status: { in: BATCH_OWNERSHIP_STATUSES },
            OR: [
              { vpnUsername: { equals: record.username, mode: 'insensitive' } },
              { ldapUsername: { equals: record.username, mode: 'insensitive' } },
            ],
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 2,
        });
        const linkedBatchItem = record.batchAccountItemId
          ? await prisma.batchAccountItem.findUnique({ where: { id: record.batchAccountItemId } })
          : null;
        const explicitLegacyBatchValid = Boolean(
          linkedBatchItem && record.accessRequestId
          && linkedBatchItem.lifecycleOwnerKind === 'access_request_legacy'
          && linkedBatchItem.accessRequestId === record.accessRequestId
          && (!linkedBatchItem.vpnUsername || linkedBatchItem.vpnUsername.toLowerCase() === record.username.toLowerCase())
          && (!record.batchId || linkedBatchItem.batchId === record.batchId)
        );
        const explicitBatchOwner = record.batchAccountItemId
          ? vpnBatchOwners.find((item) => item.id === record.batchAccountItemId && item.vpnUsername?.trim().toLowerCase() === record.username.trim().toLowerCase()) ?? null
          : null;
        const legacyBatchOwners = !record.batchAccountItemId && record.batchId
          ? vpnBatchOwners.filter((item) => item.batchId === record.batchId && item.vpnUsername?.trim().toLowerCase() === record.username.trim().toLowerCase())
          : [];
        if (
          vpnBatchOwners.length > 1
          || (record.batchAccountItemId && !explicitLegacyBatchValid && (!explicitBatchOwner || vpnBatchOwners.length !== 1))
          || (!record.batchAccountItemId && record.batchId && vpnBatchOwners.length > 0 && legacyBatchOwners.length !== 1)
        ) {
          return planError(`Batch ownership for VPN record ${vpnUsername} is incomplete or conflicting.`, 'AMBIGUOUS_BATCH_ACCOUNT_LINK');
        }
        const vpnBatchOwner = explicitBatchOwner ?? legacyBatchOwners[0] ?? null;
        if (vpnBatchOwners.length > 0 && record.accessRequestId) {
          return planError(`A request and a standalone batch item both claim VPN record ${vpnUsername}.`, 'REQUEST_BATCH_OWNERSHIP_CONFLICT');
        }
        if (vpnBatchOwners.length > 0 && !vpnBatchOwner) {
          return planError(`A batch item claims VPN record ${vpnUsername}, but its recorded linkage needs review.`, 'AMBIGUOUS_BATCH_ACCOUNT_LINK');
        }
        if (vpnBatchOwner && vpnBatchOwner.status !== 'completed') {
          return planError(`The batch-owned VPN record for ${vpnUsername} is not ready for deletion.`, 'BATCH_DELETE_NOT_READY');
        }
        if (vpnBatchOwner) {
          if (text(target.sourceBatchId) !== vpnBatchOwner.batchId) {
            return planError(`The batch-owned VPN record for ${vpnUsername} no longer matches the selected creation batch.`, 'BATCH_DELETE_NOT_READY');
          }
          // VPN execution retains its existing governed-record contract;
          // batch provenance does not turn it into an AD batch action.
          sourceBatchId = vpnBatchOwner.batchId;
          sourceBatchItemId = vpnBatchOwner.id;
        }
        requestId = requestId ?? record.accessRequestId;
        const batchItem = vpnBatchOwner
          ?? (record.batchAccountItemId
          ? linkedBatchItem
          : record.accessRequestId
          ? await prisma.batchAccountItem.findUnique({ where: { accessRequestId: record.accessRequestId } })
          : record.batchId
            ? await prisma.batchAccountItem.findFirst({
                where: { batchId: record.batchId, vpnUsername: { equals: record.username, mode: 'insensitive' } },
                orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
              })
            : null);
        const vpnSourceBatchId = batchItem?.batchId ?? record.batchId ?? null;
        if (
          (record.batchId && batchItem && record.batchId !== batchItem.batchId)
          || (sourceBatchId && vpnSourceBatchId && sourceBatchId !== vpnSourceBatchId)
        ) {
          return planError(`Recorded creation-batch provenance conflicts for ${key}.`, 'BATCH_PROVENANCE_CONFLICT');
        }
        sourceBatchId = sourceBatchId ?? vpnSourceBatchId;
        sourceBatchItemId = sourceBatchItemId ?? batchItem?.id ?? null;
        vpn = { id: record.id, username: record.username };
      }
    }
    manifest.push({ key, operationMode: mode, requestId, sourceBatchId, sourceBatchItemId, directory, vpn });
  }

  const directoryTargets = manifest.flatMap((target) => target.directory ? [target.directory.objectGuid.toLowerCase()] : []);
  const vpnTargets = manifest.flatMap((target) => target.vpn ? [target.vpn.id] : []);
  if (new Set(directoryTargets).size !== directoryTargets.length || new Set(vpnTargets).size !== vpnTargets.length) {
    return planError('The selection contains the same AD object or VPN record more than once.', 'DUPLICATE_RECORD_TARGET', 400);
  }

  const modes = new Set(manifest.map((target) => target.operationMode));
  if (modes.size !== 1) return planError('Governed batch accounts and unmanaged directory accounts must be reviewed in separate deletion plans.', 'MIXED_DELETION_LANES');
  const lane = manifest[0].operationMode === 'directory_override'
    ? 'unmanaged_directory'
    : manifest[0].operationMode === 'batch_governed'
      ? 'batch_governed'
      : 'governed';
  const sourceBatchIds = new Set(manifest.map((target) => target.sourceBatchId).filter((value): value is string => Boolean(value)));
  // Batch provenance belongs to each target, not to the selection as a whole.
  if (lane === 'governed' && targets.length > 1
    && manifest.some((target) => !target.requestId && (!target.sourceBatchId || !target.sourceBatchItemId))) {
    return planError('Every selected account needs its own request or recorded creation-batch item.', 'BATCH_PROVENANCE_REQUIRED');
  }
  if (lane === 'batch_governed' && manifest.some((target) => !target.sourceBatchId || !target.sourceBatchItemId)) {
    return planError('Every batch-owned account needs its own recorded creation-batch item.', 'BATCH_PROVENANCE_REQUIRED');
  }
  const selectionDigest = createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
  const recordCount = manifest.reduce((count, target) => count + (target.directory ? 1 : 0) + (target.vpn ? 1 : 0), 0);
  if (recordCount !== expectedRecordCount) return planError('The selected record count changed during review. Refresh and confirm again.', 'RECORD_COUNT_CHANGED');
  const children: PlanChild[] = [];
  for (const target of manifest) {
    if (action === 'delete_both_records' && target.vpn) children.push({ ordinal: children.length, targetKey: target.key, actionType: 'delete_vpn_record' });
    if ((action === 'delete_ad' || action === 'delete_both_records') && target.directory) children.push({ ordinal: children.length, targetKey: target.key, actionType: 'delete_ad' });
    if (action === 'delete_vpn_record' && target.vpn) children.push({ ordinal: children.length, targetKey: target.key, actionType: 'delete_vpn_record' });
  }
  if (children.length !== recordCount) return planError('The deletion plan could not assign every record a stable execution order.', 'PLAN_ORDER_INVALID');

  const now = new Date();
  const expiresAt = new Date(now.getTime() + PLAN_TTL_MS);
  const authorizationEvidence: Prisma.InputJsonObject = {
    inputFingerprint: fingerprint,
    lane,
    action,
    targetCount: manifest.length,
    recordCount,
    typedAcknowledgement: acknowledgement,
    irreversibleImpactAcknowledged: true,
    ticketReference: reference,
    actor: admin.username,
    confirmedAt: now.toISOString(),
    ...(wantsAd ? { [DIRECTORY_DELETE_METHOD_EVIDENCE_KEY]: DIRECTORY_DELETE_METHOD } : {}),
    manifest: manifest as unknown as Prisma.InputJsonArray,
    children: children as unknown as Prisma.InputJsonArray,
  };
  let plan;
  try {
    plan = await prisma.accountLifecycleBatch.create({
      data: {
        batchType: 'permanent_delete',
        description: reason,
        requestedBy: admin.username,
        totalActions: children.length,
        totalTargets: manifest.length,
        relatedTicketId: reference,
        notes,
        status: 'processing',
        startedAt: now,
        idempotencyKey,
        policyVersion: PLAN_POLICY_VERSION,
        selectionDigest,
        sourceBatchId: sourceBatchIds.size === 1 ? [...sourceBatchIds][0] : null,
        authorizationEvidence,
        expiresAt,
        confirmedAt: now,
        confirmedBy: admin.username,
      },
    });
  } catch (error) {
    if ((error as { code?: string }).code !== 'P2002') throw error;
    const concurrentPlan = await prisma.accountLifecycleBatch.findUnique({ where: { idempotencyKey } });
    if (!concurrentPlan) throw error;
    return replayExistingPlan(concurrentPlan);
  }
  await logAuditAction({
    action: AuditActions.CREATE_LIFECYCLE_BATCH,
    category: AuditCategories.LIFECYCLE,
    username: admin.username,
    targetId: plan.id,
    targetType: 'AccountLifecycleBatch',
    success: true,
    details: { policyVersion: PLAN_POLICY_VERSION, lane, targetCount: manifest.length, recordCount, selectionDigest, reference },
    ipAddress: getIpAddress(request),
    userAgent: getUserAgent(request),
  });
  const auditedEvidence: Prisma.InputJsonObject = { ...authorizationEvidence, auditRecordedAt: new Date().toISOString() };
  const auditedPlan = await prisma.accountLifecycleBatch.update({
    where: { id: plan.id },
    data: { authorizationEvidence: auditedEvidence },
  });
  return NextResponse.json({ plan: { ...auditedPlan, manifest, requiredPhrase }, replayed: false }, { status: 201 });
}
