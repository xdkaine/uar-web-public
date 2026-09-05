-- Portal-owned shared contracts for device binding and normalized IdP audit
-- filtering. All columns are nullable so old portal/auth-service binaries
-- remain compatible while the rollout is in shadow mode.

ALTER TABLE "Session"
  ADD COLUMN IF NOT EXISTS "deviceBindingState" TEXT,
  ADD COLUMN IF NOT EXISTS "deviceCookieHash" TEXT,
  ADD COLUMN IF NOT EXISTS "fingerprintVersion" INTEGER,
  ADD COLUMN IF NOT EXISTS "fingerprintHash" TEXT,
  ADD COLUMN IF NOT EXISTS "deviceVerifiedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "riskLevel" TEXT;

CREATE INDEX IF NOT EXISTS "Session_riskLevel_createdAt_idx" ON "Session"("riskLevel", "createdAt");

ALTER TABLE "AuditLog"
  ADD COLUMN IF NOT EXISTS "clientId" TEXT,
  ADD COLUMN IF NOT EXISTS "providerSid" TEXT,
  ADD COLUMN IF NOT EXISTS "riskLevel" TEXT;

CREATE INDEX IF NOT EXISTS "AuditLog_clientId_createdAt_idx" ON "AuditLog"("clientId", "createdAt");
CREATE INDEX IF NOT EXISTS "AuditLog_riskLevel_createdAt_idx" ON "AuditLog"("riskLevel", "createdAt");
CREATE INDEX IF NOT EXISTS "AuditLog_outcome_createdAt_idx" ON "AuditLog"("outcome", "createdAt");
