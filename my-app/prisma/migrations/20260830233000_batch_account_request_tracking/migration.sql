ALTER TABLE "BatchAccountItem"
  ADD COLUMN "accessRequestId" TEXT,
  ADD COLUMN "targetDirectoryDn" TEXT,
  ADD COLUMN "targetDirectoryObjectGuid" TEXT,
  ADD COLUMN "mutationStage" TEXT;

ALTER TABLE "BatchAccountCreation"
  ADD COLUMN "processingClaimId" TEXT,
  ADD COLUMN "processingClaimedUntil" TIMESTAMP(3);

CREATE UNIQUE INDEX "BatchAccountItem_accessRequestId_key"
  ON "BatchAccountItem"("accessRequestId");

CREATE INDEX "BatchAccountItem_accessRequestId_idx"
  ON "BatchAccountItem"("accessRequestId");

CREATE INDEX "BatchAccountCreation_status_processingClaimedUntil_idx"
  ON "BatchAccountCreation"("status", "processingClaimedUntil");

ALTER TABLE "BatchAccountItem"
  ADD CONSTRAINT "BatchAccountItem_accessRequestId_fkey"
  FOREIGN KEY ("accessRequestId") REFERENCES "AccessRequest"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
