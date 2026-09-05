BEGIN;

CREATE TABLE "OffboardOperationRun" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "campaignId" TEXT NOT NULL,
  "actor" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "digest" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'previewed',
  "claimId" TEXT,
  "claimedAt" TIMESTAMP(3),
  "claimedUntil" TIMESTAMP(3),
  "idempotencyKey" TEXT,
  "summary" JSONB,
  CONSTRAINT "OffboardOperationRun_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OffboardOperationRun_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "OffboardCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "OffboardOperationRunItem" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "runId" TEXT NOT NULL,
  "recipientId" TEXT,
  "position" INTEGER NOT NULL,
  "expectedState" JSONB NOT NULL,
  "actions" JSONB NOT NULL,
  "conflicts" JSONB NOT NULL,
  "outcome" JSONB,
  "status" TEXT NOT NULL DEFAULT 'previewed',
  CONSTRAINT "OffboardOperationRunItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OffboardOperationRunItem_runId_fkey" FOREIGN KEY ("runId") REFERENCES "OffboardOperationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "OffboardOperationRunItem_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "OffboardCampaignRecipient"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "OffboardOperationRun_claimId_key" ON "OffboardOperationRun"("claimId");
CREATE UNIQUE INDEX "OffboardOperationRun_idempotencyKey_key" ON "OffboardOperationRun"("idempotencyKey");
CREATE INDEX "OffboardOperationRun_campaignId_kind_createdAt_idx" ON "OffboardOperationRun"("campaignId", "kind", "createdAt");
CREATE INDEX "OffboardOperationRun_status_expiresAt_idx" ON "OffboardOperationRun"("status", "expiresAt");
CREATE UNIQUE INDEX "OffboardOperationRunItem_runId_position_key" ON "OffboardOperationRunItem"("runId", "position");
CREATE INDEX "OffboardOperationRunItem_recipientId_idx" ON "OffboardOperationRunItem"("recipientId");
CREATE INDEX "OffboardOperationRunItem_runId_status_idx" ON "OffboardOperationRunItem"("runId", "status");

COMMIT;
