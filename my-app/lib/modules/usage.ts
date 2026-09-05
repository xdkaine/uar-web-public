/**
 * Live usage evidence for capability modules. For each registered module this
 * answers "what actually runs because this module is on": the admin tabs it
 * gates, the workflow graphs and automation rules listening to its triggers,
 * and the cron routes that drive its background processing with their latest
 * recorded execution.
 *
 * Every section degrades independently to an empty list on failure - usage is
 * advisory evidence for operators and must never break the panel that renders
 * it, mirroring the fail-open posture of lib/modules/core.ts.
 */
import { prisma } from '@/lib/prisma';
import { CRON_ROUTE_REGISTRY } from '@/lib/cron/registry';
import { getResolvedModuleStates } from './core';
import { ALL_MODULE_IDS, type ModuleId, type ModuleDefinition } from './registry';
import { MODULE_REGISTRY } from './registry';

export interface ModuleWorkflowUsage {
  id: string;
  name: string;
  status: string;
  triggerKey: string;
}

export interface ModuleAutomationUsage {
  id: string;
  name: string;
  enabled: boolean;
  triggerKey: string;
}

export interface ModuleCronUsage {
  key: string;
  label: string;
  cadence: string;
  enabledEnvKey?: string;
  lastRunAt: string | null;
  healthy: boolean;
}

export interface ModuleUsage {
  moduleId: ModuleId;
  enabled: boolean;
  adminTabs: string[];
  workflows: ModuleWorkflowUsage[];
  automationRules: ModuleAutomationUsage[];
  cronJobs: ModuleCronUsage[];
}

function formatCadence(seconds: number): string {
  if (seconds % 3600 === 0) return `every ${seconds / 3600}h`;
  if (seconds % 60 === 0) return `every ${seconds / 60}m`;
  return `every ${seconds}s`;
}

async function fetchWorkflows(triggerKeys: string[]): Promise<ModuleWorkflowUsage[]> {
  if (triggerKeys.length === 0) return [];
  return prisma.workflowGraph.findMany({
    where: { triggerKey: { in: triggerKeys }, status: { in: ['draft', 'published'] } },
    select: { id: true, name: true, status: true, triggerKey: true },
    orderBy: { updatedAt: 'desc' },
    take: 50,
  });
}

async function fetchAutomationRules(triggerKeys: string[]): Promise<ModuleAutomationUsage[]> {
  if (triggerKeys.length === 0) return [];
  const rows = await prisma.automationRule.findMany({
    where: { triggerKey: { in: triggerKeys } },
    select: { id: true, name: true, enabled: true, triggerKey: true },
    orderBy: { updatedAt: 'desc' },
    take: 50,
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    enabled: row.enabled,
    triggerKey: row.triggerKey,
  }));
}

/**
 * Health follows the operations dashboard contract: a job is healthy only
 * while its latest activity is recent relative to cadence (3x interval, at
 * least 5 minutes) and failures do not dominate. A job with no recorded runs
 * reports unhealthy so silence stays visible evidence rather than assumed
 * good.
 */
async function fetchCronJobs(routeKeys: string[]): Promise<ModuleCronUsage[]> {
  if (routeKeys.length === 0) return [];
  const descriptors = CRON_ROUTE_REGISTRY.filter((entry) => routeKeys.includes(entry.route));

  const rollups = await prisma.cronRun.groupBy({
    by: ['route', 'outcome'],
    _count: { _all: true },
    _max: { startedAt: true },
    where: { route: { in: descriptors.map((descriptor) => descriptor.route) } },
  });

  const healthByRoute = new Map<string, { lastRunAt: string | null; failed: number; success: number }>();
  for (const row of rollups) {
    let entry = healthByRoute.get(row.route);
    if (!entry) {
      entry = { lastRunAt: null, failed: 0, success: 0 };
      healthByRoute.set(row.route, entry);
    }
    if (row.outcome === 'failed') {
      entry.failed += row._count._all;
    } else {
      entry.success += row._count._all;
    }
    const lastAt = row._max.startedAt;
    if (lastAt && (!entry.lastRunAt || lastAt.toISOString() > entry.lastRunAt)) {
      entry.lastRunAt = lastAt.toISOString();
    }
  }

  const nowMs = Date.now();
  return descriptors.map((descriptor) => {
    const health = healthByRoute.get(descriptor.route);
    let healthy = false;
    if (health?.lastRunAt) {
      const staleAfterMs = Math.max(descriptor.expectedIntervalSeconds * 3, 5 * 60 * 1000);
      const notStale = nowMs - new Date(health.lastRunAt).getTime() <= staleAfterMs;
      healthy = notStale && !(health.failed > 0 && health.failed >= health.success);
    }
    return {
      key: descriptor.route,
      label: descriptor.label,
      cadence: formatCadence(descriptor.expectedIntervalSeconds),
      ...(descriptor.enabledEnvKey ? { enabledEnvKey: descriptor.enabledEnvKey } : {}),
      lastRunAt: health?.lastRunAt ?? null,
      healthy,
    };
  });
}

/** Per-module usage evidence for every registered module, in registry order. */
export async function getModuleUsage(): Promise<ModuleUsage[]> {
  const states = await getResolvedModuleStates();
  const enabledById = new Map(states.map((state) => [state.moduleId, state.enabled]));

  const results = await Promise.all(
    ALL_MODULE_IDS.map(async (moduleId): Promise<ModuleUsage> => {
      const definition: ModuleDefinition = MODULE_REGISTRY[moduleId];
      const triggerKeys = definition.triggerKeys ?? [];
      const cronJobKeys = definition.cronJobKeys ?? [];

      // Each section fails independently into an empty list so one broken
      // table cannot hide the rest of the evidence.
      const [workflows, automationRules, cronJobs] = await Promise.all([
        fetchWorkflows(triggerKeys).catch((error) => {
          console.error(`[Modules] Failed to load workflow usage for ${moduleId}:`, error);
          return [];
        }),
        fetchAutomationRules(triggerKeys).catch((error) => {
          console.error(`[Modules] Failed to load automation usage for ${moduleId}:`, error);
          return [];
        }),
        fetchCronJobs(cronJobKeys).catch((error) => {
          console.error(`[Modules] Failed to load cron usage for ${moduleId}:`, error);
          return [];
        }),
      ]);

      return {
        moduleId,
        enabled: enabledById.get(moduleId) ?? true,
        adminTabs: definition.adminTabs ?? [],
        workflows,
        automationRules,
        cronJobs,
      };
    })
  );

  return results;
}
