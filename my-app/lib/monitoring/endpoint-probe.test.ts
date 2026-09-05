import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  findMany: vi.fn(),
  updateMany: vi.fn(),
  deleteMany: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRaw: mocks.queryRaw,
    monitoredEndpoint: { findMany: mocks.findMany, updateMany: mocks.updateMany },
    operationalLease: { deleteMany: mocks.deleteMany },
  },
}));
vi.mock('@/lib/flow/engine', () => ({ emitFlowEvent: vi.fn() }));

import { runMonitoredEndpointCycle } from './endpoint-probe';

describe('monitored endpoint cycle ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.queryRaw.mockResolvedValue([{ owner: 'lease-owner' }]);
    mocks.findMany.mockResolvedValue([]);
    mocks.deleteMany.mockResolvedValue({ count: 1 });
  });

  it('skips an overlapping cycle when the lease is held', async () => {
    mocks.queryRaw.mockResolvedValue([]);
    await expect(runMonitoredEndpointCycle()).resolves.toEqual({ checked: 0, transitions: 0, skipped: true });
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it('bounds the registered target read and releases its owner-specific lease', async () => {
    await expect(runMonitoredEndpointCycle()).resolves.toEqual({ checked: 0, transitions: 0 });
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 25 }));
    expect(mocks.deleteMany).toHaveBeenCalledWith({ where: { key: 'monitored-endpoint-cycle', owner: expect.any(String) } });
  });
});
