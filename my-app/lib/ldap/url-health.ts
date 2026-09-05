import tls from 'tls';
import { ldapLogger } from '../logger';

const HEALTH_CACHE_TTL_MS = 30_000;
const PROBE_TIMEOUT_MS = 2_500;

export interface LdapEndpoint {
  url: string;
  host: string;
  port: number;
}

/** Parses an ldaps:// URL into connectable parts; null when malformed/insecure. */
export function parseLdapUrl(rawUrl: string): LdapEndpoint | null {
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol.toLowerCase() !== 'ldaps:') {
      return null;
    }
    const port = parsed.port ? Number.parseInt(parsed.port, 10) : 636;
    if (!Number.isInteger(port) || port < 1 || port > 65535 || !parsed.hostname) {
      return null;
    }
    return { url: rawUrl.trim(), host: parsed.hostname, port };
  } catch {
    return null;
  }
}

/**
 * Ordered candidate list: the configured primary first, then every valid
 * ldaps:// failover entry. Invalid entries are dropped rather than failing
 * the whole list so one typo cannot take connectivity down.
 */
export function buildCandidateUrls(primaryUrl: string, failoverUrls: string[]): string[] {
  const candidates = [primaryUrl.trim(), ...failoverUrls.map((url) => url.trim())];
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    if (!candidate || seen.has(candidate)) continue;
    if (index > 0 && !parseLdapUrl(candidate)) continue;
    seen.add(candidate);
    ordered.push(candidate);
  }
  return ordered;
}

async function probeTls(endpoint: LdapEndpoint, rejectUnauthorized: boolean, ca?: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = tls.connect({
      host: endpoint.host,
      port: endpoint.port,
      rejectUnauthorized,
      ...(ca ? { ca } : {}),
      timeout: PROBE_TIMEOUT_MS,
    });
    const finish = (result: boolean) => {
      socket.destroy();
      resolve(result);
    };
    socket.once('secureConnect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.once('timeout', () => finish(false));
  });
}

const healthCache = new Map<string, { healthyUntil: number }>();

function isRecentlyHealthy(url: string, now: number): boolean {
  const entry = healthCache.get(url);
  return !!entry && entry.healthyUntil > now;
}

export function resetLdapHealthCache(): void {
  healthCache.clear();
}

/**
 * Returns the first URL whose TLS endpoint currently accepts connections.
 * A single candidate short-circuits (no probing, zero behavior change).
 * When nothing answers, the PRIMARY is returned so the caller surfaces the
 * exact historical connection error instead of a synthetic one.
 */
export async function selectHealthyLdapUrl(
  candidateUrls: string[],
  options: { rejectUnauthorized: boolean; ca?: string },
  prober: typeof probeTls = probeTls
): Promise<string> {
  if (candidateUrls.length <= 1) {
    return candidateUrls[0] ?? '';
  }

  const now = Date.now();
  const endpoints = candidateUrls
    .map((url) => ({ url, endpoint: parseLdapUrl(url) }))
    .filter((item): item is { url: string; endpoint: LdapEndpoint } => item.endpoint !== null);

  for (const { url } of endpoints) {
    if (isRecentlyHealthy(url, now)) {
      return url;
    }
  }

  const primary = endpoints[0]?.url ?? candidateUrls[0] ?? '';
  for (const { url, endpoint } of endpoints) {
    const healthy = await prober(endpoint, options.rejectUnauthorized, options.ca);
    if (healthy) {
      healthCache.set(url, { healthyUntil: Date.now() + HEALTH_CACHE_TTL_MS });
      if (url !== primary) {
        ldapLogger.warn(`Primary LDAP URL unreachable; using failover endpoint ${url}`);
      }
      return url;
    }
  }
  return primary;
}
