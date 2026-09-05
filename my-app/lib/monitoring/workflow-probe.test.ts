import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  updateMany: vi.fn(),
  outboxCreate: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: mocks.transaction,
  },
}));

import { persistWorkflowMonitorResult } from './workflow-probe';

const row = {
  id: 'check-1',
  graphId: 'graph-1',
  sourceNodeId: 'monitor-1',
  updatedAt: new Date('2026-08-28T00:00:00.000Z'),
};
const check = {
  key: 'portal', name: 'Portal', kind: 'https' as const, host: 'portal.example.test', port: 443,
  path: '/health', method: 'GET' as const, intervalSeconds: 60, timeoutMs: 5000,
  failureThreshold: 2, recoveryThreshold: 2, enabled: true,
};
const result = { reachable: false, latencyMs: 121, error: 'connection refused' };
const next = { currentState: 'down', consecutiveFailures: 2, consecutiveSuccesses: 0, transition: 'failed' as const };

describe('durable workflow monitor transitions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      workflowMonitorCheck: { updateMany: mocks.updateMany },
      flowEventOutbox: { create: mocks.outboxCreate },
    }));
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.outboxCreate.mockResolvedValue({ id: 'outbox-1' });
  });

  it('persists the state CAS and targeted outbox acceptance in one transaction', async () => {
    const checkedAt = new Date('2026-08-28T00:01:00.000Z');

    await expect(persistWorkflowMonitorResult(row, check, result, next, checkedAt))
      .resolves.toEqual({ id: 'outbox-1' });

    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'check-1', updatedAt: row.updatedAt, active: true },
      data: expect.objectContaining({ currentState: 'down', lastTransitionAt: checkedAt }),
    }));
    expect(mocks.outboxCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        graphId: 'graph-1',
        sourceNodeId: 'monitor-1',
        sourceHandle: 'failed',
      }),
    }));
  });

  it('does not enqueue after a lost state CAS and propagates outbox persistence failure', async () => {
    mocks.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(persistWorkflowMonitorResult(row, check, result, next, new Date())).resolves.toBeNull();
    expect(mocks.outboxCreate).not.toHaveBeenCalled();

    mocks.updateMany.mockResolvedValueOnce({ count: 1 });
    mocks.outboxCreate.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(persistWorkflowMonitorResult(row, check, result, next, new Date()))
      .rejects.toThrow('database unavailable');
  });
});
