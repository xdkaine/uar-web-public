/**
 * Environment contract for the auth service (ADR-0012). Fail fast at boot:
 * an OIDC issuer that cannot reach its directory or database is useless.
 */

import { AUTH_JWKS_ENV } from './jwks';
import { isProductionCloneReadOnly } from './clone-safety';

function required(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function optional(name: string, fallback = ''): string {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : fallback;
}

function productionSecret(name: string): string {
  const value = required(name);
  const normalized = value.toLowerCase();
  if (
    (process.env.NODE_ENV ?? '') === 'production'
    && (
      normalized.includes('replace_with')
      || normalized.includes('replace-me')
      || normalized.includes('changeme')
      || normalized.includes('example-secret')
      || normalized === 'password'
      || normalized === 'secret'
    )
  ) {
    throw new Error(`${name} must not use a known placeholder in production`);
  }
  return value;
}

/** Truthy env values ('1','true','yes', case-insensitive) for opt-in flags. */
function truthy(name: string): boolean {
  const value = process.env[name];
  if (!value) return false;
  return ['1', 'true', 'yes'].includes(value.trim().toLowerCase());
}

function boundedInteger(name: string, fallback: number, minimum: number, maximum: number): number {
  const raw = optional(name, String(fallback));
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

export interface AuthConfig {
  issuer: string;
  port: number;
  databaseUrl: string;
  redisUrl: string;
  /** Comma-separated signing keys for provider session cookies. */
  cookieKeys: string[];

  clientId: string;
  clientSecret: string;
  /** Portal callback URLs allowed to receive authorization codes. */
  redirectUris: string[];
  /**
   * Back-channel logout URI advertised for the bootstrap client. Registering
   * it (with backchannelLogoutSessionRequired) flips the provider's
   * Client.includeSid() so issued codes/ID tokens carry the session `sid`
   * claim the portal records for its full-logout backchannel. The provider
   * only POSTs to this URI from /session/end_session, which this deployment
   * does not use.
   */
  backchannelLogoutUri: string;
  /** Where the provider sends the browser after portal-initiated logout. */
  postLogoutRedirects: string[];

  ldapDomain: string;
  ldapUrl: string;
  ldapSearchBase: string;
  ldapBindDn: string;
  ldapBindPassword: string;
  /** Lab-only escape hatch; verification stays ON unless explicitly set. */
  allowInvalidCertificates: boolean;
  /**
   * Lab-only escape hatch (LDAP_ALLOW_INSECURE_TRANSPORT): permits a non-ldaps
   * LDAP_URL. Boot fails on anything but ldaps:// unless this is truthy.
   */
  allowInsecureTransport: boolean;

  turnstileSiteKey: string;
  turnstileSecretKey: string;

  /**
   * AUTH_TRUST_PROXY_HEADERS (default OFF): when OFF, client IPs are taken
   * from the socket address only and X-Forwarded-For/X-Real-IP are ignored
   * (spoof-proof for direct exposure). Enable ONLY behind the trusted reverse
   * proxy, which OVERWRITES X-Forwarded-For so the rightmost hop is ours.
   */
  trustProxyHeaders: boolean;

  /** Durable device evidence is opt-in and never blocks authentication. */
  deviceRiskMode: 'off' | 'shadow';
  /** HMAC key used to unlink raw browser/cookie identifiers from storage. */
  deviceEvidenceKey: string;
  /** Previous HMAC keys accepted only for matching during controlled rotation. */
  deviceEvidencePreviousKeys: string[];

  /** Fixed-window login rate limit per IP. */
  loginWindowMs: number;
  loginMaxAttempts: number;

  /**
   * Per-account lockout alongside the IP limiter: after this many failed
   * attempts for one username, further attempts are denied (with
   * wrong-password messaging) until the window passes.
   */
  accountLockWindowMs: number;
  accountLockMaxAttempts: number;

  /**
   * Shared secret for the internal branding API consumed by the portal
   * (GET/PUT profiles, preview rendering). Unset => endpoints fail closed.
   */
  internalBrandingToken: string;

  /**
   * AD usernames permitted to use the first-party /admin console. Empty =>
   * the whole console fails closed (404). Accounts are bound against AD on
   * every login; the allowlist only gates who may attempt it.
   */
  adminUsernames: string[];
  /** AD group allowlist (DN or CN). When set, membership grants console access. */
  adminGroups: string[];
  /** Enables Auth Manager-owned local recovery accounts for /admin only. */
  adminLocalRecoveryEnabled: boolean;
}

/**
 * Back-channel logout URI for a relying party, derived from its first
 * registered callback origin. Falls back to the raw first URI when it cannot
 * be parsed (loadConfig has already validated the list is non-empty).
 */
export function backchannelLogoutUriFor(redirectUris: string[]): string {
  const first = redirectUris[0];
  if (!first) return '';
  try {
    return `${new URL(first).origin}/api/auth/oidc/backchannel-logout`;
  } catch {
    return first;
  }
}

export function loadConfig(): AuthConfig {
  isProductionCloneReadOnly();
  // Transport policy (ADR-0012): the directory is reached over LDAPS only.
  // The explicit escape hatch exists for lab deployments without TLS certs.
  const ldapUrl = required('LDAP_URL');
  const allowInsecureTransport = truthy('LDAP_ALLOW_INSECURE_TRANSPORT');
  if (!ldapUrl.toLowerCase().startsWith('ldaps://') && !allowInsecureTransport) {
    throw new Error(
      'LDAP_URL must start with ldaps:// (credentials cross this connection). ' +
        'Set LDAP_ALLOW_INSECURE_TRANSPORT=true to override for lab use only.'
    );
  }

  // Production must have stable signing identity. A restart with an ephemeral
  // key invalidates outstanding tokens and defeats planned key rotation.
  if ((process.env.NODE_ENV ?? '') === 'production' && !optional(AUTH_JWKS_ENV)) {
    throw new Error(`${AUTH_JWKS_ENV} is required in production`);
  }

  const deviceRiskModeValue = optional('AUTH_DEVICE_RISK_MODE', 'off').toLowerCase();
  if (deviceRiskModeValue !== 'off' && deviceRiskModeValue !== 'shadow') {
    throw new Error('AUTH_DEVICE_RISK_MODE must be off or shadow; enforcement is not enabled');
  }
  const deviceEvidenceKey = optional('AUTH_DEVICE_EVIDENCE_KEY');
  const deviceEvidencePreviousKeys = optional('AUTH_DEVICE_EVIDENCE_PREVIOUS_KEYS')
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean);
  if (deviceRiskModeValue === 'shadow' && deviceEvidenceKey.length < 32) {
    throw new Error('AUTH_DEVICE_EVIDENCE_KEY must be at least 32 characters in shadow mode');
  }
  if (deviceEvidencePreviousKeys.some((key) => key.length < 32)) {
    throw new Error('Every AUTH_DEVICE_EVIDENCE_PREVIOUS_KEYS value must be at least 32 characters');
  }

  return {
    issuer: required('AUTH_ISSUER'),
    port: Number.parseInt(optional('AUTH_PORT', '3003'), 10),
    databaseUrl: required('DATABASE_URL'),
    redisUrl: optional('REDIS_URL', 'redis://redis:6379'),
    cookieKeys: productionSecret('AUTH_COOKIE_KEYS')
      .split(',')
      .map((key) => key.trim())
      .filter(Boolean),

    clientId: optional('OIDC_CLIENT_ID', 'uar-portal'),
    clientSecret: productionSecret('OIDC_CLIENT_SECRET'),
    redirectUris: optional(
      'OIDC_REDIRECT_URIS',
      'http://localhost:3002/api/auth/oidc/callback'
    )
      .split(',')
      .map((uri) => uri.trim())
      .filter(Boolean),
    postLogoutRedirects: optional('OIDC_POST_LOGOUT_URIS', 'http://localhost:3002')
      .split(',')
      .map((uri) => uri.trim())
      .filter(Boolean),

    backchannelLogoutUri: backchannelLogoutUriFor(
      optional(
        'OIDC_REDIRECT_URIS',
        'http://localhost:3002/api/auth/oidc/callback'
      )
        .split(',')
        .map((uri) => uri.trim())
        .filter(Boolean)
    ),

    ldapDomain: required('LDAP_DOMAIN'),
    ldapUrl,
    ldapSearchBase: required('LDAP_SEARCH_BASE'),
    ldapBindDn: optional('LDAP_BIND_DN', ''),
    ldapBindPassword: optional('LDAP_BIND_PASSWORD', ''),
    allowInvalidCertificates: optional('LDAP_ALLOW_INVALID_CERTS', 'false') === 'true',
    allowInsecureTransport,

    turnstileSiteKey: required('NEXT_PUBLIC_TURNSTILE_SITE_KEY'),
    turnstileSecretKey: required('TURNSTILE_SECRET_KEY'),

    trustProxyHeaders: truthy('AUTH_TRUST_PROXY_HEADERS'),

    deviceRiskMode: deviceRiskModeValue,
    deviceEvidenceKey,
    deviceEvidencePreviousKeys,

    loginWindowMs: boundedInteger('AUTH_LOGIN_WINDOW_MS', 900000, 1000, 3600000),
    loginMaxAttempts: boundedInteger('AUTH_LOGIN_MAX_ATTEMPTS', 20, 1, 1000),

    accountLockWindowMs: boundedInteger('AUTH_ACCOUNT_LOCK_WINDOW_MS', 900000, 1000, 3600000),
    accountLockMaxAttempts: boundedInteger('AUTH_ACCOUNT_LOCK_MAX_ATTEMPTS', 5, 1, 100),

    internalBrandingToken: optional('AUTH_INTERNAL_BRANDING_TOKEN'),

    adminGroups: optional('AUTH_ADMIN_GROUPS')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean),
    adminLocalRecoveryEnabled: truthy('AUTH_ADMIN_LOCAL_RECOVERY_ENABLED'),
    adminUsernames: optional('AUTH_ADMIN_USERNAMES')
      .split(',')
      .map((name) => name.trim().toLowerCase())
      .filter(Boolean),
  };
}
