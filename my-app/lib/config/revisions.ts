import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

/**
 * Immutable before/after trail for persisted configuration (roadmap §6.14).
 * Every write through System Configuration appends one row per changed key.
 *
 * Secret material is NEVER recorded: secret revisions persist only the
 * changeKind marker so history proves a credential was rotated or cleared
 * without exposing plaintext, ciphertext, or its length.
 */

export const SECRET_REVISION_MARKER = '(encrypted value changed)' as const;

export type ConfigChangeKind = 'update' | 'clear' | 'secret_change';

export interface ConfigRevisionInput {
  key: string;
  previousValue: unknown;
  newValue: unknown;
  changeKind: ConfigChangeKind;
  changedBy: string;
  reason?: string;
}

function toJson(value: unknown): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
  if (value === null || value === undefined) return Prisma.DbNull;
  try {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  } catch {
    // Values are already registry-validated JSON-compatible structures; this
    // branch exists so a malformed caller can never fail a business write.
    return Prisma.DbNull;
  }
}

/** Truncate a free-text reason to a bounded, sanitized string. */
export function normalizeRevisionReason(reason: unknown): string | undefined {
  if (typeof reason !== 'string') return undefined;
  const trimmed = reason.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, 500);
}

/**
 * Record one configuration revision. Best-effort by design: a revision-store
 * outage must not roll back a configuration change that already succeeded
 * (fail-open matches the resolver's availability contract). Callers log the
 * failure; the audit log remains the authoritative accountability record.
 */
export async function recordConfigRevision(input: ConfigRevisionInput): Promise<void> {
  await prisma.configurationRevision.create({
    data: {
      key: input.key,
      previousValue: toJson(input.previousValue),
      newValue: toJson(input.newValue),
      changeKind: input.changeKind,
      changedBy: input.changedBy,
      reason: normalizeRevisionReason(input.reason),
    },
  });
}
