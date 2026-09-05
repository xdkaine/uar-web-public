import { randomBytes } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma, withSessionAdvisoryLock } from './db';
import { RedisAdapter, PROVIDER_RECORD_TTL_CEILING_SECONDS } from './adapter';
import {
  CLIENT_SECRET_ENC_KEY_ENV,
  decryptClientSecret,
  encryptClientSecret,
  isClientSecretEncryptionConfigured,
  isEncryptedClientSecret,
} from './secret-encryption';

/**
 * Dynamic OIDC client registry (Auth Manager). Rows live in Postgres; every
 * mutation is mirrored into the Redis `Client` store so oidc-provider's
 * adapter-based Client.find() resolves them without a restart. The env
 * bootstrap client (uar-portal) stays statically configured and is never
 * managed here.
 */

const PROVIDER_CLIENT_TTL = 0; // sentinel: RedisAdapter skips expiry for <= 0

export const CLIENT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,62}[a-z0-9]$/;

/** Default provider session lifetime when neither registry nor env override. */
export const DEFAULT_SESSION_TTL_SECONDS = 8 * 60 * 60;
/**
 * Registry-configurable bounds for per-application sign-in lifetimes. The
 * max is pinned to the Redis adapter's record ceiling: a configured session
 * longer than that would be silently killed early by the adapter clamp.
 */
export const MIN_SESSION_TTL_SECONDS = 5 * 60;
export const MAX_SESSION_TTL_SECONDS = PROVIDER_RECORD_TTL_CEILING_SECONDS;

export function clampSessionTtlSeconds(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const floored = Math.floor(value);
  if (floored < MIN_SESSION_TTL_SECONDS || floored > MAX_SESSION_TTL_SECONDS) return null;
  return floored;
}

/**
 * Per-client session TTLs must resolve SYNCHRONOUSLY - oidc-provider invokes
 * the ttl.Session callback without awaiting it. The registry is therefore
 * mirrored into this in-process cache at boot and on every mutation; the
 * env override (AUTH_SESSION_TTL_<CLIENT_ID>) remains the fallback for the
 * bootstrap client and pre-migration deployments.
 */
const sessionTtlCache = new Map<string, number>();

function envSessionTtlFor(clientId: string): number | null {
  const key = `AUTH_SESSION_TTL_${clientId.replace(/[^A-Za-z0-9]/g, '_').toUpperCase()}`;
  const raw = process.env[key];
  if (!raw) return null;
  return clampSessionTtlSeconds(Number.parseInt(raw, 10));
}

/** Boot/mutation hook: reload the synchronous TTL mirror from the registry. */
export async function refreshSessionTtlCache(): Promise<void> {
  try {
    const rows = await prisma.oidcClient.findMany({
      select: { clientId: true, sessionTtlSeconds: true },
    });
    sessionTtlCache.clear();
    for (const row of rows) {
      const clamped = clampSessionTtlSeconds(row.sessionTtlSeconds);
      if (clamped !== null) {
        sessionTtlCache.set(row.clientId, clamped);
      }
    }
  } catch (error) {
    // Pre-migration deployments keep the env/default path.
    console.error('[auth] session ttl cache refresh failed', error);
  }
}

export function resolveSessionTtlSeconds(clientId?: string): number {
  if (!clientId) return DEFAULT_SESSION_TTL_SECONDS;
  const cached = sessionTtlCache.get(clientId);
  if (cached !== undefined) return cached;
  const fromEnv = envSessionTtlFor(clientId);
  return fromEnv ?? DEFAULT_SESSION_TTL_SECONDS;
}

export interface OidcClientRow {
  id: string;
  clientId: string;
  name: string;
  secret: string;
  redirectUris: string[];
  postLogoutRedirectUris: string[];
  backchannelLogoutUri: string | null;
  scope: string;
  enabled: boolean;
  /** Per-application provider-session lifetime; null => default/env. */
  sessionTtlSeconds: number | null;
  createdBy: string;
}

/** Listing/API shape: never carries plaintext or ciphertext, only hasSecret. */
export type PublicOidcClientRow = Omit<OidcClientRow, 'secret'> & { hasSecret: boolean };

function publicRow(row: OidcClientRow): PublicOidcClientRow {
  const { secret, ...rest } = row;
  void secret;
  return { ...rest, hasSecret: true };
}

function asRedirectUris(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
}

export function toProviderPayload(row: OidcClientRow): Record<string, unknown> {
  const firstRedirect = row.redirectUris[0];
  let backchannelLogoutUri = '';
  if (firstRedirect) {
    try {
      backchannelLogoutUri = `${new URL(firstRedirect).origin}/api/auth/oidc/backchannel-logout`;
    } catch {
      backchannelLogoutUri = firstRedirect;
    }
  }
  return {
    client_id: row.clientId,
    client_secret: row.secret,
    redirect_uris: row.redirectUris,
    post_logout_redirect_uris: row.postLogoutRedirectUris,
    grant_types: ['authorization_code'],
    response_types: ['code'],
    token_endpoint_auth_method: 'client_secret_basic',
    scope: row.scope,
    // Registration-time pinning: this deployment signs with its RSA key only.
    id_token_signed_response_alg: REQUIRED_ID_TOKEN_ALG,
    // Mirrors the bootstrap client: enables Client.includeSid() so issued
    // codes/ID tokens carry the session `sid` claim relying parties need for
    // full-logout backchannels. Only /session/end_session POSTs to this URI.
    backchannel_logout_uri: row.backchannelLogoutUri || backchannelLogoutUri,
    backchannel_logout_session_required: true,
  };
}

const localClientOperationTails = new Map<string, Promise<void>>();

async function locallyExclusive<T>(clientId: string, work: () => Promise<T>): Promise<T> {
  const previous = localClientOperationTails.get(clientId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.catch(() => undefined).then(() => current);
  localClientOperationTails.set(clientId, tail);
  await previous.catch(() => undefined);
  try {
    return await work();
  } finally {
    release();
    if (localClientOperationTails.get(clientId) === tail) localClientOperationTails.delete(clientId);
  }
}

export function providerClientAdapter(
  redisAdapter: Pick<RedisAdapter, 'upsert' | 'destroy'> & Partial<Pick<RedisAdapter, 'withLock'>>
) {
  return {
    async sync(row: OidcClientRow): Promise<void> {
      if (!row.enabled) return;
      await redisAdapter.upsert(row.clientId, toProviderPayload(row), PROVIDER_CLIENT_TTL);
    },
    async remove(clientId: string): Promise<void> {
      await redisAdapter.destroy(clientId);
    },
    async exclusive<T>(clientId: string, work: () => Promise<T>): Promise<T> {
      return redisAdapter.withLock
        ? redisAdapter.withLock(clientId, work)
        : locallyExclusive(clientId, work);
    },
  };
}

export function validateRedirectUris(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) {
    return null;
  }
  const uris: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') return null;
    let parsed: URL;
    try {
      parsed = new URL(entry);
    } catch {
      return null;
    }
    // Registration-time policy: https for non-loopback hosts, no wildcards,
    // no fragments. Loopback may be plain http for local development.
    if (parsed.hash) return null;
    const isLoopback =
      parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === '::1';
    if (parsed.protocol !== 'https:' && !isLoopback) return null;
    uris.push(parsed.toString().replace(/\/$/, ''));
  }
  return uris;
}

export function validateOptionalRedirectUris(value: unknown): string[] | null {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value) && value.length === 0) return [];
  return validateRedirectUris(value);
}

export function validateBackchannelLogoutUri(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === '') return null;
  const parsed = validateRedirectUris([value]);
  return parsed?.[0];
}

function generateClientId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const suffix = randomBytes(4).toString('hex');
  const base = slug || 'app';
  return `${base}-${suffix}`.slice(0, 63);
}

export function generateClientSecret(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Scope allowlist for client registration (create AND update): relying
 * parties may only request the identity contract scopes this provider
 * actually issues (ADR-0012). offline_access is named explicitly in the
 * rejection because refresh tokens are deliberately not offered.
 */
export const ALLOWED_SCOPES = ['openid', 'email', 'profile', 'amr', 'groups'];

/** Existing default scope string; stays the valid fallback. */
export const DEFAULT_CLIENT_SCOPE = 'openid profile email';

/** The provider signs with its pinned RSA key only; RS256 is non-negotiable. */
export const REQUIRED_ID_TOKEN_ALG = 'RS256';

export class InvalidScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidScopeError';
  }
}

export type ScopeValidation =
  | { ok: true; scope: string }
  | { ok: false; reason: string };

/** Validate a requested scope string against the registration allowlist. */
export function validateRequestedScope(input: unknown): ScopeValidation {
  if (input !== undefined && typeof input !== 'string') {
    return { ok: false, reason: 'scope must be a space-separated string' };
  }
  const tokens = (typeof input === 'string' ? input : '').trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return { ok: true, scope: DEFAULT_CLIENT_SCOPE };
  for (const token of tokens) {
    if (ALLOWED_SCOPES.includes(token)) continue;
    return token === 'offline_access'
      ? { ok: false, reason: 'offline_access is not issued by this provider' }
      : { ok: false, reason: `scope "${token}" is not allowed (allowed: ${ALLOWED_SCOPES.join(' ')})` };
  }
  if (!tokens.includes('openid')) {
    return { ok: false, reason: 'openid is required for every registered application' };
  }
  const normalized = ALLOWED_SCOPES.filter((scope) => tokens.includes(scope));
  return { ok: true, scope: normalized.join(' ') };
}

function requireValidScope(input: unknown): string {
  const parsed = validateRequestedScope(input);
  if (!parsed.ok) throw new InvalidScopeError(parsed.reason);
  return parsed.scope;
}

/**
 * Registration-time ID-token algorithm pinning: a supplied metadata value
 * MUST be RS256 (anything else is rejected upstream of storage); absent
 * values are pinned to RS256 on the stored record.
 */
export function validateRequestedIdTokenAlg(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return true;
  return value === REQUIRED_ID_TOKEN_ALG;
}

export interface CreateClientInput {
  name: string;
  redirectUris: string[];
  postLogoutRedirectUris?: string[];
  backchannelLogoutUri?: string | null;
  scope?: string;
  /** Optional per-app provider-session lifetime (seconds, clamped). */
  sessionTtlSeconds?: number | null;
  createdBy: string;
}

export interface ClientMutationAudit {
  action: string;
  actor: string;
  details?: Record<string, unknown>;
}

export class OidcClientInCatalogError extends Error {
  constructor() {
    super('Remove this application from the public directory before deleting its OIDC registration.');
    this.name = 'OidcClientInCatalogError';
  }
}

function clientAuditData(
  clientId: string,
  audit: ClientMutationAudit,
  providerMirror: 'pending' | 'reconciled' = 'reconciled'
) {
  return {
    action: audit.action,
    category: 'configuration',
    username: audit.actor,
    actorType: 'admin',
    targetId: clientId,
    clientId,
    eventKind: 'security',
    outcome: 'committed',
    details: JSON.stringify({ clientId, ...audit.details, providerMirror }),
    success: true,
  };
}

function retryableTransactionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : '';
  return code === 'P2034' || /write conflict|deadlock/i.test(error.message);
}

async function serializableTransaction<T>(
  work: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(work, { isolationLevel: 'Serializable' });
    } catch (error) {
      if (attempt === 2 || !retryableTransactionError(error)) throw error;
    }
  }
  throw new Error('serializable transaction retry exhausted');
}

async function recordMirrorReconciled(clientId: string, audit?: ClientMutationAudit): Promise<void> {
  if (!audit) return;
  try {
    await prisma.auditLog.create({
      data: clientAuditData(clientId, {
        ...audit,
        action: `${audit.action}_MIRROR_RECONCILED`,
      }),
    });
  } catch (error) {
    // The committed mutation audit remains conservatively marked pending.
    // Mirror reconciliation is repeated at boot, so this evidence can lag
    // without making an unaudited provider-side candidate authoritative.
    console.error(`[auth] failed to record provider mirror reconciliation for ${clientId}`, error);
  }
}

async function reconcileCommittedClient(
  client: OidcClientRow,
  redisAdapter: ReturnType<typeof providerClientAdapter>,
  audit?: ClientMutationAudit
): Promise<boolean> {
  try {
    if (client.enabled) await redisAdapter.sync(client);
    await recordMirrorReconciled(client.clientId, audit);
    return false;
  } catch (error) {
    // PostgreSQL plus its mutation audit are authoritative. Redis stays
    // absent (fail closed) and boot reconciliation retries the exact durable
    // record. The caller still receives one-time secrets with a pending flag.
    console.error(`[auth] provider mirror pending for ${client.clientId}`, error);
    return true;
  }
}

async function exclusiveClientOperation<T>(
  clientId: string,
  redisAdapter: ReturnType<typeof providerClientAdapter>,
  work: () => Promise<T>
): Promise<T> {
  return withSessionAdvisoryLock(`oidc-client:${clientId}`, () =>
    redisAdapter.exclusive(clientId, work)
  );
}

export async function createOidcClient(
  input: CreateClientInput,
  redisAdapter: ReturnType<typeof providerClientAdapter>,
  audit?: ClientMutationAudit
): Promise<{ row: PublicOidcClientRow; clientSecret: string; mirrorPending: boolean }> {
  let clientId = generateClientId(input.name);
  // Extremely unlikely collision; retry a few times regardless.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const existing = await prisma.oidcClient.findUnique({ where: { clientId } });
    if (!existing) break;
    clientId = generateClientId(input.name);
  }

  const clientSecret = generateClientSecret();
  const data = {
      clientId,
      name: input.name.trim(),
      secret: encryptClientSecret(clientSecret),
      redirectUris: input.redirectUris,
      postLogoutRedirectUris: input.postLogoutRedirectUris ?? [],
      backchannelLogoutUri: input.backchannelLogoutUri ?? null,
      scope: requireValidScope(input.scope),
      enabled: true,
      sessionTtlSeconds: clampSessionTtlSeconds(input.sessionTtlSeconds),
      createdBy: input.createdBy,
  };
  return exclusiveClientOperation(clientId, redisAdapter, async () => {
    const row = await serializableTransaction(async (tx) => {
      const created = await tx.oidcClient.create({ data });
      if (audit) {
        await tx.auditLog.create({
          data: clientAuditData(clientId, audit, 'pending'),
        });
      }
      return created;
    });

    const mapped = mapRow(row);
    // The Redis provider mirror keeps receiving the RAW secret.
    mapped.secret = clientSecret;
    const mirrorPending = await reconcileCommittedClient(mapped, redisAdapter, audit);
    await refreshSessionTtlCache().catch(() => undefined);
    return { row: publicRow(mapped), clientSecret, mirrorPending };
  });
}

type PrismaOidcClientRow = {
  id: string;
  clientId: string;
  name: string;
  secret: string;
  redirectUris: unknown; // Prisma Json - normalized via asRedirectUris
  postLogoutRedirectUris: unknown;
  backchannelLogoutUri: string | null;
  scope: string;
  enabled: boolean;
  sessionTtlSeconds: number | null;
  createdBy: string;
};

function mapRow(row: PrismaOidcClientRow): OidcClientRow {
  return {
    id: row.id,
    clientId: row.clientId,
    name: row.name,
    secret: row.secret,
    redirectUris: asRedirectUris(row.redirectUris),
    postLogoutRedirectUris: asRedirectUris(row.postLogoutRedirectUris),
    backchannelLogoutUri: row.backchannelLogoutUri,
    scope: row.scope,
    enabled: row.enabled,
    sessionTtlSeconds: clampSessionTtlSeconds(row.sessionTtlSeconds),
    createdBy: row.createdBy,
  };
}

/**
 * Resolve the stored secret to its RAW value for the provider mirror.
 * Envelope rows are decrypted (undecryptable => fail closed); legacy
 * plaintext rows are re-encrypted in place on this touch when a key is
 * configured, otherwise served as-is.
 */
async function resolveStoredSecret(clientId: string, stored: string): Promise<string> {
  if (isEncryptedClientSecret(stored)) {
    const raw = decryptClientSecret(stored);
    if (raw === null) {
      throw new Error(
        `Stored secret for client ${clientId} cannot be decrypted; verify ${CLIENT_SECRET_ENC_KEY_ENV}.`
      );
    }
    return raw;
  }
  try {
    await prisma.oidcClient.update({
      where: { clientId },
      data: { secret: encryptClientSecret(stored) },
    });
  } catch {
    // No key configured (or transient failure): keep serving the legacy
    // plaintext; it is re-encrypted on a later touch.
  }
  return stored;
}

async function withRawSecret(row: OidcClientRow): Promise<OidcClientRow> {
  return { ...row, secret: await resolveStoredSecret(row.clientId, row.secret) };
}

/**
 * Boot gate: refuses startup while any ciphertext row exists that cannot be
 * decrypted with the configured key (including key absent entirely).
 */
export async function assertClientSecretsDecryptable(): Promise<void> {
  const rows = await prisma.oidcClient.findMany({ select: { clientId: true, secret: true } });
  for (const row of rows) {
    if (!isEncryptedClientSecret(row.secret)) continue;
    if (decryptClientSecret(row.secret) === null) {
      throw new Error(
        `${CLIENT_SECRET_ENC_KEY_ENV} is missing or wrong but encrypted client secrets exist ` +
          '(fail-closed boot). Restore the 64-hex-character encryption key used to write them.'
      );
    }
  }
}

/**
 * Boot-time migration of legacy plaintext secrets: when the encryption key is
 * configured, every plaintext row is re-encrypted IN PLACE before serving
 * traffic. Only a COUNT is logged - never secret material. Undecryptable
 * ciphertext keeps its separate fail-closed gate above.
 */
export async function reencryptPlaintextSecretsOnBoot(): Promise<void> {
  if (!isClientSecretEncryptionConfigured()) return;
  const rows = await prisma.oidcClient.findMany({ select: { clientId: true, secret: true } });
  let count = 0;
  for (const row of rows) {
    if (isEncryptedClientSecret(row.secret)) continue;
    try {
      await prisma.oidcClient.update({
        where: { clientId: row.clientId },
        data: { secret: encryptClientSecret(row.secret) },
      });
      count += 1;
    } catch (error) {
      // A transient write failure must not wedge boot; resolveStoredSecret
      // still re-encrypts lazily on the next touch.
      console.error(`[auth] boot re-encryption failed for one client (${row.clientId})`, error);
    }
  }
  if (count > 0) {
    console.log(`[auth] re-encrypted ${count} plaintext client secret(s) at boot`);
  }
}

export async function listOidcClients(): Promise<PublicOidcClientRow[]> {
  const rows = await prisma.oidcClient.findMany({ orderBy: { createdAt: 'asc' } });
  return rows.map((row) => publicRow(mapRow(row)));
}

export async function getOidcClientRow(
  clientId: string
): Promise<OidcClientRow | null> {
  const row = await prisma.oidcClient.findUnique({ where: { clientId } });
  return row ? withRawSecret(mapRow(row)) : null;
}

export async function updateOidcClient(
  clientId: string,
  patch: {
    redirectUris?: string[];
    postLogoutRedirectUris?: string[];
    backchannelLogoutUri?: string | null;
    scope?: string;
    enabled?: boolean;
    /** null clears the override back to the default/env lifetime. */
    sessionTtlSeconds?: number | null;
  },
  redisAdapter: ReturnType<typeof providerClientAdapter>,
  audit?: ClientMutationAudit
): Promise<(PublicOidcClientRow & { mirrorPending: boolean }) | null> {
  const data: Record<string, unknown> = {};
  if (patch.redirectUris !== undefined) data.redirectUris = patch.redirectUris;
  if (patch.postLogoutRedirectUris !== undefined) data.postLogoutRedirectUris = patch.postLogoutRedirectUris;
  if (patch.backchannelLogoutUri !== undefined) data.backchannelLogoutUri = patch.backchannelLogoutUri;
  if (patch.scope !== undefined) {
    // Update path enforces the same allowlist as create.
    if (!patch.scope.trim()) {
      data.scope = DEFAULT_CLIENT_SCOPE;
    } else {
      data.scope = requireValidScope(patch.scope);
    }
  }
  if (patch.enabled !== undefined) data.enabled = patch.enabled;
  if (patch.sessionTtlSeconds !== undefined) {
    data.sessionTtlSeconds = clampSessionTtlSeconds(patch.sessionTtlSeconds);
  }

  return exclusiveClientOperation(clientId, redisAdapter, async () => {
    const existingRow = await prisma.oidcClient.findUnique({ where: { clientId } });
    if (!existingRow) return null;

    // Remove the old provider record before changing the durable authority.
    // A transaction failure therefore fails closed until boot reconciliation
    // restores the previous durable row.
    await redisAdapter.remove(clientId);
    const committedRow = await serializableTransaction(async (tx) => {
      const updated = await tx.oidcClient.update({ where: { clientId }, data });
      if (patch.enabled === false) {
        await tx.applicationCatalogEntry.updateMany({
          where: { oidcClientId: clientId, visibility: 'public' },
          data: {
            visibility: 'hidden',
            publishedAt: null,
            ...(audit ? { updatedBy: audit.actor } : {}),
          },
        });
      }
      if (audit) {
        await tx.auditLog.create({ data: clientAuditData(clientId, audit, 'pending') });
      }
      return updated;
    });
    const candidate = await withRawSecret(mapRow(committedRow));
    const mirrorPending = await reconcileCommittedClient(candidate, redisAdapter, audit);
    await refreshSessionTtlCache().catch(() => undefined);
    return { ...publicRow(candidate), mirrorPending };
  });
}

export async function rotateOidcClientSecret(
  clientId: string,
  redisAdapter: ReturnType<typeof providerClientAdapter>,
  audit?: ClientMutationAudit
): Promise<{ clientSecret: string; mirrorPending: boolean } | null> {
  return exclusiveClientOperation(clientId, redisAdapter, async () => {
    const existingRow = await prisma.oidcClient.findUnique({ where: { clientId } });
    if (!existingRow) return null;
    const clientSecret = generateClientSecret();
    await redisAdapter.remove(clientId);
    const data = { secret: encryptClientSecret(clientSecret), enabled: true };
    const committedRow = await serializableTransaction(async (tx) => {
      const updated = await tx.oidcClient.update({ where: { clientId }, data });
      if (audit) {
        await tx.auditLog.create({ data: clientAuditData(clientId, audit, 'pending') });
      }
      return updated;
    });
    const mirrorPending = await reconcileCommittedClient(
      { ...mapRow(committedRow), secret: clientSecret, enabled: true },
      redisAdapter,
      audit
    );
    return { clientSecret, mirrorPending };
  });
}

export async function deleteOidcClient(
  clientId: string,
  redisAdapter: ReturnType<typeof providerClientAdapter>,
  audit?: ClientMutationAudit
): Promise<boolean> {
  return exclusiveClientOperation(clientId, redisAdapter, async () => {
    const linked = await prisma.applicationCatalogEntry.findUnique({
      where: { oidcClientId: clientId }, select: { id: true },
    });
    if (linked) throw new OidcClientInCatalogError();
    const existingRow = await prisma.oidcClient.findUnique({ where: { clientId } });
    if (!existingRow) return false;
    const existing = await withRawSecret(mapRow(existingRow));
    await redisAdapter.remove(clientId);
    try {
      if (audit) {
        await prisma.$transaction(async (tx) => {
          await tx.oidcClient.delete({ where: { clientId } });
          await tx.auditLog.create({ data: clientAuditData(clientId, audit) });
        });
      } else {
        await prisma.oidcClient.delete({ where: { clientId } });
      }
    } catch (error) {
      const code = typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code)
        : '';
      if (code === 'P2025') return false;
      if (existing.enabled) await redisAdapter.sync(existing).catch(() => undefined);
      if (code === 'P2003') throw new OidcClientInCatalogError();
      throw error;
    }
    await refreshSessionTtlCache().catch(() => undefined);
    return true;
  });
}

/** Boot-time sync: mirror every enabled client into the provider store. */
export async function syncAllClientsOnBoot(
  redisAdapter: ReturnType<typeof providerClientAdapter>,
  redis?: {
    scanIterator(opts: { MATCH: string; COUNT: number }): AsyncIterable<string | string[]>;
    del(...keys: string[]): Promise<unknown>;
  },
  preserveClientIds: readonly string[] = []
): Promise<number> {
  const rows = await prisma.oidcClient.findMany({
    where: { enabled: true },
    select: { clientId: true },
  });
  if (redis) {
    const allowed = new Set([...rows.map((row) => row.clientId), ...preserveClientIds]);
    for await (const chunk of redis.scanIterator({ MATCH: 'oidc:Client:*', COUNT: 100 })) {
      const keys = Array.isArray(chunk) ? chunk : [chunk];
      for (const key of keys) {
        const clientId = key.slice('oidc:Client:'.length);
        if (clientId && !clientId.includes(':') && !allowed.has(clientId)) {
          await exclusiveClientOperation(clientId, redisAdapter, async () => {
            // The startup snapshot can race a new registration. Re-read the
            // durable authority under the same cross-process lock before
            // removing any provider record.
            const current = await prisma.oidcClient.findUnique({ where: { clientId } });
            if (!current?.enabled) await redisAdapter.remove(clientId);
          });
        }
      }
    }
  }
  let synced = 0;
  for (const snapshot of rows) {
    await exclusiveClientOperation(snapshot.clientId, redisAdapter, async () => {
      // A delete or disable may commit after the startup snapshot. Only the
      // current row, read while holding the client lock, may be mirrored.
      const current = await prisma.oidcClient.findUnique({ where: { clientId: snapshot.clientId } });
      if (!current?.enabled) return;
      await redisAdapter.sync(await withRawSecret(mapRow(current)));
      synced += 1;
    });
  }
  return synced;
}
