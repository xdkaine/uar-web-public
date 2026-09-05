import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isModuleEnabled: vi.fn(),
}));

vi.mock('@/lib/modules/core', () => ({
  isModuleEnabled: mocks.isModuleEnabled,
}));

import { MODULE_DISABLED_ERROR_CODE, requireModuleEnabled } from './guards';
import { ALL_MODULE_IDS } from './registry';

describe('requireModuleEnabled', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isModuleEnabled.mockResolvedValue(true);
  });

  it('lets enabled modules pass through with null', async () => {
    await expect(requireModuleEnabled('vpn.management')).resolves.toBeNull();
    expect(mocks.isModuleEnabled).toHaveBeenCalledWith('vpn.management');
  });

  it('returns a standardized 503 payload when the module is disabled', async () => {
    mocks.isModuleEnabled.mockResolvedValue(false);

    const response = await requireModuleEnabled('support.tickets');

    expect(response).not.toBeNull();
    expect(response!.status).toBe(503);
    const body = await response!.json();
    expect(body).toEqual({
      error: 'The support.tickets capability is currently disabled.',
      code: MODULE_DISABLED_ERROR_CODE,
      moduleId: 'support.tickets',
    });
    expect(MODULE_DISABLED_ERROR_CODE).toBe('MODULE_DISABLED');
  });

  it('echoes every registered module id through the same payload shape when disabled', async () => {
    mocks.isModuleEnabled.mockResolvedValue(false);

    for (const moduleId of ALL_MODULE_IDS) {
      const response = await requireModuleEnabled(moduleId);
      expect(response).not.toBeNull();
      expect(response!.status).toBe(503);
      const body = await response!.json();
      expect(body.code).toBe('MODULE_DISABLED');
      expect(body.moduleId).toBe(moduleId);
      expect(typeof body.error).toBe('string');
    }
  });

  it('treats unknown module ids as pass-through so future callers keep working', async () => {
    await expect(requireModuleEnabled('future.capability')).resolves.toBeNull();
  });
});
