import { appLogger } from '@/lib/logger';
import crypto from 'crypto';

/**
 * Server-to-server call to the auth service destroying the provider session
 * recorded at OIDC callback time (full logout). Fire-and-capped-await: logout
 * must succeed even when the IdP is unreachable.
 */

const BACKCHANNEL_PATH = '/session/backchannel-logout';
const BACKCHANNEL_TIMEOUT_MS = 2500;

function providerSidFingerprint(providerSid: string): string {
  return crypto.createHash('sha256').update(providerSid).digest('hex').slice(0, 16);
}

function internalIssuerBase(): string | null {
  return (
    process.env.OIDC_INTERNAL_ISSUER_URL?.trim() ||
    process.env.AUTH_ISSUER?.trim() ||
    null
  );
}

export interface BackchannelCredentials {
  clientId: string;
  clientSecret: string;
}

function readCredentials(): BackchannelCredentials | null {
  const clientId = process.env.AUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.AUTH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    // Native mode or unconfigured deployment: nothing to do by design.
    return null;
  }
  return { clientId, clientSecret };
}

/**
 * Authenticated server-to-server request to the auth service's internal API
 * (backchannel logout, client registry, ...). Returns null when the auth
 * service integration is not configured for this deployment.
 */
export async function authServiceInternalFetch(
  path: string,
  init: { method: string; body?: string }
): Promise<Response | null> {
  const base = internalIssuerBase();
  const credentials = readCredentials();
  if (!base || !credentials) {
    return null;
  }
  return fetch(`${base.replace(/\/$/, '')}${path}`, {
    method: init.method,
    headers: {
      Authorization: `Basic ${Buffer.from(
        `${credentials.clientId}:${credentials.clientSecret}`
      ).toString('base64')}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(init.body ? { body: init.body } : {}),
    signal: AbortSignal.timeout(BACKCHANNEL_TIMEOUT_MS),
    cache: 'no-store',
  });
}

/**
 * Tri-state outcome for a provider backchannel logout attempt:
 * - success: the auth service confirmed destruction of the provider session.
 * - failure: an attempt was made but the IdP could not confirm it (unreachable
 *   or rejected); the provider session survives until its own TTL.
 * - not-configured: nothing was attempted by design (no provider session link
 *   recorded, or the deployment has no auth-service integration).
 */
export type ProviderBackchannelOutcome = 'success' | 'failure' | 'not-configured';

export interface ProviderBackchannelResult {
  outcome: ProviderBackchannelOutcome;
  providerLogoutAttempted: boolean;
}

export async function requestProviderBackchannelLogoutDetailed(
  providerSid: string | null | undefined
): Promise<ProviderBackchannelResult> {
  if (!providerSid) {
    return { outcome: 'not-configured', providerLogoutAttempted: false };
  }
  const base = internalIssuerBase();
  const credentials = readCredentials();
  if (!base || !credentials) {
    return { outcome: 'not-configured', providerLogoutAttempted: false };
  }

  try {
    const response = await authServiceInternalFetch(BACKCHANNEL_PATH, {
      method: 'POST',
      body: JSON.stringify({ sid: providerSid }),
    });
    if (!response) {
      return { outcome: 'failure', providerLogoutAttempted: true };
    }
    if (!response.ok) {
      appLogger.warn('[Oidc] Backchannel logout rejected', {
        status: response.status,
        providerSidHash: providerSidFingerprint(providerSid),
      });
      return { outcome: 'failure', providerLogoutAttempted: true };
    }
    return { outcome: 'success', providerLogoutAttempted: true };
  } catch (error) {
    appLogger.warn('[Oidc] Backchannel logout failed', {
      error: error instanceof Error ? error.message : 'unknown',
      providerSidHash: providerSidFingerprint(providerSid),
    });
    return { outcome: 'failure', providerLogoutAttempted: true };
  }
}

export async function requestProviderBackchannelLogout(
  providerSid: string | null | undefined
): Promise<boolean> {
  const result = await requestProviderBackchannelLogoutDetailed(providerSid);
  return result.outcome === 'success';
}
