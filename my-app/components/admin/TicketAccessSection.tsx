"use client";
import { TicketAccessWorkspace } from "./TicketAccessWorkspace";
import { useTicketAccessState } from "./useTicketAccessState";
export function TicketAccessSection({
  ticketId,
  requesterName,
  requesterUsername,
}: {
  ticketId: string;
  requesterName?: string;
  requesterUsername?: string;
}) {
  return (
    <TicketAccessWorkspace
      ticketId={ticketId}
      requesterName={requesterName}
      requesterUsername={requesterUsername}
      {...useTicketAccessState(ticketId)}
    />
  );
}

export default TicketAccessSection;
