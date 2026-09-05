import { prisma } from './db';
import { readFile, rename, writeFile } from 'node:fs/promises';

const DEFAULT_BATCH_SIZE = 1_000;
const DEFAULT_MAX_BATCHES = 25;
const DEFAULT_INTERVAL_SECONDS = 24 * 60 * 60;
const DEFAULT_RETRY_SECONDS = 5 * 60;
const DEFAULT_HEALTH_GRACE_SECONDS = 15 * 60;
const STATUS_PATH = process.env.AUTH_DEVICE_PURGE_STATUS_PATH || '/tmp/auth-device-purge-status.json';

interface ExpiredObservationStore {
  findMany(args: unknown): Promise<Array<{ id: string }>>;
  deleteMany(args: unknown): Promise<{ count: number }>;
}

export interface PurgeResult {
  deleted: number;
  batches: number;
  backlogRemaining: boolean;
}

interface MaintenanceStatus {
  lastAttemptAt: string;
  lastSuccessAt?: string;
  backlogRemaining?: boolean;
  deleted?: number;
  batches?: number;
  lastError?: string;
}

export function maintenanceStatusHealthy(
  status: MaintenanceStatus | null,
  nowMs: number,
  intervalSeconds: number,
  graceSeconds: number
): boolean {
  if (!status?.lastSuccessAt) return false;
  const lastSuccess = Date.parse(status.lastSuccessAt);
  return Number.isFinite(lastSuccess) && nowMs - lastSuccess <= (intervalSeconds + graceSeconds) * 1_000;
}

async function readStatus(): Promise<MaintenanceStatus | null> {
  try {
    return JSON.parse(await readFile(STATUS_PATH, 'utf8')) as MaintenanceStatus;
  } catch {
    return null;
  }
}

async function writeStatus(status: MaintenanceStatus): Promise<void> {
  const temporaryPath = `${STATUS_PATH}.${process.pid}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(status), { encoding: 'utf8', mode: 0o600 });
  await rename(temporaryPath, STATUS_PATH);
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

/** Bounded, restart-safe retention maintenance; concurrent runners may overlap safely. */
export async function purgeExpiredDeviceObservations(
  store: ExpiredObservationStore = prisma.deviceObservation as unknown as ExpiredObservationStore,
  options: { now?: Date; batchSize?: number; maxBatches?: number } = {}
): Promise<PurgeResult> {
  const now = options.now ?? new Date();
  const batchSize = boundedInteger(options.batchSize, DEFAULT_BATCH_SIZE, 1, 5_000);
  const maxBatches = boundedInteger(options.maxBatches, DEFAULT_MAX_BATCHES, 1, 1_000);
  let deleted = 0;
  let batches = 0;

  for (; batches < maxBatches; batches += 1) {
    const rows = await store.findMany({
      where: { expiresAt: { lte: now } },
      orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
      take: batchSize,
    });
    if (rows.length === 0) return { deleted, batches, backlogRemaining: false };
    const result = await store.deleteMany({ where: { id: { in: rows.map((row) => row.id) } } });
    deleted += result.count;
    if (rows.length < batchSize) return { deleted, batches: batches + 1, backlogRemaining: false };
  }

  const remaining = await store.findMany({
    where: { expiresAt: { lte: now } },
    orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
    select: { id: true },
    take: 1,
  });
  return { deleted, batches, backlogRemaining: remaining.length > 0 };
}

async function runOnce(): Promise<PurgeResult> {
  await prisma.auditLog.create({
    data: {
      action: 'DEVICE_EVIDENCE_PURGE_STARTED', category: 'maintenance', username: 'auth-maintenance',
      actorType: 'service', eventKind: 'security', outcome: 'started', success: true,
    },
  });
  const result = await purgeExpiredDeviceObservations(undefined, {
    batchSize: boundedInteger(process.env.AUTH_DEVICE_PURGE_BATCH_SIZE, DEFAULT_BATCH_SIZE, 1, 5_000),
    maxBatches: boundedInteger(process.env.AUTH_DEVICE_PURGE_MAX_BATCHES, DEFAULT_MAX_BATCHES, 1, 1_000),
  });
  await prisma.auditLog.create({
    data: {
      action: 'DEVICE_EVIDENCE_PURGED', category: 'maintenance', username: 'auth-maintenance',
      actorType: 'service', eventKind: 'security',
      outcome: result.backlogRemaining ? 'partial' : 'success',
      details: JSON.stringify(result), success: !result.backlogRemaining,
    },
  });
  const completedAt = new Date().toISOString();
  await writeStatus({
    lastAttemptAt: completedAt,
    lastSuccessAt: completedAt,
    backlogRemaining: result.backlogRemaining,
    deleted: result.deleted,
    batches: result.batches,
  });
  console.log('[auth-maintenance] device evidence purge complete', result);
  return result;
}

async function healthcheck(): Promise<void> {
  const intervalSeconds = boundedInteger(
    process.env.AUTH_DEVICE_PURGE_INTERVAL_SECONDS, DEFAULT_INTERVAL_SECONDS, 300, 7 * 24 * 60 * 60
  );
  const graceSeconds = boundedInteger(
    process.env.AUTH_DEVICE_PURGE_HEALTH_GRACE_SECONDS, DEFAULT_HEALTH_GRACE_SECONDS, 60, 24 * 60 * 60
  );
  const status = await readStatus();
  if (!maintenanceStatusHealthy(status, Date.now(), intervalSeconds, graceSeconds)) process.exitCode = 1;
}

async function main(): Promise<void> {
  if (process.argv.includes('--healthcheck')) {
    await healthcheck();
    await prisma.$disconnect();
    return;
  }
  const loop = process.argv.includes('--loop');
  const intervalSeconds = boundedInteger(
    process.env.AUTH_DEVICE_PURGE_INTERVAL_SECONDS,
    DEFAULT_INTERVAL_SECONDS,
    300,
    7 * 24 * 60 * 60
  );
  const retrySeconds = boundedInteger(
    process.env.AUTH_DEVICE_PURGE_RETRY_SECONDS, DEFAULT_RETRY_SECONDS, 30, 60 * 60
  );
  do {
    let delaySeconds = intervalSeconds;
    try {
      const result = await runOnce();
      if (result.backlogRemaining) delaySeconds = retrySeconds;
    } catch (error) {
      console.error('[auth-maintenance] device evidence purge failed', error);
      const previous = await readStatus();
      await writeStatus({
        ...(previous?.lastSuccessAt ? { lastSuccessAt: previous.lastSuccessAt } : {}),
        lastAttemptAt: new Date().toISOString(),
        backlogRemaining: previous?.backlogRemaining,
        lastError: error instanceof Error ? error.message.slice(0, 500) : 'unknown error',
      }).catch((statusError) => console.error('[auth-maintenance] status write failed', statusError));
      delaySeconds = retrySeconds;
      if (!loop) process.exitCode = 1;
    }
    if (!loop) break;
    await new Promise((resolve) => setTimeout(resolve, delaySeconds * 1_000));
  } while (true);
  await prisma.$disconnect();
}

if (require.main === module) void main();
