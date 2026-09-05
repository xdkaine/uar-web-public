import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  findUnique: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    moduleState: {
      findMany: mocks.findMany,
      findUnique: mocks.findUnique,
    },
  },
}));

import {
  assertModuleEnabled,
  clearModuleStateCache,
  getResolvedModuleStates,
  isModuleDisabled,
  isModuleEnabled,
  isModuleEnabledStrict,
  ModuleDisabledError,
} from './core';
import { ALL_MODULE_IDS, MODULE_REGISTRY } from './registry';

beforeEach(() => {
  vi.clearAllMocks();
  clearModuleStateCache();
});

describe('module state resolution', () => {
  it('treats missing rows as enabled so first deployment preserves behavior', async () => {
    mocks.findMany.mockResolvedValue([]);

    expect(await isModuleEnabled('vpn.management')).toBe(true);
    expect(await isModuleDisabled('vpn.management')).toBe(false);
  });

  it('applies stored overrides', async () => {
    mocks.findMany.mockResolvedValue([{ moduleId: 'vpn.management', enabled: false }]);

    expect(await isModuleEnabled('vpn.management')).toBe(false);
    expect(await isModuleDisabled('vpn.management')).toBe(true);
  });

  it('caches states until invalidated', async () => {
    mocks.findMany.mockResolvedValue([{ moduleId: 'vpn.management', enabled: false }]);
    expect(await isModuleEnabled('vpn.management')).toBe(false);

    clearModuleStateCache();
    mocks.findMany.mockResolvedValue([]);
    expect(await isModuleEnabled('vpn.management')).toBe(true);
  });

  it('fails open to defaults when the store is unreadable', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.findMany.mockRejectedValue(new Error('db down'));

    expect(await isModuleEnabled('vpn.management')).toBe(true);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('strict resolution preserves the missing-row default but propagates store failures', async () => {
    mocks.findUnique.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('db down'));

    await expect(isModuleEnabledStrict('vpn.management')).resolves.toBe(true);
    await expect(isModuleEnabledStrict('vpn.management')).rejects.toThrow('db down');
  });

  it('throws ModuleDisabledError from assertModuleEnabled', async () => {
    mocks.findMany.mockResolvedValue([{ moduleId: 'vpn.management', enabled: false }]);

    await expect(assertModuleEnabled('vpn.management')).rejects.toMatchObject({
      name: 'ModuleDisabledError',
      moduleId: 'vpn.management',
    });
    await expect(ModuleDisabledError).toBeDefined();
  });

  it('treats unknown module ids as enabled', async () => {
    mocks.findMany.mockResolvedValue([]);

    expect(await isModuleEnabled('future.thing')).toBe(true);
  });
});

describe('resolved state reporting', () => {
  it('reports override provenance for the configuration UI', async () => {
    mocks.findMany.mockResolvedValue([{ moduleId: 'vpn.management', enabled: false }]);

    const states = await getResolvedModuleStates();
    expect(states).toHaveLength(ALL_MODULE_IDS.length);
    expect(states.find((s) => s.moduleId === 'vpn.management')).toMatchObject({
      enabled: false,
      overridden: true,
    });
  });
});

describe('registry integrity', () => {
  it('defines every registered module with impact metadata', () => {
    for (const definition of Object.values(MODULE_REGISTRY)) {
      expect(definition.name.length).toBeGreaterThan(0);
      expect(definition.description.length).toBeGreaterThan(0);
      expect(Array.isArray(definition.disableImpact)).toBe(true);
      expect(definition.disableImpact.length).toBeGreaterThan(0);
    }
  });
});
