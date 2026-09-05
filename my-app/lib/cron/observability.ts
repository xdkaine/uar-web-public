import { randomUUID } from 'node:crypto';

import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import { appLogger } from '@/lib/logger';
import { observeCronRun } from '@/lib/operations/detectors';
import { projectSafeCronDetail } from '@/lib/cron/evidence';

/**
 * Cron execution evidence (roadmap §16 external-side-effect events). Each
 * authenticated cron route records one CronRun row describing what happened,
 * including explicit module-disabled skips so operators can see WHY a pass
 * produced no work.
 *
 * Recording is strictly best-effort: an observability failure is logged and
 * swallowed so it can never fail the underlying job or alter its response.
 */

export type CronOutcome = 'success' | 'failed' | 'skipped_module_disabled';

export interface CronWorkResult {
  /** Number of domain items processed; defaults to 0 when not meaningful. */
  itemsProcessed?: number;
  /** Safe structured details (redacted before persistence by callers). */
  detail?: Record<string, unknown>;
  /** Route-specific payload echoed back so responses keep their exact shape. */
  response?: unknown;
}

/** Coarse, log-safe error classification for aggregation and alerting. */
export function classifyCronError(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (message.includes('ldap') || message.includes('directory')) return 'ldap_error';
    if (message.includes('smtp') || message.includes('mail')) return 'smtp_error';
    if (message.includes('timeout') || message.includes('etimedout')) return 'timeout';
    if (message.includes('connect')) return 'connection_error';
    return error.name || 'error';
  }
  return 'unknown_error';
}

async function writeRun(row: {
  route: string;
  outcome: CronOutcome;
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
  itemsProcessed: number;
  errorClass?: string;
  detail?: Record<string, unknown>;
  correlationId: string;
}): Promise<void> {
  try {
    const run = await prisma.cronRun.create({
      data: {
        route: row.route,
        outcome: row.outcome,
        startedAt: row.startedAt,
        finishedAt: row.finishedAt,
        durationMs: row.durationMs,
        itemsProcessed: row.itemsProcessed,
        errorClass: row.errorClass,
        detail: projectSafeCronDetail({
          outcome: row.outcome,
          itemsProcessed: row.itemsProcessed,
          errorClass: row.errorClass,
          detail: row.detail,
          correlationId: row.correlationId,
        }) as Prisma.InputJsonValue,
      },
    });
    await observeCronRun(run);
  } catch (error) {
    appLogger.error('Failed to record cron run', {
      route: row.route,
      outcome: row.outcome,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Run one cron unit of work with start/finish/outcome evidence. Rethrows so
 * route-level error handling (status codes, logs) keeps its exact behavior.
 * Generic in the work result so callers keep the precise shape their callback
 * returns (e.g. `response`, `results`, `scheduler` payload fields).
 */
export async function runCronWithObservability<T extends CronWorkResult>(
  routeName: string,
  work: () => Promise<T>
): Promise<T> {
  const startedAt = new Date();
  const correlationId = randomUUID();
  try {
    const result = await work();
    const finishedAt = new Date();
    await writeRun({
      route: routeName,
      outcome: 'success',
      startedAt,
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      itemsProcessed: result.itemsProcessed ?? 0,
      detail: result.detail,
      correlationId,
    });
    return result;
  } catch (error) {
    const finishedAt = new Date();
    await writeRun({
      route: routeName,
      outcome: 'failed',
      startedAt,
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      itemsProcessed: 0,
      errorClass: classifyCronError(error),
      correlationId,
    });
    throw error;
  }
}

/**
 * Module-gating helper for cron handlers. When the module owning this cron's
 * work is disabled, records a skipped run and returns false so callers can
 * short-circuit without any external side effects.
 */
export async function checkCronModuleEnabled(
  routeName: string,
  moduleId: string,
  isEnabled: () => Promise<boolean>
): Promise<boolean> {
  if (await isEnabled()) {
    return true;
  }
  await writeRun({
    route: routeName,
    outcome: 'skipped_module_disabled',
    startedAt: new Date(),
    finishedAt: new Date(),
    durationMs: 0,
    itemsProcessed: 0,
    detail: { moduleId },
    correlationId: randomUUID(),
  });
  return false;
}
