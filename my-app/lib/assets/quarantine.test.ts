import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  update: vi.fn(),
  pendingFindMany: vi.fn(),
  pendingDeleteMany: vi.fn(),
  ticketUpdateMany: vi.fn(),
  transaction: vi.fn(),
  deleteAssetBytes: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    quarantinedTicketAttachment: {
      findMany: mocks.findMany,
      update: mocks.update,
    },
    ticketAttachment: { findMany: mocks.pendingFindMany },
    $transaction: mocks.transaction,
  },
}));

vi.mock('@/lib/assets/storage', () => ({
  deleteAssetBytes: mocks.deleteAssetBytes,
}));

import { purgeExpiredQuarantinedAssets, reconcileStalePendingAttachments } from './quarantine';

describe('purgeExpiredQuarantinedAssets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findMany.mockResolvedValue([]);
    mocks.deleteAssetBytes.mockResolvedValue(undefined);
    mocks.update.mockResolvedValue({});
    mocks.pendingFindMany.mockResolvedValue([]);
    mocks.pendingDeleteMany.mockResolvedValue({ count: 1 });
    mocks.ticketUpdateMany.mockResolvedValue({ count: 1 });
    mocks.transaction.mockImplementation(async (callback) => callback({
      ticketAttachment: { deleteMany: mocks.pendingDeleteMany },
      supportTicket: { updateMany: mocks.ticketUpdateMany },
    }));
  });

  it('removes stale pending bytes and releases the ticket quota claim', async () => {
    const now = new Date('2026-08-27T08:00:00.000Z');
    mocks.pendingFindMany.mockResolvedValue([{ id: 'pending-1', ticketId: 'ticket-1', storageKey: 'pending.bin', sizeBytes: 1024 }]);

    await expect(reconcileStalePendingAttachments(now)).resolves.toEqual({ recovered: 1 });

    expect(mocks.pendingFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { scanStatus: 'pending', createdAt: { lte: new Date('2026-08-27T07:00:00.000Z') } },
    }));
    expect(mocks.deleteAssetBytes).toHaveBeenCalledWith('pending.bin');
    expect(mocks.pendingDeleteMany.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.deleteAssetBytes.mock.invocationCallOrder[0]
    );
    expect(mocks.ticketUpdateMany).toHaveBeenCalledWith({
      where: { id: 'ticket-1', attachmentCount: { gte: 1 }, attachmentBytes: { gte: BigInt(1024) } },
      data: { attachmentCount: { decrement: 1 }, attachmentBytes: { decrement: BigInt(1024) } },
    });
  });

  it('deletes sealed bytes before retaining a purged metadata record', async () => {
    const now = new Date('2026-08-27T08:00:00.000Z');
    mocks.findMany.mockResolvedValue([{ id: 'attachment-1', storageKey: 'sealed.bin' }]);

    await expect(purgeExpiredQuarantinedAssets(now)).resolves.toEqual({ purged: 1 });

    expect(mocks.findMany).toHaveBeenCalledWith({
      where: {
        quarantinedAt: { lte: new Date('2026-07-28T08:00:00.000Z') },
        purgedAt: null,
      },
      select: { id: true, storageKey: true },
      take: 100,
    });
    expect(mocks.deleteAssetBytes).toHaveBeenCalledWith('sealed.bin');
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: 'attachment-1' },
      data: { purgedAt: now },
    });
    expect(mocks.deleteAssetBytes.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.update.mock.invocationCallOrder[0]
    );
  });

  it('does not mark metadata purged when byte deletion fails', async () => {
    mocks.findMany.mockResolvedValue([{ id: 'attachment-1', storageKey: 'sealed.bin' }]);
    mocks.deleteAssetBytes.mockRejectedValue(new Error('asset store unavailable'));

    await expect(purgeExpiredQuarantinedAssets()).rejects.toThrow('asset store unavailable');
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
