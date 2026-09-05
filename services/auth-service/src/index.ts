import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { createClient } from 'redis';
import Provider from 'oidc-provider';
import { loadConfig, type AuthConfig } from './config';
import { prisma } from './db';
import {
  assertCloneModeForDatabaseAttestation,
  isProductionCloneReadOnly,
} from './clone-safety';
import { RedisAdapter } from './adapter';
import { Adapter } from 'oidc-provider';
import { authenticateAd, changeAdPasswordWithCurrent, type AdAccountProfile } from './ldap';
import {
  checkAccountLockout,
  checkEndpointRateLimit,
  checkLoginRateLimit,
  endpointRateKey,
  recordAccountAuthFailure,
  resetAccountFailures,
  verifyTurnstile,
} from './turnstile';
import {
  CLIENT_ID_PATTERN,
  DEFAULT_BRANDING_CLIENT_ID,
  defaultBrandingDoc,
} from './branding';
import { loadBrandingDoc } from './branding-store';
import { interactionHtmlHeaders, renderBrandingPage } from './render';
import {
  INTERNAL_BRANDING_PATH_PATTERN,
  handleInternalBrandingRequest,
} from './internal-branding';
import {
  adminConsoleEnabled,
  adminPrincipalFromRequest,
  handleAdminLogin,
  handleAdminLogout,
  renderAdminLoginPage,
} from './admin-auth';
import { handleAdminApi } from './admin-api';
import { ADMIN_CSS, ADMIN_EDITOR_HTML, ADMIN_JS, ADMIN_THEME_JS } from './admin-static';
import { consumePreviewDraft } from './admin-preview';
import { loadUiFont } from './ui-assets';
import {
  listPublishedCatalogEntries,
  type CatalogEntryView,
} from './application-catalog';
import {
  PUBLIC_UI_HEADERS,
  configuredBootstrapApplication,
  renderApplicationLanding,
} from './public-ui';
import { recordShadowDeviceObservation, type DeviceRiskAssessment } from './device-risk';
import { clientIp, cookieHeaderValue, parseCookies, readRawBody } from './httputil';
import {
  destroySessionByClientSid,
  parseBackchannelBody,
  verifyClientCredentials,
} from './backchannel';
import {
  attachLoginContext,
  captureLoginContext,
  isValidDeviceId,
} from './session-store';
import {
  bindPendingPasswordChange,
  boundPendingChangeAccount,
  clearPendingPasswordChange,
  isBoundChangeRequest,
} from './interaction-state';
import { buildProviderOptions, claimsKey, CLAIM_TTL_SECONDS, type CachedAccountClaims } from './provider-options';
import { sharedProviderKeys } from './jwks';
import {
  assertClientSecretsDecryptable,
  clampSessionTtlSeconds,
  createOidcClient,
  deleteOidcClient,
  listOidcClients,
  OidcClientInCatalogError,
  providerClientAdapter,
  reencryptPlaintextSecretsOnBoot,
  refreshSessionTtlCache,
  rotateOidcClientSecret,
  syncAllClientsOnBoot,
  updateOidcClient,
  validateBackchannelLogoutUri,
  validateOptionalRedirectUris,
  validateRedirectUris,
  validateRequestedIdTokenAlg,
  validateRequestedScope,
} from './oidc-clients';

const config: AuthConfig = loadConfig();
const interactionHeaders = (extra: Record<string, string> = {}) =>
  interactionHtmlHeaders(extra, config.redirectUris);

// Assigned during main() startup before any request is served.
let provider!: Provider;

const redis = createClient({ url: config.redisUrl });

/**
 * Uniform wrong-password response copy: account lockouts and AD-side
 * disabled/locked states reuse it verbatim so no oracle distinguishes them.
 */
const INVALID_CREDENTIALS_MESSAGE = 'Invalid username or password.';

/**
 * First-party device-recognition cookie (ADR-0014): lets the sign-in trail
 * distinguish "same machine, new session" from "new device". It carries no
 * identity - only a random UUID - and is never read by third parties.
 */
const DEVICE_COOKIE_NAME = 'authsvc_did';
const DEVICE_COOKIE_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;

function secureCookies(): boolean {
  try {
    return new URL(config.issuer).protocol === 'https:';
  } catch {
    return false;
  }
}

/** Read the existing device cookie or mint one; returns the Set-Cookie header when minted. */
function resolveDeviceCookie(
  req: http.IncomingMessage
): { value: string; setCookieHeader: string | null } {
  const existing = parseCookies(req)[DEVICE_COOKIE_NAME];
  if (existing && existing.length === 36) {
    return { value: existing, setCookieHeader: null };
  }
  const value = randomUUID();
  return {
    value,
    setCookieHeader: cookieHeaderValue(DEVICE_COOKIE_NAME, value, {
      maxAgeSeconds: DEVICE_COOKIE_MAX_AGE_SECONDS,
      httpOnly: true,
      sameSite: 'Lax',
      secure: secureCookies(),
    }),
  };
}

async function storeClaims(
  accountId: string,
  profile?: AdAccountProfile
): Promise<void> {
  // Descriptive directory attributes only (ADR-0012 amendment): no roles,
  // no elevation, no session state rides in the claims cache. Groups are
  // CNs (not DNs) so relying parties like Proxmox map them to local groups
  // by name, exactly as they would against a direct AD bind.
  const claims: CachedAccountClaims = {};
  if (profile?.displayName) claims.name = profile.displayName;
  if (profile?.mail) claims.email = profile.mail;
  if (profile?.memberOf?.length) {
    const seen = new Set<string>();
    const cns: string[] = [];
    for (const dn of profile.memberOf) {
      const cn = /^CN=([^,]+)/i.exec(dn)?.[1];
      if (cn && !seen.has(cn)) {
        seen.add(cn);
        cns.push(cn);
      }
    }
    if (cns.length) claims.groups = cns;
  }
  await redis.set(claimsKey(accountId), JSON.stringify(claims), { EX: CLAIM_TTL_SECONDS });
}

function deviceCookieIdFrom(req: http.IncomingMessage): string | undefined {
  const value = parseCookies(req)[DEVICE_COOKIE_NAME];
  return value && value.length === 36 ? value : undefined;
}

/**
 * Stash the sign-in context (app, IP, user-agent, first-party device hints)
 * for the tracking adapter to bind to the provider session created moments
 * later by interactionFinished (ADR-0014). Best-effort by design.
 */
async function captureSignInContext(input: {
  username: string;
  clientId: string;
  interactionUid: string;
  form: Record<string, string>;
  req: http.IncomingMessage;
}): Promise<void> {
  try {
    await captureLoginContext(redis, input.username, {
      clientId: input.clientId,
      ip: clientIp(input.req, { trustForwardedHeaders: config.trustProxyHeaders }),
      userAgent:
        typeof input.req.headers['user-agent'] === 'string'
          ? String(input.req.headers['user-agent'])
          : undefined,
      deviceId:
        config.deviceRiskMode === 'shadow' && isValidDeviceId(input.form.deviceId)
          ? input.form.deviceId
          : undefined,
      deviceCookieId: deviceCookieIdFrom(input.req),
    }, input.interactionUid);
  } catch (error) {
    console.error('[auth] sign-in context capture failed', error);
  }
}

export async function attachAuthorizationSuccessContext(context: unknown): Promise<void> {
  const ctx = context as {
    oidc?: {
      session?: { jti?: unknown; accountId?: unknown; exp?: unknown };
      entities?: { Interaction?: { uid?: unknown } };
    };
  };
  const session = ctx.oidc?.session;
  const interactionUid = ctx.oidc?.entities?.Interaction?.uid;
  if (
    typeof session?.jti !== 'string' ||
    typeof session.accountId !== 'string' ||
    typeof interactionUid !== 'string'
  ) return;
  const now = Math.floor(Date.now() / 1000);
  const ttl = typeof session.exp === 'number' ? Math.max(1, session.exp - now) : 8 * 60 * 60;
  await attachLoginContext(redis, session.accountId, session.jti, ttl, interactionUid);
}

async function observeSignInDevice(input: {
  username: string;
  clientId: string;
  form: Record<string, string>;
  req: http.IncomingMessage;
  method: 'ad';
}): Promise<DeviceRiskAssessment | null> {
  try {
    return await recordShadowDeviceObservation(config, {
      username: input.username,
      clientId: input.clientId,
      deviceCookieId: deviceCookieIdFrom(input.req),
      fingerprint: isValidDeviceId(input.form.deviceId) ? input.form.deviceId : undefined,
      ipAddress: clientIp(input.req, { trustForwardedHeaders: config.trustProxyHeaders }),
      userAgent:
        typeof input.req.headers['user-agent'] === 'string'
          ? String(input.req.headers['user-agent'])
          : null,
      method: input.method,
    });
  } catch (error) {
    console.error('[auth] device evidence capture failed', error);
    return null;
  }
}

async function auditLogin(input: {
  username: string;
  success: boolean;
  outcome: string;
  method: string;
  ip: string | null;
  userAgent: string | null;
  error?: string;
  /** Server-side structured detail; never rendered to users. */
  detail?: string;
  clientId?: string;
  riskLevel?: DeviceRiskAssessment['level'];
}): Promise<void> {
  await prisma.auditLog.create({
      data: {
        action: input.success ? 'LOGIN_SUCCESS' : 'LOGIN_FAILED',
        category: 'authentication',
        username: input.username,
        actorType: 'user',
        subjectUsername: input.username,
        eventKind: 'security',
        outcome: input.outcome,
        clientId: input.clientId,
        riskLevel: input.riskLevel,
        details: JSON.stringify({
          method: input.method,
          error: input.error ?? undefined,
          detail: input.detail ?? undefined,
        }),
        ipAddress: input.ip,
        userAgent: input.userAgent,
        success: input.success,
      },
  });
}

/**
 * Error pages inherit the default profile's theme so a broken interaction
 * still looks like the deployment's sign-in surface. Falls back to the
 * built-in document when the database is unreachable (a common cause of
 * errors on this path).
 */
async function renderErrorPage(message: string): Promise<string> {
  let doc = defaultBrandingDoc();
  try {
    doc = await loadBrandingDoc(DEFAULT_BRANDING_CLIENT_ID);
  } catch {
    // keep built-in default
  }
  return renderBrandingPage('error', doc, { errorMessage: message });
}

/**
 * Resolve the relying-party name from authoritative registration data. The
 * bootstrap portal is configured through provider metadata and intentionally
 * may not have an OidcClient row, so reuse the same presentation resolver as
 * the public application directory. Unknown clients stay unnamed; the
 * renderer omits destination context instead of inventing a placeholder.
 */
async function resolveRequestingApplication(clientId: string): Promise<string | undefined> {
  const client = await prisma.oidcClient.findUnique({
    where: { clientId },
    select: { name: true },
  }).catch(() => null);
  const registeredName = client?.name?.trim();
  if (registeredName) return registeredName;
  if (clientId !== config.clientId) return undefined;
  return configuredBootstrapApplication(config.clientId, config.redirectUris)?.name;
}

function readBody(req: http.IncomingMessage): Promise<Record<string, string>> {
  return readRawBody(req, 64 * 1024).then((data) =>
    Object.fromEntries(new URLSearchParams(data))
  );
}

/**
 * Best-effort client_id resolution for POST paths: interactionDetails reads
 * the interaction cookie, which survives the form submission. Failure keeps
 * the configured default so branding never blocks authentication.
 */
async function resolveInteractionContext(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<{ clientId: string; requestingApplication?: string }> {
  try {
    const details = await provider.interactionDetails(req, res);
    const clientId = details.params.client_id;
    if (typeof clientId === 'string' && CLIENT_ID_PATTERN.test(clientId)) {
      return { clientId, requestingApplication: await resolveRequestingApplication(clientId) };
    }
  } catch {
    // fall through to default
  }
  return { clientId: config.clientId };
}

async function handleInteractionGet(req: http.IncomingMessage, res: http.ServerResponse, uid: string): Promise<void> {
  try {
    const details = await provider.interactionDetails(req, res);
    if (details.prompt.name === 'consent') {
      // First-party portal: no consent screen. The requested scopes are the
      // ones the single configured client may always receive. v8 REQUIRES the
      // consent result to reference a SAVED Grant id — a bare scope list is
      // never applied to the grant, so the policy re-prompts forever.
      const accountId = details.session?.accountId;
      if (!accountId) {
        res.writeHead(400, { 'Content-Type': 'text/html', ...interactionHeaders() });
        res.end(await renderErrorPage('This sign-in session has expired. Return to the portal and try again.'));
        return;
      }
      const grant = new provider.Grant({
        accountId,
        clientId: details.params.client_id || config.clientId,
      });
      grant.addOIDCScope(String(details.params.scope ?? 'openid'));
      const grantId = await grant.save();
      await provider.interactionFinished(req, res, { consent: { grantId } });
      return;
    }
    if (details.prompt.name !== 'login') {
      res.writeHead(400, { 'Content-Type': 'text/html', ...interactionHeaders() });
      res.end(await renderErrorPage('Unexpected authentication prompt'));
      return;
    }
    const clientId =
      typeof details.params.client_id === 'string' && CLIENT_ID_PATTERN.test(details.params.client_id)
        ? details.params.client_id
        : config.clientId;
    const doc = await loadBrandingDoc(clientId);
    const html = renderBrandingPage('login', doc, {
      uid,
      requestingApplication: await resolveRequestingApplication(clientId),
      cancelUrl: '/',
      turnstileSiteKey: config.turnstileSiteKey,
      deviceEvidenceEnabled: config.deviceRiskMode === 'shadow',
    });
    const device = resolveDeviceCookie(req);
    const headers: Record<string, string> = {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      ...interactionHeaders(),
    };
    if (device.setCookieHeader) headers['Set-Cookie'] = device.setCookieHeader;
    res.writeHead(200, headers);
    res.end(html);
  } catch (error) {
    console.error('[auth] interactionDetails failed', error);
    res.writeHead(400, { 'Content-Type': 'text/html', ...interactionHeaders() });
    res.end(await renderErrorPage('This sign-in session has expired. Return to the portal and try again.'));
  }
}

async function finishLogin(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  accountId: string,
  amr: string[],
  meta: Record<string, unknown>,
  profile?: AdAccountProfile,
  extras?: { pwdChanged?: boolean }
): Promise<void> {
  await storeClaims(accountId, profile);
  const sessionAmr = extras?.pwdChanged ? [...amr, 'pwd_changed'] : amr;
  await provider.interactionFinished(
    req,
    res,
    { login: { accountId, amr: sessionAmr }, meta },
    { mergeWithLastSubmission: true }
  );
}

async function handleInteractionPost(req: http.IncomingMessage, res: http.ServerResponse, uid: string): Promise<void> {
  const ip = clientIp(req, { trustForwardedHeaders: config.trustProxyHeaders });
  const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null;
  const interaction = await resolveInteractionContext(req, res);
  const clientId = interaction.clientId;
  let form: Record<string, string>;
  try {
    form = await readBody(req);
  } catch {
    res.writeHead(413, { 'Content-Type': 'text/html', ...interactionHeaders() });
    res.end(await renderErrorPage('Invalid request'));
    return;
  }
  const username = (form.username ?? '').trim().toLowerCase();
  const password = form.password ?? '';

  // Rate limit first, fail closed.
  const limit = await checkLoginRateLimit(redis, config, ip).catch(() => ({ allowed: false }));
  if (!limit.allowed) {
    res.writeHead(429, { 'Content-Type': 'text/html', ...interactionHeaders() });
    res.end(await renderErrorPage('Too many sign-in attempts. Please wait a few minutes and try again.'));
    return;
  }

  if (!(await verifyTurnstile(config, form['cf-turnstile-response'] ?? '', ip))) {
    await auditLogin({ username, success: false, outcome: 'denied', method: 'turnstile', ip, userAgent, clientId });
    res.writeHead(401, { 'Content-Type': 'text/html', ...interactionHeaders() });
    res.end(await renderErrorPage('Human verification failed or was not completed.'));
    return;
  }

  // Per-account lockout alongside the IP limiter. Locked accounts get the
  // exact same body/status as a wrong password - no oracle, no AD round-trip.
  if (await checkAccountLockout(redis, config, username)) {
    await auditLogin({ username, success: false, outcome: 'account_lockout_engaged', method: 'ad', ip, userAgent, clientId });
    await sendWrongPasswordResponse(res, clientId, uid, username, interaction.requestingApplication);
    return;
  }

  // Same-connection profile read (ADR-0012 amendment): one bind, one extra
  // search; a failed read never blocks sign-in - claims fall back to defaults.
  const adResult = await authenticateAd(config, username, password, { withProfile: true });

  if (adResult.success) {
    await resetAccountFailures(redis, config, username);
    await captureSignInContext({ username, clientId, interactionUid: uid, form, req });
    const risk = await observeSignInDevice({ username, clientId, form, req, method: 'ad' });
    await auditLogin({ username, success: true, outcome: 'success', method: 'ad', ip, userAgent, clientId, riskLevel: risk?.level });
    // Ordinary AD sign-in: no pwd_changed claim (ADR-0012 §2).
    await finishLogin(req, res, username, ['ad'], {}, adResult.profile);
    return;
  }

  if (
    adResult.status === 'password_change_required' ||
    adResult.status === 'password_expired'
  ) {
    // Pin the account whose credentials triggered the forced change to this
    // interaction uid; the change endpoint refuses any other username.
    await bindPendingPasswordChange(redis, uid, username);
    const doc = await loadBrandingDoc(clientId);
    const html = renderBrandingPage('change-password', doc, {
      uid,
      username,
      requestingApplication: interaction.requestingApplication,
      cancelUrl: '/',
      turnstileSiteKey: config.turnstileSiteKey,
      deviceEvidenceEnabled: config.deviceRiskMode === 'shadow',
    });
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...interactionHeaders() });
    res.end(html);
    return;
  }

  if (!adResult.success && adResult.status !== 'invalid_credentials') {
    if (
      adResult.status === 'account_disabled' ||
      adResult.status === 'account_locked' ||
      adResult.status === 'account_expired' ||
      adResult.status === 'account_restricted'
    ) {
      // Policy denials are NOT credential failures: they must not increment
      // the per-account brute-force counter (only wrong passwords do).
      await auditLogin({
        username,
        success: false,
        outcome: adResult.status,
        method: 'ad',
        ip,
        userAgent,
        clientId,
        error: adResult.error,
      });
      // Generic response: never confirm account state to unauthenticated callers.
      res.writeHead(401, { 'Content-Type': 'text/html', ...interactionHeaders() });
      res.end(await renderErrorPage(INVALID_CREDENTIALS_MESSAGE));
      return;
    }

    await auditLogin({
      username,
      success: false,
      outcome: 'unavailable',
      method: 'ad',
      ip,
      userAgent,
      clientId,
      error: adResult.error,
    });
    res.writeHead(503, { 'Content-Type': 'text/html', ...interactionHeaders() });
    res.end(await renderErrorPage('Sign-in is temporarily unavailable. Please try again shortly.'));
    return;
  }

  await recordAccountAuthFailure(redis, config, username);
  await auditLogin({
    username,
    success: false,
    outcome: 'invalid_credentials',
    method: 'ad',
    ip,
    userAgent,
    clientId,
  });
  await sendWrongPasswordResponse(res, clientId, uid, username, interaction.requestingApplication);
}

/**
 * The wrong-password response for the login POST: branding login page with
 * the uniform message. Used for BOTH actual credential failures and engaged
 * per-account lockouts so they are indistinguishable on the wire.
 */
async function sendWrongPasswordResponse(
  res: http.ServerResponse,
  clientId: string,
  uid: string,
  username: string,
  requestingApplication?: string
): Promise<void> {
  const doc = await loadBrandingDoc(clientId);
  const html = renderBrandingPage('login', doc, {
    uid,
    username,
    requestingApplication,
    cancelUrl: '/',
    turnstileSiteKey: config.turnstileSiteKey,
    deviceEvidenceEnabled: config.deviceRiskMode === 'shadow',
    errorMessage: INVALID_CREDENTIALS_MESSAGE,
  });
  // The body echoes the submitted username; never let intermediaries cache it.
  res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...interactionHeaders() });
  res.end(html);
}

/**
 * Uniform failure copy for the change-password endpoint. Identity-binding
 * violations reuse the validation-failure message verbatim: mismatched
 * username, unbound/expired interaction, and missing fields must be
 * indistinguishable to the caller.
 */
const CHANGE_PASSWORD_GENERIC_ERROR =
  'All fields are required and the new password must be at least 8 characters.';
/** Exact AD rejection text that identifies a wrong CURRENT password. */
const WRONG_CURRENT_PASSWORD_ERROR =
  'Current password was not accepted by Active Directory.';

async function handleChangePasswordPost(req: http.IncomingMessage, res: http.ServerResponse, uid: string): Promise<void> {
  // The change screen only exists inside a live login interaction; bind the
  // request to that uid and gate it like the login POST itself so this can
  // never become an unauthenticated AD password oracle.
  let clientId = config.clientId;
  let requestingApplication: string | undefined;
  try {
    const details = await provider.interactionDetails(req, res);
    if (details.prompt.name !== 'login') {
      res.writeHead(400, { 'Content-Type': 'text/html', ...interactionHeaders() });
      res.end(await renderErrorPage('This sign-in session has expired.'));
      return;
    }
    const paramsClientId = details.params.client_id;
    if (typeof paramsClientId === 'string' && CLIENT_ID_PATTERN.test(paramsClientId)) {
      clientId = paramsClientId;
    }
    requestingApplication = await resolveRequestingApplication(clientId);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/html', ...interactionHeaders() });
    res.end(await renderErrorPage('This sign-in session has expired.'));
    return;
  }

  const ip = clientIp(req, { trustForwardedHeaders: config.trustProxyHeaders });
  const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null;
  const limit = await checkLoginRateLimit(redis, config, ip).catch(() => ({ allowed: false }));
  if (!limit.allowed) {
    res.writeHead(429, { 'Content-Type': 'text/html', ...interactionHeaders() });
    res.end(await renderErrorPage('Too many attempts. Please wait a few minutes and try again.'));
    return;
  }
  const form = await readBody(req).catch(() => ({}) as Record<string, string>);
  if (!(await verifyTurnstile(config, form['cf-turnstile-response'] ?? '', ip))) {
    res.writeHead(401, { 'Content-Type': 'text/html', ...interactionHeaders() });
    res.end(await renderErrorPage('Human verification failed or was not completed.'));
    return;
  }
  const username = (form.username ?? '').trim().toLowerCase();
  const current = form.current ?? '';
  const next = form.next ?? '';
  const confirm = form.confirm ?? '';

  const brandingDoc = await loadBrandingDoc(clientId);
  const fail = async (message: string) => {
    const html = renderBrandingPage('change-password', brandingDoc, {
      uid,
      username,
      requestingApplication,
      cancelUrl: '/',
      turnstileSiteKey: config.turnstileSiteKey,
      deviceEvidenceEnabled: config.deviceRiskMode === 'shadow',
      errorMessage: message,
    });
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8', ...interactionHeaders() });
    res.end(html);
  };

  // Identity binding: only the account that authenticated into THIS
  // interaction may change its password through it. Unbound uids (expired
  // binding, direct navigation) and mismatches both fail closed here,
  // before any field validation or AD contact.
  const boundAccount = await boundPendingChangeAccount(redis, uid);
  if (!isBoundChangeRequest(boundAccount, username)) {
    await auditLogin({
      username,
      success: false,
      outcome: 'password_change_denied',
      method: 'ad',
      ip,
      userAgent,
      clientId,
    });
    await fail(CHANGE_PASSWORD_GENERIC_ERROR);
    return;
  }

  // Same per-account lockout posture as the login POST.
  if (await checkAccountLockout(redis, config, username)) {
    await auditLogin({ username, success: false, outcome: 'account_lockout_engaged', method: 'ad', ip, userAgent, clientId });
    await fail(CHANGE_PASSWORD_GENERIC_ERROR);
    return;
  }

  if (!username || !current || next.length < 8) {
    await fail(CHANGE_PASSWORD_GENERIC_ERROR);
    return;
  }
  if (next !== confirm) {
    await fail('The confirmation does not match the new password.');
    return;
  }

  const changed = await changeAdPasswordWithCurrent(config, username, current, next);
  if (!changed.ok) {
    // A rejected current password is a credential failure: count it toward
    // the per-account lockout so this endpoint cannot bypass it.
    if (changed.error === WRONG_CURRENT_PASSWORD_ERROR) {
      await recordAccountAuthFailure(redis, config, username);
    }
    await auditLogin({
      username,
      success: false,
      outcome: 'password_change_failed',
      method: 'ad',
      ip,
      userAgent,
      clientId,
      error: changed.error,
      detail: changed.detail,
    });
    // The rendered copy is generic; the structured directory detail stays in
    // the audit trail only.
    await fail(changed.error ?? 'Unable to complete password change. Contact your administrator.');
    return;
  }

  const recheck = await authenticateAd(config, username, next, { withProfile: true });
  if (!recheck.success) {
    await clearPendingPasswordChange(redis, uid);
    res.writeHead(503, { 'Content-Type': 'text/html', ...interactionHeaders() });
    res.end(await renderErrorPage('Password changed but sign-in could not complete. Please retry from the portal.'));
    return;
  }

  await clearPendingPasswordChange(redis, uid);
  await resetAccountFailures(redis, config, username);
  await captureSignInContext({ username, clientId, interactionUid: uid, form, req });
  const risk = await observeSignInDevice({ username, clientId, form, req, method: 'ad' });
  await auditLogin({ username, success: true, outcome: 'password_changed', method: 'ad', ip, userAgent, clientId, riskLevel: risk?.level });
  // Forced-change completion is bound to this provider Session as an extra
  // authentication-method marker; no account-scoped cache can leak it into a
  // concurrent or later sign-in.
  await finishLogin(req, res, username, ['ad'], {}, recheck.profile, { pwdChanged: true });
}

/**
 * Registry bodies are JSON-first and keep value TYPES (string[] for
 * redirectUris, booleans for enabled). Form-encoded callers get everything
 * coerced to strings.
 */
async function readJsonObjectBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const raw = await new Promise<string>((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 64 * 1024) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
  const trimmed = raw.trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object') {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* fall through */
    }
  }
  return Object.fromEntries(new URLSearchParams(trimmed));
}

/**
 * Portal-initiated full logout (ADR-0012 posture): the portal revokes its own
 * session, then calls here with the provider sid it recorded at callback time.
 * Authenticated with the OIDC client credentials over the trusted network.
 */
async function readJsonishBody(req: http.IncomingMessage): Promise<Record<string, string>> {
  // 64KB cap, then accept either application/json or url-encoded bodies:
  // internal callers are the portal's fetch (JSON) while ops curl tends to
  // default to form encoding - both must work.
  const raw = await new Promise<string>((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 64 * 1024) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
  const trimmed = raw.trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      return Object.fromEntries(
        Object.entries(parsed).map(([key, value]) => [key, String(value)])
      );
    } catch {
      /* fall through to form parsing */
    }
  }
  return Object.fromEntries(new URLSearchParams(trimmed));
}

async function handleBackchannelLogout(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const deny = () => {
    res.writeHead(401, {
      'Content-Type': 'application/json',
      'WWW-Authenticate': 'Basic realm="uar-backchannel"',
    });
    res.end(JSON.stringify({ error: 'invalid_client' }));
  };

  // Shared-secret endpoints are rate-limited per source IP BEFORE the
  // credential check so the secret cannot be brute-forced online.
  let allowed: boolean;
  try {
    allowed = (
      await checkEndpointRateLimit(
        redis,
        endpointRateKey(
          'backchannel-logout',
          clientIp(req, { trustForwardedHeaders: config.trustProxyHeaders }),
          60_000
        ),
        60,
        60
      )
    ).allowed;
  } catch {
    // Redis outage: fail closed with an explicit availability signal.
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'temporarily_unavailable' }));
    return;
  }
  if (!allowed) {
    res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '60' });
    res.end(JSON.stringify({ error: 'rate_limited' }));
    return;
  }

  if (!verifyClientCredentials(req.headers.authorization, config.clientId, config.clientSecret)) {
    deny();
    return;
  }

  let body: Record<string, string>;
  try {
    body = await readJsonishBody(req);
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'invalid_request' }));
    return;
  }

  const parsed = parseBackchannelBody(body);
  if (!parsed) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'invalid_request' }));
    return;
  }

  let destroyed = false;
  try {
    // The portal sends the ID-token `sid` (authorizations.<client>.sid);
    // resolve it against live Session payloads rather than findByUid, whose
    // index is keyed by the session's internal payload.uid instead.
    destroyed = await destroySessionByClientSid(
      redis,
      parsed.sid,
      config.clientId,
      new RedisAdapter('Session', redis)
    );
  } catch (error) {
    console.error('[auth] backchannel logout failed to destroy session', error);
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'temporarily_unavailable' }));
    return;
  }

  await prisma.auditLog
    .create({
      data: {
        action: 'LOGOUT',
        category: 'authentication',
        // The provider session sid does not carry a username; audit rows
        // require one, so record the sentinel rather than weakening the row.
        username: 'unknown',
        actorType: 'system',
        eventKind: 'security',
        outcome: 'success',
        details: JSON.stringify({
          method: 'oidc_backchannel',
          sid: parsed.sid,
          sessionDestroyed: destroyed,
        }),
        success: true,
      },
    })
    .catch((error) => {
      console.error('[auth] backchannel logout audit write failed', error);
    });

  res.writeHead(204).end();
}

/**
 * Internal client-registry API (Auth Manager). Same client-secret-basic
 * authentication as the backchannel endpoint. The portal proxies its admin
 * UI here; the registry mirrors mutations into the Redis Client store so
 * oidc-provider resolves new relying parties without restarts.
 */
async function handleInternalClients(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  method: string,
  id: string | undefined
): Promise<void> {
  // Shared-secret endpoints are rate-limited per source IP BEFORE the
  // credential check so the secret cannot be brute-forced online.
  let allowed: boolean;
  try {
    allowed = (
      await checkEndpointRateLimit(
        redis,
        endpointRateKey(
          'internal-clients',
          clientIp(req, { trustForwardedHeaders: config.trustProxyHeaders }),
          60_000
        ),
        120,
        60
      )
    ).allowed;
  } catch {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'temporarily_unavailable' }));
    return;
  }
  if (!allowed) {
    res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '60' });
    res.end(JSON.stringify({ error: 'rate_limited' }));
    return;
  }

  if (!verifyClientCredentials(req.headers.authorization, config.clientId, config.clientSecret)) {
    res.writeHead(401, {
      'Content-Type': 'application/json',
      'WWW-Authenticate': 'Basic realm="uar-internal"',
    });
    res.end(JSON.stringify({ error: 'invalid_client' }));
    return;
  }

  const mirror = providerClientAdapter(new RedisAdapter('Client', redis));

  try {
    if (method === 'GET' && !id) {
      const clients = await listOidcClients();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ clients }));
      return;
    }

    if (method === 'POST' && !id) {
      const body = await readJsonObjectBody(req);
      const redirectUris = body.redirectUris;
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name || name.length > 120) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid_request', detail: 'name required (max 120 chars)' }));
        return;
      }
      const validUris = validateRedirectUris(redirectUris);
      if (!validUris) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: 'invalid_request',
          detail: 'redirectUris must be a non-empty array of absolute https (or loopback http) URLs without fragments',
        }));
        return;
      }
      const postLogoutRedirectUris = validateOptionalRedirectUris(body.postLogoutRedirectUris);
      const backchannelLogoutUri = validateBackchannelLogoutUri(body.backchannelLogoutUri);
      if (postLogoutRedirectUris === null || backchannelLogoutUri === undefined) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid_request', detail: 'logout URI metadata is invalid' }));
        return;
      }
      const scopeCheck = validateRequestedScope(body.scope);
      if (!scopeCheck.ok) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid_request', detail: scopeCheck.reason }));
        return;
      }
      if (!validateRequestedIdTokenAlg(body.id_token_signed_response_alg)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: 'invalid_request',
          detail: 'id_token_signed_response_alg must be RS256',
        }));
        return;
      }
      const actor = typeof body.actor === 'string' ? body.actor.trim().slice(0, 120) : 'portal-admin';
      const created = await createOidcClient(
        {
          name,
          redirectUris: validUris,
          postLogoutRedirectUris,
          backchannelLogoutUri,
          scope: typeof body.scope === 'string' ? scopeCheck.scope : undefined,
          sessionTtlSeconds:
            body.sessionTtlSeconds === undefined
              ? undefined
              : (clampSessionTtlSeconds(Number(body.sessionTtlSeconds)) ?? undefined),
          createdBy: actor,
        },
        mirror,
        {
          action: 'AUTH_CLIENT_CREATED', actor,
          details: { redirectUris: validUris.length, scopes: scopeCheck.scope.split(' ') },
        }
      );
      res.writeHead(201, { 'Content-Type': 'application/json' });
      // clientSecret is returned EXACTLY ONCE here; only the verbatim value is
      // stored server-side and it never appears in list/read responses.
      res.end(JSON.stringify({
        client: created.row,
        clientSecret: created.clientSecret,
        mirrorPending: created.mirrorPending,
      }));
      return;
    }

    if ((method === 'PATCH' || method === 'DELETE') && id) {
      if (id === config.clientId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid_request', detail: 'bootstrap client is immutable' }));
        return;
      }

      if (method === 'DELETE') {
        const removed = await deleteOidcClient(id, mirror, {
          action: 'AUTH_CLIENT_DELETED', actor: 'portal-admin',
        });
        if (!removed) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'not_found' }));
          return;
        }
        res.writeHead(204).end();
        return;
      }

      const body = await readJsonObjectBody(req);
      const patch: {
        redirectUris?: string[];
        postLogoutRedirectUris?: string[];
        backchannelLogoutUri?: string | null;
        scope?: string;
        enabled?: boolean;
        sessionTtlSeconds?: number | null;
      } = {};
      if (body.enabled !== undefined) {
        patch.enabled = body.enabled === true || body.enabled === 'true';
      }
      if (body.scope !== undefined) {
        const scopeCheck = validateRequestedScope(body.scope);
        if (!scopeCheck.ok) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid_request', detail: scopeCheck.reason }));
          return;
        }
        if (!validateRequestedIdTokenAlg(body.id_token_signed_response_alg)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: 'invalid_request',
            detail: 'id_token_signed_response_alg must be RS256',
          }));
          return;
        }
        patch.scope = scopeCheck.scope;
      }
      if (Object.prototype.hasOwnProperty.call(body, 'sessionTtlSeconds')) {
        const rawTtl = (body as Record<string, unknown>).sessionTtlSeconds;
        patch.sessionTtlSeconds =
          rawTtl === null || rawTtl === '' ? null : clampSessionTtlSeconds(Number(rawTtl));
      }
      if (body.redirectUris !== undefined) {
        const validUris = validateRedirectUris(body.redirectUris);
        if (!validUris) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid_request', detail: 'redirectUris invalid' }));
          return;
        }
        patch.redirectUris = validUris;
      }
      if (body.postLogoutRedirectUris !== undefined) {
        const validUris = validateOptionalRedirectUris(body.postLogoutRedirectUris);
        if (validUris === null) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid_request', detail: 'postLogoutRedirectUris invalid' }));
          return;
        }
        patch.postLogoutRedirectUris = validUris;
      }
      if (body.backchannelLogoutUri !== undefined) {
        const validUri = validateBackchannelLogoutUri(body.backchannelLogoutUri);
        if (validUri === undefined) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid_request', detail: 'backchannelLogoutUri invalid' }));
          return;
        }
        patch.backchannelLogoutUri = validUri;
      }

      const rotate = body.rotateSecret === true || body.rotateSecret === 'true';

      const actor =
        typeof body.actor === 'string' ? body.actor.trim().slice(0, 120) : 'portal-admin';

      if (rotate) {
        const rotated = await rotateOidcClientSecret(id, mirror, {
          action: 'AUTH_CLIENT_SECRET_ROTATED', actor,
        });
        if (!rotated) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'not_found' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          clientSecret: rotated.clientSecret,
          mirrorPending: rotated.mirrorPending,
        }));
        return;
      }

      const updated = await updateOidcClient(id, patch, mirror, {
        action: 'AUTH_CLIENT_UPDATED', actor, details: { fields: Object.keys(patch) },
      });
      if (!updated) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not_found' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ client: updated }));
      return;
    }

    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'method_not_allowed' }));
  } catch (error) {
    console.error('[auth] internal clients request failed', error);
    if (!res.writableEnded) {
      if (error instanceof OidcClientInCatalogError) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'client_in_application_directory', detail: error.message }));
        return;
      }
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'server_error' }));
    }
  }
}

/**
 * First-party admin console router. Static assets are served unauthenticated
 * (they are inert without API access); everything else requires an admin
 * session cookie. The whole surface 404s when no allowlist is configured.
 */
async function handleAdminRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  config: AuthConfig,
  requestPath: string
): Promise<void> {
  const notFound = (): void => {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!DOCTYPE html><html lang="en"><body><h1>404</h1></body></html>');
  };

  if (!adminConsoleEnabled(config)) {
    notFound();
    return;
  }

  const method = req.method ?? 'GET';
  const jsonHeaders = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  // 'self' in frame-src: the console frames its own /admin/preview/:token
  // route (srcdoc would inherit frame-ancestors 'none' and render blank).
  const csp =
    "default-src 'none'; script-src 'self' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src https: data:; font-src 'self'; connect-src 'self'; frame-src 'self' https://challenges.cloudflare.com; form-action 'self'; frame-ancestors 'none'";

  // Console assets are shared by the login page and the editor.
  if (method === 'GET' && requestPath === '/admin/app.css') {
    res.writeHead(200, {
      'Content-Type': 'text/css; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'",
    });
    res.end(ADMIN_CSS);
    return;
  }
  if (method === 'GET' && requestPath === '/admin/app.js') {
    res.writeHead(200, {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'",
    });
    res.end(ADMIN_JS);
    return;
  }
  if (method === 'GET' && requestPath === '/admin/theme.js') {
    res.writeHead(200, {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'",
    });
    res.end(ADMIN_THEME_JS);
    return;
  }

  // Rendered sign-in preview drafts. Own CSP: the ONLY surface allowed to be
  // framed (by the console itself); scripts stay disabled entirely because
  // preview pages are rendered script-free by design.
  const previewMatch = /^\/admin\/preview\/([A-Za-z0-9_-]{1,64})$/.exec(requestPath);
  if (previewMatch && method === 'GET') {
    const principal = await adminPrincipalFromRequest(req, config, redis);
    if (!principal) {
      res.writeHead(401, jsonHeaders);
      res.end(JSON.stringify({ error: 'unauthenticated' }));
      return;
    }
    const html = consumePreviewDraft(previewMatch[1]);
    if (!html) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end('Preview expired. Render it again.');
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy':
        "default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; font-src 'self'; script-src 'none'; form-action 'none'; frame-ancestors 'self'",
      'Referrer-Policy': 'no-referrer',
    });
    res.end(html);
    return;
  }

  if (requestPath === '/admin/login' && method === 'POST') {
    await handleAdminLogin(req, res, config, redis);
    return;
  }
  if (requestPath === '/admin/logout' && method === 'POST') {
    await handleAdminLogout(req, res, config, redis);
    return;
  }

  const principal = await adminPrincipalFromRequest(req, config, redis);
  if (!principal) {
    if (requestPath.startsWith('/admin/api/')) {
      res.writeHead(401, jsonHeaders);
      res.end(JSON.stringify({ error: 'unauthenticated' }));
      return;
    }
    if (requestPath === '/admin' || requestPath === '/admin/' || requestPath === '/admin/login') {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Security-Policy': csp,
        'Referrer-Policy': 'no-referrer',
      });
      res.end(renderAdminLoginPage(config.turnstileSiteKey));
      return;
    }
    res.writeHead(302, { Location: '/admin', 'Cache-Control': 'no-store' });
    res.end();
    return;
  }

  if (requestPath === '/admin' || requestPath === '/admin/') {
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': csp,
      'Referrer-Policy': 'no-referrer',
    });
    res.end(ADMIN_EDITOR_HTML);
    return;
  }

  if (requestPath.startsWith('/admin/api/')) {
    await handleAdminApi(req, res, requestPath.slice('/admin/api/'.length), principal, config, redis);
    return;
  }

  notFound();
}

async function main(): Promise<void> {
  await prisma.$connect().catch((error) => {
    console.error('[auth] database connection failed', error);
    throw error;
  });
  const cloneRows = await prisma.$queryRawUnsafe<Array<{ attestation: string | null }>>(
    "SELECT nullif(current_setting('uar.clone_attestation', true), '') AS attestation"
  );
  assertCloneModeForDatabaseAttestation(cloneRows[0]?.attestation ?? null);
  await redis.connect();

  const instance = new Provider(
    config.issuer,
    buildProviderOptions(
      config,
      {
        redis,
        createAdapter: (name: string): Adapter => new RedisAdapter(name, redis),
      },
      // One keypair for everything the provider signs AND for back-channel
      // logout tokens (admin destroy emitter); RPs verify both via jwks_uri.
      sharedProviderKeys().jwks
    )
  );

  provider = instance;
  instance.on('authorization.success', (context) => {
    void attachAuthorizationSuccessContext(context).catch((error) => {
      console.error('[auth] authorization context attachment failed', error);
    });
  });
  // Terminated by nginx on the deployment VM. oidc-provider exposes proxy
  // awareness ONLY via this instance setter (there is no constructor option):
  // without it the provider ignores X-Forwarded-Proto/Host, treats traffic
  // as plain HTTP against the HTTPS issuer, and emits http:// redirects.
  // GATED on AUTH_TRUST_PROXY_HEADERS: forwarding headers are only honored
  // when the deployment actually sits behind the trusted proxy, otherwise a
  // direct client could spoof proto/host via headers.
  instance.proxy = config.trustProxyHeaders;

  // Fail closed BEFORE serving anything: encrypted registry secrets that the
  // configured key cannot decrypt mean operator error, not a degraded mode.
  await assertClientSecretsDecryptable();

  // Migrate legacy plaintext registry secrets to ciphertext at boot (count
  // logged only). No-op when no encryption key is configured.
  await reencryptPlaintextSecretsOnBoot();

  // Mirror every enabled registered client into the Redis Client store so
  // adapter-based Client.find() resolves them for the running process, then
  // load the per-app session-TTL mirror used by the synchronous ttl callback.
  const clientMirror = providerClientAdapter(new RedisAdapter('Client', redis));
  await syncAllClientsOnBoot(clientMirror, redis, [config.clientId]);
  await refreshSessionTtlCache().catch((error) => {
    console.error('[auth] session ttl cache boot load failed', error);
  });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', config.issuer);
    const path = url.pathname;

    if (path === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if ((req.method === 'GET' || req.method === 'HEAD') && path === '/') {
      const entries: CatalogEntryView[] = await listPublishedCatalogEntries().catch((error) => {
        console.error('[auth] application catalog lookup failed', error);
        return [];
      });
      const bootstrap = configuredBootstrapApplication(config.clientId, config.redirectUris);
      if (bootstrap && !entries.some((entry) => entry.oidcClientId === config.clientId)) {
        entries.unshift(bootstrap);
      }
      const body = renderApplicationLanding(entries);
      res.writeHead(200, PUBLIC_UI_HEADERS);
      res.end(req.method === 'HEAD' ? undefined : body);
      return;
    }

    // A person opening the authorization endpoint directly did not start an
    // OIDC request. Send them to the application directory instead of the
    // provider's protocol-oriented invalid_request page.
    if (req.method === 'GET' && path === '/auth' && url.searchParams.size === 0) {
      res.writeHead(303, { Location: '/', 'Cache-Control': 'no-store' });
      res.end();
      return;
    }

    if (path.startsWith('/ui/fonts/')) {
      if (req.method !== 'GET') {
        res.writeHead(405, { Allow: 'GET', 'Cache-Control': 'no-store' });
        res.end();
        return;
      }
      const font = loadUiFont(path);
      if (!font) {
        res.writeHead(404, {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        });
        res.end('Not found');
        return;
      }
      const body = await font;
      res.writeHead(200, {
        'Content-Type': 'font/woff2',
        'Content-Length': String(body.length),
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Cross-Origin-Resource-Policy': 'same-origin',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(body);
      return;
    }

    // Portal-initiated full logout: destroys the provider session the portal
    // recorded at callback time so a subsequent /auth cannot silently SSO.
    if (path === '/session/backchannel-logout') {
      await handleBackchannelLogout(req, res);
      return;
    }

    // Auth Manager client registry (portal admin proxy target).
    const clientsMatch = /^\/internal\/clients(?:\/([A-Za-z0-9_-]+))?$/.exec(path);
    if (clientsMatch) {
      await handleInternalClients(req, res, req.method ?? 'GET', clientsMatch[1]);
      return;
    }

    // First-party Auth Manager console. AD operators use the deployment
    // allowlist/groups; optional local recovery identities belong only here.
    if (path === '/admin' || path.startsWith('/admin/')) {
      await handleAdminRoutes(req, res, config, path);
      return;
    }

    // Token-guarded internal branding API (compose network only; never
    // proxied publicly — see docs/deploy/nginx-auth.example.conf).
    const brandingMatch = INTERNAL_BRANDING_PATH_PATTERN.exec(path);
    if (brandingMatch) {
      await handleInternalBrandingRequest(req, res, brandingMatch[1] ?? '', config);
      return;
    }

    const interactionMatch = /^\/interaction\/([A-Za-z0-9_-]+)(\/change-password)?$/.exec(path);
    if (interactionMatch) {
      const uid = interactionMatch[1] ?? '';
      const isChange = Boolean(interactionMatch[2]);
      try {
        if (req.method === 'GET' && !isChange) {
          await handleInteractionGet(req, res, uid);
        } else if (req.method === 'POST' && !isChange) {
          await handleInteractionPost(req, res, uid);
        } else if (req.method === 'POST' && isChange) {
          await handleChangePasswordPost(req, res, uid);
        } else {
          res.writeHead(405).end();
        }
      } catch (error) {
        console.error('[auth] interaction handling failed', error);
        if (!res.writableEnded) {
          res.writeHead(500, { 'Content-Type': 'text/html', ...interactionHeaders() });
          res.end(await renderErrorPage('An unexpected error occurred during sign-in.'));
        }
      }
      return;
    }

    // oidc-provider owns an independent RP-initiated logout emitter. Never
    // delegate this path for an attested production clone because it can POST
    // to registered relying-party back-channel logout URIs.
    if (path === '/session/end_session' && isProductionCloneReadOnly()) {
      res.writeHead(403, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify({ error: 'disabled_in_clone_mode' }));
      return;
    }

    // provider.callback() is a FACTORY: it returns the node request handler.
    const handleProviderRequest = provider.callback();
    try {
      await handleProviderRequest(req, res);
    } catch (error) {
      console.error('[auth] provider callback failed', error);
      if (!res.writableEnded) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'server_error' }));
      }
    }
  });

  server.listen(config.port, () => {
    console.log(`[auth] OIDC provider listening on port ${config.port} (issuer ${config.issuer})`);
  });
}

main().catch((error) => {
  console.error('[auth] fatal startup error', error);
  process.exit(1);
});
