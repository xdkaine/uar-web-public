import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import { decryptPassword, encryptPassword } from '@/lib/encryption';
import { CONFIG_REGISTRY, getSecretDefinition, getConfigDefinition, type ConfigDefinition, type ConfigSource } from './registry';
import { recordConfigRevision, SECRET_REVISION_MARKER } from './revisions';

export interface ResolvedConfig<T = unknown> {
  key: string;
  value: T;
  source: ConfigSource;
}

interface StoredRow {
  key: string;
  value: unknown;
}

function parseEnvFor(definition: ConfigDefinition): unknown | undefined {
  if (!definition.envFallback) return undefined;
  const raw = process.env[definition.envFallback];
  if (raw === undefined || raw.trim() === '') return undefined;
  return definition.parseEnv(raw);
}

async function loadStoredRows(): Promise<Map<string, unknown>> {
  const rows = await prisma.systemConfigEntry.findMany();
  return new Map(rows.map((row: StoredRow) => [row.key, row.value]));
}

export function clearConfigCache(): void {
  // Kept as a compatibility hook for callers that persist configuration.
  // Resolution intentionally performs a database read on every call so an
  // authorization or credential change is visible across all app replicas.
}

/**
 * Resolve one key with ADR-0005 precedence:
 *   persisted database row -> legacy environment -> safe default.
 * Throws only when no source yields a VALID value for a required-style key
 * (e.g. ldap.url has no default); callers translate that into their existing
 * missing-configuration errors.
 */
export async function resolveConfig(key: string): Promise<ResolvedConfig> {
  const definition = getConfigDefinition(key);
  if (!definition) {
    throw new Error(`Unknown configuration key "${key}"`);
  }

  const rows = await loadStoredRows();
  if (rows.has(key)) {
    try {
      return { key, value: definition.validate(rows.get(key)), source: 'database' };
    } catch (error) {
      throw new Error(
        `Stored configuration key ${key} is invalid: ${error instanceof Error ? error.message : 'invalid value'}`
      );
    }
  }

  const envValue = parseEnvFor(definition);
  if (envValue !== undefined) {
    // Environment values are the legacy source of truth: pass strings through
    // as-is so downstream consumers keep raising their exact historical
    // errors (e.g. ldaps:// enforcement in createLDAPClient). Structured
    // value types must still parse.
    if (definition.valueType === 'string') {
      return { key, value: String(process.env[definition.envFallback!]).trim(), source: 'environment' };
    }
    try {
      return { key, value: envValue, source: 'environment' };
    } catch (error) {
      throw new Error(
        `Configuration key ${key} has an invalid environment fallback (${definition.envFallback}): ${error instanceof Error ? error.message : 'invalid'}`
      );
    }
  }

  return { key, value: definition.safeDefault, source: 'default' };
}

/** Value-only convenience for call sites replacing getRequiredEnv. */
export async function getConfigValue<T = unknown>(key: string): Promise<T> {
  return (await resolveConfig(key)).value as T;
}

/**
 * Resolve the whole registry in one stored-row read. Used by the
 * configuration UI and by consumers needing several related keys at once.
 */
export async function resolveAllConfig(): Promise<Array<ResolvedConfig & { description: string; envFallback?: string }>> {
  const rows = await loadStoredRows();
  return Object.values(CONFIG_REGISTRY).map((definition) => {
    const base: ResolvedConfig & { description: string; envFallback?: string } = {
      key: definition.key,
      value: definition.safeDefault,
      source: 'default',
      description: definition.description,
      envFallback: definition.envFallback,
    };

    if (rows.has(definition.key)) {
      try {
        base.value = definition.validate(rows.get(definition.key));
        base.source = 'database';
        return base;
      } catch (error) {
        throw new Error(
          `Stored configuration key ${definition.key} is invalid: ${error instanceof Error ? error.message : 'invalid value'}`
        );
      }
    }

    const envValue = parseEnvFor(definition);
    if (envValue !== undefined) {
      base.value = envValue;
      base.source = 'environment';
    }
    return base;
  });
}


// ---------------------------------------------------------------------------
// Secret configuration (ADR-0006): service-account credentials live in the
// same System Configuration surface but are stored ENCRYPTED and are never
// returned by bulk reads. Environment fallback keeps first deployments and
// break-glass recovery working.
// ---------------------------------------------------------------------------

const SECRET_STORE_MARKER = 'enc-v1';

interface StoredSecret {
  __secret: typeof SECRET_STORE_MARKER;
  data: string;
}

function isStoredSecret(value: unknown): value is StoredSecret {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as StoredSecret).__secret === SECRET_STORE_MARKER &&
    typeof (value as StoredSecret).data === 'string'
  );
}

/**
 * Resolve a secret credential. Precedence mirrors values: encrypted stored
 * row, then legacy environment, then unconfigured. The plaintext is ONLY
 * available through this function for direct use by consumers; it must never
 * be logged or included in API responses.
 */
export async function resolveSecret(
  key: string
): Promise<{ configured: boolean; source: ConfigSource | null; value: string }> {
  const definition = getSecretDefinition(key);
  if (!definition) {
    throw new Error(`Unknown secret configuration key "${key}"`);
  }

  const rows = await loadStoredRows();

  if (rows.has(key)) {
    try {
      const stored = rows.get(key);
      if (!isStoredSecret(stored)) {
        throw new Error('unrecognized stored secret format');
      }
      return { configured: true, source: 'database', value: decryptPassword(stored.data) };
    } catch (error) {
      throw new Error(
        `Stored secret configuration key ${key} is invalid: ${error instanceof Error ? error.message : 'invalid value'}`
      );
    }
  }

  const raw = process.env[definition.envFallback];
  if (raw && raw.trim() !== '') {
    return { configured: true, source: 'environment', value: raw };
  }

  return { configured: false, source: null, value: '' };
}

/** Value-only convenience that fails loudly when a required secret is absent. */
export async function getRequiredSecretValue(key: string): Promise<string> {
  const resolved = await resolveSecret(key);
  if (!resolved.configured || !resolved.value) {
    const definition = getSecretDefinition(key)!;
    throw new Error(
      `Required secret ${key} is not configured (save it in System Configuration or set ${definition.envFallback})`
    );
  }
  return resolved.value;
}

/**
 * Persist a secret in encrypted form. Empty/null clears any stored override
 * so the environment fallback applies again. Returns nothing; callers audit.
 * Every change appends a ConfigurationRevision containing only the redaction
 * marker - never plaintext or ciphertext.
 */
export async function storeSecret(key: string, plaintext: string, updatedBy: string): Promise<void> {
  const definition = getSecretDefinition(key);
  if (!definition) {
    throw new Error(`Unknown secret configuration key "${key}"`);
  }
  const previous = await prisma.systemConfigEntry.findUnique({ where: { key } });
  if (!plaintext.trim()) {
    if (previous) {
      await prisma.systemConfigEntry.delete({ where: { key } });
      clearConfigCache();
      await recordConfigRevision({
        key,
        previousValue: SECRET_REVISION_MARKER,
        newValue: null,
        changeKind: 'secret_change',
        changedBy: updatedBy,
      }).catch((error) => {
        console.error(`[Config] Failed to record revision for secret ${key}:`, error);
      });
    }
    return;
  }
  const payload: StoredSecret = {
    __secret: SECRET_STORE_MARKER,
    data: encryptPassword(plaintext),
  };
  await prisma.systemConfigEntry.upsert({
    where: { key },
    update: { value: payload as unknown as Prisma.InputJsonValue, updatedBy },
    create: { key, value: payload as unknown as Prisma.InputJsonValue, updatedBy },
  });
  clearConfigCache();
  await recordConfigRevision({
    key,
    previousValue: previous ? SECRET_REVISION_MARKER : null,
    newValue: SECRET_REVISION_MARKER,
    changeKind: 'secret_change',
    changedBy: updatedBy,
  }).catch((error) => {
    console.error(`[Config] Failed to record revision for secret ${key}:`, error);
  });
}
