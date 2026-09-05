import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  cloneReadOnly: vi.fn(),
  processAllQueuedActions: vi.fn(),
  processMassEmailCampaigns: vi.fn(),
  runGuardedOffboardScheduler: vi.fn(),
  drainProviderLogoutTasks: vi.fn(),
  runCronWithObservability: vi.fn(),
}));

vi.mock('@/lib/clone-safety', () => ({ isProductionCloneReadOnly: mocks.cloneReadOnly }));
vi.mock('@/lib/lifecycle-processor', () => ({ processAllQueuedActions: mocks.processAllQueuedActions }));
vi.mock('@/lib/mass-email', () => ({ processMassEmailCampaigns: mocks.processMassEmailCampaigns }));
vi.mock('@/lib/offboard-scheduler', () => ({ runGuardedOffboardScheduler: mocks.runGuardedOffboardScheduler }));
vi.mock('@/lib/auth/provider-logout-audit', () => ({ drainProviderLogoutTasks: mocks.drainProviderLogoutTasks }));
vi.mock('@/lib/cron/observability', () => ({ runCronWithObservability: mocks.runCronWithObservability }));
vi.mock('@/lib/modules/core', () => ({ isModuleDisabled: vi.fn() }));
vi.mock('@/lib/timing-safe', () => ({ bearerTokenMatches: vi.fn(() => true) }));
vi.mock('@/lib/logger', () => ({
  appLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { GET, POST } from './route';

describe('lifecycle queue cron clone safety', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = 'test-cron-secret';
    mocks.cloneReadOnly.mockReturnValue(true);
  });

  it.each([
    ['GET', GET],
    ['POST', POST],
  ])('rejects authenticated %s requests before any queue work', async (method, handler) => {
    const request = new NextRequest('http://localhost/api/cron/process-lifecycle-queue', {
      method,
      headers: { authorization: 'Bearer test-cron-secret' },
    });

    const response = await handler(request);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'CLONE_READ_ONLY' });
    expect(mocks.runCronWithObservability).not.toHaveBeenCalled();
    expect(mocks.runGuardedOffboardScheduler).not.toHaveBeenCalled();
    expect(mocks.processMassEmailCampaigns).not.toHaveBeenCalled();
    expect(mocks.drainProviderLogoutTasks).not.toHaveBeenCalled();
    expect(mocks.processAllQueuedActions).not.toHaveBeenCalled();
  });
});
