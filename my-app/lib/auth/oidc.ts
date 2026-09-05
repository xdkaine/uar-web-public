import { randomBytes } from 'node:crypto';
import * as oidc from 'openid-client';
import { getSafeRelativeRedirect } from '@/lib/safe-redirect';
import { appLogger } from '@/lib/logger';

/**
 * OIDC relying-party helpers (ADR-0012). The portal authenticates via
 * authorization code + PKCE against the standalone auth service; identity is
 * exchanged once at the callback, then the portal mints its own opaque
 * session exactly like the native path. No roles travel in tokens.
 */

export const OIDC_STATE_COOKIE = 'oidc_state';
export const OIDC_VERIFIER_COOKIE = 'oidc_verifier';
export const OIDC_NONCE_COOKIE = 'oidc_nonce';
export const OIDC_REDIRECT_COOKIE = 'oidc_redirect';
export const OIDC_COOKIE_MAX_AGE_SECONDS = 600;
export const OIDC_PROVIDER_REQUEST_TIMEOUT_MS = 3_000;

export interface OidcRuntimeConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /**
   * Server-side base for token/discovery calls from INSIDE the compose
   * network (e.g. http://auth-service:3003). The ISSUER identity and the
   * authorization endpoint stay browser-facing; only server-to-server calls
   * are mirrored onto this base. Absent => the issuer itself is used.
   */
  internalBaseUrl?: string;
}

export function getOidcRuntimeConfig(): OidcRuntimeConfig | null {
  const issuer = process.env.AUTH_ISSUER?.trim();
  if (!issuer) return null;
  return {
    issuer,
    clientId: process.env.AUTH_CLIENT_ID?.trim() || 'uar-portal',
    clientSecret: process.env.AUTH_CLIENT_SECRET?.trim() || '',
    redirectUri:
      process.env.AUTH_REDIRECT_URI?.trim() ||
      `${process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? 'http://localhost:3002'}/api/auth/oidc/callback`,
    internalBaseUrl: process.env.OIDC_INTERNAL_ISSUER_URL?.trim() || undefined,
  };
}

/** Runtime readiness is independent from portal method selection. */
export function isOidcRuntimeReady(): boolean {
  const config = getOidcRuntimeConfig();
  return !!config?.clientSecret && !!config.issuer && !!config.clientId && !!config.redirectUri;
}

/** Legacy AUTH_MODE helper retained only for pre-policy compatibility. */
export function isOidcEnabled(): boolean {
  if (process.env.AUTH_MODE !== 'oidc') return false;
  return isOidcRuntimeReady();
}

interface ProviderMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  [key: string]: unknown;
}

export type OidcProviderFailureReason =
  | 'connect_timeout'
  | 'connection_refused'
  | 'connection_reset'
  | 'dns_failure'
  | 'network_unreachable'
  | 'tls_failure'
  | 'http_error'
  | 'invalid_metadata'
  | 'issuer_mismatch'
  | 'unknown_failure';

export class OidcProviderAvailabilityError extends Error {
  constructor(
    public readonly reason: OidcProviderFailureReason,
    public readonly qualifiesForOutageFallback: boolean,
    message: string
  ) {
    super(message);
    this.name = 'OidcProviderAvailabilityError';
  }
}

export type OidcProviderAvailability =
  | { available: true }
  | {
      available: false;
      reason: OidcProviderFailureReason;
      qualifiesForOutageFallback: boolean;
    };

function readErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const direct = 'code' in error && typeof error.code === 'string' ? error.code : null;
  if (direct) return direct;
  const cause = 'cause' in error ? error.cause : null;
  return cause && typeof cause === 'object' && 'code' in cause && typeof cause.code === 'string'
    ? cause.code
    : null;
}

function classifyProviderFetchFailure(error: unknown): OidcProviderAvailabilityError {
  if (error instanceof OidcProviderAvailabilityError) return error;
  if (error instanceof DOMException && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    return new OidcProviderAvailabilityError('connect_timeout', true, 'OIDC provider connection timed out');
  }
  const code = readErrorCode(error)?.toUpperCase();
  if (code === 'ECONNREFUSED') {
    return new OidcProviderAvailabilityError('connection_refused', true, 'OIDC provider refused the connection');
  }
  if (code === 'ECONNRESET') {
    return new OidcProviderAvailabilityError('connection_reset', true, 'OIDC provider reset the connection');
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return new OidcProviderAvailabilityError('dns_failure', true, 'OIDC provider name could not be resolved');
  }
  if (code === 'ETIMEDOUT' || code === 'EHOSTUNREACH' || code === 'ENETUNREACH') {
    return new OidcProviderAvailabilityError('network_unreachable', true, 'OIDC provider network is unreachable');
  }
  if (code && (code.includes('CERT') || code.includes('TLS') || code.includes('SSL'))) {
    return new OidcProviderAvailabilityError('tls_failure', false, 'OIDC provider TLS validation failed');
  }
  return new OidcProviderAvailabilityError('unknown_failure', false, 'OIDC provider probe failed');
}

// Logged once per process so operators notice the RFC 9207 workaround is
// active (and remember to remove it once the proxy stops rewriting responses).
let warnedIssuerParamStrip = false;

/**
 * Fetch the provider's discovery document. When OIDC_INTERNAL_ISSUER_URL is
 * set, the document is fetched over the internal compose network and every
 * SERVER-called endpoint (token, revocation) is rewritten onto that base;
 * `issuer` and `authorization_endpoint` stay browser-facing so redirects and
 * ID-token `iss` validation are unchanged.
 */
async function fetchProviderMetadata(
  runtime: OidcRuntimeConfig,
  timeoutMs?: number
): Promise<ProviderMetadata> {
  const base = runtime.internalBaseUrl || runtime.issuer;
  let response: Response;
  try {
    response = await fetch(`${base.replace(/\/$/, '')}/.well-known/openid-configuration`, {
      cache: 'no-store',
      ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
    });
  } catch (error) {
    throw classifyProviderFetchFailure(error);
  }
  if (!response.ok) {
    throw new OidcProviderAvailabilityError(
      'http_error',
      false,
      `OIDC discovery returned HTTP ${response.status}`
    );
  }
  let metadata: ProviderMetadata;
  try {
    metadata = (await response.json()) as ProviderMetadata;
  } catch {
    throw new OidcProviderAvailabilityError('invalid_metadata', false, 'OIDC discovery was not valid JSON');
  }
  if (
    !metadata
    || typeof metadata.issuer !== 'string'
    || typeof metadata.authorization_endpoint !== 'string'
    || typeof metadata.token_endpoint !== 'string'
  ) {
    throw new OidcProviderAvailabilityError('invalid_metadata', false, 'OIDC discovery metadata is incomplete');
  }
  if (metadata.issuer.replace(/\/$/, '') !== runtime.issuer.replace(/\/$/, '')) {
    throw new OidcProviderAvailabilityError('issuer_mismatch', false, 'OIDC discovery issuer did not match configuration');
  }
  if (runtime.internalBaseUrl) {
    const external = runtime.issuer.replace(/\/$/, '');
    const internal = runtime.internalBaseUrl.replace(/\/$/, '');
    for (const key of Object.keys(metadata)) {
      const value = metadata[key];
      if (typeof value === 'string' && value.startsWith(external)) {
        metadata[key] = internal + value.slice(external.length);
      }
    }
    // Keep identity fields browser-facing after the rewrite above.
    metadata.issuer = external;
    if (typeof metadata.authorization_endpoint === 'string') {
      metadata.authorization_endpoint = external + '/auth';
    }
  }
  // oidc-provider advertises RFC 9207 issuer identification, which makes
  // oauth4webapi REQUIRE an `iss` query parameter on every authorization
  // response and strict-compare it against the issuer. The TLS-terminating
  // proxy rewrites Location headers (observed: a trailing slash injected
  // into the percent-encoded iss value), so the comparison fails and every
  // code exchange dies with "invalid response encountered". Drop the flag so
  // iss is neither required nor compared; the callback stays bound by state,
  // PKCE, and nonce against a single configured IdP. Remove this once the
  // proxy stops rewriting authorization responses.
  if (metadata.authorization_response_iss_parameter_supported === true) {
    if (!warnedIssuerParamStrip) {
      warnedIssuerParamStrip = true;
      console.warn(
        '[Oidc] Provider enforces RFC 9207 iss response parameters; stripping enforcement because the fronting proxy rewrites authorization responses'
      );
    }
  }
  delete metadata.authorization_response_iss_parameter_supported;
  return metadata;
}

/**
 * Bounded server-side readiness probe used only for outage-circuit decisions.
 * Automatic fallback requires the explicit internal issuer mirror so reverse
 * proxy responses, public TLS failures, and browser-only failures cannot be
 * mistaken for a safe credential-path downgrade.
 */
export async function probeOidcProviderAvailability(timeoutMs = 1500): Promise<OidcProviderAvailability> {
  const runtime = getOidcRuntimeConfig();
  if (!runtime?.internalBaseUrl) {
    return { available: false, reason: 'unknown_failure', qualifiesForOutageFallback: false };
  }
  try {
    await fetchProviderMetadata(runtime, timeoutMs);
    return { available: true };
  } catch (error) {
    const classified = classifyProviderFetchFailure(error);
    return {
      available: false,
      reason: classified.reason,
      qualifiesForOutageFallback: classified.qualifiesForOutageFallback,
    };
  }
}

async function discover(runtime: OidcRuntimeConfig) {
  // Provider discovery participates in the guarded outage circuit. It must
  // never hang indefinitely on a black-holed socket, and its typed timeout is
  // preserved so the login-start route can count qualifying evidence.
  const metadata = await fetchProviderMetadata(runtime, OIDC_PROVIDER_REQUEST_TIMEOUT_MS);

  // Client metadata MUST carry the redirect_uris: discovery has no client
  // registration data, and without it openid-client sends no redirect_uri at
  // the token endpoint - the provider then rejects the grant with a
  // redirect_uri mismatch.
  const config = new oidc.Configuration(
    metadata as never,
    runtime.clientId,
    {
      client_secret: runtime.clientSecret,
      redirect_uris: [runtime.redirectUri],
    },
  );

  // Plain-HTTP issuers are only permitted behind this EXPLICIT operator-set
  // flag (local / trusted-network deployments without a TLS-terminating
  // proxy). Never enable it where the auth traffic crosses an untrusted
  // path - production terminates TLS at nginx and leaves this unset.
  if (process.env.AUTH_ALLOW_INSECURE_OIDC === 'true') {
    console.warn(
      '[Oidc] AUTH_ALLOW_INSECURE_OIDC=true - plain-HTTP issuer permitted; TLS must be handled by the surrounding network'
    );
    oidc.allowInsecureRequests(config);
  }

  return config;
}

function randomValue(bytes = 32): string {
  // randomBytes, NOT new Uint8Array(bytes): the latter is zero-filled and
  // would emit a CONSTANT OIDC state/nonce for every login.
  return randomBytes(bytes).toString('base64url');
}

export interface PreparedLogin {
  authorizationUrl: URL;
  state: string;
  codeVerifier: string;
  nonce: string;
  redirectPath: string;
}

/** Build the authorization redirect plus the values that must be cookie-stashed. */
export async function prepareLogin(
  requestedRedirect: string | null | undefined,
  origin: string
): Promise<PreparedLogin> {
  const runtime = getOidcRuntimeConfig();
  if (!runtime) throw new Error('OIDC is not configured');

  const discovery = await discover(runtime);
  const state = randomValue();
  const codeVerifier = oidc.randomPKCECodeVerifier();
  const nonce = randomValue(24);

  // Only internal relative paths survive this helper; anything else falls
  // back to the portal root so the IdP can never be used as an open redirect.
  const redirectPath = getSafeRelativeRedirect(requestedRedirect) ?? '/instructions';

  const authorizationUrl = oidc.buildAuthorizationUrl(discovery, {
    redirect_uri: `${origin.replace(/\/$/, '')}${callbackPath()}`,
    scope: 'openid email profile amr',
    state,
    nonce,
    code_challenge: await oidc.calculatePKCECodeChallenge(codeVerifier),
    code_challenge_method: 'S256',
  });

  return { authorizationUrl, state, codeVerifier, nonce, redirectPath };
}

export function callbackPath(): string {
  return '/api/auth/oidc/callback';
}

/**
 * Browser-facing base URL for building redirects. Resolution order:
 *   1. OIDC_BROWSER_BASE_URL (local deployments where NEXT_PUBLIC_APP_URL
 *      points at the production hostname)
 *   2. NEXT_PUBLIC_APP_URL (production)
 * Request-supplied Host headers are NEVER trusted: an attacker-controlled
 * Host must not steer authorization redirects or callback construction.
 * Env validation requires an explicit base URL whenever OIDC mode is
 * enabled, so absence of both variables fails loud here.
 */
export function portalBaseUrl(): string {
  const browserOverride = process.env.OIDC_BROWSER_BASE_URL?.trim();
  if (browserOverride) return browserOverride.replace(/\/$/, '');
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) return configured.replace(/\/$/, '');
  throw new Error(
    'OIDC browser-facing base URL is not configured: set NEXT_PUBLIC_APP_URL or OIDC_BROWSER_BASE_URL'
  );
}

export interface ExchangedIdentity {
  username: string;
  amr: string[];
  /**
   * Provider session uid from the ID token. Persisted with the portal session
   * so logout can destroy the IdP session via backchannel - without it the
   * next /auth request silently SSOs the user back in.
   */
  sid?: string;
  /** Signed auth-service session expiry, as Unix seconds. */
  providerSessionExpiresAt?: number;
}

/**
 * Validate the callback against the stashed cookies and return the verified
 * identity. Throws on any mismatch - callers translate that into a generic
 * sign-in failure without leaking which check failed.
 */
export async function exchangeCallback(input: {
  callbackUrl: URL;
  expectedState: string | undefined;
  codeVerifier: string | undefined;
  expectedNonce: string | undefined;
}): Promise<ExchangedIdentity> {
  const runtime = getOidcRuntimeConfig();
  if (!runtime) throw new Error('OIDC is not configured');
  // State, PKCE verifier, and nonce are all mandatory: the login route always
  // sets them, so a missing one means tampering or an expired flow.
  if (!input.expectedState || !input.codeVerifier || !input.expectedNonce) {
    throw new Error('Missing login state');
  }

  // Drop the RFC 9207 `iss` response parameter before validation. The
  // TLS-terminating proxy rewrites Location query values (observed: trailing
  // slash injected into the percent-encoded iss), so oauth4webapi's strict
  // `iss !== issuer` comparison rejects every genuine callback. Combined with
  // the metadata flag strip above, iss is neither required nor compared; the
  // response stays bound by state, PKCE, and nonce against the single
  // configured IdP. Remove once the proxy stops rewriting responses.
  input.callbackUrl.searchParams.delete('iss');

  const discovery = await discover(runtime);

  try {
    const tokens = await oidc.authorizationCodeGrant(discovery, input.callbackUrl, {
      pkceCodeVerifier: input.codeVerifier,
      expectedState: input.expectedState,
      expectedNonce: input.expectedNonce,
    });

    const claims = tokens.claims();
    const username = typeof claims?.preferred_username === 'string'
      ? claims.preferred_username
      : typeof claims?.sub === 'string'
        ? claims.sub
        : '';
    if (!username) {
      throw new Error('Token carried no usable subject');
    }

    const amrRaw = (claims as { amr?: unknown }).amr;
    const amr = Array.isArray(amrRaw) ? amrRaw.map((entry) => String(entry)) : [];

    const sidRaw = (claims as { sid?: unknown }).sid;
    const sid = typeof sidRaw === 'string' && sidRaw ? sidRaw : undefined;
    const providerExpiryRaw = (claims as { provider_session_expires_at?: unknown }).provider_session_expires_at;
    const providerSessionExpiresAt = typeof providerExpiryRaw === 'number'
      && Number.isSafeInteger(providerExpiryRaw)
      && providerExpiryRaw > 0
      ? providerExpiryRaw
      : undefined;

    appLogger.info('[Oidc] Authorization code exchange complete', {
      username,
      amr,
      hasProviderSession: Boolean(sid),
      hasProviderSessionExpiry: Boolean(providerSessionExpiresAt),
    });
    return { username: username.toLowerCase(), amr, sid, providerSessionExpiresAt };
  } catch (error) {
    // openid-client wraps the specific oauth4webapi reason (state mismatch,
    // missing iss parameter, malformed token body...) inside ClientError.cause;
    // log the chain or all exchanges fail as the same opaque string.
    const cause = error instanceof Error ? error.cause : undefined;
    appLogger.warn('[Oidc] Code exchange failed', {
      error: error instanceof Error ? error.message : 'unknown',
      errorCode:
        error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
          ? error.code
          : undefined,
      causeMessage: cause instanceof Error ? cause.message : undefined,
    });
    throw new Error('Sign-in could not be completed');
  }
}
