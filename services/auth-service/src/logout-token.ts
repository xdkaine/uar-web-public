import { randomUUID, sign as rsaSign } from 'node:crypto';
import type { LogoutSigningKey } from './jwks';
import { isProductionCloneReadOnly } from './clone-safety';

/**
 * IdP-initiated OIDC Back-Channel Logout emitter (audit-only v1: no retry
 * queue). After admin destroy paths kill provider sessions, each destroyed
 * session's (clientId, sid) authorization gets a signed logout_token POSTed
 * to the RP's registered backchannel_logout_uri. Per-RP outcomes are always
 * returned so they can be durably audited on the IdP side; delivery failures
 * never fail the destruction that already succeeded.
 *
 * Tokens reuse the provider's own JWKS (see jwks.ts), so RPs verify them
 * against the published /.well-known/jwks.json. Per the Back-Channel Logout
 * spec, `nonce` is never included and `sub` is only present when known.
 */

export const BACKCHANNEL_LOGOUT_EVENT = 'http://schemas.openid.net/event/backchannel-logout';

/** Parity with oidc-provider's own logout tokens (short-lived replay guard). */
const TOKEN_TTL_SECONDS = 120;
export const DELIVERY_TIMEOUT_MS = 5000;

export type DeliveryOutcome = 'delivered' | 'rejected' | 'unreachable';

export interface DeliveryRecord {
  clientId: string;
  outcome: DeliveryOutcome;
  status?: number;
}

/** One destroyed session authorization: subject is omitted when unknown. */
export interface DestroyedAuthorization {
  clientId: string;
  sid: string | null;
  subject: string | null;
}

interface MinimalResponse {
  status: number;
}

export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
  }
) => Promise<MinimalResponse>;

function b64u(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

export function mintBackchannelLogoutToken(
  signing: LogoutSigningKey,
  input: { issuer: string; clientId: string; sid: string; subject?: string | null },
  now: Date = new Date()
): string {
  const iat = Math.floor(now.getTime() / 1000);
  const payload: Record<string, unknown> = {
    iss: input.issuer,
    aud: input.clientId,
    iat,
    exp: iat + TOKEN_TTL_SECONDS,
    jti: randomUUID(),
    events: { [BACKCHANNEL_LOGOUT_EVENT]: {} },
  };
  if (input.subject) payload.sub = input.subject;
  payload.sid = input.sid;
  const header: Record<string, unknown> = { alg: 'RS256', typ: 'JWT' };
  if (signing.kid) header.kid = signing.kid;
  const signingInput = `${b64u(header)}.${b64u(payload)}`;
  const signature = rsaSign(
    'RSA-SHA256',
    Buffer.from(signingInput, 'ascii'),
    signing.privateKey
  );
  return `${signingInput}.${signature.toString('base64url')}`;
}

async function deliverLogoutToken(
  uri: string,
  token: string,
  fetchImpl: FetchLike,
  timeoutMs: number = DELIVERY_TIMEOUT_MS
): Promise<{ outcome: DeliveryOutcome; status?: number }> {
  try {
    const response = await fetchImpl(uri, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ logout_token: token }).toString(),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.status >= 200 && response.status < 300) {
      return { outcome: 'delivered', status: response.status };
    }
    return { outcome: 'rejected', status: response.status };
  } catch {
    return { outcome: 'unreachable' };
  }
}

/**
 * Push a signed back-channel logout for every unique (clientId, sid) pair.
 * Pairs without a resolvable sid cannot carry a spec-valid session logout and
 * are skipped; unknown RPs report `unreachable` so the audit shows reality.
 */
export async function pushBackchannelLogouts(options: {
  pairs: readonly DestroyedAuthorization[];
  issuer: string;
  signing: LogoutSigningKey;
  resolveUri: (clientId: string) => Promise<string | undefined>;
  fetchImpl?: FetchLike;
  now?: Date;
}): Promise<DeliveryRecord[]> {
  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as FetchLike);
  const targets = new Map<string, DestroyedAuthorization>();
  for (const pair of options.pairs) {
    if (!pair.sid) continue;
    targets.set(`${pair.clientId}|${pair.sid}`, pair);
  }
  if (isProductionCloneReadOnly()) {
    return [...targets.values()].map((pair) => ({
      clientId: pair.clientId,
      outcome: 'unreachable',
    }));
  }
  return Promise.all(
    [...targets.values()].map(async (pair): Promise<DeliveryRecord> => {
      const sid = pair.sid as string;
      try {
        const uri = await options.resolveUri(pair.clientId);
        if (!uri) return { clientId: pair.clientId, outcome: 'unreachable' };
        const token = mintBackchannelLogoutToken(
          options.signing,
          { issuer: options.issuer, clientId: pair.clientId, sid, subject: pair.subject },
          options.now
        );
        const { outcome, status } = await deliverLogoutToken(uri, token, fetchImpl);
        return { clientId: pair.clientId, outcome, status };
      } catch (error) {
        console.error('[auth] back-channel logout push failed', error);
        return { clientId: pair.clientId, outcome: 'unreachable' };
      }
    })
  );
}
