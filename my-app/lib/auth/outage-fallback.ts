import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';

import { AuditActions, AuditCategories, logAuditAction } from '@/lib/audit-log';
import {
  OidcProviderAvailabilityError,
  probeOidcProviderAvailability,
  type OidcProviderFailureReason,
} from '@/lib/auth/oidc';
import { appLogger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import {
  getRequiredAuthRedisClient,
  type RedisRateLimitClient,
} from '@/lib/ratelimit';

const CIRCUIT_KEY = 'auth:oidc-outage-fallback:circuit';
const CIRCUIT_OPENING_KEY = 'auth:oidc-outage-fallback:opening';
const CIRCUIT_CLOSING_KEY = 'auth:oidc-outage-fallback:closing';
const FAILURE_WINDOW_KEY = 'auth:oidc-outage-fallback:failures';
const FAILURE_WINDOW_SECONDS = 30;
const FAILURE_THRESHOLD = 3;
const CIRCUIT_TTL_SECONDS = 5 * 60;
const TRANSITION_TTL_SECONDS = 30;
const ACTIVATION_AUDIT_TIMEOUT_MS = 10_000;
const RECOVERY_WINDOW_PREFIX = 'auth:oidc-outage-fallback:recovery';
const RECOVERY_WINDOW_SECONDS = 30;
const RECOVERY_THRESHOLD = 2;

export type OidcOutageFallbackPolicy = 'off' | 'native_and_local';

export interface OidcOutageCircuit {
  correlationId: string;
  openedAt: string;
  expiresAt: string;
  reason: OidcProviderFailureReason;
}

export type OidcSignInDecision =
  | { kind: 'oidc_primary' }
  | { kind: 'outage_fallback'; circuit: OidcOutageCircuit };

function policy(): OidcOutageFallbackPolicy {
  return process.env.AUTH_OIDC_OUTAGE_FALLBACK === 'native_and_local'
    ? 'native_and_local'
    : 'off';
}

function internalProbeConfigured(): boolean {
  return Boolean(process.env.OIDC_INTERNAL_ISSUER_URL?.trim());
}

function parseCircuit(value: unknown): OidcOutageCircuit | null {
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value) as Partial<OidcOutageCircuit>;
    if (
      typeof parsed.correlationId !== 'string'
      || typeof parsed.openedAt !== 'string'
      || typeof parsed.expiresAt !== 'string'
      || typeof parsed.reason !== 'string'
      || new Date(parsed.expiresAt).getTime() <= Date.now()
    ) {
      return null;
    }
    return parsed as OidcOutageCircuit;
  } catch {
    return null;
  }
}

async function readCircuit(redis: RedisRateLimitClient): Promise<OidcOutageCircuit | null> {
  const [value, opening, closing] = await Promise.all([
    redis.get(CIRCUIT_KEY),
    redis.get(CIRCUIT_OPENING_KEY),
    redis.get(CIRCUIT_CLOSING_KEY),
  ]);
  // Once one replica claims recovery/closure, every replica immediately
  // denies the credential downgrade while the durable transition is written.
  const circuit = parseCircuit(value);
  if (circuit && closing === circuit.correlationId) return null;
  if (!circuit) return null;

  // Redis alone is never sufficient authorization for credential downgrade.
  // A circuit is readable only when the correlated durable activation audit
  // exists. This also fails closed if Redis rollback was unavailable after an
  // activation-audit failure.
  const activationAudit = await prisma.auditLog.findFirst({
    where: {
      action: AuditActions.OIDC_OUTAGE_FALLBACK_OPENED,
      correlationId: circuit.correlationId,
      outcome: 'success',
      success: true,
    },
    select: { id: true },
  });
  if (!activationAudit) {
    // The opener publishes a fenced candidate before committing its OPENED
    // audit. Readers remain fail-closed during that interval, but must not
    // delete the candidate while the matching transition owner is live.
    if (opening === circuit.correlationId) return null;
    await redis.deleteIfValue(CIRCUIT_KEY, JSON.stringify(circuit)).catch(() => undefined);
    return null;
  }
  return circuit;
}

async function verifyPortalDependencies(): Promise<void> {
  await prisma.$queryRaw<Array<{ ok: number }>>`SELECT 1 AS ok`;
}

async function auditCircuitTransition(
  action: string,
  circuit: OidcOutageCircuit,
  outcome: 'success' | 'failure' = 'success',
  transitionResult?: string,
  database?: Pick<Prisma.TransactionClient, 'auditLog'>
): Promise<void> {
  await logAuditAction({
    action,
    category: AuditCategories.AUTH,
    username: 'system',
    actorType: 'system',
    eventKind: 'security',
    outcome,
    correlationId: circuit.correlationId,
    details: {
      configuredMode: 'oidc',
      fallbackPolicy: policy(),
      reason: circuit.reason,
      openedAt: circuit.openedAt,
      expiresAt: circuit.expiresAt,
      ...(transitionResult ? { transitionResult } : {}),
    },
  }, database);
}

async function recordQualifyingFailure(
  redis: RedisRateLimitClient,
  reason: OidcProviderFailureReason
): Promise<OidcOutageCircuit | null> {
  const existing = await readCircuit(redis);
  if (existing) return existing;

  // The increment and first TTL assignment are one Redis operation. If this
  // code encounters a legacy counter without a TTL, the script resets it to
  // one rather than allowing stale evidence to authorize a later downgrade.
  const count = await redis.incrementWithFirstExpiry(
    FAILURE_WINDOW_KEY,
    FAILURE_WINDOW_SECONDS
  );
  if (count < FAILURE_THRESHOLD) {
    appLogger.warn('[OidcFallback] Auth service outage suspected', { reason, count });
    return null;
  }

  const now = new Date();
  const circuit: OidcOutageCircuit = {
    correlationId: randomUUID(),
    openedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + CIRCUIT_TTL_SECONDS * 1000).toISOString(),
    reason,
  };
  const ownsOpening = await redis.setIfAbsentWithExpiry(
    CIRCUIT_OPENING_KEY,
    circuit.correlationId,
    TRANSITION_TTL_SECONDS
  );
  if (!ownsOpening) return readCircuit(redis);

  try {
    if (await redis.get(CIRCUIT_KEY)) return readCircuit(redis);
    // The opening marker is never accepted as authorization. Verify durable
    // dependencies and persist an accurately named authorization event before
    // publishing the active circuit. The final write is fenced by ownership of
    // the transition marker, so an expired/stolen opener cannot activate.
    await verifyPortalDependencies();
    await auditCircuitTransition(
      AuditActions.OIDC_OUTAGE_FALLBACK_OPEN_AUTHORIZED,
      circuit
    );
    const activated = await redis.setIfOwnerWithExpiry(
      CIRCUIT_OPENING_KEY,
      circuit.correlationId,
      CIRCUIT_KEY,
      JSON.stringify(circuit),
      CIRCUIT_TTL_SECONDS,
      TRANSITION_TTL_SECONDS
    );
    if (!activated) {
      await auditCircuitTransition(
        AuditActions.OIDC_OUTAGE_FALLBACK_ACTIVATION_FAILED,
        circuit,
        'failure',
        'transition_ownership_lost_or_circuit_exists'
      );
      return readCircuit(redis);
    }
    try {
      await prisma.$transaction(
        async (transaction) => auditCircuitTransition(
          AuditActions.OIDC_OUTAGE_FALLBACK_OPENED,
          circuit,
          'success',
          undefined,
          transaction
        ),
        { timeout: ACTIVATION_AUDIT_TIMEOUT_MS }
      );
    } catch (error) {
      // Do not leave a circuit active without its correlated activation event.
      await redis.deleteIfValue(CIRCUIT_KEY, JSON.stringify(circuit)).catch((rollbackError) => {
        appLogger.error('[OidcFallback] Redis activation rollback failed; durable audit fence remains closed', undefined, {
          correlationId: circuit.correlationId,
          error: rollbackError instanceof Error ? rollbackError.message : 'unknown',
        });
      });
      await auditCircuitTransition(
        AuditActions.OIDC_OUTAGE_FALLBACK_ACTIVATION_FAILED,
        circuit,
        'failure',
        'activation_audit_failed'
      ).catch(() => undefined);
      throw error;
    }
    const committedCircuit = await readCircuit(redis);
    if (committedCircuit?.correlationId !== circuit.correlationId) {
      await auditCircuitTransition(
        AuditActions.OIDC_OUTAGE_FALLBACK_ACTIVATION_FAILED,
        circuit,
        'failure',
        'candidate_missing_after_activation_audit'
      );
      return committedCircuit;
    }
    await redis.del(FAILURE_WINDOW_KEY);
    appLogger.error('[OidcFallback] Native outage fallback opened', undefined, {
      correlationId: circuit.correlationId,
      reason,
      expiresAt: circuit.expiresAt,
    });
    return committedCircuit;
  } finally {
    await redis.deleteIfValue(CIRCUIT_OPENING_KEY, circuit.correlationId).catch(() => undefined);
  }
}

async function recordRecoverySuccess(
  redis: RedisRateLimitClient,
  circuit: OidcOutageCircuit
): Promise<boolean> {
  const recoveryKey = `${RECOVERY_WINDOW_PREFIX}:${circuit.correlationId}`;
  const count = await redis.incrementWithFirstExpiry(recoveryKey, RECOVERY_WINDOW_SECONDS);
  if (count < RECOVERY_THRESHOLD) return false;

  const ownsClosing = await redis.setIfAbsentWithExpiry(
    CIRCUIT_CLOSING_KEY,
    circuit.correlationId,
    TRANSITION_TTL_SECONDS
  );
  if (!ownsClosing) return true;

  try {
    const closed = await redis.deleteIfValue(CIRCUIT_KEY, JSON.stringify(circuit));
    if (!closed) return true;
    await auditCircuitTransition(AuditActions.OIDC_OUTAGE_FALLBACK_RECOVERED, circuit);
    await redis.del(recoveryKey);
    appLogger.info('[OidcFallback] Auth service recovered; native fallback closed', {
      correlationId: circuit.correlationId,
    });
    return true;
  } finally {
    await redis.deleteIfValue(CIRCUIT_CLOSING_KEY, circuit.correlationId).catch(() => undefined);
  }
}

export function isOidcOutageFallbackEnabled(): boolean {
  return policy() === 'native_and_local' && internalProbeConfigured();
}

/** Read the distributed lease without probing or changing provider state. */
export async function getActiveOidcOutageCircuit(): Promise<OidcOutageCircuit | null> {
  if (!isOidcOutageFallbackEnabled()) return null;
  return readCircuit(await getRequiredAuthRedisClient());
}

/**
 * Resolve what the sign-in page should do. Only qualifying internal transport
 * failures contribute to the circuit. HTTP, TLS, metadata, callback, token,
 * and user errors never open the native credential path.
 */
export async function evaluateOidcSignInDecision(): Promise<OidcSignInDecision> {
  if (!isOidcOutageFallbackEnabled()) return { kind: 'oidc_primary' };
  const redis = await getRequiredAuthRedisClient();
  const circuit = await readCircuit(redis);
  const availability = await probeOidcProviderAvailability();

  if (circuit) {
    if (availability.available && await recordRecoverySuccess(redis, circuit)) {
      return { kind: 'oidc_primary' };
    }
    if (!availability.available && !availability.qualifiesForOutageFallback) {
      // A transport outage must not mask a new TLS/config/protocol failure.
      // Close immediately rather than allowing the previous lease to turn a
      // non-qualifying condition into continued credential downgrade.
      const ownsClosing = await redis.setIfAbsentWithExpiry(
        CIRCUIT_CLOSING_KEY,
        circuit.correlationId,
        TRANSITION_TTL_SECONDS
      );
      if (ownsClosing) {
        try {
          await redis.deleteIfValue(CIRCUIT_KEY, JSON.stringify(circuit));
          await auditCircuitTransition(
            AuditActions.OIDC_OUTAGE_FALLBACK_CLOSED_FAIL_CLOSED,
            circuit,
            'failure'
          ).catch((error) => {
            appLogger.error('[OidcFallback] Failed to audit fail-closed circuit shutdown', undefined, {
              error: error instanceof Error ? error.message : 'unknown',
            });
          });
        } finally {
          await redis.deleteIfValue(CIRCUIT_CLOSING_KEY, circuit.correlationId).catch(() => undefined);
        }
      }
      return { kind: 'oidc_primary' };
    }
    return { kind: 'outage_fallback', circuit };
  }

  if (!availability.available && availability.qualifiesForOutageFallback) {
    const opened = await recordQualifyingFailure(redis, availability.reason);
    if (opened) return { kind: 'outage_fallback', circuit: opened };
  }
  return { kind: 'oidc_primary' };
}

/** Add a typed OIDC-start transport failure to the same distributed circuit. */
export async function recordOidcStartFailure(error: unknown): Promise<OidcOutageCircuit | null> {
  if (
    !isOidcOutageFallbackEnabled()
    || !(error instanceof OidcProviderAvailabilityError)
    || !error.qualifiesForOutageFallback
  ) {
    return null;
  }
  return recordQualifyingFailure(await getRequiredAuthRedisClient(), error.reason);
}

function positiveInteger(raw: string | undefined, fallback: number): number {
  const value = Number.parseInt(raw ?? '', 10);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function accountLockKey(username: string, now = Date.now()): string {
  const windowMs = positiveInteger(process.env.AUTH_ACCOUNT_LOCK_WINDOW_MS, 15 * 60 * 1000);
  const bucket = Math.floor(now / windowMs);
  return `authrl:acctlock:${encodeURIComponent(username.trim().toLowerCase())}:${bucket}`;
}

export async function isOutageFallbackAccountLocked(username: string): Promise<boolean> {
  const redis = await getRequiredAuthRedisClient();
  const raw = await redis.get(accountLockKey(username));
  const count = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? '0'), 10);
  return Number.isFinite(count)
    && count >= positiveInteger(process.env.AUTH_ACCOUNT_LOCK_MAX_ATTEMPTS, 5);
}

export async function recordOutageFallbackFailure(username: string): Promise<void> {
  const redis = await getRequiredAuthRedisClient();
  const key = accountLockKey(username);
  const count = await redis.incr(key);
  if (count === 1) {
    const windowMs = positiveInteger(process.env.AUTH_ACCOUNT_LOCK_WINDOW_MS, 15 * 60 * 1000);
    await redis.expire(key, Math.ceil(windowMs / 1000) + 1);
  }
}

export async function resetOutageFallbackFailures(username: string): Promise<void> {
  await (await getRequiredAuthRedisClient()).del(accountLockKey(username));
}

/**
 * Consume the same fixed-window per-IP budget as the standalone auth service,
 * so an outage does not grant a second password-spray allowance.
 */
export async function checkSharedAuthIpRateLimit(ip: string): Promise<{
  success: boolean;
  limit: number;
  remaining: number;
  reset: number;
}> {
  const redis = await getRequiredAuthRedisClient();
  const windowMs = positiveInteger(process.env.AUTH_LOGIN_WINDOW_MS, 15 * 60 * 1000);
  const limit = positiveInteger(process.env.AUTH_LOGIN_MAX_ATTEMPTS, 20);
  const bucket = Math.floor(Date.now() / windowMs);
  const key = `authrl:login:${ip}:${bucket}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, Math.ceil(windowMs / 1000) + 1);
  return {
    success: count <= limit,
    limit,
    remaining: Math.max(0, limit - count),
    reset: (bucket + 1) * windowMs,
  };
}
