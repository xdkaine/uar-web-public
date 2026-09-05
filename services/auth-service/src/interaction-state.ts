import type { ScanCapableRedis } from './session-store';

/**
 * Server-side binding between a live interaction uid and the account whose
 * credentials triggered the forced password change. Without it, anyone
 * holding ANY live interaction uid could aim /interaction/<uid>/change-password
 * at arbitrary accounts (semi-open AD credential oracle). The binding is
 * written only by the login POST after AD reports password_change_required /
 * password_expired, and is read back before the change endpoint touches AD.
 */

const PENDING_CHANGE_PREFIX = 'authsvc:cpw:';
/** Outlives the interaction record (600 s) so the flow never lapses first. */
export const PENDING_CHANGE_TTL_SECONDS = 15 * 60;

function pendingChangeKey(uid: string): string {
  return `${PENDING_CHANGE_PREFIX}${uid}`;
}

/** Bind the authenticated-in-progress account to this interaction uid. */
export async function bindPendingPasswordChange(
  redis: Pick<ScanCapableRedis, 'set'>,
  uid: string,
  username: string
): Promise<void> {
  const normalized = username.trim().toLowerCase();
  if (!uid || !normalized) return;
  await redis.set(pendingChangeKey(uid), normalized, {
    EX: PENDING_CHANGE_TTL_SECONDS,
  }).catch(() => undefined);
}

/** The single account allowed to change its password via this uid, if any. */
export async function boundPendingChangeAccount(
  redis: Pick<ScanCapableRedis, 'get'>,
  uid: string
): Promise<string | null> {
  if (!uid) return null;
  try {
    const raw = await redis.get(pendingChangeKey(uid));
    return raw ? raw : null;
  } catch {
    return null;
  }
}

export async function clearPendingPasswordChange(
  redis: Pick<ScanCapableRedis, 'del'>,
  uid: string
): Promise<void> {
  if (!uid) return;
  await redis.del(pendingChangeKey(uid)).catch(() => undefined);
}

/**
 * Whether the submitted username matches the account that authenticated into
 * this interaction. Unbound uids and mismatches both fail closed.
 */
export function isBoundChangeRequest(bound: string | null, submitted: string): boolean {
  return bound !== null && bound === submitted.trim().toLowerCase();
}
