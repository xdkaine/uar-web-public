import { createHash } from 'node:crypto';

export const MAX_CHECKS_PER_SOURCE = 25;
export const MAX_ACTIVE_WORKFLOW_CHECKS = 100;

export type WorkflowMonitorKind = 'http' | 'https' | 'tcp' | 'tls' | 'ldaps' | 'icmp';

export interface WorkflowMonitorCheckConfig {
  key: string;
  name: string;
  kind: WorkflowMonitorKind;
  host: string;
  port?: number;
  path?: string;
  method?: 'GET' | 'HEAD';
  expectedStatusMin?: number;
  expectedStatusMax?: number;
  expectedBody?: string;
  baseDn?: string;
  credentialRef?: string;
  /** Provenance for the explicit legacy-import replacement handshake. */
  legacyEndpointId?: string;
  intervalSeconds: number;
  timeoutMs: number;
  failureThreshold: number;
  recoveryThreshold: number;
  enabled: boolean;
}

const DEFAULT_PORTS: Record<WorkflowMonitorKind, number | undefined> = {
  http: 80,
  https: 443,
  tcp: undefined,
  tls: 443,
  ldaps: 636,
  icmp: undefined,
};

function integer(value: unknown, fallback: number, min: number, max: number): number | null {
  const parsed = value === undefined ? fallback : Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

function normalizedHost(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase().replace(/^\[|\]$/g, '');
}

export function validateWorkflowMonitorCheck(
  input: unknown,
  index = 0
): { ok: true; value: WorkflowMonitorCheckConfig } | { ok: false; error: string } {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: `Monitor check ${index + 1} must be an object` };
  }
  const raw = input as Record<string, unknown>;
  const key = typeof raw.key === 'string' ? raw.key.trim() : '';
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 100) : '';
  const kind = typeof raw.kind === 'string' && ['http', 'https', 'tcp', 'tls', 'ldaps', 'icmp'].includes(raw.kind)
    ? raw.kind as WorkflowMonitorKind
    : null;
  const host = normalizedHost(raw.host);
  if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$|^[0-9a-f:]+$/i.test(host) || host.includes('..')) {
    return { ok: false, error: `${name || `Monitor check ${index + 1}`}: host must be a hostname or IP address` };
  }
  if (!key || !/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(key)) {
    return { ok: false, error: `${name || `Monitor check ${index + 1}`}: key must be 1-64 letters, numbers, dashes, or underscores` };
  }
  if (!name || !kind) {
    return { ok: false, error: `Monitor check ${index + 1} needs a name and check type` };
  }
  const defaultPort = DEFAULT_PORTS[kind];
  const port = kind === 'icmp' ? undefined : integer(raw.port, defaultPort ?? 0, 1, 65535) ?? undefined;
  if (kind !== 'icmp' && !port) return { ok: false, error: `${name}: port must be between 1 and 65535` };
  const intervalSeconds = integer(raw.intervalSeconds, 60, 60, 3600);
  const timeoutMs = integer(raw.timeoutMs, 5000, 500, 15000);
  const failureThreshold = integer(raw.failureThreshold, 2, 1, 10);
  const recoveryThreshold = integer(raw.recoveryThreshold, 2, 1, 10);
  if (!intervalSeconds || !timeoutMs || !failureThreshold || !recoveryThreshold) {
    return { ok: false, error: `${name}: schedule, timeout, or transition threshold is outside the allowed range` };
  }
  const path = typeof raw.path === 'string' && raw.path.trim() ? raw.path.trim() : '/';
  if ((kind === 'http' || kind === 'https') && (!path.startsWith('/') || path.includes('..') || path.length > 500)) {
    return { ok: false, error: `${name}: request path must be absolute and cannot contain traversal` };
  }
  const method = raw.method === 'HEAD' ? 'HEAD' : 'GET';
  const expectedStatusMin = integer(raw.expectedStatusMin, 200, 100, 599) ?? 200;
  const expectedStatusMax = integer(raw.expectedStatusMax, 499, 100, 599) ?? 499;
  if (expectedStatusMin > expectedStatusMax) return { ok: false, error: `${name}: status range is reversed` };
  const expectedBody = typeof raw.expectedBody === 'string' ? raw.expectedBody.slice(0, 500) : undefined;
  if (method === 'HEAD' && expectedBody) return { ok: false, error: `${name}: HEAD checks cannot assert response content` };
  const credentialRef = typeof raw.credentialRef === 'string' && raw.credentialRef.trim()
    ? raw.credentialRef.trim()
    : undefined;
  const legacyEndpointId = typeof raw.legacyEndpointId === 'string' && raw.legacyEndpointId.trim()
    ? raw.legacyEndpointId.trim()
    : undefined;
  if (legacyEndpointId && !/^[a-z0-9_-]{1,191}$/i.test(legacyEndpointId)) {
    return { ok: false, error: `${name}: legacy endpoint reference is invalid` };
  }
  if (kind === 'http' && credentialRef) {
    return { ok: false, error: `${name}: credentials require HTTPS` };
  }
  return {
    ok: true,
    value: {
      key,
      name,
      kind,
      host,
      ...(port ? { port } : {}),
      ...((kind === 'http' || kind === 'https') ? { path, method, expectedStatusMin, expectedStatusMax } : {}),
      ...(expectedBody ? { expectedBody } : {}),
      ...(typeof raw.baseDn === 'string' && raw.baseDn.trim() ? { baseDn: raw.baseDn.trim().slice(0, 1000) } : {}),
      ...(credentialRef ? { credentialRef } : {}),
      ...(legacyEndpointId ? { legacyEndpointId } : {}),
      intervalSeconds,
      timeoutMs,
      failureThreshold,
      recoveryThreshold,
      enabled: raw.enabled !== false,
    },
  };
}

export function validateWorkflowMonitorChecks(input: unknown):
  | { ok: true; checks: WorkflowMonitorCheckConfig[] }
  | { ok: false; errors: string[] } {
  if (!Array.isArray(input) || input.length === 0) {
    return { ok: false, errors: ['Monitor endpoints needs at least one check'] };
  }
  if (input.length > MAX_CHECKS_PER_SOURCE) {
    return { ok: false, errors: [`Monitor endpoints allows at most ${MAX_CHECKS_PER_SOURCE} checks`] };
  }
  const results = input.map((entry, index) => validateWorkflowMonitorCheck(entry, index));
  const errors = results.filter((result): result is { ok: false; error: string } => !result.ok).map((result) => result.error);
  const checks = results.filter((result): result is { ok: true; value: WorkflowMonitorCheckConfig } => result.ok).map((result) => result.value);
  const duplicateKeys = checks.map((check) => check.key).filter((key, index, keys) => keys.indexOf(key) !== index);
  if (duplicateKeys.length > 0) errors.push(`Monitor check keys must be unique: ${Array.from(new Set(duplicateKeys)).join(', ')}`);
  return errors.length > 0 ? { ok: false, errors } : { ok: true, checks };
}

export function monitorCheckConfigHash(check: WorkflowMonitorCheckConfig): string {
  // Import provenance controls the one-time replacement transaction but does
  // not change probe semantics or prevent state retention across versions.
  const probeConfig = { ...check };
  delete probeConfig.legacyEndpointId;
  return createHash('sha256').update(JSON.stringify(probeConfig)).digest('hex').slice(0, 32);
}
