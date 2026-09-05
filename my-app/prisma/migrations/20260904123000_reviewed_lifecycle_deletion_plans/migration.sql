-- Additive metadata for server-owned, reviewed bulk deletion plans.
ALTER TABLE "AccountLifecycleBatch"
  ADD COLUMN "idempotencyKey" TEXT,
  ADD COLUMN "policyVersion" TEXT,
  ADD COLUMN "selectionDigest" TEXT,
  ADD COLUMN "authorizationEvidence" JSONB,
  ADD COLUMN "resultSummary" JSONB,
  ADD COLUMN "totalTargets" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "sourceBatchId" TEXT,
  ADD COLUMN "expiresAt" TIMESTAMP(3),
  ADD COLUMN "confirmedAt" TIMESTAMP(3),
  ADD COLUMN "confirmedBy" TEXT;

ALTER TABLE "AccountLifecycleAction"
  ADD COLUMN "planTargetKey" TEXT,
  ADD COLUMN "planOrdinal" INTEGER;

CREATE UNIQUE INDEX "AccountLifecycleBatch_idempotencyKey_key"
  ON "AccountLifecycleBatch"("idempotencyKey");

CREATE INDEX "AccountLifecycleBatch_sourceBatchId_idx"
  ON "AccountLifecycleBatch"("sourceBatchId");

CREATE INDEX "AccountLifecycleBatch_expiresAt_idx"
  ON "AccountLifecycleBatch"("expiresAt");

CREATE UNIQUE INDEX "AccountLifecycleAction_batchId_planTargetKey_actionType_key"
  ON "AccountLifecycleAction"("batchId", "planTargetKey", "actionType");

CREATE UNIQUE INDEX "AccountLifecycleAction_batchId_planOrdinal_key"
  ON "AccountLifecycleAction"("batchId", "planOrdinal");
