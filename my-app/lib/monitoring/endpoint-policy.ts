import net from 'node:net';

export const MAX_MONITORED_ENDPOINTS = 25;

export const ENDPOINT_PRESETS = {
  proxmox: { protocol: 'https', port: 8006, path: '/api2/json/version' },
  truenas: { protocol: 'https', port: 443, path: '/api/v2.0/system/state' },
  generic_https: { protocol: 'https', port: 443, path: '/' },
  tcp: { protocol: 'tcp', port: 443, path: null },
} as const;

export type EndpointPreset = keyof typeof ENDPOINT_PRESETS;

export interface EndpointDraft {
  name?: unknown;
  preset?: unknown;
  host?: unknown;
  port?: unknown;
  path?: unknown;
  timeoutMs?: unknown;
  failureThreshold?: unknown;
  recoveryThreshold?: unknown;
  enabled?: unknown;
}

export type ValidatedEndpoint = {
  name: string;
  preset: EndpointPreset;
  protocol: 'https' | 'tcp';
  host: string;
  port: number;
  path: string | null;
  timeoutMs: number;
  failureThreshold: number;
  recoveryThreshold: number;
  enabled: boolean;
};

export function isForbiddenProbeAddress(address: string): boolean {
  if (net.isIPv4(address)) {
    const octets = address.split('.').map(Number);
    return octets[0] === 0 || octets[0] === 127 || octets[0]! >= 224 ||
      (octets[0] === 169 && octets[1] === 254);
  }
  if (net.isIPv6(address)) {
    const normalized = address.toLowerCase();
    const mapped = normalized.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/)?.[1];
    if (mapped) return isForbiddenProbeAddress(mapped);
    const mappedHex = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mappedHex) {
      const high = Number.parseInt(mappedHex[1]!, 16);
      const low = Number.parseInt(mappedHex[2]!, 16);
      return isForbiddenProbeAddress(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
    }
    return normalized === '::' || normalized === '::1' || normalized.startsWith('fe80:') ||
      normalized.startsWith('ff') || normalized.startsWith('fc00:0:0:0:0:0:0:1');
  }
  return true;
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number | null {
  const parsed = value === undefined ? fallback : Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

export function validateEndpointDraft(draft: EndpointDraft):
  | { ok: true; value: ValidatedEndpoint }
  | { ok: false; error: string } {
  const name = typeof draft.name === 'string' ? draft.name.trim().slice(0, 100) : '';
  const preset = typeof draft.preset === 'string' && draft.preset in ENDPOINT_PRESETS
    ? draft.preset as EndpointPreset
    : null;
  const host = typeof draft.host === 'string' ? draft.host.trim().toLowerCase() : '';
  if (!name || !preset || !host) return { ok: false, error: 'Name, preset, and host are required' };
  if (host.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?|\[[0-9a-f:]+\]|[0-9a-f:]+)$/i.test(host) || host.includes('..')) {
    return { ok: false, error: 'Host must be a hostname or IP address without a scheme or credentials' };
  }
  const defaults = ENDPOINT_PRESETS[preset];
  const protocol = defaults.protocol;
  const port = boundedInteger(draft.port, defaults.port, 1, 65535);
  const timeoutMs = boundedInteger(draft.timeoutMs, 5000, 500, 15000);
  const failureThreshold = boundedInteger(draft.failureThreshold, 2, 1, 10);
  const recoveryThreshold = boundedInteger(draft.recoveryThreshold, 2, 1, 10);
  if (!port || !timeoutMs || !failureThreshold || !recoveryThreshold) {
    return { ok: false, error: 'Port, timeout, and transition thresholds are outside allowed bounds' };
  }
  let endpointPath: string | null = defaults.path;
  if (protocol === 'https' && preset === 'generic_https') {
    endpointPath = typeof draft.path === 'string' && draft.path.trim() ? draft.path.trim() : '/';
  }
  if (endpointPath && (!endpointPath.startsWith('/') || endpointPath.includes('..') || endpointPath.length > 500)) {
    return { ok: false, error: 'HTTPS path must be an absolute path without traversal' };
  }
  return {
    ok: true,
    value: {
      name,
      preset,
      protocol,
      host: host.replace(/^\[|\]$/g, ''),
      port,
      path: endpointPath,
      timeoutMs,
      failureThreshold,
      recoveryThreshold,
      enabled: draft.enabled !== false,
    },
  };
}
