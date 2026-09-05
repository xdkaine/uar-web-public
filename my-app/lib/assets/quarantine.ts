import { deleteAssetBytes } from '@/lib/assets/storage';
import { prisma } from '@/lib/prisma';

export const QUARANTINE_RETENTION_DAYS = 30;
export const PENDING_ATTACHMENT_RECOVERY_MINUTES = 60;

export async function reconcileStalePendingAttachments(now = new Date()): Promise<{ recovered: number }> {
  const cutoff = new Date(now.getTime() - PENDING_ATTACHMENT_RECOVERY_MINUTES * 60 * 1000);
  const stale = await prisma.ticketAttachment.findMany({
    where: { scanStatus: 'pending', createdAt: { lte: cutoff } },
    select: { id: true, ticketId: true, storageKey: true, sizeBytes: true },
    take: 100,
  });
  let recovered = 0;
  for (const attachment of stale) {
    const removed = await prisma.$transaction(async (tx) => {
      const removed = await tx.ticketAttachment.deleteMany({
        where: { id: attachment.id, scanStatus: 'pending' },
      });
      if (removed.count !== 1) return false;
      await tx.supportTicket.updateMany({
        where: {
          id: attachment.ticketId,
          attachmentCount: { gte: 1 },
          attachmentBytes: { gte: BigInt(attachment.sizeBytes) },
        },
        data: {
          attachmentCount: { decrement: 1 },
          attachmentBytes: { decrement: BigInt(attachment.sizeBytes) },
        },
      });
      return true;
    });
    if (!removed) continue;
    await deleteAssetBytes(attachment.storageKey);
    recovered += 1;
  }
  return { recovered };
}

export async function purgeExpiredQuarantinedAssets(now = new Date()): Promise<{ purged: number }> {
  const cutoff = new Date(now.getTime() - QUARANTINE_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const expired = await prisma.quarantinedTicketAttachment.findMany({
    where: {
      quarantinedAt: { lte: cutoff },
      purgedAt: null,
    },
    select: { id: true, storageKey: true },
    take: 100,
  });

  let purged = 0;
  for (const attachment of expired) {
    await deleteAssetBytes(attachment.storageKey);
    await prisma.quarantinedTicketAttachment.update({
      where: { id: attachment.id },
      data: { purgedAt: now },
    });
    purged += 1;
  }
  return { purged };
}
