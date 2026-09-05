import {
  requestProviderBackchannelLogoutDetailed,
  type ProviderBackchannelOutcome,
} from '@/lib/auth/backchannel';
import { logAuditAction } from '@/lib/audit-log';
import { revokeAllSessionsForUser } from '@/lib/session';
import { appLogger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { createHash, randomUUID } from 'node:crypto';

/**
 * Durable provider-logout outcome rows for every portal logout surface,
 * shaped like the kill-session provider fields (providerSidPresent /
 * providerLogoutAttempted / providerSessionDestroyed) so a stale IdP
 * session - the silent-SSO-re-entry risk - is visible to operators.
 */

export type LogoutSurface = 'user_self' | 'admin_console';

const SURFACE_ACTIONS: Record<LogoutSurface, string> = {
  user_self: 'user_logout',
  admin_console: 'admin_logout',
};

// AuditOutcome has no 'not-configured'; the exact tri-state rides in details.
const TOP_LEVEL_OUTCOME: Record<ProviderBackchannelOutcome, 'success' | 'failure' | 'skipped'> = {
  success: 'success',
  failure: 'failure',
  'not-configured': 'skipped',
};

export interface ProviderLogoutAuditContext {
  surface: LogoutSurface;
  username?: string | null;
  sessionId?: string | null;
  isAdmin?: boolean;
  hadSession?: boolean;
  providerSid: string | null | undefined;
  providerLogoutTaskId?: string | null;
  ipAddress?: string;
  userAgent?: string;
}

function actorType(context: ProviderLogoutAuditContext): 'admin' | 'user' | 'anonymous' {
  if (context.isAdmin) {
    return 'admin';
  }
  return context.username || context.hadSession ? 'user' : 'anonymous';
}

/**
 * Fires the backchannel logout (unchanged semantics) and records its ACTUAL
 * outcome as an audit row. Audit-write failures are logged, never propagated:
 * a user's logout must not break because auditing is unavailable.
 */
export async function recordProviderLogoutOutcome(
  context: ProviderLogoutAuditContext
): Promise<void> {
  const providerSidPresent = Boolean(context.providerSid);
  const durableResult = context.providerLogoutTaskId
    ? await processProviderLogoutTask(context.providerLogoutTaskId)
    : null;
  const result = durableResult
    ? {
        outcome: durableResult.destroyed ? 'success' as const : 'failure' as const,
        providerLogoutAttempted: durableResult.attempted,
      }
    : await requestProviderBackchannelLogoutDetailed(context.providerSid);
  const destroyed = result.outcome === 'success';

  try {
    await logAuditAction({
      action: SURFACE_ACTIONS[context.surface],
      category: 'session',
      username: context.username || 'unknown',
      actorType: actorType(context),
      targetType: 'Session',
      targetId: context.sessionId || undefined,
      outcome: TOP_LEVEL_OUTCOME[result.outcome],
      success: destroyed,
      details: {
        providerSidPresent,
        providerLogoutAttempted: result.providerLogoutAttempted,
        providerSessionDestroyed: destroyed,
        providerLogoutOutcome: result.outcome,
      },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
  } catch (error) {
    appLogger.error('[Logout] Failed to persist provider logout audit row', {
      surface: context.surface,
      error: error instanceof Error ? error.message : 'unknown',
    });
  }
}

export interface BulkSessionRevocationContext {
  /** Audit actor: admin username or a system sentinel (e.g. system:lifecycle). */
  actor: string;
  actorType: 'admin' | 'system';
  /** Why: admin_end_all | lifecycle_disable | offboard_enforcement | ... */
  reason: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface BulkSessionRevocationResult {
  portalSessionsRevoked: number;
  providerLogoutsAttempted: number;
  providerSessionsDestroyed: number;
  providerLogoutsReconciliationRequired: number;
}

const PROVIDER_LOGOUT_LEASE_MS = 5 * 60 * 1000;

export async function processProviderLogoutTask(taskId: string): Promise<{
  attempted: boolean;
  destroyed: boolean;
  incomplete: boolean;
  reconciliationRequired: boolean;
}> {
  const current = await prisma.providerLogoutTask.findUnique({ where: { id: taskId } });
  if (!current) throw new Error('Provider logout task not found');
  if (current.status === 'completed') {
    return { attempted: false, destroyed: true, incomplete: false, reconciliationRequired: false };
  }
  if (current.status === 'reconciliation_required') {
    return { attempted: false, destroyed: false, incomplete: false, reconciliationRequired: true };
  }
  if (current.status === 'processing') {
    if (!current.claimedUntil || current.claimedUntil <= new Date()) {
      await prisma.providerLogoutTask.updateMany({
        where: { id: taskId, status: 'processing', claimId: current.claimId },
        data: {
          status: 'reconciliation_required',
          claimId: null,
          claimedUntil: null,
          lastError: 'Provider logout claim expired; remote outcome is unknown',
        },
      });
      return { attempted: false, destroyed: false, incomplete: false, reconciliationRequired: true };
    }
    return { attempted: false, destroyed: false, incomplete: true, reconciliationRequired: false };
  }

  const claimId = randomUUID();
  const claimed = await prisma.providerLogoutTask.updateMany({
    where: { id: taskId, status: 'pending' },
    data: {
      status: 'processing',
      claimId,
      claimedAt: new Date(),
      claimedUntil: new Date(Date.now() + PROVIDER_LOGOUT_LEASE_MS),
      attempts: { increment: 1 },
      lastError: null,
    },
  });
  if (claimed.count !== 1) {
    return { attempted: false, destroyed: false, incomplete: true, reconciliationRequired: false };
  }

  const result = await requestProviderBackchannelLogoutDetailed(current.providerSid).catch(() => ({
    outcome: 'failure' as ProviderBackchannelOutcome,
    providerLogoutAttempted: true,
  }));
  if (result.outcome === 'success') {
    const finalized = await prisma.providerLogoutTask.updateMany({
      where: { id: taskId, status: 'processing', claimId },
      data: {
        status: 'completed',
        claimId: null,
        claimedUntil: null,
        completedAt: new Date(),
        lastError: null,
      },
    });
    return {
      attempted: result.providerLogoutAttempted,
      destroyed: finalized.count === 1,
      incomplete: false,
      reconciliationRequired: finalized.count !== 1,
    };
  }

  await prisma.providerLogoutTask.updateMany({
    where: { id: taskId, status: 'processing', claimId },
    data: {
      status: 'reconciliation_required',
      claimId: null,
      claimedUntil: null,
      lastError: result.outcome === 'not-configured'
        ? 'Provider logout endpoint is not configured'
        : 'Provider logout failed or returned an ambiguous outcome',
    },
  });
  return {
    attempted: result.providerLogoutAttempted,
    destroyed: false,
    incomplete: false,
    reconciliationRequired: true,
  };
}

export async function drainProviderLogoutTasks(limit: number = 100): Promise<{
  processed: number;
  completed: number;
  incomplete: number;
  reconciliationRequired: number;
}> {
  const boundedLimit = Math.max(1, Math.min(limit, 250));
  const now = new Date();
  const tasks = await prisma.providerLogoutTask.findMany({
    where: {
      OR: [
        { status: 'pending' },
        { status: 'processing', claimedUntil: { lte: now } },
      ],
    },
    orderBy: { createdAt: 'asc' },
    take: boundedLimit,
    select: { id: true },
  });
  let completed = 0;
  let incomplete = 0;
  let reconciliationRequired = 0;
  for (const task of tasks) {
    const result = await processProviderLogoutTask(task.id);
    if (result.destroyed) completed += 1;
    if (result.incomplete) incomplete += 1;
    if (result.reconciliationRequired) reconciliationRequired += 1;
  }
  return { processed: tasks.length, completed, incomplete, reconciliationRequired };
}

/**
 * End EVERY session a user has - portal rows AND their IdP sessions via the
 * backchannel - as one audited operation. This is the ONLY sanctioned bulk
 * path: plain deleteMany sweeps silently orphan IdP sessions and offboarded
 * users could SSO straight back in (ADR-0014 full-logout parity). Backchannel
 * failures never fail the revocation; they are recorded so operators see the
 * real outcome.
 */
export async function revokeUserSessionsEverywhere(
  username: string,
  context: BulkSessionRevocationContext
): Promise<BulkSessionRevocationResult> {
  const revoked = await revokeAllSessionsForUser(username, context.reason);
  const providerSids = [...new Set(revoked.map((row) => row.providerSid).filter((sid): sid is string => Boolean(sid)))];
  // This mirrors the hash generated transactionally before session deletion.
  // The raw provider sid never appears in audit or API output.
  const taskHashes = providerSids.map((providerSid) => createHash('sha256').update(providerSid).digest('hex'));
  const tasks = taskHashes.length > 0
    ? await prisma.providerLogoutTask.findMany({ where: { providerSidHash: { in: taskHashes } } })
    : [];

  let providerLogoutsAttempted = 0;
  let providerSessionsDestroyed = 0;
  let providerLogoutsReconciliationRequired = 0;
  for (const task of tasks) {
    const outcome = await processProviderLogoutTask(task.id);
    if (outcome.attempted) providerLogoutsAttempted += 1;
    if (outcome.destroyed) providerSessionsDestroyed += 1;
    if (outcome.incomplete || outcome.reconciliationRequired) providerLogoutsReconciliationRequired += 1;
  }

  try {
    await logAuditAction({
      action: 'bulk_session_revocation',
      category: 'session',
      username: context.actor,
      actorType: context.actorType,
      targetType: 'Session',
      targetId: revoked[0]?.id,
      eventKind: 'security',
      outcome: providerLogoutsReconciliationRequired > 0 ? 'failure' : 'success',
      success: providerLogoutsReconciliationRequired === 0,
      details: {
        reason: context.reason,
        targetUsername: username,
        portalSessionsRevoked: revoked.length,
        providerSidsPresent: providerSids.length,
        providerLogoutsAttempted,
        providerSessionsDestroyed,
        providerLogoutsReconciliationRequired,
      },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
  } catch (error) {
    appLogger.error('[Logout] Failed to persist bulk session revocation audit row', {
      username,
      reason: context.reason,
      error: error instanceof Error ? error.message : 'unknown',
    });
  }

  return {
    portalSessionsRevoked: revoked.length,
    providerLogoutsAttempted,
    providerSessionsDestroyed,
    providerLogoutsReconciliationRequired,
  };
}
