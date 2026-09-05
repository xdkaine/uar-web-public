ALTER TABLE "FlowEventOutbox"
ADD COLUMN "lockToken" TEXT,
ADD COLUMN "lockedUntil" TIMESTAMP(3);

DROP INDEX "FlowEventOutbox_processedAt_nextAttemptAt_idx";
CREATE INDEX "FlowEventOutbox_processedAt_nextAttemptAt_lockedUntil_idx"
ON "FlowEventOutbox"("processedAt", "nextAttemptAt", "lockedUntil");
