import {
  createHash,
  createPrivateKey,
  generateKeyPairSync,
  type JsonWebKey,
  type KeyObject,
} from 'node:crypto';

/**
 * Single source of truth for the provider signing keys. The resolved JWK Set
 * is handed to oidc-provider's `jwks` option AND reused to sign OIDC
 * Back-Channel Logout tokens, so relying parties verify both against the one
 * published /.well-known/jwks.json - there is never a second keypair.
 *
 * AUTH_JWKS (JSON JWK Set, RSA signing key with private material) pins the
 * keys across restarts. Production fails closed when it is missing; local and
 * test processes may still use an ephemeral key.
 */

export const AUTH_JWKS_ENV = 'AUTH_JWKS';

const LOGOUT_TOKEN_ALG = 'RS256';

/** Private JWK members imported verbatim; everything else is stripped. */
const RSA_PRIVATE_MEMBERS = ['kty', 'n', 'e', 'd', 'p', 'q', 'dp', 'dq', 'qi'] as const;

export interface LogoutSigningKey {
  /** JWS header kid: configured kid, else the RFC 7638 thumbprint. */
  kid: string | undefined;
  privateKey: KeyObject;
}

export interface ResolvedProviderKeys {
  /** JWK Set for oidc-provider's `jwks` option (it publishes only public parts). */
  jwks: { keys: Array<Record<string, unknown>> };
  logout: LogoutSigningKey;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** RFC 7638 SHA-256 thumbprint over the required RSA members, base64url. */
function rfc7638Thumbprint(jwk: { n?: unknown; e?: unknown }): string {
  const canonical = JSON.stringify({ e: String(jwk.e), kty: 'RSA', n: String(jwk.n) });
  return createHash('sha256').update(canonical).digest('base64url');
}

function isRsaPrivateJwk(value: unknown): value is Record<string, string> {
  if (!isRecord(value)) return false;
  return (
    value.kty === 'RSA' &&
    typeof value.n === 'string' &&
    typeof value.e === 'string' &&
    typeof value.d === 'string'
  );
}

function toSigningKey(jwk: Record<string, string>): LogoutSigningKey {
  const minimal: Record<string, string> = {};
  for (const member of RSA_PRIVATE_MEMBERS) {
    const value = jwk[member];
    if (typeof value === 'string') minimal[member] = value;
  }
  const kid = jwk.kid ?? rfc7638Thumbprint(minimal);
  const privateKey = createPrivateKey({ key: minimal as unknown as JsonWebKey, format: 'jwk' });
  return { kid, privateKey };
}

/** Pure resolver: AUTH_JWKS when set, else a fresh per-call ephemeral RSA key. */
export function resolveProviderKeys(env: NodeJS.ProcessEnv = process.env): ResolvedProviderKeys {
  const raw = env[AUTH_JWKS_ENV]?.trim();
  if (!raw) {
    if (env.NODE_ENV === 'production') {
      throw new Error(`${AUTH_JWKS_ENV} is required in production`);
    }
    return generateEphemeral();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${AUTH_JWKS_ENV} must be a JSON Web Key Set`);
  }
  const keys = isRecord(parsed) && Array.isArray(parsed.keys) ? parsed.keys : [];
  const signing = keys.find(isRsaPrivateJwk);
  if (!signing) {
    throw new Error(`${AUTH_JWKS_ENV} must contain an RSA signing key with private material`);
  }
  return {
    jwks: {
      keys: keys.filter(isRecord).map((key) =>
        isRsaPrivateJwk(key) && !key.kid ? { ...key, kid: rfc7638Thumbprint(key) } : key
      ),
    },
    logout: toSigningKey(signing),
  };
}

function generateEphemeral(): ResolvedProviderKeys {
  // node:crypto supports JWK encodings at runtime; this @types/node release
  // only overloads pem/der, so pin the JWK shape explicitly.
  type JwkPairOptions = {
    modulusLength: number;
    publicKeyEncoding: { type: 'spki'; format: 'jwk' };
    privateKeyEncoding: { type: 'pkcs8'; format: 'jwk' };
  };
  const pair = (generateKeyPairSync as unknown as (
    type: 'rsa',
    options: JwkPairOptions
  ) => { publicKey: Record<string, string>; privateKey: Record<string, string> })('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'jwk' },
    privateKeyEncoding: { type: 'pkcs8', format: 'jwk' },
  });
  const kid = rfc7638Thumbprint(pair.publicKey);
  const fullPrivate = {
    kty: 'RSA',
    kid,
    use: 'sig',
    alg: LOGOUT_TOKEN_ALG,
    ...pair.publicKey,
    ...pair.privateKey,
  };
  return {
    jwks: { keys: [fullPrivate] },
    logout: {
      kid,
      privateKey: createPrivateKey({ key: fullPrivate as unknown as JsonWebKey, format: 'jwk' }),
    },
  };
}

let shared: ResolvedProviderKeys | undefined;

/** Resolve once per process; every consumer shares the same keys. */
export function sharedProviderKeys(): ResolvedProviderKeys {
  if (!shared) {
    shared = resolveProviderKeys();
  }
  return shared;
}
