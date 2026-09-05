/**
 * Ticket creation notification orchestration (ADR-0007).
 *
 * A new ticket is always unassigned, so the configured default queue receives
 * the creation event and the creator receives a receipt. Delivery is
 * best-effort: failures are logged and never propagate to ticket creation.
 */

export interface TicketCreationNotificationInput {
  ticketId: string;
  subject: string;
  category?: string | null;
  severity?: string | null;
  body: string;
  username: string;
  /** Creator email resolved from directory-derived request data, when known. */
  creatorEmail?: string | null;
}

export async function sendTicketCreationNotifications(
  input: TicketCreationNotificationInput
): Promise<void> {
  const { ticketId, subject, category, severity, body, username, creatorEmail } = input;

  try {
    const { sendNewTicketNotificationToAdmin } = await import('@/lib/email');
    await sendNewTicketNotificationToAdmin({
      ticketId,
      subject,
      category,
      severity,
      username,
      userEmail: creatorEmail ?? null,
      body,
    });
  } catch (error) {
    console.error('[Ticket Creation] Failed to send admin notification:', error);
  }

  if (!creatorEmail) {
    return;
  }

  try {
    const { sendTicketReceiptToCreator } = await import('@/lib/email');
    await sendTicketReceiptToCreator({
      ticketId,
      subject,
      category,
      severity,
      userEmail: creatorEmail,
    });
  } catch (error) {
    console.error('[Ticket Creation] Failed to send creator receipt:', error);
  }
}
