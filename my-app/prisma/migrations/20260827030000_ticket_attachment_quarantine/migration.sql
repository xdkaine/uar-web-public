ALTER TABLE "TicketAttachment"
  ADD COLUMN "scanStatus" TEXT NOT NULL DEFAULT 'legacy_unscanned',
  ADD COLUMN "scannedAt" TIMESTAMP(3),
  ADD COLUMN "forceDownload" BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX "TicketAttachment_scanStatus_idx" ON "TicketAttachment"("scanStatus");

ALTER TABLE "SupportTicket"
  ADD COLUMN "internalOnly" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "attachmentCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "attachmentBytes" BIGINT NOT NULL DEFAULT 0;

UPDATE "SupportTicket" AS ticket
SET
  "attachmentCount" = totals."attachmentCount",
  "attachmentBytes" = totals."attachmentBytes"
FROM (
  SELECT "ticketId", COUNT(*)::INTEGER AS "attachmentCount", COALESCE(SUM("sizeBytes"), 0)::BIGINT AS "attachmentBytes"
  FROM "TicketAttachment"
  GROUP BY "ticketId"
) AS totals
WHERE ticket."id" = totals."ticketId";

CREATE INDEX "SupportTicket_internalOnly_status_idx"
  ON "SupportTicket"("internalOnly", "status");

CREATE TABLE "QuarantinedTicketAttachment" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ticketId" TEXT NOT NULL,
  "filename" TEXT NOT NULL,
  "contentType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "sha256" TEXT NOT NULL,
  "storageKey" TEXT NOT NULL,
  "uploadedBy" TEXT NOT NULL,
  "scanSignature" TEXT,
  "quarantinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "purgedAt" TIMESTAMP(3),
  CONSTRAINT "QuarantinedTicketAttachment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "QuarantinedTicketAttachment_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "QuarantinedTicketAttachment_storageKey_key" ON "QuarantinedTicketAttachment"("storageKey");
CREATE INDEX "QuarantinedTicketAttachment_ticketId_idx" ON "QuarantinedTicketAttachment"("ticketId");
CREATE INDEX "QuarantinedTicketAttachment_quarantinedAt_purgedAt_idx" ON "QuarantinedTicketAttachment"("quarantinedAt", "purgedAt");

CREATE TABLE "FlowEventOutbox" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "triggerKey" TEXT NOT NULL,
  "eventKey" TEXT NOT NULL,
  "context" JSONB NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  "lastError" TEXT,
  CONSTRAINT "FlowEventOutbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FlowEventOutbox_eventKey_key" ON "FlowEventOutbox"("eventKey");
CREATE INDEX "FlowEventOutbox_processedAt_nextAttemptAt_idx" ON "FlowEventOutbox"("processedAt", "nextAttemptAt");
