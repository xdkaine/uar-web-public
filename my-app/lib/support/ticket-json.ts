/**
 * Prisma exposes SupportTicket.attachmentBytes as a bigint. JSON has no
 * bigint representation, so every API boundary that returns a ticket must
 * project it deliberately instead of spreading the raw Prisma model into a
 * Response. A decimal string preserves the exact value without risking
 * Number.MAX_SAFE_INTEGER truncation.
 */
export function serializeSupportTicket<T extends { attachmentBytes: bigint }>(
  ticket: T
): Omit<T, 'attachmentBytes'> & { attachmentBytes: string } {
  return {
    ...ticket,
    attachmentBytes: ticket.attachmentBytes.toString(),
  };
}
