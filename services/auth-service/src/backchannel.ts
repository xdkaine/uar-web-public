import { createHash, timingSafeEqual } from 'node:crypto';
import type { RedisAdapter } from './adapter';

/**
 * Backchannel session destroy (portal-initiated full logout). The portal
 * calls this server-to-server after revoking its own session so the IdP
 * session dies with it - otherwise the next /auth request silently SSOs the
 * user back in.
 *
 * Authentication reuses the OIDC client credentials (client_secret_basic):
 * the portal already holds them, and no second secret surface is introduced.
 */

const SID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

/** Minimal Redis surface needed for the session-sid scan fallback. */
export interface ScanCapableRedis {
    get(key: string): Promise<string | null>;
    del(...keys: string[]): Promise<unknown>;
    /**
     * Yields matching keys. node-redis v4 yields single strings while v5
     * yields per-CALL batches (string[]); both are accepted.
     */
    scanIterator?(opts: { MATCH: string; COUNT: number }): AsyncIterable<string | string[]>;
}

function safeEqual(a: string, b: string): boolean {
  // Hash both sides to equalize length before timingSafeEqual; comparing the
  // digests leaks nothing about which prefix matched.
  const da = createHash('sha256').update(a).digest();
  const db = createHash('sha256').update(b).digest();
  return timingSafeEqual(da, db);
}

export function verifyClientCredentials(
  authorizationHeader: string | string[] | undefined,
  expectedClientId: string,
  expectedClientSecret: string
): boolean {
  const header = Array.isArray(authorizationHeader)
    ? authorizationHeader[0]
    : authorizationHeader;
  if (!header || !header.startsWith('Basic ')) {
    return false;
  }
  let decoded: string;
  try {
    decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  } catch {
    return false;
  }
  const separator = decoded.indexOf(':');
  if (separator < 0) {
    return false;
  }
  const clientId = decoded.slice(0, separator);
  const clientSecret = decoded.slice(separator + 1);
  return (
    safeEqual(clientId, expectedClientId) && safeEqual(clientSecret, expectedClientSecret)
  );
}

export function parseBackchannelBody(
  body: Record<string, string>
): { sid: string } | null {
  if (typeof body.sid !== 'string') {
    return null;
  }
  const sid = body.sid.trim();
  if (!SID_PATTERN.test(sid)) {
    return null;
  }
  return { sid };
}

/**
 * Destroy the provider session whose PER-CLIENT sid matches. The ID token
 * `sid` claim (what the portal records) is authorizations.<clientId>.sid,
 * NOT the adapter's internal payload.uid used by findByUid - so resolve by
 * scanning live Session payloads. Linear scan is acceptable here: sessions
 * are bounded by the deployment's active-user count.
 */
export async function destroySessionByClientSid(
  redis: ScanCapableRedis,
  sid: string,
  clientId: string,
  adapter: Pick<RedisAdapter, 'destroy'>
): Promise<boolean> {
  if (!redis.scanIterator) {
    return false;
  }
  for await (const chunk of redis.scanIterator({ MATCH: 'oidc:Session:*', COUNT: 100 })) {
    // node-redis v5 yields batches; v4 and test doubles yield single keys.
    for (const key of Array.isArray(chunk) ? chunk : [chunk]) {
      // Skip secondary indexes; only primary Session records carry payloads.
      if (key.includes(':uid:') || key.includes(':userCode:')) {
        continue;
      }
      const raw = await redis.get(key);
      if (!raw) continue;
      let payload: {
        jti?: unknown;
        kind?: unknown;
        authorizations?: Record<string, { sid?: unknown } | undefined>;
      };
      try {
        payload = JSON.parse(raw);
      } catch {
        continue;
      }
      if (payload.kind !== 'Session' || typeof payload.jti !== 'string') {
        continue;
      }
      const authorization = payload.authorizations?.[clientId];
      if (authorization && authorization.sid === sid) {
        await adapter.destroy(payload.jti);
        return true;
      }
    }
  }
  return false;
}
