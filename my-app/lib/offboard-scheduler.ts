import crypto from 'crypto';
import { processOffboardCampaigns } from '@/lib/offboard-campaign';
import { appLogger } from '@/lib/logger';
import { calculateOffboardScheduledWindow } from '@/lib/offboard-scheduler-window';

const CURSOR_KEY = 'offboard-scheduler:v1:last-successful-run';
const LOCK_KEY = 'offboard-scheduler:v1:lock';
const DEFAULT_GRACE_SECONDS = 15 * 60;
const LOCK_SECONDS = 10 * 60;

interface SchedulerRedisClient {
  get(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    options?: { EX?: number; NX?: boolean }
  ): Promise<string | null>;
  eval(
    script: string,
    options: { keys: string[]; arguments: string[] }
  ): Promise<unknown>;
}

let redisPromise: Promise<SchedulerRedisClient> | null = null;

function readIntegerEnv(name: string, fallback: number, minimum: number, maximum: number) {
  const raw = process.env[name];
  if (!raw) return fallback;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }

  return parsed;
}

export function isOffboardSchedulerEnabled() {
  return process.env.OFFBOARD_SCHEDULER_ENABLED === 'true';
}

async function getRedisClient(): Promise<SchedulerRedisClient> {
  if (redisPromise) return redisPromise;

  redisPromise = (async () => {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      throw new Error('REDIS_URL is required for guarded offboard scheduling');
    }
    if (redisUrl.includes('upstash.io')) {
      throw new Error('Guarded offboard scheduling currently requires a standard Redis connection URL');
    }

    const { createClient } = await import('redis');
    const client = createClient({ url: redisUrl });
    client.on('error', error => {
      appLogger.error('Offboard scheduler Redis client error', { error });
    });
    await client.connect();
    return client as unknown as SchedulerRedisClient;
  })().catch(error => {
    redisPromise = null;
    throw error;
  });

  return redisPromise;
}

async function releaseLock(redis: SchedulerRedisClient, token: string) {
  await redis.eval(
    'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end',
    { keys: [LOCK_KEY], arguments: [token] }
  );
}

export async function runGuardedOffboardScheduler(now = new Date()) {
  if (!isOffboardSchedulerEnabled()) {
    return {
      status: 'disabled' as const,
      message: 'OFFBOARD_SCHEDULER_ENABLED is not true',
    };
  }

  const redis = await getRedisClient();
  const token = crypto.randomUUID();
  const acquired = await redis.set(LOCK_KEY, token, { EX: LOCK_SECONDS, NX: true });
  if (!acquired) {
    return {
      status: 'busy' as const,
      message: 'Another offboard scheduler run is already active',
    };
  }

  try {
    const cursorValue = await redis.get(CURSOR_KEY);
    const graceSeconds = readIntegerEnv(
      'OFFBOARD_SCHEDULER_GRACE_SECONDS',
      DEFAULT_GRACE_SECONDS,
      60,
      86_400
    );
    const window = calculateOffboardScheduledWindow(cursorValue, now, graceSeconds);

    if (!window) {
      await redis.set(CURSOR_KEY, now.toISOString());
      appLogger.warn('Initialized guarded offboard scheduler baseline without processing backlog', {
        baseline: now.toISOString(),
      });
      return {
        status: 'initialized' as const,
        baseline: now.toISOString(),
        message: 'Baseline recorded; existing overdue work was not processed',
      };
    }

    if (window.startExclusive >= window.endInclusive) {
      await redis.set(CURSOR_KEY, now.toISOString());
      return {
        status: 'idle' as const,
        windowStart: window.startExclusive.toISOString(),
        windowEnd: window.endInclusive.toISOString(),
        results: [],
      };
    }

    const results = await processOffboardCampaigns({
      actor: 'offboard-scheduler',
      limit: 250,
      processInitialEmails: false,
      scheduledWindow: window,
    });
    const batchLimitReached = results.some(result => result.batchLimitReached);
    if (!batchLimitReached) {
      await redis.set(CURSOR_KEY, now.toISOString());
    }

    appLogger.info('Guarded offboard scheduler completed', {
      windowStart: window.startExclusive.toISOString(),
      windowEnd: window.endInclusive.toISOString(),
      protectedBacklog: window.protectedBacklog,
      cursorAdvanced: !batchLimitReached,
      campaigns: results.length,
    });

    return {
      status: 'processed' as const,
      windowStart: window.startExclusive.toISOString(),
      windowEnd: window.endInclusive.toISOString(),
      protectedBacklog: window.protectedBacklog,
      cursorAdvanced: !batchLimitReached,
      results,
    };
  } finally {
    await releaseLock(redis, token).catch(error => {
      appLogger.error('Failed to release offboard scheduler lock', { error });
    });
  }
}
