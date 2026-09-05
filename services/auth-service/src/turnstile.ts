import type { AuthConfig } from './config';

/**
 * Cloudflare Turnstile verification, ported from the portal: fails CLOSED
 * when the secret is unset or the verification call errors.
 */
export async function verifyTurnstile(
  config: AuthConfig,
  token: string,
  remoteIp: string | null
): Promise<boolean> {
  if (!token) return false;
  if (!config.turnstileSecretKey) {
    console.error('[auth] TURNSTILE_SECRET_KEY is not set; failing closed');
    return false;
  }
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        secret: config.turnstileSecretKey,
        response: token,
        ...(remoteIp ? { remoteip: remoteIp } : {}),
      }),
    });
    if (!response.ok) return false;
    const data = (await response.json()) as { success?: boolean };
    return data.success === true;
  } catch (error) {
    console.error('[auth] Turnstile verification error', error);
    return false;
  }
}

/**
 * Minimal Redis surface for the atomic fixed-window counter primitive
 * (node-redis v5 EVAL signature).
 */
export interface EvalCapableRedis {
  eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
}

/**
 * Counter+TTL in ONE atomic script: a crash between INCR and EXPIRE can never
 * leave an immortal (TTL-less) rate-limit key behind.
 */
const FIXED_WINDOW_LUA = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return count`;

/** Atomically increment the window counter; sets its TTL on the first hit. */
async function incrFixedWindow(
  redis: EvalCapableRedis,
  key: string,
  windowSeconds: number
): Promise<number> {
  const result = await redis.eval(FIXED_WINDOW_LUA, {
    keys: [key],
    arguments: [String(windowSeconds)],
  });
  const count = typeof result === 'number' ? result : Number.parseInt(String(result), 10);
  if (!Number.isFinite(count)) throw new Error('unexpected rate-limit counter reply');
  return count;
}

/**
 * Redis fixed-window rate limiter. Returns true when ALLOWED; a Redis outage
 * fails closed for login (same posture as the portal's login limiter).
 */
export async function checkLoginRateLimit(
  redis: EvalCapableRedis,
  config: AuthConfig,
  ip: string
): Promise<{ allowed: boolean }> {
  const count = await incrFixedWindow(
    redis,
    `authrl:login:${ip}:${Math.floor(Date.now() / config.loginWindowMs)}`,
    Math.ceil(config.loginWindowMs / 1000) + 1
  );
  return { allowed: count <= config.loginMaxAttempts };
}

/** Namespaced key for a shared-secret endpoint's per-window bucket. */
export function endpointRateKey(scope: string, identifier: string, windowMs: number): string {
  return `authrl:endpoint:${scope}:${identifier}:${Math.floor(Date.now() / windowMs)}`;
}

/**
 * Generic fixed-window endpoint limiter over the atomic primitive. THROWS on
 * Redis errors so callers can fail closed with 503 instead of confusing an
 * outage with a limit denial.
 */
export async function checkEndpointRateLimit(
  redis: EvalCapableRedis,
  key: string,
  limit: number,
  windowSeconds: number
): Promise<{ allowed: boolean }> {
  const count = await incrFixedWindow(redis, key, windowSeconds);
  return { allowed: count <= limit };
}

/** Minimal Redis surface for the per-account lockout counters. */
interface LockoutRedis {
  get(key: string): Promise<string | null>;
  del(...keys: string[]): Promise<unknown>;
}

/**
 * Per-account lockout alongside the per-IP limiter: repeated failed
 * attempts for ONE username engage a temporary lock regardless of source IP.
 * Fixed-window counter, released automatically when the window's key
 * expires. Callers MUST present lockouts with the same body/status as a
 * wrong-password response so account existence/state never leaks.
 */

function accountLockKey(config: AuthConfig, username: string): string {
  const bucket = Math.floor(Date.now() / Math.max(1, config.accountLockWindowMs));
  return `authrl:acctlock:${encodeURIComponent(username.toLowerCase())}:${bucket}`;
}

/** True when the account is currently locked (failure threshold reached). */
export async function checkAccountLockout(
  redis: LockoutRedis,
  config: AuthConfig,
  username: string
): Promise<boolean> {
  try {
    const raw = await redis.get(accountLockKey(config, username));
    const count = raw ? Number.parseInt(raw, 10) : 0;
    return Number.isFinite(count) && count >= config.accountLockMaxAttempts;
  } catch {
    // Counter unreadable: fail open here; the per-IP limiter still fails
    // closed on Redis outages, so logins are never unguarded overall.
    return false;
  }
}

/** Count one failed authentication attempt against the account. */
export async function recordAccountAuthFailure(
  redis: EvalCapableRedis,
  config: AuthConfig,
  username: string
): Promise<void> {
  await incrFixedWindow(
    redis,
    accountLockKey(config, username),
    Math.ceil(config.accountLockWindowMs / 1000) + 1
  ).catch(() => undefined);
}

/** Clear the counter after a successful authentication. */
export async function resetAccountFailures(
  redis: Pick<LockoutRedis, 'del'>,
  config: AuthConfig,
  username: string
): Promise<void> {
  await redis.del(accountLockKey(config, username)).catch(() => undefined);
}
