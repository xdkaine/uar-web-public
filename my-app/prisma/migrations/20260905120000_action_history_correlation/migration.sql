-- Correlate the immutable VPN status projection with the lifecycle mutation
-- that also emits VPN activity and canonical audit evidence. Existing rows
-- remain nullable and are handled conservatively by the history reader.
ALTER TABLE "VPNAccountStatusLog"
  ADD COLUMN "lifecycleActionId" TEXT;

CREATE INDEX "VPNAccountStatusLog_lifecycleActionId_idx"
  ON "VPNAccountStatusLog"("lifecycleActionId");

ALTER TABLE "VPNAccountStatusLog"
  ADD CONSTRAINT "VPNAccountStatusLog_lifecycleActionId_fkey"
  FOREIGN KEY ("lifecycleActionId") REFERENCES "AccountLifecycleAction"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
