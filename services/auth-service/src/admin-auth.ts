import { createHmac, timingSafeEqual } from 'node:crypto';
import type http from 'node:http';
import { authenticateAd, loadAdAdminState, loadAdGroupMembership } from './ldap';
import {
  checkAccountLockout,
  checkLoginRateLimit,
  recordAccountAuthFailure,
  resetAccountFailures,
  verifyTurnstile,
} from './turnstile';
import { clientIp, readRawBody } from './httputil';
import { escapeHtml } from './render';
import { auditAdminEvent } from './audit';
import { groupsMatch } from './admin-groups';
import {
  isAdminSessionId,
  isAdminSessionLive,
  mintAdminSessionRecord,
  revokeAdminSession,
  type AdminSessionStore,
} from './admin-sessions';
import type { AuthConfig } from './config';
import {
  findRecoveryCredential,
  recordRecoveryUse,
  recoveryCredentialIsCurrent,
  verifyRecoveryPassword,
} from './admin-recovery';

/** Structural subset of the redis client used for rate limiting. */
interface RateLimitRedis {
  /** Atomic fixed-window counter primitive (turnstile.ts Lua script). */
  eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
}

/** Redis surface needed by the login/logout handlers themselves. */
export interface AdminLoginRedis extends RateLimitRedis, AdminSessionStore {}

/**
 * First-party /admin console authentication (ADR-0012 follow-up). The auth
 * service owns its management surface: AD operators authenticate against a
 * strict allowlist, while separately configured recovery accounts authenticate
 * only this console. Both receive a short-lived HMAC-signed cookie with an
 * explicit credential authority. No portal involvement.
 *
 * Failure posture:
 *   - no AD allowlist/groups and local recovery disabled -> console returns 404
 *   - failed logins are rate-limited like interaction logins and audited
 */

export const ADMIN_COOKIE_NAME = 'uar_admin_session';
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const SESSION_KEY_INFO = 'uar-admin-session-v1';

/**
 * Purpose-separated session signing key: the provider cookie keys are shared
 * infrastructure, so the admin session HMAC is derived from them with a fixed
 * info label instead of reusing the raw value. Compromise or misuse in one
 * role cannot forge cookies in the other.
 */
function derivedKey(rawKey: string): string {
  return createHmac('sha256', rawKey).update(SESSION_KEY_INFO).digest('base64');
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function hmac(payload: string, key: string): string {
  return createHmac('sha256', key).update(payload).digest('base64url');
}

function constantTimeEquals(a: string, b: string): boolean {
  const ha = Buffer.from(a);
  const hb = Buffer.from(b);
  if (ha.length !== hb.length) {
    // Still burn comparable time to avoid a trivial length oracle.
    timingSafeEqual(ha, ha);
    return false;
  }
  return timingSafeEqual(ha, hb);
}

export interface AdminSessionPayload {
  u: string;
  exp: number;
  /** Server-tracked session identifier; liveness lives in Redis. */
  j: string;
  /** Set when access was granted via AUTH_ADMIN_GROUPS membership. */
  g?: 1;
  /** Credential authority for this Auth Manager session. */
  m: 'ad' | 'local_recovery';
  /** AuthAdminLocalAccount identity and version for local recovery sessions. */
  a?: string;
  v?: number;
}

export interface AdminPrincipal {
  username: string;
  authMethod: 'ad' | 'local_recovery';
  sessionId: string;
  viaGroup: boolean;
  localAccountId?: string;
  credentialVersion?: number;
}

export function signAdminSession(
  username: string,
  cookieKey: string,
  now = Date.now(),
  viaGroup = false,
  sessionId = '',
  identity: { method: 'ad' } | { method: 'local_recovery'; accountId: string; credentialVersion: number } = { method: 'ad' }
): string {
  if (!isAdminSessionId(sessionId)) {
    throw new Error('signAdminSession requires a tracked session id');
  }
  const payload: AdminSessionPayload = {
    u: username,
    exp: Math.floor(now / 1000) + SESSION_TTL_SECONDS,
    j: sessionId,
    m: identity.method,
    ...(viaGroup ? { g: 1 as const } : {}),
    ...(identity.method === 'local_recovery'
      ? { a: identity.accountId, v: identity.credentialVersion }
      : {}),
  };
  const encoded = base64url(JSON.stringify(payload));
  return `${encoded}.${hmac(encoded, derivedKey(cookieKey))}`;
}

export function verifyAdminSession(
  token: string | undefined,
  cookieKey: string,
  now = Date.now()
): AdminSessionPayload | null {
  if (!token) return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const encoded = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (!constantTimeEquals(signature, hmac(encoded, derivedKey(cookieKey)))) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as AdminSessionPayload;
    if (typeof payload.u !== 'string' || typeof payload.exp !== 'number') return null;
    if (payload.exp <= Math.floor(now / 1000)) return null;
    // Untracked (pre-revocation-era) cookies never verify.
    if (!isAdminSessionId(payload.j)) return null;
    if (payload.m !== 'ad' && payload.m !== 'local_recovery') return null;
    if (
      payload.m === 'local_recovery'
      && (typeof payload.a !== 'string' || typeof payload.v !== 'number' || !Number.isInteger(payload.v))
    ) return null;
    return payload;
  } catch {
    return null;
  }
}

function readCookie(req: http.IncomingMessage, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return undefined;
}

/**
 * Resolve the console identity behind a request: signature + expiry first,
 * then the server-tracked liveness record (fail-closed), then the current
 * identity authority. AD sessions recheck directory policy; local sessions
 * recheck the Auth Manager account's active state and credential version.
 */
export async function adminPrincipalFromRequest(
  req: http.IncomingMessage,
  config: AuthConfig,
  redis: AdminSessionStore
): Promise<AdminPrincipal | null> {
  if (!adminConsoleEnabled(config)) return null;
  const session = verifyAdminSession(readCookie(req, ADMIN_COOKIE_NAME), config.cookieKeys[0]);
  if (!session) return null;
  if (!(await isAdminSessionLive(redis, session.j))) return null;
  const username = session.u.toLowerCase();
  if (session.m === 'local_recovery') {
    if (!config.adminLocalRecoveryEnabled || !session.a || session.v === undefined) return null;
    if (!(await recoveryCredentialIsCurrent({
      id: session.a,
      username,
      credentialVersion: session.v,
    }).catch(() => false))) return null;
    return {
      username,
      authMethod: 'local_recovery',
      sessionId: session.j,
      viaGroup: false,
      localAccountId: session.a,
      credentialVersion: session.v,
    };
  }
  const directory = await loadAdAdminState(config, username);
  if (!directory.ok || directory.disabled || directory.locked) return null;
  if (config.adminUsernames.includes(username)) {
    return { username, authMethod: 'ad', sessionId: session.j, viaGroup: false };
  }
  // The cookie marker identifies how the session was minted; current group
  // membership is still verified live on every privileged request.
  if (
    (config.adminGroups?.length ?? 0) > 0 &&
    session.g === 1 &&
    groupsMatch(directory.memberOf, config.adminGroups)
  ) return { username, authMethod: 'ad', sessionId: session.j, viaGroup: true };
  return null;
}

/** Compatibility helper for callers that only need the resolved username. */
export async function adminUsernameFromRequest(
  req: http.IncomingMessage,
  config: AuthConfig,
  redis: AdminSessionStore
): Promise<string | null> {
  return (await adminPrincipalFromRequest(req, config, redis))?.username ?? null;
}

export function adminConsoleEnabled(config: AuthConfig): boolean {
  return (
    (config.adminUsernames.length > 0
      || (config.adminGroups?.length ?? 0) > 0
      || config.adminLocalRecoveryEnabled) &&
    config.cookieKeys.length > 0
  );
}

function secureCookies(config: AuthConfig): boolean {
  return config.issuer.startsWith('https://');
}

function sessionSetCookie(token: string, config: AuthConfig): string {
  const attributes = [
    `${ADMIN_COOKIE_NAME}=${token}`,
    // Scope the cookie to the console so it never rides along on other
    // surfaces of the auth host.
    'Path=/admin',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_TTL_SECONDS}`,
  ];
  if (secureCookies(config)) attributes.push('Secure');
  return attributes.join('; ');
}

function clearedCookie(config: AuthConfig): string {
  const attributes = [`${ADMIN_COOKIE_NAME}=`, 'Path=/admin', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (secureCookies(config)) attributes.push('Secure');
  return attributes.join('; ');
}

async function readForm(req: http.IncomingMessage): Promise<Record<string, string>> {
  const raw = await readRawBody(req, 16 * 1024);
  return Object.fromEntries(new URLSearchParams(raw));
}

/**
 * Handle POST /admin/login: allowlist gate first (so non-admins can never
 * reach an AD bind through this endpoint), then the same AD bind the
 * interaction login uses, under the same IP rate limit.
 */
export async function handleAdminLogin(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  config: AuthConfig,
  redis: AdminLoginRedis
): Promise<void> {
  if (!adminConsoleEnabled(config)) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
    return;
  }

  const ip = clientIp(req, { trustForwardedHeaders: config.trustProxyHeaders });
  const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null;
  let form: Record<string, string>;
  try {
    form = await readForm(req);
  } catch {
    res.writeHead(413, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'invalid_request' }));
    return;
  }

  const username = (form.username ?? '').trim().toLowerCase();
  const password = form.password ?? '';

  const deny = async (outcome: string, error?: string): Promise<void> => {
    await auditAdminEvent({
      action: 'ADMIN_LOGIN_FAILED',
      username,
      outcome,
      ip,
      userAgent,
      error,
    });
    // Rate limiting is reported honestly (429) so locked-out admins are not
    // told their password is wrong; all credential failures stay generic.
    const rateLimited = outcome === 'rate_limited';
    res.writeHead(rateLimited ? 429 : 401, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    });
    res.end(
      JSON.stringify({
        error: rateLimited
          ? 'Too many attempts. Please wait a few minutes and try again.'
          : 'Invalid credentials.',
      })
    );
  };

  const limit = await checkLoginRateLimit(redis, config, ip).catch(() => ({ allowed: false }));
  if (!limit.allowed) {
    await deny('rate_limited');
    return;
  }

  if (!username || !password) {
    await deny('missing_credentials');
    return;
  }

  // Resolve exactly one credential authority before verification. A username
  // reserved by the recovery roster is never tried against AD, even when the
  // account is inactive or the password is wrong.
  let recovery = null;
  if (config.adminLocalRecoveryEnabled) {
    try {
      recovery = await findRecoveryCredential(username);
    } catch {
      res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error: 'recovery_store_unavailable' }));
      return;
    }
  }

  // Local allowlist gate BEFORE any external call: non-admins can never
  // reach an AD bind OR consume a Turnstile siteverify through this endpoint.
  const allowlisted = config.adminUsernames.includes(username);
  if (!recovery && !allowlisted && (config.adminGroups?.length ?? 0) === 0) {
    await deny('not_allowlisted');
    return;
  }

  // Same human-verification boundary as the user interaction login
  // (fail-closed when the secret is unset). Audited like every denial.
  if (!(await verifyTurnstile(config, form['cf-turnstile-response'] ?? '', ip))) {
    await auditAdminEvent({
      action: 'ADMIN_LOGIN_FAILED',
      username,
      outcome: 'turnstile_denied',
      ip,
      userAgent,
    });
    res.writeHead(401, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ error: 'Human verification failed or was not completed.' }));
    return;
  }

  // Per-account lockout alongside the IP limiter, checked before any AD
  // bind. Presented with the same generic body/status as wrong-password so
  // account state never leaks.
  if (await checkAccountLockout(redis, config, username)) {
    await deny('account_lockout_engaged');
    return;
  }

  if (recovery) {
    if (!recovery.isActive || !verifyRecoveryPassword(password, recovery.passwordHash)) {
      await recordAccountAuthFailure(redis, config, username);
      await deny('invalid_credentials');
      return;
    }
    if (!(await recordRecoveryUse(recovery.id, recovery.credentialVersion, ip).catch(() => false))) {
      res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error: 'recovery_store_unavailable' }));
      return;
    }
    await resetAccountFailures(redis, config, username);
    await auditAdminEvent({
      action: 'ADMIN_LOGIN_SUCCESS',
      username,
      outcome: 'success',
      ip,
      userAgent,
      details: { authentication_method: 'local_recovery' },
    });
    let sessionId: string;
    try {
      sessionId = await mintAdminSessionRecord(redis);
    } catch {
      res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error: 'session_store_unavailable' }));
      return;
    }
    const token = signAdminSession(username, config.cookieKeys[0], Date.now(), false, sessionId, {
      method: 'local_recovery',
      accountId: recovery.id,
      credentialVersion: recovery.credentialVersion,
    });
    const wantsJson = (req.headers.accept ?? '').includes('application/json');
    res.writeHead(wantsJson ? 200 : 303, {
      ...(wantsJson ? { 'Content-Type': 'application/json' } : { Location: '/admin' }),
      'Cache-Control': 'no-store',
      'Set-Cookie': sessionSetCookie(token, config),
    });
    res.end(wantsJson ? JSON.stringify({ ok: true }) : undefined);
    return;
  }

  let viaGroup = false;
  if (!allowlisted) {
    // Group path: bind AS the user and check memberOf against the configured
    // groups. Invalid credentials here are definitive; transport errors fall
    // through to the AD bind below so its error taxonomy (and audit detail)
    // stays intact.
    const groupProbe = await loadAdGroupMembership(config, username, password).catch(() =>
      ({ ok: false as const, reason: 'timeout' as const })
    );
    if (groupProbe.ok) {
      if (!groupProbe.memberOf.length || !groupsMatch(groupProbe.memberOf, config.adminGroups)) {
        await deny('not_in_admin_group');
        return;
      }
      viaGroup = true;
    } else if (groupProbe.reason === 'invalid') {
      await recordAccountAuthFailure(redis, config, username);
      await deny('invalid_credentials');
      return;
    }
  }

  const adResult = await authenticateAd(config, username, password);
  if (!adResult.success) {
    // Only definitive credential failures feed the per-account lockout;
    // policy denials and directory outages must not brute-force-lock the
    // account (same posture as the interaction login).
    if (adResult.status === 'invalid_credentials') {
      await recordAccountAuthFailure(redis, config, username);
    }
    await deny(adResult.status === 'invalid_credentials' ? 'invalid_credentials' : 'ad_unavailable', adResult.error);
    return;
  }

  await resetAccountFailures(redis, config, username);
  await auditAdminEvent({
    action: 'ADMIN_LOGIN_SUCCESS', username, outcome: 'success', ip, userAgent,
    details: { authentication_method: 'ad' },
  });
  // Mint the server-tracked session id BEFORE signing; a dead session store
  // fails the login closed rather than issuing a cookie that can never verify.
  let sessionId: string;
  try {
    sessionId = await mintAdminSessionRecord(redis);
  } catch {
    res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ error: 'session_store_unavailable' }));
    return;
  }
  const token = signAdminSession(username, config.cookieKeys[0], Date.now(), viaGroup, sessionId);
  // Plain form posts navigate; send them to the console. Fetch callers that
  // explicitly accept JSON still get the machine-readable body.
  const wantsJson = (req.headers.accept ?? '').includes('application/json');
  if (wantsJson) {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Set-Cookie': sessionSetCookie(token, config),
    });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  res.writeHead(303, {
    Location: '/admin',
    'Cache-Control': 'no-store',
    'Set-Cookie': sessionSetCookie(token, config),
  });
  res.end();
}

/** Handle POST /admin/logout. Revokes the tracked session, then clears the cookie. */
export async function handleAdminLogout(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  config: AuthConfig,
  redis: AdminSessionStore
): Promise<void> {
  const session = verifyAdminSession(readCookie(req, ADMIN_COOKIE_NAME), config.cookieKeys[0]);
  if (session) {
    await revokeAdminSession(redis, session.j).catch(() => undefined);
    const ip = clientIp(req, { trustForwardedHeaders: config.trustProxyHeaders });
    const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null;
    await auditAdminEvent({ action: 'ADMIN_LOGOUT', username: session.u, outcome: 'success', ip, userAgent });
  }
  res.writeHead(204, {
    'Cache-Control': 'no-store',
    'Set-Cookie': clearedCookie(config),
  });
  res.end();
}

/**
 * CSRF defense for state-changing /admin/api calls: SameSite=Lax already
 * blocks cross-site POSTs from attaching the cookie, but browsers that ignore
 * SameSite or older proxies make this belt-and-braces check worthwhile — the
 * Origin must match the issuer origin.
 */
export function sameOriginRequest(req: http.IncomingMessage, config: AuthConfig): boolean {
  const origin = req.headers.origin;
  if (!origin) return true; // same-origin fetches may omit it; curl/tooling too
  try {
    return new URL(origin).origin === new URL(config.issuer).origin;
  } catch {
    return false;
  }
}

/**
 * Minimal login page served when the console is enabled but no session
 * exists. Carries the same Turnstile boundary as the interaction sign-in
 * (widget rendered only when a site key is configured) and the shared
 * light/dark theme bootstrap.
 */
export function renderAdminLoginPage(turnstileSiteKey?: string, message?: string): string {
  const errorBox = message ? `<div class="error" role="alert">${escapeHtml(message)}</div>` : '';
  const turnstile = turnstileSiteKey
    ? `<div class="cf-turnstile" data-sitekey="${escapeHtml(turnstileSiteKey)}" data-size="flexible"></div>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>`
    : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Auth Manager Sign-in</title>
<link rel="stylesheet" href="/admin/app.css">
<script src="/admin/theme.js"></script>
</head>
<body class="login-body">
<div class="login-route">
<div class="identity-login">
  <header class="login-top">
    <div class="provider-lockup">
      <div class="provider-name"><strong>Cal Poly SOC</strong><span>IdP Admin</span></div>
    </div>
    <button id="btn-login-theme" class="theme-text" type="button" aria-label="Toggle color theme">Theme</button>
  </header>
  <main class="auth-card">
    <h1>Admin sign in</h1>
    <p class="sub">Use an authorized directory account or an enabled Auth Manager recovery account.</p>
    ${errorBox}
    <form method="post" action="/admin/login">
      <label for="username">Username</label>
      <input type="text" id="username" name="username" autocomplete="username" required autofocus>
      <label for="password">Password</label>
      <input type="password" id="password" name="password" autocomplete="current-password" required>
      ${turnstile}
      <button type="submit">Sign in</button>
    </form>
  </main>
</div>
</div>
</body>
</html>`;
}
