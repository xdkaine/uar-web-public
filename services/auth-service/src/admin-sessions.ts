import { randomBytes } from 'node:crypto';

/**
 * Server-tracked liveness records for /admin console cookies. The cookie
 * carries a random session id inside its HMAC-signed payload; EVERY console
 * request requires a matching Redis record whose TTL mirrors the cookie
 * Max-Age. Deleting one record revokes exactly that console session
 * instantly - other admins and all provider sessions are untouched - and a
 * rejected id fails with the same generic shape as any invalid cookie.
 */

export const ADMIN_SESSION_PREFIX = 'authsvc:adminsess:';
/** Must equal SESSION_TTL_SECONDS in admin-auth.ts (the cookie Max-Age). */
export const ADMIN_SESSION_TTL_SECONDS = 8 * 60 * 60;

export interface AdminSessionStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { EX?: number }): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
}

export function isAdminSessionId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(value);
}

function recordKey(id: string): string {
  return `${ADMIN_SESSION_PREFIX}${id}`;
}

/** Mints a tracked session id and stores it with TTL == cookie Max-Age. */
export async function mintAdminSessionRecord(redis: AdminSessionStore): Promise<string> {
  const id = randomBytes(24).toString('base64url');
  await redis.set(recordKey(id), '1', { EX: ADMIN_SESSION_TTL_SECONDS });
  return id;
}

/** Fail-closed liveness probe: Redis errors deny the request. */
export async function isAdminSessionLive(redis: AdminSessionStore, id: string): Promise<boolean> {
  if (!isAdminSessionId(id)) return false;
  try {
    return (await redis.get(recordKey(id))) !== null;
  } catch {
    return false;
  }
}

/** Removes exactly this identifier; false when it was absent or unusable. */
export async function revokeAdminSession(redis: AdminSessionStore, id: string): Promise<boolean> {
  if (!isAdminSessionId(id)) return false;
  try {
    return Number(await redis.del(recordKey(id))) > 0;
  } catch {
    return false;
  }
}
