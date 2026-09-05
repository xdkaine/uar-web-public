import {
  createPublicKey,
  verify as cryptoVerify,
  type JsonWebKey,
  type KeyObject,
} from 'node:crypto';
import { getOidcRuntimeConfig } from './oidc';
import { appLogger } from '@/lib/logger';

/**
 * Receiver-side validation for IdP-initiated OIDC Back-Channel Logout
 * (issue #36). The signed logout_token is the ONLY authentication on this
 * surface, so every check is mandatory before any session state changes:
 * RS256 signature against the provider JWKS, iss, aud, iat skew, the
 * backchannel-logout event membership, absence of nonce, and a usable sid.
 * Any failure returns null - the route maps that to a generic 400 with no
 * side effects. Replayed tokens (reused jti) are deliberately tolerated:
 * dedupe happens through sid revocation semantics, not a jti store.
 */

const BACKCHANNEL_LOGOUT_EVENT = 'http://schemas.openid.net/event/backchannel-logout';
const RS256 = 'RS256';
const CLOCK_SKEW_SECONDS = 300;
const JWKS_CACHE_TTL_MS = 5 * 60 * 1000;

export interface ValidLogoutToken {
  sid: string;
}

interface JwtHeader {
  alg?: string;
  kid?: string;
}

interface LogoutClaims {
  iss?: unknown;
  aud?: unknown;
  iat?: unknown;
  sid?: unknown;
  nonce?: unknown;
  events?: unknown;
}

let jwksCache: { keys: JsonWebKey[]; fetchedAt: number } | null = null;

/** Test seam: clears the module-level JWKS cache between scenarios. */
export function resetBackchannelJwksCache(): void {
  jwksCache = null;
}

function decodeSegment(segment: string): Buffer {
  return Buffer.from(segment, 'base64url');
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    cache: 'no-store',
    signal: AbortSignal.timeout(2500),
  });
  if (!response.ok) {
    throw new Error(`Fetch failed (${response.status})`);
  }
  return response.json();
}

async function loadProviderKeys(
  runtime: NonNullable<ReturnType<typeof getOidcRuntimeConfig>>,
  forceRefresh: boolean
): Promise<JsonWebKey[]> {
  if (
    !forceRefresh &&
    jwksCache &&
    Date.now() - jwksCache.fetchedAt < JWKS_CACHE_TTL_MS
  ) {
    return jwksCache.keys;
  }

  const base = (runtime.internalBaseUrl || runtime.issuer).replace(/\/$/, '');
  const metadata = (await fetchJson(`${base}/.well-known/openid-configuration`)) as {
    jwks_uri?: unknown;
  };
  let jwksUri = typeof metadata.jwks_uri === 'string' ? metadata.jwks_uri : '';
  if (!jwksUri) {
    throw new Error('Discovery carried no jwks_uri');
  }

  // Mirror the oidc.ts rewrite: server-to-server calls go over the internal
  // compose network when configured.
  if (runtime.internalBaseUrl) {
    const external = runtime.issuer.replace(/\/$/, '');
    const internal = runtime.internalBaseUrl.replace(/\/$/, '');
    if (jwksUri.startsWith(external)) {
      jwksUri = internal + jwksUri.slice(external.length);
    }
  }

  const jwks = (await fetchJson(jwksUri)) as { keys?: unknown };
  const keys = Array.isArray(jwks.keys) ? (jwks.keys as JsonWebKey[]) : [];
  jwksCache = { keys, fetchedAt: Date.now() };
  return keys;
}

function selectVerificationKey(keys: JsonWebKey[], kid: string | undefined): KeyObject | null {
  const rsaKeys = keys.filter((key) => key.kty === 'RSA');
  if (kid) {
    const matched = rsaKeys.find((key) => key.kid === kid);
    return matched ? createPublicKey({ key: matched, format: 'jwk' }) : null;
  }
  if (rsaKeys.length === 1) {
    return createPublicKey({ key: rsaKeys[0], format: 'jwk' });
  }
  return null;
}

export async function validateBackchannelLogoutToken(
  logoutToken: string | undefined | null
): Promise<ValidLogoutToken | null> {
  if (!logoutToken || typeof logoutToken !== 'string') {
    return null;
  }

  const parts = logoutToken.split('.');
  if (parts.length !== 3 || parts.some((segment) => segment.length === 0)) {
    return null;
  }

  let header: JwtHeader | null;
  let claims: LogoutClaims | null;
  try {
    header = JSON.parse(decodeSegment(parts[0]).toString('utf8')) as JwtHeader;
    claims = JSON.parse(decodeSegment(parts[1]).toString('utf8')) as LogoutClaims;
  } catch {
    return null;
  }

  if (!header || !claims) {
    return null;
  }

  if (header.alg !== RS256) {
    return null;
  }

  const runtime = getOidcRuntimeConfig();
  if (!runtime) {
    return null;
  }

  let verificationKey: KeyObject | null = null;
  try {
    let keys = await loadProviderKeys(runtime, false);
    verificationKey = selectVerificationKey(keys, header.kid);
    if (!verificationKey && header.kid) {
      // Unknown kid usually means provider key rotation: refresh once.
      keys = await loadProviderKeys(runtime, true);
      verificationKey = selectVerificationKey(keys, header.kid);
    }
  } catch (error) {
    appLogger.warn('[Oidc] Back-channel logout: unable to load provider JWKS', {
      error: error instanceof Error ? error.message : 'unknown',
    });
    return null;
  }

  if (!verificationKey) {
    return null;
  }

  const signed = `${parts[0]}.${parts[1]}`;
  let signature: Buffer;
  try {
    signature = decodeSegment(parts[2]);
  } catch {
    return null;
  }
  const signatureValid = cryptoVerify(
    'RSA-SHA256',
    Buffer.from(signed),
    verificationKey,
    signature
  );
  if (!signatureValid) {
    return null;
  }

  if (claims.iss !== runtime.issuer) {
    return null;
  }

  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(runtime.clientId)) {
    return null;
  }

  if (
    typeof claims.iat !== 'number' ||
    !Number.isFinite(claims.iat) ||
    claims.iat > Date.now() / 1000 + CLOCK_SKEW_SECONDS
  ) {
    return null;
  }

  const events = claims.events;
  if (
    !events ||
    typeof events !== 'object' ||
    Array.isArray(events) ||
    !(BACKCHANNEL_LOGOUT_EVENT in (events as Record<string, unknown>))
  ) {
    return null;
  }

  // Spec: a logout_token MUST NOT contain a nonce claim - its presence means
  // an ID token (or forged look-alike), not a logout event.
  if ('nonce' in claims) {
    return null;
  }

  if (typeof claims.sid !== 'string' || !claims.sid) {
    return null;
  }

  return { sid: claims.sid };
}
