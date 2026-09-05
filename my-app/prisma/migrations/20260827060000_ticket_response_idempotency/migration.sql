-- Optional client-generated request identifiers make response retries safe.
ALTER TABLE "TicketResponse" ADD COLUMN "clientRequestId" TEXT;

CREATE UNIQUE INDEX "TicketResponse_ticketId_clientRequestId_key"
  ON "TicketResponse"("ticketId", "clientRequestId");
