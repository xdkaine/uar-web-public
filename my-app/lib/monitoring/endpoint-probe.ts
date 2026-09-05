import dns from 'node:dns/promises';
import https from 'node:https';
import net from 'node:net';
import { randomUUID } from 'node:crypto';

import { prisma } from '@/lib/prisma';
import { isForbiddenProbeAddress } from './endpoint-policy';
import { nextEndpointState } from './endpoint-state';
import { emitFlowEvent } from '@/lib/flow/engine';
import { MAX_MONITORED_ENDPOINTS } from './endpoint-policy';

interface ProbeTarget {
  id: string;
  name: string;
  protocol: string;
  host: string;
  port: number;
  path: string | null;
  timeoutMs: number;
}

export interface EndpointProbeResult {
  reachable: boolean;
  latencyMs: number;
  error?: string;
  statusCode?: number;
}

async function resolveApprovedAddress(host: string): Promise<{ address: string; family: 4 | 6 }> {
  const addresses = await dns.lookup(host, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some((entry) => isForbiddenProbeAddress(entry.address))) {
    throw new Error('Target resolves to a blocked special-use address');
  }
  return addresses[0] as { address: string; family: 4 | 6 };
}

export async function probeEndpoint(target: ProbeTarget): Promise<EndpointProbeResult> {
  const startedAt = Date.now();
  try {
    const resolved = await resolveApprovedAddress(target.host);
    if (target.protocol === 'tcp') {
      await new Promise<void>((resolve, reject) => {
        const socket = net.createConnection({ host: resolved.address, port: target.port });
        socket.setTimeout(target.timeoutMs);
        socket.once('connect', () => { socket.destroy(); resolve(); });
        socket.once('timeout', () => { socket.destroy(); reject(new Error('Connection timed out')); });
        socket.once('error', reject);
      });
      return { reachable: true, latencyMs: Date.now() - startedAt };
    }
    const statusCode = await new Promise<number>((resolve, reject) => {
      const request = https.request({
        hostname: target.host,
        servername: target.host,
        port: target.port,
        path: target.path || '/',
        method: 'GET',
        timeout: target.timeoutMs,
        rejectUnauthorized: true,
        lookup: (_hostname, _options, callback) => callback(null, resolved.address, resolved.family),
        headers: { 'user-agent': 'UAR-Health-Check/1.0', accept: 'application/json,text/plain,*/*' },
      }, (response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      });
      request.once('timeout', () => request.destroy(new Error('Request timed out')));
      request.once('error', reject);
      request.end();
    });
    return {
      reachable: statusCode >= 200 && statusCode < 500,
      latencyMs: Date.now() - startedAt,
      statusCode,
      ...(statusCode >= 500 || statusCode === 0 ? { error: `HTTP ${statusCode || 'error'}` } : {}),
    };
  } catch (error) {
    return {
      reachable: false,
      latencyMs: Date.now() - startedAt,
      error: (error instanceof Error ? error.message : 'Probe failed').slice(0, 500),
    };
  }
}

export async function runMonitoredEndpointCycle(): Promise<{ checked: number; transitions: number; skipped?: boolean }> {
  const owner = randomUUID();
  const now = new Date();
  const acquired = await prisma.$queryRaw<Array<{ owner: string }>>`
    INSERT INTO "OperationalLease" ("key", "owner", "expiresAt", "updatedAt")
    VALUES ('monitored-endpoint-cycle', ${owner}, ${new Date(now.getTime() + 90_000)}, ${now})
    ON CONFLICT ("key") DO UPDATE SET
      "owner" = EXCLUDED."owner", "expiresAt" = EXCLUDED."expiresAt", "updatedAt" = EXCLUDED."updatedAt"
    WHERE "OperationalLease"."expiresAt" <= ${now}
    RETURNING "owner"
  `;
  if (acquired.length !== 1) return { checked: 0, transitions: 0, skipped: true };
  try {
    const targets = await prisma.monitoredEndpoint.findMany({
      where: { enabled: true },
      orderBy: { name: 'asc' },
      take: MAX_MONITORED_ENDPOINTS,
    });
    let transitions = 0;
    for (let offset = 0; offset < targets.length; offset += 5) {
      const results = await Promise.all(targets.slice(offset, offset + 5).map(async (target) => {
    const result = await probeEndpoint(target);
    const next = nextEndpointState(target, result.reachable, target.failureThreshold, target.recoveryThreshold);
    const checkedAt = new Date();
    const claimed = await prisma.monitoredEndpoint.updateMany({
      where: { id: target.id, updatedAt: target.updatedAt },
      data: {
        currentState: next.currentState,
        consecutiveFailures: next.consecutiveFailures,
        consecutiveSuccesses: next.consecutiveSuccesses,
        lastCheckedAt: checkedAt,
        lastLatencyMs: result.latencyMs,
        lastError: result.error ?? null,
        ...(next.transition ? { lastTransitionAt: checkedAt } : {}),
      },
    });
    if (claimed.count !== 1 || !next.transition) return false;
    const triggerKey = next.transition === 'failed' ? 'health_check_failed' : 'health_check_recovered';
    await emitFlowEvent(triggerKey, `${triggerKey}:${target.id}:${checkedAt.toISOString()}`, {
      targetId: target.id,
      target: target.name,
      host: target.host,
      protocol: target.protocol,
      error: result.error,
      latencyMs: result.latencyMs,
    });
    return true;
      }));
      transitions += results.filter(Boolean).length;
    }
    return { checked: targets.length, transitions };
  } finally {
    await prisma.operationalLease.deleteMany({ where: { key: 'monitored-endpoint-cycle', owner } }).catch(() => undefined);
  }
}
