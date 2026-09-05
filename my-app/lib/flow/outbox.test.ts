import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  findMany: vi.fn(),
  updateMany: vi.fn(),
  emitFlowEvent: vi.fn(),
  startFlowRunFromSource: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    flowEventOutbox: {
      findUnique: mocks.findUnique,
      findMany: mocks.findMany,
      updateMany: mocks.updateMany,
    },
  },
}));

vi.mock('@/lib/flow/engine', () => ({
  emitFlowEvent: mocks.emitFlowEvent,
  startFlowRunFromSource: mocks.startFlowRunFromSource,
}));

import { deliverFlowEventOutboxById, drainFlowEventOutbox } from './outbox';

const EVENT = {
  id: 'outbox-1',
  triggerKey: 'attachment_malware_detected',
  eventKey: 'attachment_malware:q-1',
  context: { attachmentId: 'q-1' },
  graphId: null,
  sourceNodeId: null,
  sourceHandle: null,
  attempts: 0,
  processedAt: null,
  lockToken: expect.any(String),
};

describe('workflow event outbox', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findUnique.mockImplementation(async () => ({
      ...EVENT,
      lockToken: mocks.updateMany.mock.calls[0]?.[0]?.data?.lockToken,
    }));
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.emitFlowEvent.mockResolvedValue(1);
    mocks.startFlowRunFromSource.mockResolvedValue(true);
  });

  it('delivers a targeted source event without broadcasting it', async () => {
    mocks.findUnique.mockImplementation(async () => ({
      ...EVENT,
      triggerKey: 'targeted_source',
      graphId: 'graph-1',
      sourceNodeId: 'monitor-1',
      sourceHandle: 'failed',
      lockToken: mocks.updateMany.mock.calls[0]?.[0]?.data?.lockToken,
    }));

    await expect(deliverFlowEventOutboxById('outbox-1')).resolves.toBe(true);

    expect(mocks.startFlowRunFromSource).toHaveBeenCalledWith(
      'graph-1',
      'monitor-1',
      'failed',
      EVENT.eventKey,
      EVENT.context,
      { acceptedWhileActive: true }
    );
    expect(mocks.emitFlowEvent).not.toHaveBeenCalled();
  });

  it('retains a targeted transition when run acceptance is temporarily unavailable', async () => {
    mocks.findUnique.mockImplementation(async () => ({
      ...EVENT,
      graphId: 'graph-1',
      sourceNodeId: 'monitor-1',
      sourceHandle: 'recovered',
      lockToken: mocks.updateMany.mock.calls[0]?.[0]?.data?.lockToken,
    }));
    mocks.startFlowRunFromSource.mockResolvedValue(false);

    await expect(deliverFlowEventOutboxById('outbox-1')).resolves.toBe(false);

    expect(mocks.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        lastError: 'Target workflow version is unavailable',
        nextAttemptAt: expect.any(Date),
      }),
    }));
    expect(mocks.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ processedAt: expect.any(Date) }),
    }));
  });

  it('marks an event processed only after workflow delivery succeeds', async () => {
    await expect(deliverFlowEventOutboxById('outbox-1')).resolves.toBe(true);
    expect(mocks.emitFlowEvent).toHaveBeenCalledWith(
      EVENT.triggerKey,
      EVENT.eventKey,
      EVENT.context,
      { throwOnInfrastructureFailure: true }
    );
    expect(mocks.updateMany).toHaveBeenLastCalledWith({
      where: { id: EVENT.id, processedAt: null, lockToken: expect.any(String) },
      data: {
        processedAt: expect.any(Date),
        attempts: { increment: 1 },
        lastError: null,
        lockToken: null,
        lockedUntil: null,
      },
    });
  });

  it('retains a failed event with bounded exponential retry metadata', async () => {
    mocks.emitFlowEvent.mockRejectedValue(new Error('engine unavailable'));

    await expect(deliverFlowEventOutboxById('outbox-1')).resolves.toBe(false);
    expect(mocks.updateMany).toHaveBeenLastCalledWith({
      where: { id: EVENT.id, processedAt: null, lockToken: expect.any(String) },
      data: expect.objectContaining({
        attempts: { increment: 1 },
        lastError: 'engine unavailable',
        nextAttemptAt: expect.any(Date),
        lockToken: null,
        lockedUntil: null,
      }),
    });
  });

  it('allows only one worker to claim a row and cannot mark a failed first delivery as processed', async () => {
    let releaseFirst!: () => void;
    const firstDelivery = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    mocks.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });
    mocks.emitFlowEvent.mockImplementationOnce(async () => {
      await firstDelivery;
      throw new Error('first worker crashed');
    });

    const first = deliverFlowEventOutboxById('outbox-1');
    await vi.waitFor(() => expect(mocks.emitFlowEvent).toHaveBeenCalledTimes(1));
    const second = await deliverFlowEventOutboxById('outbox-1');
    releaseFirst();

    await expect(first).resolves.toBe(false);
    expect(second).toBe(false);
    expect(mocks.emitFlowEvent).toHaveBeenCalledTimes(1);
    expect(mocks.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ processedAt: expect.any(Date) }),
    }));
  });

  it('drains only due unprocessed rows', async () => {
    mocks.findMany.mockResolvedValue([{ id: 'outbox-1' }]);
    await expect(drainFlowEventOutbox()).resolves.toEqual({ processed: 1, failed: 0 });
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        processedAt: null,
        nextAttemptAt: { lte: expect.any(Date) },
        OR: [{ lockedUntil: null }, { lockedUntil: { lte: expect.any(Date) } }],
      },
      take: 50,
    }));
  });
});
