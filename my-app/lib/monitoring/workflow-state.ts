import type { Prisma } from '@prisma/client';

import type { FlowNode } from '@/lib/flow/graph';
import {
  MAX_ACTIVE_WORKFLOW_CHECKS,
  monitorCheckConfigHash,
  validateWorkflowMonitorChecks,
} from './workflow-checks';

export async function deactivateWorkflowMonitorChecks(
  tx: Prisma.TransactionClient,
  graphIds: string[]
): Promise<void> {
  if (graphIds.length === 0) return;
  await tx.workflowMonitorCheck.updateMany({ where: { graphId: { in: graphIds }, active: true }, data: { active: false } });
}

export async function activateWorkflowMonitorChecks(
  tx: Prisma.TransactionClient,
  graph: { id: string; name: string; nodes: unknown },
  actor: string
): Promise<number> {
  const sources = (graph.nodes as unknown as FlowNode[]).filter((node) => node.type === 'source_monitor_endpoints');
  const desired = sources.flatMap((source) => {
    const parsed = validateWorkflowMonitorChecks(source.config.checks);
    if (!parsed.ok) throw new Error(`WORKFLOW_MONITOR_INVALID:${parsed.errors.join('; ')}`);
    return parsed.checks.filter((check) => check.enabled).map((check) => ({ source, check }));
  });
  if (desired.length === 0) return 0;
  const activeElsewhere = await tx.workflowMonitorCheck.count({ where: { active: true, graphId: { not: graph.id } } });
  if (activeElsewhere + desired.length > MAX_ACTIVE_WORKFLOW_CHECKS) {
    throw new Error(`WORKFLOW_MONITOR_LIMIT:${MAX_ACTIVE_WORKFLOW_CHECKS - activeElsewhere}`);
  }

  const legacyEndpointIds = Array.from(new Set(
    desired.flatMap(({ check }) => check.legacyEndpointId ? [check.legacyEndpointId] : [])
  ));
  if (legacyEndpointIds.length > 0) {
    const legacyEndpoints = await tx.monitoredEndpoint.findMany({
      where: { id: { in: legacyEndpointIds } },
      select: {
        id: true,
        protocol: true,
        host: true,
        port: true,
        path: true,
        timeoutMs: true,
        failureThreshold: true,
        recoveryThreshold: true,
      },
    });
    const legacyById = new Map(legacyEndpoints.map((endpoint) => [endpoint.id, endpoint]));
    const mismatched = desired.flatMap(({ check }) => {
      if (!check.legacyEndpointId) return [];
      const legacy = legacyById.get(check.legacyEndpointId);
      const matches = legacy
        && legacy.protocol === check.kind
        && legacy.host.toLowerCase() === check.host.toLowerCase()
        && legacy.port === check.port
        && (legacy.path ?? '/') === (check.path ?? '/')
        && legacy.timeoutMs === check.timeoutMs
        && legacy.failureThreshold === check.failureThreshold
        && legacy.recoveryThreshold === check.recoveryThreshold
        && check.intervalSeconds === 60
        && !check.credentialRef
        && !check.expectedBody
        && (check.kind !== 'https' || (
          check.method === 'GET'
          && check.expectedStatusMin === 200
          && check.expectedStatusMax === 499
        ));
      return matches ? [] : [check.legacyEndpointId];
    });
    if (mismatched.length > 0) {
      throw new Error(`WORKFLOW_MONITOR_LEGACY_MISMATCH:${Array.from(new Set(mismatched)).join(',')}`);
    }
  }

  await tx.workflowMonitorCheck.updateMany({ where: { graphId: graph.id }, data: { active: false } });
  for (const { source, check } of desired) {
    const configHash = monitorCheckConfigHash(check);
    const previous = await tx.workflowMonitorCheck.findFirst({
      where: {
        sourceNodeId: source.id,
        checkKey: check.key,
        configHash,
        graph: { name: graph.name },
      },
      orderBy: { updatedAt: 'desc' },
    });
    await tx.workflowMonitorCheck.upsert({
      where: { graphId_sourceNodeId_checkKey: { graphId: graph.id, sourceNodeId: source.id, checkKey: check.key } },
      update: { configHash, config: check as unknown as Prisma.InputJsonValue, active: true, nextProbeAt: new Date() },
      create: {
        graphId: graph.id,
        sourceNodeId: source.id,
        checkKey: check.key,
        configHash,
        config: check as unknown as Prisma.InputJsonValue,
        active: true,
        nextProbeAt: new Date(),
        ...(previous ? {
          currentState: previous.currentState,
          consecutiveFailures: previous.consecutiveFailures,
          consecutiveSuccesses: previous.consecutiveSuccesses,
          lastCheckedAt: previous.lastCheckedAt,
          lastTransitionAt: previous.lastTransitionAt,
          lastLatencyMs: previous.lastLatencyMs,
          lastStatusCode: previous.lastStatusCode,
          lastError: previous.lastError,
        } : {}),
      },
    });
  }
  if (legacyEndpointIds.length > 0) {
    await tx.monitoredEndpoint.updateMany({
      where: { id: { in: legacyEndpointIds }, enabled: true },
      data: { enabled: false, configVersion: { increment: 1 }, updatedBy: actor },
    });
  }
  return desired.length;
}
