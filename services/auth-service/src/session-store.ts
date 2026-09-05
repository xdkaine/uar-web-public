import type { RedisAdapter } from './adapter';
import { createHash, createHmac } from 'node:crypto';

/**
 * IdP session control plane (ADR-0014): enumeration and forced logout over
 * live oidc-provider Session records in Redis.
 *
 * oidc-provider whitelists the fields it serializes (Session.IN_PAYLOAD), so
 * login context (IP, user-agent, device) can never ride on the session
 * payload itself. Sign-in handlers therefore stash the context under
 * `authsvc:lastlogin:<account>` and the tracking adapter copies it into a
 * sidecar record `authsvc:sessmeta:<jti>` on the session's first save after
 * login. Live interactions use an account + interaction-uid correlation key
 * so simultaneous sign-ins cannot exchange metadata. Enumeration joins the
 * sidecars back at list time; both record types expire with (or sooner than)
 * the sessions they describe.
 */

/** Minimal Redis surface needed for scans + sidecar reads (mirrors backchannel.ts). */
export interface ScanCapableRedis {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { EX?: number }): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
  scanIterator?(opts: { MATCH: string; COUNT: number }): AsyncIterable<string | string[]>;
}

export interface RawSessionPayload {
  jti?: unknown;
  uid?: unknown;
  kind?: unknown;
  accountId?: unknown;
  loginTs?: unknown;
  exp?: unknown;
  amr?: unknown;
  authorizations?: unknown;
}

/** Login context captured at sign-in time (first-party, transparent). */
export interface LoginContext {
  clientId?: string;
  ip?: string;
  userAgent?: string;
  /** JS-computed device hash submitted with the sign-in form (not a secret). */
  deviceId?: string;
  /** First-party persistent cookie id recognizing returning devices. */
  deviceCookieId?: string;
  ts?: number;
}

export interface ProviderSessionView {
  /** Adapter-level session id (payload.jti). Not an OIDC token claim. */
  sid: string;
  accountId: string | null;
  loginAt: string | null;
  expiresAt: string | null;
  amr: string[];
  /** Client ids this session holds authorizations for. */
  clients: string[];
  context: LoginContext | null;
}

export interface SessionAggregates {
  totalSessions: number;
  distinctUsers: number;
  distinctDevices: number;
  perClient: Array<{ clientId: string; sessions: number }>;
}

const SESSION_META_PREFIX = 'authsvc:sessmeta:';
const LAST_LOGIN_PREFIX = 'authsvc:lastlogin:';
const LOGIN_CORRELATION_PREFIX = 'authsvc:loginctx:';
const LAST_LOGIN_TTL_SECONDS = 15 * 60;
const MIN_META_TTL_SECONDS = 60;
/** Outlives the longest registry-configurable session (the Redis adapter's 14 d record ceiling) so attribution never lapses first. */
const MAX_META_TTL_SECONDS = 31 * 24 * 60 * 60;

/** Client-supplied device ids are opaque short tokens, never free-form text. */
const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
/** Device cookie value is a server-generated UUID. */
const DEVICE_COOKIE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isValidDeviceId(value: unknown): value is string {
  return typeof value === 'string' && DEVICE_ID_PATTERN.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sidecarKey(jti: string): string {
  return `${SESSION_META_PREFIX}${jti}`;
}

function lastLoginKey(accountId: string): string {
  return `${LAST_LOGIN_PREFIX}${accountId.toLowerCase()}`;
}

function correlatedLoginKey(accountId: string, correlationId: string): string | null {
  if (!/^[A-Za-z0-9_-]{8,160}$/.test(correlationId)) return null;
  return `${LOGIN_CORRELATION_PREFIX}${accountId.toLowerCase()}:${correlationId}`;
}

function asString(value: unknown, max = 512): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, max);
}

function asIso(seconds: unknown): string | null {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }
  return new Date(seconds * 1000).toISOString();
}

/**
 * Stash the sign-in context for the adapter to attach when the provider first
 * saves the authenticated session. Live interaction handlers provide their
 * interaction uid and therefore use an account + interaction key. The account-only key is retained
 * for backwards-compatible callers that cannot provide a correlation id.
 */
export async function captureLoginContext(
  redis: Pick<ScanCapableRedis, 'set'>,
  accountId: string,
  context: LoginContext,
  correlationId?: string
): Promise<void> {
  const payload: LoginContext = {
    clientId: asString(context.clientId, 120),
    ip: asString(context.ip, 64),
    userAgent: asString(context.userAgent, 400),
    deviceId: isValidDeviceId(context.deviceId) ? context.deviceId : undefined,
    deviceCookieId: DEVICE_COOKIE_PATTERN.test(String(context.deviceCookieId))
      ? (context.deviceCookieId as string)
      : undefined,
    ts: Math.floor(Date.now() / 1000),
  };
  const key = correlationId ? correlatedLoginKey(accountId, correlationId) : null;
  await redis.set(key ?? lastLoginKey(accountId), JSON.stringify(payload), {
    EX: LAST_LOGIN_TTL_SECONDS,
  });
}

/**
 * Called from the tracking adapter on every Session upsert that carries an
 * account. Attaches the pending context exactly once per session (sidecar
 * presence is the guard), so later saves - SSO into more apps, token refreshes -
 * never overwrite the original sign-in attribution.
 */
export async function attachLoginContext(
  redis: ScanCapableRedis,
  accountId: string,
  jti: string,
  ttlSeconds: number,
  correlationId?: string
): Promise<void> {
  const key = sidecarKey(jti);
  try {
    if (await redis.get(key)) return;
    const correlatedKey = correlationId ? correlatedLoginKey(accountId, correlationId) : null;
    const pendingKey = correlatedKey ?? lastLoginKey(accountId);
    const raw = await redis.get(pendingKey);
    if (!raw) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (!isRecord(parsed)) return;
    // Only consume contexts captured moments ago; stale entries mean the
    // session being saved predates this capture (e.g. SSO reuse) or a prior
    // attachment was evicted - either way attribution would be wrong.
    const ts = typeof parsed.ts === 'number' ? parsed.ts : 0;
    const ageSeconds = Math.floor(Date.now() / 1000) - ts;
    if (!Number.isFinite(ageSeconds) || ageSeconds < 0 || ageSeconds > 600) {
      await redis.del(pendingKey);
      return;
    }
    const ttl = Math.min(Math.max(ttlSeconds, MIN_META_TTL_SECONDS), MAX_META_TTL_SECONDS);
    await redis.set(key, JSON.stringify(parsed), { EX: ttl });
    await redis.del(pendingKey);
  } catch {
    // Attribution is best-effort operational data; never break session saves.
  }
}

function parseSessionPayload(raw: string): RawSessionPayload | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return null;
    if (parsed.kind !== 'Session' || typeof parsed.jti !== 'string') return null;
    return parsed as RawSessionPayload;
  } catch {
    return null;
  }
}

function authorizedClients(payload: RawSessionPayload): string[] {
  if (!isRecord(payload.authorizations)) return [];
  return Object.keys(payload.authorizations).sort();
}

async function readContext(
  redis: ScanCapableRedis,
  jti: string
): Promise<LoginContext | null> {
  try {
    const raw = await redis.get(sidecarKey(jti));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? (parsed as LoginContext) : null;
  } catch {
    return null;
  }
}

/**
 * Enumerate live provider sessions with their captured sign-in context.
 * Linear SCAN matches the existing backchannel pattern; sessions are bounded
 * by the deployment's active-user count.
 */
export async function listActiveSessions(
  redis: ScanCapableRedis
): Promise<{ sessions: ProviderSessionView[]; aggregates: SessionAggregates }> {
  const sessions: ProviderSessionView[] = [];
  if (!redis.scanIterator) {
    return { sessions, aggregates: emptyAggregates(sessions) };
  }
  const now = Date.now() / 1000;
  for await (const chunk of redis.scanIterator({ MATCH: 'oidc:Session:*', COUNT: 100 })) {
    for (const key of Array.isArray(chunk) ? chunk : [chunk]) {
      if (key.includes(':uid:') || key.includes(':userCode:')) continue;
      const raw = await redis.get(key);
      if (!raw) continue;
      const payload = parseSessionPayload(raw);
      if (!payload || typeof payload.jti !== 'string') continue;
      // Expired-but-unreaped records are invisible to operators.
      if (typeof payload.exp === 'number' && payload.exp <= now) continue;
      sessions.push({
        sid: payload.jti,
        accountId: asString(payload.accountId, 200)?.toLowerCase() ?? null,
        loginAt: asIso(payload.loginTs),
        expiresAt: asIso(payload.exp),
        amr: Array.isArray(payload.amr)
          ? payload.amr.filter((v): v is string => typeof v === 'string')
          : [],
        clients: authorizedClients(payload),
        context: await readContext(redis, payload.jti),
      });
    }
  }

  const aggregates = buildAggregates(sessions);
  const viewSessions = sessions.map((session) => ({
    ...session,
    context: session.context
      ? {
          ...session.context,
          deviceCookieId: session.context.deviceCookieId
            ? opaqueDeviceReference(session.context.deviceCookieId)
            : undefined,
          deviceId: session.context.deviceId
            ? opaqueDeviceReference(session.context.deviceId)
            : undefined,
        }
      : null,
  }));
  return { sessions: viewSessions, aggregates };
}

function opaqueDeviceReference(value: string): string {
  const key = process.env.AUTH_DEVICE_FINGERPRINT_KEY;
  const digest = key
    ? createHmac('sha256', key).update(value).digest('hex')
    : createHash('sha256').update(value).digest('hex');
  return `v1-${digest.slice(0, 20)}`;
}

function emptyAggregates(sessions: ProviderSessionView[]): SessionAggregates {
  void sessions;
  return { totalSessions: 0, distinctUsers: 0, distinctDevices: 0, perClient: [] };
}

function buildAggregates(sessions: ProviderSessionView[]): SessionAggregates {
  const users = new Set<string>();
  const devices = new Set<string>();
  const perClient = new Map<string, number>();
  for (const session of sessions) {
    if (session.accountId) users.add(session.accountId.toLowerCase());
    const deviceKey = session.context?.deviceCookieId ?? session.context?.deviceId;
    if (deviceKey) devices.add(deviceKey);
    for (const clientId of session.clients) {
      perClient.set(clientId, (perClient.get(clientId) ?? 0) + 1);
    }
  }
  return {
    totalSessions: sessions.length,
    distinctUsers: users.size,
    distinctDevices: devices.size,
    perClient: [...perClient.entries()]
      .map(([clientId, count]) => ({ clientId, sessions: count }))
      .sort((a, b) => b.sessions - a.sessions || a.clientId.localeCompare(b.clientId)),
  };
}

export interface DestroyTarget {
  destroy(id: string): Promise<unknown>;
}

/** Partial-failure-aware result: per CONTEXT.md, partial destroys are recorded. */
export interface DestroyOutcome {
  destroyed: number;
  failed: number;
  /**
   * (client, per-session sid) authorizations captured from payloads before
   * deletion, for the IdP-initiated back-channel logout emitter. Pairs with
   * a null sid had no resolvable RP session id and cannot be pushed.
   */
  authorizations: Array<{ clientId: string; sid: string | null; subject: string | null }>;
}

function authorizationPairs(payload: RawSessionPayload): DestroyOutcome['authorizations'] {
  if (!isRecord(payload.authorizations)) return [];
  const subject = typeof payload.accountId === 'string' ? payload.accountId : null;
  return Object.entries(payload.authorizations)
    .map(([clientId, authorization]) => ({
      clientId,
      sid:
        isRecord(authorization) && typeof authorization.sid === 'string'
          ? authorization.sid
          : null,
      subject,
    }))
    .sort((a, b) => a.clientId.localeCompare(b.clientId));
}

/**
 * Destroy one session by its adapter id; refuses non-Session payloads.
 * A failing destroy is counted in `failed` rather than thrown so the caller
 * can always audit what actually happened.
 */
export async function destroySessionBySid(
  redis: ScanCapableRedis,
  adapter: Pick<RedisAdapter, 'destroy'> | DestroyTarget,
  sid: string
): Promise<DestroyOutcome> {
  if (!SID_PATTERN.test(sid)) return { destroyed: 0, failed: 0, authorizations: [] };
  const raw = await redis.get(`oidc:Session:${sid}`);
  if (!raw) return { destroyed: 0, failed: 0, authorizations: [] };
  const payload = parseSessionPayload(raw);
  if (!payload) return { destroyed: 0, failed: 0, authorizations: [] };
  try {
    await adapter.destroy(sid);
  } catch {
    return { destroyed: 0, failed: 1, authorizations: [] };
  }
  await redis.del(sidecarKey(sid)).catch(() => undefined);
  return { destroyed: 1, failed: 0, authorizations: authorizationPairs(payload) };
}

const SID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

/**
 * Force-logout every session belonging to an account. Individual destroy
 * failures are swallowed and counted - the scan continues for the rest.
 */
export async function destroySessionsForUser(
  redis: ScanCapableRedis,
  adapter: DestroyTarget,
  username: string
): Promise<DestroyOutcome> {
  const target = username.trim().toLowerCase();
  if (!target) return { destroyed: 0, failed: 0, authorizations: [] };
  let destroyed = 0;
  let failed = 0;
  const authorizations: DestroyOutcome['authorizations'] = [];
  for await (const [sid, payload] of iterateLiveSessions(redis)) {
    const accountId = typeof payload.accountId === 'string' ? payload.accountId.toLowerCase() : '';
    if (accountId && accountId === target) {
      await destroyOne(redis, adapter, sid).then((ok) => {
        if (ok) {
          destroyed += 1;
          authorizations.push(...authorizationPairs(payload));
        } else {
          failed += 1;
        }
      });
    }
  }
  return { destroyed, failed, authorizations };
}

/**
 * Force-logout every session holding an authorization for a client/app.
 * Same per-item failure tolerance as the user scope.
 */
export async function destroySessionsForClient(
  redis: ScanCapableRedis,
  adapter: DestroyTarget,
  clientId: string
): Promise<DestroyOutcome> {
  const target = clientId.trim();
  if (!target) return { destroyed: 0, failed: 0, authorizations: [] };
  let destroyed = 0;
  let failed = 0;
  const authorizations: DestroyOutcome['authorizations'] = [];
  for await (const [sid, payload] of iterateLiveSessions(redis)) {
    if (authorizedClients(payload).includes(target)) {
      await destroyOne(redis, adapter, sid).then((ok) => {
        if (ok) {
          destroyed += 1;
          authorizations.push(
            ...authorizationPairs(payload).filter((pair) => pair.clientId === target)
          );
        } else {
          failed += 1;
        }
      });
    }
  }
  return { destroyed, failed, authorizations };
}

async function destroyOne(
  redis: ScanCapableRedis,
  adapter: DestroyTarget,
  sid: string
): Promise<boolean> {
  try {
    await adapter.destroy(sid);
  } catch {
    return false;
  }
  await redis.del(sidecarKey(sid)).catch(() => undefined);
  return true;
}

async function* iterateLiveSessions(
  redis: ScanCapableRedis
): AsyncGenerator<[string, RawSessionPayload]> {
  if (!redis.scanIterator) return;
  const now = Date.now() / 1000;
  for await (const chunk of redis.scanIterator({ MATCH: 'oidc:Session:*', COUNT: 100 })) {
    for (const key of Array.isArray(chunk) ? chunk : [chunk]) {
      if (key.includes(':uid:') || key.includes(':userCode:')) continue;
      const raw = await redis.get(key);
      if (!raw) continue;
      const payload = parseSessionPayload(raw);
      if (!payload || typeof payload.jti !== 'string') continue;
      if (typeof payload.exp === 'number' && payload.exp <= now) continue;
      yield [key.slice('oidc:Session:'.length), payload];
    }
  }
}
