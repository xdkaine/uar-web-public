import { prisma } from '@/lib/prisma';
import { ALL_MODULE_IDS } from './registry';

// Shared transaction fence for module-state mutations and destructive
// operations whose authorization depends on a module remaining enabled.
export const MODULE_STATE_LOCK_NAMESPACE = 639117;

export class ModuleDisabledError extends Error {
  readonly moduleId: string;

  constructor(moduleId: string) {
    super(`Module "${moduleId}" is disabled`);
    this.name = 'ModuleDisabledError';
    this.moduleId = moduleId;
  }
}

interface ModuleStateRow {
  moduleId: string;
  enabled: boolean;
}

let cachedStates: Map<string, boolean> | null = null;
let lastFetchTime = 0;
const CACHE_TTL = 30000;

function applyStates(target: Map<string, boolean>, rows: ModuleStateRow[]): Map<string, boolean> {
  for (const id of ALL_MODULE_IDS) {
    target.set(id, true);
  }
  for (const row of rows) {
    target.set(row.moduleId, row.enabled);
  }
  return target;
}

async function fetchStates(): Promise<Map<string, boolean>> {
  try {
    const rows = await prisma.moduleState.findMany();
    cachedStates = applyStates(new Map(), rows);
    lastFetchTime = Date.now();
    return cachedStates;
  } catch (error) {
    // Fail open to defaults (all enabled) so a configuration-store outage
    // cannot take unrelated capabilities down. This matches the pre-module
    // behavior where no state existed at all.
    console.error('[Modules] Failed to load module states, using defaults:', error);
    return applyStates(new Map(), []);
  }
}

async function resolveStates(): Promise<Map<string, boolean>> {
  if (cachedStates && Date.now() - lastFetchTime < CACHE_TTL) {
    return cachedStates;
  }
  return fetchStates();
}

/**
 * Whether a capability is enabled. Unknown module ids are treated as enabled
 * so callers wired to future modules cannot silently break.
 */
export async function isModuleEnabled(moduleId: string): Promise<boolean> {
  const states = await resolveStates();
  return states.get(moduleId) ?? true;
}

/**
 * Resolve a module without the ordinary fail-open cache behavior. Destructive
 * operations use this so a configuration-store outage cannot be interpreted
 * as authorization to delete data. A missing row still means enabled.
 */
export async function isModuleEnabledStrict(moduleId: string): Promise<boolean> {
  const row = await prisma.moduleState.findUnique({ where: { moduleId } });
  return row?.enabled ?? true;
}

/** Inverse convenience for guard clauses in shared business logic. */
export async function isModuleDisabled(moduleId: string): Promise<boolean> {
  return !(await isModuleEnabled(moduleId));
}

/**
 * Throws when the module is disabled. Used inside lib/ services and route
 * bodies where a response object is not available.
 */
export async function assertModuleEnabled(moduleId: string): Promise<void> {
  if (!(await isModuleEnabled(moduleId))) {
    throw new ModuleDisabledError(moduleId);
  }
}

export function clearModuleStateCache(): void {
  cachedStates = null;
  lastFetchTime = 0;
}

export async function getResolvedModuleStates(): Promise<Array<{ moduleId: string; enabled: boolean; overridden: boolean }>> {
  let rows: ModuleStateRow[] = [];
  try {
    rows = await prisma.moduleState.findMany();
  } catch (error) {
    console.error('[Modules] Failed to load module states:', error);
  }
  const overrides = new Map(rows.map((row) => [row.moduleId, row.enabled]));
  return ALL_MODULE_IDS.map((moduleId) => ({
    moduleId,
    enabled: overrides.get(moduleId) ?? true,
    overridden: overrides.has(moduleId),
  }));
}
