import { randomUUID } from 'node:crypto';

import { prisma } from '@/lib/prisma';
import { getLDAPGroupMembers } from '@/lib/ldap';
import { appLogger } from '@/lib/logger';
import { notifyActiveAdministrators } from '@/lib/notifications';

/**
 * Directory snapshot synchronization for allowed ticket groups (ADR-0007).
 *
 * AD/LDAP stays the source of truth; this service copies membership and mail
 * attributes of every active AllowedTicketSubjectGroup into local snapshot
 * rows so form rendering and recipient expansion never touch the domain
 * controller. Per-group outcomes are recorded on the run: a failed group keeps
 * its previous snapshot instead of being wiped (partial-failure evidence,
 * lifecycle-operations invariant). Runs are idempotent - re-running replaces
 * each group's snapshot rows.
 */

export interface DirectorySyncOutcome {
  runId: string;
  status: 'success' | 'partial_failure' | 'failed';
  groupsProcessed: number;
  membersCaptured: number;
  errors: Array<{ groupDn: string; error: string }>;
}

/** A run older than this is considered abandoned and no longer blocks new runs. */
const STALE_RUN_MS = 10 * 60 * 1000;
const SYNC_LEASE_KEY = 'directory-group-sync';
const LEASE_HEARTBEAT_MS = Math.floor(STALE_RUN_MS / 3);

class DirectorySyncLeaseLostError extends Error {}

async function sweepAbandonedRuns(): Promise<void> {
  // Runs stuck in 'running' past the stale window never reached a terminal
  // state (e.g. process killed mid-sync). Mark them failed so operators see
  // truthful history instead of phantom active runs.
  await prisma.directorySyncRun.updateMany({
    where: {
      status: 'running',
      startedAt: { lt: new Date(Date.now() - STALE_RUN_MS) },
    },
    data: { status: 'failed', finishedAt: new Date() },
  });
}

async function findActiveRun() {
  const candidate = await prisma.directorySyncRun.findFirst({
    where: { status: 'running', startedAt: { gte: new Date(Date.now() - STALE_RUN_MS) } },
    orderBy: { startedAt: 'desc' },
  });
  return candidate;
}

export async function runDirectoryGroupSync(options: {
  triggeredBy: string;
}): Promise<DirectorySyncOutcome> {
  const leaseOwner = randomUUID();
  const leaseStartedAt = new Date();
  const acquired = await prisma.$queryRaw<Array<{ owner: string }>>`
    INSERT INTO "OperationalLease" ("key", "owner", "expiresAt", "updatedAt")
    VALUES (${SYNC_LEASE_KEY}, ${leaseOwner}, ${new Date(leaseStartedAt.getTime() + STALE_RUN_MS)}, ${leaseStartedAt})
    ON CONFLICT ("key") DO UPDATE SET
      "owner" = EXCLUDED."owner", "expiresAt" = EXCLUDED."expiresAt", "updatedAt" = EXCLUDED."updatedAt"
    WHERE "OperationalLease"."expiresAt" <= ${leaseStartedAt}
    RETURNING "owner"
  `;
  if (acquired.length !== 1) {
    throw new Error('A directory sync is already running. Wait for it to finish before starting another.');
  }

  let leaseLost = false;
  let heartbeatPromise = Promise.resolve();
  const renewLease = async () => {
    const renewedAt = new Date();
    const renewed = await prisma.operationalLease.updateMany({
      where: { key: SYNC_LEASE_KEY, owner: leaseOwner },
      data: { expiresAt: new Date(renewedAt.getTime() + STALE_RUN_MS) },
    });
    if (renewed.count !== 1) {
      throw new DirectorySyncLeaseLostError(
        'Directory sync lease was lost before the group could be refreshed'
      );
    }
  };
  const leaseHeartbeat = setInterval(() => {
    heartbeatPromise = heartbeatPromise
      .then(renewLease)
      .catch((error) => {
        leaseLost = true;
        appLogger.error('Directory sync lease heartbeat failed', {
          message: error instanceof Error ? error.message : String(error),
        });
      });
  }, LEASE_HEARTBEAT_MS);
  leaseHeartbeat.unref?.();

  const assertAndRenewLease = async () => {
    await heartbeatPromise;
    if (leaseLost) {
      throw new DirectorySyncLeaseLostError(
        'Directory sync lease was lost before the group could be refreshed'
      );
    }
    await renewLease();
  };

  let activeRunId: string | null = null;
  try {
    await sweepAbandonedRuns();
    const existing = await findActiveRun();
    if (existing) {
      throw new Error(
        `A directory sync is already running (started ${existing.startedAt.toISOString()}). Wait for it to finish or retry after it goes stale.`
      );
    }

    const run = await prisma.directorySyncRun.create({
      data: { status: 'running', triggeredBy: options.triggeredBy },
    });
    activeRunId = run.id;

    const groups = await prisma.allowedTicketSubjectGroup.findMany({
      where: { isActive: true },
      select: { dn: true, name: true },
    });

    const errors: Array<{ groupDn: string; error: string }> = [];
    let membersCaptured = 0;
    let succeededGroups = 0;

    for (const group of groups) {
      await assertAndRenewLease();

      try {
        // External LDAP operation: not atomic with database writes by design.
        const members = await getLDAPGroupMembers(group.dn);

        // LDAP expansion can be slow for a large nested group. Confirm this
        // worker still owns the lease immediately before it writes anything;
        // the heartbeat keeps ownership alive while the read is in flight.
        await assertAndRenewLease();

        await prisma.$transaction([
          prisma.directoryGroupMemberSnapshot.deleteMany({ where: { groupDn: group.dn } }),
          prisma.directoryGroupMemberSnapshot.createMany({
            data: members.map((member) => ({
              groupDn: group.dn,
              syncRunId: run.id,
              username: member.username,
              email: member.email || null,
              displayName: member.displayName || null,
              accountEnabled: member.accountEnabled,
            })),
          }),
          prisma.allowedTicketSubjectGroup.update({
            where: { dn: group.dn },
            data: {
              lastSyncedAt: new Date(),
              lastSyncStatus: 'success',
            },
          }),
        ]);

        membersCaptured += members.length;
        succeededGroups += 1;
      } catch (error) {
        if (error instanceof DirectorySyncLeaseLostError) throw error;
        const message = error instanceof Error ? error.message : String(error);
        errors.push({ groupDn: group.dn, error: message });
        appLogger.error(`Directory sync failed for group ${group.dn}`, { message });

        // Keep the previous snapshot; only record observable failure state.
        await prisma.allowedTicketSubjectGroup
          .update({
            where: { dn: group.dn },
            // Preserve lastSyncedAt as the last successful snapshot refresh.
            // Advancing it here would make retained stale rows appear fresh.
            data: { lastSyncStatus: 'failed' },
          })
          .catch((updateError) => {
            appLogger.error(`Failed to record sync failure for group ${group.dn}`, {
              message: updateError instanceof Error ? updateError.message : String(updateError),
            });
          });
      }
    }

    const status: DirectorySyncOutcome['status'] =
      groups.length === 0 || errors.length === 0
        ? 'success'
        : succeededGroups > 0
          ? 'partial_failure'
          : 'failed';

    await prisma.directorySyncRun.update({
      where: { id: run.id },
      data: {
        status,
        finishedAt: new Date(),
        groupsProcessed: groups.length,
        membersCaptured,
        errors: errors.length > 0 ? { items: errors } : undefined,
      },
    });

    if (status !== 'success') {
      await notifyActiveAdministrators({
        dedupeKey: `directory-sync:${run.id}`,
        kind: 'sync_failure',
        title: status === 'failed' ? 'Directory sync failed' : 'Directory sync partially failed',
        message: `${errors.length} of ${groups.length} configured groups could not be refreshed.`,
        href: '/admin/configuration?section=directory-email',
        severity: status === 'failed' ? 'critical' : 'warning',
      }).catch((error) => {
        appLogger.error('Failed to create directory-sync in-app notifications', {
          runId: run.id,
          message: error instanceof Error ? error.message : String(error),
        });
      });
    }

    return {
      runId: run.id,
      status,
      groupsProcessed: groups.length,
      membersCaptured,
      errors,
    };
  } catch (error) {
    if (activeRunId) {
      await prisma.directorySyncRun.updateMany({
        where: { id: activeRunId, status: 'running' },
        data: { status: 'failed', finishedAt: new Date() },
      }).catch(() => undefined);
    }
    throw error;
  } finally {
    clearInterval(leaseHeartbeat);
    await heartbeatPromise.catch(() => undefined);
    await prisma.operationalLease
      .deleteMany({ where: { key: SYNC_LEASE_KEY, owner: leaseOwner } })
      .catch(() => undefined);
  }
}
