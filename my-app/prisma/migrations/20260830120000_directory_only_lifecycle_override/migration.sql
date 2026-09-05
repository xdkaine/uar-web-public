-- Directory-only lifecycle overrides are additive. Existing actions retain
-- governed semantics and all evidence columns remain nullable for legacy rows.
ALTER TABLE "AccountLifecycleAction"
  ADD COLUMN "operationMode" TEXT NOT NULL DEFAULT 'governed',
  ADD COLUMN "targetDirectoryDn" TEXT,
  ADD COLUMN "targetDirectoryObjectGuid" TEXT,
  ADD COLUMN "bindingFailureCode" TEXT,
  ADD COLUMN "preflightSnapshot" JSONB,
  ADD COLUMN "resultSnapshot" JSONB,
  ADD COLUMN "authorizationEvidence" JSONB,
  ADD COLUMN "policyVersion" TEXT,
  ADD COLUMN "targetGroupObjectGuid" TEXT;

CREATE INDEX "AccountLifecycleAction_operationMode_idx"
  ON "AccountLifecycleAction"("operationMode");
