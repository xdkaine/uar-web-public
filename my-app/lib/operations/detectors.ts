import { createHash, randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';

import {
  effectiveCronRouteRegistry,
  type EffectiveCronRouteDescriptor,
} from '@/lib/cron/registry';
import { enqueueFlowEvent } from '@/lib/flow/outbox';
import { appLogger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';

export const OPERATIONAL_EVIDENCE_ARCHIVE_AFTER_DAYS = 365;
export const OPERATIONAL_DETECTOR_VERSION = 1;
export const OPERATIONAL_EVIDENCE_VERSION = 1;

const ACCESS_REQUEST_STALE_AFTER_MS = 15 * 60_000;
const DELIVERY_STATE_STALE_AFTER_MS = 5 * 60_000;
const MINIMUM_JOB_STALE_AFTER_MS = 5 * 60_000;
const DETECTOR_LEASE_MS = 90_000;
const ACCESS_REQUEST_SCAN_BATCH = 100;
const ACTIVE_SIGNAL_SCAN_BATCH = 250;

type SignalSeverity = 'info' | 'warning' | 'critical';

interface OperationalObservation {
  detectorKey: string;
  subjectKey: string;
  subjectType: 'scheduled_job' | 'access_request';
  subjectId: string;
  reasonCode: string;
  severity: SignalSeverity;
  summary: string;
  sourceType: 'cron_run' | 'scheduler_registry' | 'access_request';
  sourceId?: string;
  fingerprint: string;
  href: string;
  evidence: Record<string, string | number | boolean | null>;
}

export interface CronRunObservation {
  id: string;
  route: string;
  outcome: string;
  startedAt: Date;
  finishedAt: Date | null;
  durationMs: number | null;
  itemsProcessed: number;
  errorClass: string | null;
  detail: unknown;
}

export interface AccessRequestDetectorRecord {
  id: string;
  status: string;
  provisioningState: string | null;
  provisioningStartedAt: Date | null;
  provisioningCompletedAt: Date | null;
  facultyNotificationState: string | null;
  facultyNotificationClaimedUntil: Date | null;
  updatedAt: Date;
}

const TERMINAL_PROVISIONING_STATES = new Set([
  'failed',
  'ldap_failed',
  'delivery_failed',
  'delivery_reconciliation_required',
  'reconciliation_required',
  'approval_failed',
  'rejection_failed',
  'verification_email_failed',
]);

const IN_PROGRESS_PROVISIONING_STATES = new Set([
  'in_progress',
  'approval_in_progress',
  'rejection_in_progress',
  'provisioning',
]);

const UPDATED_AT_DELIVERY_STATES = new Set([
  'delivery_sending',
  'delivery_retrying',
  'verification_email_sending',
]);

function fingerprint(value: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function archiveEligibleAt(now: Date): Date {
  return new Date(now.getTime() + OPERATIONAL_EVIDENCE_ARCHIVE_AFTER_DAYS * 24 * 60 * 60_000);
}

function signalContext(
  signalId: string,
  observation: OperationalObservation,
  correlationId: string,
  evidenceEventId: string
): Record<string, string> {
  return {
    detectorKey: observation.detectorKey,
    reasonCode: observation.reasonCode,
    severity: observation.severity,
    subjectType: observation.subjectType,
    subjectId: observation.subjectId,
    route: observation.subjectType === 'scheduled_job' ? observation.subjectId : '',
    summary: observation.summary,
    dedupeKey: `${observation.detectorKey}:${observation.subjectKey}`,
    evidenceEventId,
    correlationId,
    signalId,
    href: observation.href,
  };
}

async function appendTransition(
  tx: Prisma.TransactionClient,
  signalId: string,
  transition: 'detected' | 'resolved',
  observation: OperationalObservation,
  now: Date
): Promise<void> {
  const eventId = randomUUID();
  const correlationId = randomUUID();
  const eventKey = `operational:${signalId}:${eventId}`;
  const summary = transition === 'resolved'
    ? `Resolved: ${observation.summary}`
    : observation.summary;

  await tx.operationalSignalEvent.create({
    data: {
      id: eventId,
      signalId,
      eventKey,
      transition,
      detectorKey: observation.detectorKey,
      detectorVersion: OPERATIONAL_DETECTOR_VERSION,
      evidenceVersion: OPERATIONAL_EVIDENCE_VERSION,
      sourceType: observation.sourceType,
      sourceId: observation.sourceId,
      correlationId,
      summary,
      evidence: observation.evidence as Prisma.InputJsonValue,
      archiveEligibleAt: archiveEligibleAt(now),
    },
  });

  await enqueueFlowEvent(tx, {
    triggerKey: transition === 'resolved' ? 'operational_issue_resolved' : 'operational_issue_detected',
    eventKey,
    context: signalContext(signalId, { ...observation, summary }, correlationId, eventId),
  });
}

async function observeSignal(
  observation: OperationalObservation,
  now = new Date(),
  retryTransaction = true,
  revalidate?: (tx: Prisma.TransactionClient) => Promise<OperationalObservation | null>
): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      const currentObservation = revalidate ? await revalidate(tx) : observation;
      if (!currentObservation) return;
      const existing = await tx.operationalSignal.findUnique({
        where: {
          detectorKey_subjectKey: {
            detectorKey: currentObservation.detectorKey,
            subjectKey: currentObservation.subjectKey,
          },
        },
      });

      if (!existing) {
        const signal = await tx.operationalSignal.create({
          data: {
            detectorKey: currentObservation.detectorKey,
            subjectKey: currentObservation.subjectKey,
            subjectType: currentObservation.subjectType,
            subjectId: currentObservation.subjectId,
            reasonCode: currentObservation.reasonCode,
            fingerprint: currentObservation.fingerprint,
            severity: currentObservation.severity,
            summary: currentObservation.summary,
            firstSeenAt: now,
            lastSeenAt: now,
          },
        });
        await appendTransition(tx, signal.id, 'detected', currentObservation, now);
        return;
      }

      const isNewEpisode = existing.status !== 'active';
      const changedFingerprint = existing.fingerprint !== currentObservation.fingerprint;
      if (isNewEpisode || changedFingerprint) {
        const claimed = await tx.operationalSignal.updateMany({
          where: {
            id: existing.id,
            OR: [
              { status: { not: 'active' } },
              { fingerprint: { not: currentObservation.fingerprint } },
            ],
          },
          data: {
            status: 'active',
            subjectType: currentObservation.subjectType,
            subjectId: currentObservation.subjectId,
            reasonCode: currentObservation.reasonCode,
            fingerprint: currentObservation.fingerprint,
            severity: currentObservation.severity,
            summary: currentObservation.summary,
            firstSeenAt: isNewEpisode ? now : existing.firstSeenAt,
            lastSeenAt: now,
            resolvedAt: null,
            occurrenceCount: isNewEpisode ? 1 : { increment: 1 },
          },
        });
        if (claimed.count === 1) {
          await appendTransition(tx, existing.id, 'detected', currentObservation, now);
          return;
        }
      }

      const refreshed = await tx.operationalSignal.updateMany({
        where: {
          id: existing.id,
          status: 'active',
          fingerprint: currentObservation.fingerprint,
        },
        data: {
          lastSeenAt: now,
          occurrenceCount: { increment: 1 },
        },
      });
      if (refreshed.count !== 1) {
        throw Object.assign(new Error('Operational signal projection changed concurrently'), {
          code: 'P2034',
        });
      }
    }, { isolationLevel: 'Serializable' });
  } catch (error) {
    if (
      retryTransaction &&
      error &&
      typeof error === 'object' &&
      ((error as { code?: string }).code === 'P2002' || (error as { code?: string }).code === 'P2034')
    ) {
      await observeSignal(observation, now, false, revalidate);
      return;
    }
    throw error;
  }
}

async function resolveSignal(
  detectorKey: string,
  subjectKey: string,
  fallback: Omit<OperationalObservation, 'fingerprint'>,
  now = new Date(),
  revalidate?: (tx: Prisma.TransactionClient) => Promise<boolean>,
  retryTransaction = true
): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      if (revalidate && !(await revalidate(tx))) return;
      const existing = await tx.operationalSignal.findUnique({
        where: { detectorKey_subjectKey: { detectorKey, subjectKey } },
      });
      if (!existing || existing.status !== 'active') return;

      const observation: OperationalObservation = {
        ...fallback,
        detectorKey,
        subjectKey,
        reasonCode: existing.reasonCode,
        severity: existing.severity as SignalSeverity,
        summary: existing.summary,
        fingerprint: existing.fingerprint,
      };
      const claimed = await tx.operationalSignal.updateMany({
        where: { id: existing.id, status: 'active' },
        data: { status: 'resolved', resolvedAt: now },
      });
      if (claimed.count !== 1) return;
      await appendTransition(tx, existing.id, 'resolved', observation, now);
    }, { isolationLevel: 'Serializable' });
  } catch (error) {
    if (
      retryTransaction &&
      error &&
      typeof error === 'object' &&
      (error as { code?: string }).code === 'P2034'
    ) {
      await resolveSignal(detectorKey, subjectKey, fallback, now, revalidate, false);
      return;
    }
    throw error;
  }
}

export function routeStaleAfterMs(expectedIntervalSeconds: number): number {
  return Math.max(expectedIntervalSeconds * 3 * 1000, MINIMUM_JOB_STALE_AFTER_MS);
}

export function isRouteOverdue(
  lastRunAt: Date,
  expectedIntervalSeconds: number,
  now = new Date()
): boolean {
  return now.getTime() - lastRunAt.getTime() > routeStaleAfterMs(expectedIntervalSeconds);
}

function cronFailureObservation(run: CronRunObservation): OperationalObservation {
  const errorClass = run.errorClass || 'unknown_error';
  return {
    detectorKey: 'scheduled_job_failed',
    subjectKey: run.route,
    subjectType: 'scheduled_job',
    subjectId: run.route,
    reasonCode: 'latest_run_failed',
    severity: 'critical',
    summary: `${run.route} failed with ${errorClass}.`,
    sourceType: 'cron_run',
    sourceId: run.id,
    fingerprint: fingerprint({ errorClass }),
    href: `/admin/operations?route=${encodeURIComponent(run.route)}`,
    evidence: {
      route: run.route,
      outcome: run.outcome,
      errorClass,
      startedAt: run.startedAt.toISOString(),
      finishedAt: run.finishedAt?.toISOString() ?? null,
      durationMs: run.durationMs,
      itemsProcessed: run.itemsProcessed,
      cronRunId: run.id,
    },
  };
}

function cronOverdueObservation(
  descriptor: EffectiveCronRouteDescriptor,
  run: { id: string; route: string; outcome: string; startedAt: Date },
  now: Date
): OperationalObservation {
  return {
    detectorKey: 'scheduled_job_overdue',
    subjectKey: descriptor.route,
    subjectType: 'scheduled_job',
    subjectId: descriptor.route,
    reasonCode: 'cadence_missed',
    severity: 'warning',
    summary: `${descriptor.label} is overdue for a recorded run.`,
    sourceType: 'scheduler_registry',
    sourceId: run.id,
    fingerprint: fingerprint({
      cronRunId: run.id,
      expectedIntervalSeconds: descriptor.expectedIntervalSeconds,
    }),
    href: `/admin/operations?route=${encodeURIComponent(descriptor.route)}`,
    evidence: {
      route: descriptor.route,
      label: descriptor.label,
      lastCronRunId: run.id,
      lastRunAt: run.startedAt.toISOString(),
      latestOutcome: run.outcome,
      expectedIntervalSeconds: descriptor.expectedIntervalSeconds,
      staleAfterSeconds: routeStaleAfterMs(descriptor.expectedIntervalSeconds) / 1000,
      overdueMinutes: Math.floor((now.getTime() - run.startedAt.getTime()) / 60_000),
    },
  };
}

/**
 * Called after CronRun persistence. Detector failure remains best-effort and
 * can never alter the scheduled job's response or outcome.
 */
export async function observeCronRun(run: CronRunObservation): Promise<void> {
  try {
    const latest = await prisma.cronRun.findFirst({
      where: { route: run.route },
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      select: { id: true },
    });
    // Overlapping executions can finish and persist out of order. Only the
    // newest scheduled start is allowed to change the current projection.
    if (latest?.id !== run.id) return;

    const isStillLatest = async (tx: Prisma.TransactionClient): Promise<boolean> => {
      const current = await tx.cronRun.findFirst({
        where: { route: run.route },
        orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
        select: { id: true },
      });
      return current?.id === run.id;
    };

    if (run.outcome === 'failed') {
      const observation = cronFailureObservation(run);
      await observeSignal(observation, new Date(), true, async (tx) =>
        await isStillLatest(tx) ? observation : null
      );
    } else if (run.outcome === 'success') {
      await resolveSignal('scheduled_job_failed', run.route, {
        detectorKey: 'scheduled_job_failed',
        subjectKey: run.route,
        subjectType: 'scheduled_job',
        subjectId: run.route,
        reasonCode: 'latest_run_failed',
        severity: 'critical',
        summary: `${run.route} recovered after a failed run.`,
        sourceType: 'cron_run',
        sourceId: run.id,
        href: `/admin/operations?route=${encodeURIComponent(run.route)}`,
        evidence: {
          route: run.route,
          outcome: run.outcome,
          cronRunId: run.id,
          startedAt: run.startedAt.toISOString(),
        },
      }, new Date(), isStillLatest);
    }

    await resolveSignal('scheduled_job_overdue', run.route, {
      detectorKey: 'scheduled_job_overdue',
      subjectKey: run.route,
      subjectType: 'scheduled_job',
      subjectId: run.route,
      reasonCode: 'cadence_missed',
      severity: 'warning',
      summary: `${run.route} recorded a new run.`,
      sourceType: 'cron_run',
      sourceId: run.id,
      href: `/admin/operations?route=${encodeURIComponent(run.route)}`,
      evidence: {
        route: run.route,
        outcome: run.outcome,
        cronRunId: run.id,
        startedAt: run.startedAt.toISOString(),
      },
    }, new Date(), isStillLatest);
  } catch (error) {
    appLogger.error('Failed to evaluate persisted cron evidence', {
      route: run.route,
      cronRunId: run.id,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

export function classifyAccessRequestInterventions(
  request: AccessRequestDetectorRecord,
  now = new Date()
): OperationalObservation[] {
  const observations: OperationalObservation[] = [];
  const base = {
    detectorKey: 'access_request_intervention_required',
    subjectType: 'access_request' as const,
    subjectId: request.id,
    severity: 'warning' as const,
    sourceType: 'access_request' as const,
    sourceId: request.id,
    href: `/admin/requests/${encodeURIComponent(request.id)}`,
  };

  const add = (
    reasonCode: string,
    summary: string,
    evidence: Record<string, string | number | boolean | null>,
    severity: SignalSeverity = 'warning'
  ) => {
    const subjectKey = `${request.id}:${reasonCode}`;
    const stableEvidence = Object.fromEntries(
      Object.entries(evidence).filter(([key]) => key !== 'ageMinutes')
    );
    observations.push({
      ...base,
      subjectKey,
      reasonCode,
      severity,
      summary,
      fingerprint: fingerprint(stableEvidence),
      evidence,
    });
  };

  if (request.provisioningState && TERMINAL_PROVISIONING_STATES.has(request.provisioningState)) {
    add(
      'terminal_provisioning_failure',
      `Access request ${request.id} requires provisioning reconciliation.`,
      {
        requestId: request.id,
        requestStatus: request.status,
        provisioningState: request.provisioningState,
        provisioningStartedAt: request.provisioningStartedAt?.toISOString() ?? null,
        provisioningCompletedAt: request.provisioningCompletedAt?.toISOString() ?? null,
      },
      'critical'
    );
  }

  if (
    request.provisioningState &&
    IN_PROGRESS_PROVISIONING_STATES.has(request.provisioningState) &&
    !request.provisioningStartedAt
  ) {
    add(
      'missing_provisioning_claim_timestamp',
      `Access request ${request.id} has an incomplete provisioning claim.`,
      {
        requestId: request.id,
        requestStatus: request.status,
        provisioningState: request.provisioningState,
        provisioningStartedAt: null,
      },
      'critical'
    );
  } else if (
    request.provisioningState &&
    IN_PROGRESS_PROVISIONING_STATES.has(request.provisioningState) &&
    request.provisioningStartedAt &&
    now.getTime() - request.provisioningStartedAt.getTime() > ACCESS_REQUEST_STALE_AFTER_MS
  ) {
    add(
      'stale_provisioning_claim',
      `Access request ${request.id} has an expired provisioning claim.`,
      {
        requestId: request.id,
        requestStatus: request.status,
        provisioningState: request.provisioningState,
        provisioningStartedAt: request.provisioningStartedAt.toISOString(),
        ageMinutes: Math.floor((now.getTime() - request.provisioningStartedAt.getTime()) / 60_000),
      },
      'critical'
    );
  }

  if (
    request.provisioningState &&
    UPDATED_AT_DELIVERY_STATES.has(request.provisioningState) &&
    now.getTime() - request.updatedAt.getTime() > DELIVERY_STATE_STALE_AFTER_MS
  ) {
    add(
      'stale_delivery_state',
      `Access request ${request.id} has an expired delivery lease that requires reconciliation.`,
      {
        requestId: request.id,
        requestStatus: request.status,
        provisioningState: request.provisioningState,
        leaseUpdatedAt: request.updatedAt.toISOString(),
        ageMinutes: Math.floor((now.getTime() - request.updatedAt.getTime()) / 60_000),
      },
      'critical'
    );
  }

  if (
    request.facultyNotificationState === 'failed' ||
    request.facultyNotificationState === 'delivery_unknown'
  ) {
    add(
      'faculty_delivery_reconciliation',
      `Access request ${request.id} has an unresolved faculty-notification outcome.`,
      {
        requestId: request.id,
        requestStatus: request.status,
        facultyNotificationState: request.facultyNotificationState,
        facultyNotificationClaimedUntil: request.facultyNotificationClaimedUntil?.toISOString() ?? null,
      },
      request.facultyNotificationState === 'delivery_unknown' ? 'critical' : 'warning'
    );
  }

  if (
    request.facultyNotificationState === 'sending' &&
    !request.facultyNotificationClaimedUntil
  ) {
    add(
      'missing_faculty_delivery_claim_expiry',
      `Access request ${request.id} has an incomplete faculty-notification claim.`,
      {
        requestId: request.id,
        requestStatus: request.status,
        facultyNotificationState: request.facultyNotificationState,
        facultyNotificationClaimedUntil: null,
      },
      'critical'
    );
  } else if (
    request.facultyNotificationState === 'sending' &&
    request.facultyNotificationClaimedUntil &&
    request.facultyNotificationClaimedUntil < now
  ) {
    add(
      'expired_faculty_delivery_claim',
      `Access request ${request.id} has an expired faculty-notification claim.`,
      {
        requestId: request.id,
        requestStatus: request.status,
        facultyNotificationState: request.facultyNotificationState,
        facultyNotificationClaimedUntil: request.facultyNotificationClaimedUntil.toISOString(),
        ageMinutes: Math.floor((now.getTime() - request.facultyNotificationClaimedUntil.getTime()) / 60_000),
      },
      'critical'
    );
  }

  return observations;
}

async function scanScheduledJobOverdue(now: Date, assertLease: () => Promise<void>): Promise<number> {
  const registry = effectiveCronRouteRegistry();
  const routes = registry.map((entry) => entry.route);
  const latestRuns = await prisma.cronRun.findMany({
    where: { route: { in: routes } },
    orderBy: [{ route: 'asc' }, { startedAt: 'desc' }],
    distinct: ['route'],
  });
  const latestByRoute = new Map(latestRuns.map((run) => [run.route, run]));
  const activeSubjectKeys = new Set<string>();

  for (const descriptor of registry) {
    if (!descriptor.enabled) continue;
    const run = latestByRoute.get(descriptor.route);
    if (!run || !isRouteOverdue(run.startedAt, descriptor.expectedIntervalSeconds, now)) continue;
    activeSubjectKeys.add(descriptor.route);
    const observation = cronOverdueObservation(descriptor, run, now);
    await observeSignal(observation, now, true, async (tx) => {
      const effective = effectiveCronRouteRegistry()
        .find((entry) => entry.route === descriptor.route);
      if (!effective?.enabled) return null;
      const current = await tx.cronRun.findFirst({
        where: { route: descriptor.route },
        orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
        select: { id: true, route: true, outcome: true, startedAt: true },
      });
      if (!current || !isRouteOverdue(current.startedAt, effective.expectedIntervalSeconds, now)) {
        return null;
      }
      return cronOverdueObservation(effective, current, now);
    });
  }

  await assertLease();
  const activeSignals = await prisma.operationalSignal.findMany({
    where: { detectorKey: 'scheduled_job_overdue', status: 'active' },
    take: ACTIVE_SIGNAL_SCAN_BATCH,
    select: { subjectKey: true, subjectId: true },
  });
  for (const signal of activeSignals) {
    await resolveSignal('scheduled_job_overdue', signal.subjectKey, {
      detectorKey: 'scheduled_job_overdue',
      subjectKey: signal.subjectKey,
      subjectType: 'scheduled_job',
      subjectId: signal.subjectId,
      reasonCode: 'cadence_missed',
      severity: 'warning',
      summary: `${signal.subjectId} is no longer overdue.`,
      sourceType: 'scheduler_registry',
      href: `/admin/operations?route=${encodeURIComponent(signal.subjectId)}`,
      evidence: { route: signal.subjectId, resolvedAt: now.toISOString() },
    }, now, async (tx) => {
      const descriptor = effectiveCronRouteRegistry()
        .find((entry) => entry.route === signal.subjectId);
      if (!descriptor?.enabled) return true;
      const current = await tx.cronRun.findFirst({
        where: { route: signal.subjectId },
        orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
        select: { startedAt: true },
      });
      return !current || !isRouteOverdue(current.startedAt, descriptor.expectedIntervalSeconds, now);
    });
  }
  return activeSubjectKeys.size;
}

async function scanAccessRequestInterventions(
  now: Date,
  assertLease: () => Promise<void>
): Promise<number> {
  const staleStartedBefore = new Date(now.getTime() - ACCESS_REQUEST_STALE_AFTER_MS);
  const staleDeliveryBefore = new Date(now.getTime() - DELIVERY_STATE_STALE_AFTER_MS);
  const candidateWhere: Prisma.AccessRequestWhereInput = {
    OR: [
      { provisioningState: { in: [...TERMINAL_PROVISIONING_STATES] } },
      {
        provisioningState: { in: [...IN_PROGRESS_PROVISIONING_STATES] },
        provisioningStartedAt: { lt: staleStartedBefore },
      },
      {
        provisioningState: { in: [...IN_PROGRESS_PROVISIONING_STATES] },
        provisioningStartedAt: null,
      },
      {
        provisioningState: { in: [...UPDATED_AT_DELIVERY_STATES] },
        updatedAt: { lt: staleDeliveryBefore },
      },
      { facultyNotificationState: { in: ['failed', 'delivery_unknown'] } },
      {
        facultyNotificationState: 'sending',
        facultyNotificationClaimedUntil: { lt: now },
      },
      {
        facultyNotificationState: 'sending',
        facultyNotificationClaimedUntil: null,
      },
    ],
  };
  const requestSelect = {
    id: true,
    status: true,
    provisioningState: true,
    provisioningStartedAt: true,
    provisioningCompletedAt: true,
    facultyNotificationState: true,
    facultyNotificationClaimedUntil: true,
    updatedAt: true,
  } as const;
  const activeSubjectKeys = new Set<string>();
  let candidateCursor: string | undefined;
  do {
    await assertLease();
    const candidates = await prisma.accessRequest.findMany({
      where: candidateWhere,
      orderBy: { id: 'asc' },
      take: ACCESS_REQUEST_SCAN_BATCH,
      ...(candidateCursor ? { cursor: { id: candidateCursor }, skip: 1 } : {}),
      select: requestSelect,
    });
    for (const [requestIndex, request] of candidates.entries()) {
      if (requestIndex > 0 && requestIndex % 20 === 0) await assertLease();
      for (const observation of classifyAccessRequestInterventions(request, now)) {
        activeSubjectKeys.add(observation.subjectKey);
        await observeSignal(observation, now, true, async (tx) => {
          const current = await tx.accessRequest.findUnique({
            where: { id: request.id },
            select: requestSelect,
          });
          if (!current) return null;
          return classifyAccessRequestInterventions(current, now)
            .find((entry) => entry.subjectKey === observation.subjectKey) ?? null;
        });
      }
    }
    candidateCursor = candidates.at(-1)?.id;
    if (candidates.length < ACCESS_REQUEST_SCAN_BATCH) break;
  } while (candidateCursor);

  let signalCursor: string | undefined;
  do {
    await assertLease();
    const activeSignals = await prisma.operationalSignal.findMany({
      where: { detectorKey: 'access_request_intervention_required', status: 'active' },
      orderBy: { id: 'asc' },
      take: ACTIVE_SIGNAL_SCAN_BATCH,
      ...(signalCursor ? { cursor: { id: signalCursor }, skip: 1 } : {}),
      select: { id: true, subjectKey: true, subjectId: true },
    });
    for (const [signalIndex, signal] of activeSignals.entries()) {
      if (signalIndex > 0 && signalIndex % 20 === 0) await assertLease();
      await resolveSignal('access_request_intervention_required', signal.subjectKey, {
        detectorKey: 'access_request_intervention_required',
        subjectKey: signal.subjectKey,
        subjectType: 'access_request',
        subjectId: signal.subjectId,
        reasonCode: 'intervention_cleared',
        severity: 'warning',
        summary: `Access request ${signal.subjectId} no longer matches an intervention detector.`,
        sourceType: 'access_request',
        sourceId: signal.subjectId,
        href: `/admin/requests/${encodeURIComponent(signal.subjectId)}`,
        evidence: { requestId: signal.subjectId, resolvedAt: now.toISOString() },
      }, now, async (tx) => {
        const current = await tx.accessRequest.findUnique({
          where: { id: signal.subjectId },
          select: requestSelect,
        });
        return !current || !classifyAccessRequestInterventions(current, now)
          .some((entry) => entry.subjectKey === signal.subjectKey);
      });
    }
    signalCursor = activeSignals.at(-1)?.id;
    if (activeSignals.length < ACTIVE_SIGNAL_SCAN_BATCH) break;
  } while (signalCursor);
  return activeSubjectKeys.size;
}

/** Evaluate only curated database-backed conditions; no raw log ingestion. */
export async function scanOperationalDetectors(now = new Date()): Promise<{
  overdueJobs: number;
  accessRequests: number;
  skipped?: boolean;
}> {
  const owner = randomUUID();
  const acquired = await prisma.$queryRaw<Array<{ owner: string }>>`
    INSERT INTO "OperationalLease" ("key", "owner", "expiresAt", "updatedAt")
    VALUES ('operational-detector-cycle', ${owner}, ${new Date(now.getTime() + DETECTOR_LEASE_MS)}, ${now})
    ON CONFLICT ("key") DO UPDATE SET
      "owner" = EXCLUDED."owner", "expiresAt" = EXCLUDED."expiresAt", "updatedAt" = EXCLUDED."updatedAt"
    WHERE "OperationalLease"."expiresAt" <= ${now}
    RETURNING "owner"
  `;
  if (acquired.length !== 1) return { overdueJobs: 0, accessRequests: 0, skipped: true };
  const assertLease = async (): Promise<void> => {
    const renewedAt = new Date();
    const renewed = await prisma.operationalLease.updateMany({
      where: { key: 'operational-detector-cycle', owner },
      data: {
        expiresAt: new Date(renewedAt.getTime() + DETECTOR_LEASE_MS),
        updatedAt: renewedAt,
      },
    });
    if (renewed.count !== 1) throw new Error('Operational detector lease was lost');
  };
  try {
    await assertLease();
    const overdueJobs = await scanScheduledJobOverdue(now, assertLease);
    await assertLease();
    const accessRequests = await scanAccessRequestInterventions(now, assertLease);
    return { overdueJobs, accessRequests };
  } finally {
    await prisma.operationalLease.deleteMany({
      where: { key: 'operational-detector-cycle', owner },
    }).catch(() => undefined);
  }
}
