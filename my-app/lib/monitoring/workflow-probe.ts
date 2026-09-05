import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { randomUUID } from 'node:crypto';

import { Client } from 'ldapts';

import { decryptPassword } from '@/lib/encryption';
import { deliverFlowEventOutboxById, enqueueTargetedFlowSourceEvent } from '@/lib/flow/outbox';
import { prisma } from '@/lib/prisma';
import { isForbiddenProbeAddress } from './endpoint-policy';
import { nextEndpointState } from './endpoint-state';
import { validateWorkflowMonitorCheck, type WorkflowMonitorCheckConfig } from './workflow-checks';
import { requireReachableIcmpResponse } from './icmp-probe-response';

const RESPONSE_CAP = 64 * 1024;

export interface WorkflowProbeResult {
  reachable: boolean;
  latencyMs: number;
  statusCode?: number;
  error?: string;
}

interface PersistedMonitorRow {
  id: string;
  graphId: string;
  sourceNodeId: string;
  updatedAt: Date;
}

export async function persistWorkflowMonitorResult(
  row: PersistedMonitorRow,
  check: WorkflowMonitorCheckConfig,
  result: WorkflowProbeResult,
  next: ReturnType<typeof nextEndpointState>,
  checkedAt: Date
): Promise<{ id: string } | null> {
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.workflowMonitorCheck.updateMany({
      where: { id: row.id, updatedAt: row.updatedAt, active: true },
      data: {
        currentState: next.currentState,
        consecutiveFailures: next.consecutiveFailures,
        consecutiveSuccesses: next.consecutiveSuccesses,
        nextProbeAt: new Date(checkedAt.getTime() + check.intervalSeconds * 1000),
        lastCheckedAt: checkedAt,
        lastLatencyMs: result.latencyMs,
        lastStatusCode: result.statusCode ?? null,
        lastError: result.error ?? null,
        ...(next.transition ? { lastTransitionAt: checkedAt } : {}),
      },
    });
    if (claimed.count !== 1 || !next.transition) return null;
    const handle = next.transition === 'failed' ? 'failed' : 'recovered';
    return enqueueTargetedFlowSourceEvent(tx, {
      graphId: row.graphId,
      sourceNodeId: row.sourceNodeId,
      sourceHandle: handle,
      eventKey: `monitor:${row.id}:${handle}:${checkedAt.toISOString()}`,
      context: {
        targetId: row.id,
        checkKey: check.key,
        target: check.name,
        host: check.host,
        protocol: check.kind,
        latencyMs: result.latencyMs,
        statusCode: result.statusCode,
        error: result.error,
      },
    });
  });
}

async function resolveApprovedAddress(host: string): Promise<{ address: string; family: 4 | 6 }> {
  const addresses = await dns.lookup(host, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some((entry) => isForbiddenProbeAddress(entry.address))) {
    throw new Error('Target resolves to a blocked special-use address');
  }
  return addresses[0] as { address: string; family: 4 | 6 };
}

async function credentialHeaders(check: WorkflowMonitorCheckConfig): Promise<Record<string, string>> {
  if (!check.credentialRef) return {};
  const row = await prisma.monitorCredential.findFirst({ where: { id: check.credentialRef, enabled: true } });
  if (!row || !row.allowedHosts.some((host) => host.toLowerCase() === check.host.toLowerCase())) {
    throw new Error('Credential is unavailable or is not approved for this host');
  }
  const secret = decryptPassword(row.secret);
  if (row.kind === 'http_basic') return { authorization: `Basic ${Buffer.from(`${row.username ?? ''}:${secret}`).toString('base64')}` };
  if (row.kind === 'bearer') return { authorization: `Bearer ${secret}` };
  if (row.kind === 'secret_header' && row.headerName) return { [row.headerName]: secret };
  throw new Error('Credential type does not match an HTTP check');
}

async function requestProbe(check: WorkflowMonitorCheckConfig, resolved: { address: string; family: 4 | 6 }): Promise<{ statusCode: number; body: string }> {
  const headers = await credentialHeaders(check);
  const client = check.kind === 'https' ? https : http;
  return new Promise((resolve, reject) => {
    const request = client.request({
      hostname: check.host,
      servername: check.kind === 'https' ? check.host : undefined,
      port: check.port,
      path: check.path || '/',
      method: check.method || 'GET',
      timeout: check.timeoutMs,
      rejectUnauthorized: check.kind === 'https' ? true : undefined,
      lookup: (_hostname, _options, callback) => callback(null, resolved.address, resolved.family),
      headers: { 'user-agent': 'UAR-Workflow-Monitor/1.0', accept: 'application/json,text/plain,*/*', ...headers },
    }, (response) => {
      let size = 0;
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size <= RESPONSE_CAP) chunks.push(chunk);
      });
      response.once('end', () => resolve({ statusCode: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    request.once('timeout', () => request.destroy(new Error('Request timed out')));
    request.once('error', reject);
    request.end();
  });
}

async function socketProbe(check: WorkflowMonitorCheckConfig, resolved: { address: string; family: 4 | 6 }, secure: boolean): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const socket = secure
      ? tls.connect({ host: resolved.address, port: check.port!, servername: check.host, rejectUnauthorized: true })
      : net.createConnection({ host: resolved.address, port: check.port! });
    socket.setTimeout(check.timeoutMs);
    const event = secure ? 'secureConnect' : 'connect';
    socket.once(event, () => { socket.destroy(); resolve(); });
    socket.once('timeout', () => { socket.destroy(); reject(new Error('Connection timed out')); });
    socket.once('error', reject);
  });
}

async function ldapProbe(check: WorkflowMonitorCheckConfig, resolved: { address: string; family: 4 | 6 }): Promise<void> {
  if (!check.credentialRef) return socketProbe(check, resolved, true);
  const credential = await prisma.monitorCredential.findFirst({ where: { id: check.credentialRef, enabled: true, kind: 'ldap_bind' } });
  if (!credential || !credential.username || !credential.allowedHosts.some((host) => host.toLowerCase() === check.host.toLowerCase())) {
    throw new Error('LDAP credential is unavailable or is not approved for this host');
  }
  const address = resolved.family === 6 ? `[${resolved.address}]` : resolved.address;
  const client = new Client({
    url: `ldaps://${address}:${check.port}`,
    timeout: check.timeoutMs,
    connectTimeout: check.timeoutMs,
    tlsOptions: { rejectUnauthorized: true, servername: check.host },
  });
  try {
    await client.bind(credential.username, decryptPassword(credential.secret));
    if (check.baseDn) await client.search(check.baseDn, { scope: 'base', sizeLimit: 1, attributes: ['distinguishedName'] });
  } finally {
    await client.unbind().catch(() => undefined);
  }
}

async function icmpProbe(check: WorkflowMonitorCheckConfig, resolved: { address: string }): Promise<void> {
  const url = process.env.MONITOR_PROBE_URL || 'http://monitor-probe:8091';
  const secret = process.env.MONITOR_PROBE_SHARED_SECRET;
  if (!secret) throw new Error('ICMP probe service is not configured');
  const response = await fetch(`${url}/probe`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-monitor-probe-token': secret },
    // Send the already policy-checked, DNS-pinned address so the privileged
    // sidecar never performs a second resolution that could be rebound.
    body: JSON.stringify({ host: resolved.address, timeoutMs: check.timeoutMs }),
    signal: AbortSignal.timeout(check.timeoutMs + 1000),
  });
  await requireReachableIcmpResponse(response);
}

export async function probeWorkflowCheck(check: WorkflowMonitorCheckConfig): Promise<WorkflowProbeResult> {
  const startedAt = Date.now();
  try {
    const resolved = await resolveApprovedAddress(check.host);
    if (check.kind === 'icmp') await icmpProbe(check, resolved);
    else if (check.kind === 'tcp') await socketProbe(check, resolved, false);
    else if (check.kind === 'tls') await socketProbe(check, resolved, true);
    else if (check.kind === 'ldaps') await ldapProbe(check, resolved);
    else {
      const response = await requestProbe(check, resolved);
      const min = check.expectedStatusMin ?? 200;
      const max = check.expectedStatusMax ?? 499;
      if (response.statusCode < min || response.statusCode > max) throw Object.assign(new Error(`HTTP ${response.statusCode} is outside ${min}-${max}`), { statusCode: response.statusCode });
      if (check.expectedBody && !response.body.includes(check.expectedBody)) throw Object.assign(new Error('Response did not contain the expected text'), { statusCode: response.statusCode });
      return { reachable: true, latencyMs: Date.now() - startedAt, statusCode: response.statusCode };
    }
    return { reachable: true, latencyMs: Date.now() - startedAt };
  } catch (error) {
    return {
      reachable: false,
      latencyMs: Date.now() - startedAt,
      ...((error as { statusCode?: number }).statusCode ? { statusCode: (error as { statusCode: number }).statusCode } : {}),
      error: (error instanceof Error ? error.message : 'Probe failed').slice(0, 500),
    };
  }
}

export async function runWorkflowMonitorCycle(): Promise<{ checked: number; transitions: number; skipped?: boolean }> {
  const owner = randomUUID();
  const now = new Date();
  const acquired = await prisma.$queryRaw<Array<{ owner: string }>>`
    INSERT INTO "OperationalLease" ("key", "owner", "expiresAt", "updatedAt")
    VALUES ('workflow-monitor-cycle', ${owner}, ${new Date(now.getTime() + 90_000)}, ${now})
    ON CONFLICT ("key") DO UPDATE SET
      "owner" = EXCLUDED."owner", "expiresAt" = EXCLUDED."expiresAt", "updatedAt" = EXCLUDED."updatedAt"
    WHERE "OperationalLease"."expiresAt" <= ${now}
    RETURNING "owner"
  `;
  if (acquired.length !== 1) return { checked: 0, transitions: 0, skipped: true };
  try {
    const rows = await prisma.workflowMonitorCheck.findMany({
      where: { active: true, nextProbeAt: { lte: now }, graph: { enabled: true, status: 'published' } },
      orderBy: { nextProbeAt: 'asc' },
      take: 100,
    });
    let transitions = 0;
    for (let offset = 0; offset < rows.length; offset += 5) {
      const outcomes = await Promise.all(rows.slice(offset, offset + 5).map(async (row) => {
        const parsed = validateWorkflowMonitorCheck(row.config);
        if (!parsed.ok) {
          await prisma.workflowMonitorCheck.update({ where: { id: row.id }, data: { active: false, lastError: parsed.error } });
          return false;
        }
        const check = parsed.value;
        const result = await probeWorkflowCheck(check);
        const next = nextEndpointState(row, result.reachable, check.failureThreshold, check.recoveryThreshold);
        const checkedAt = new Date();
        const queued = await persistWorkflowMonitorResult(row, check, result, next, checkedAt);
        if (!queued) return false;
        // The durable row is the acceptance boundary. Immediate delivery
        // improves latency; the outbox scheduler owns retries after failures.
        await deliverFlowEventOutboxById(queued.id);
        return true;
      }));
      transitions += outcomes.filter(Boolean).length;
    }
    return { checked: rows.length, transitions };
  } finally {
    await prisma.operationalLease.deleteMany({ where: { key: 'workflow-monitor-cycle', owner } }).catch(() => undefined);
  }
}
