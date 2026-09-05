-- Production-candidate durable claims and sensitive-token hardening.
--
-- Existing links are migrated to one-way hashes in the same transaction.  No
-- plaintext verification credential remains readable after this migration.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE "AccessRequest"
  ADD COLUMN "verificationTokenHash" TEXT,
  ADD COLUMN "accountUpdateState" TEXT,
  ADD COLUMN "accountUpdateClaimId" TEXT,
  ADD COLUMN "accountUpdateClaimedUntil" TIMESTAMP(3),
  ADD COLUMN "accountUpdateTargetLdapUsername" TEXT,
  ADD COLUMN "accountUpdateTargetVpnUsername" TEXT,
  ADD COLUMN "accountUpdateOutcome" JSONB,
  ADD COLUMN "accountUpdateError" TEXT;

CREATE UNIQUE INDEX "AccessRequest_verificationTokenHash_key"
  ON "AccessRequest"("verificationTokenHash");
CREATE INDEX "AccessRequest_verificationTokenHash_idx"
  ON "AccessRequest"("verificationTokenHash");

UPDATE "AccessRequest"
SET
  "verificationTokenHash" = encode(digest("verificationToken", 'sha256'), 'hex'),
  "verificationToken" = NULL
WHERE "verificationToken" IS NOT NULL;
CREATE INDEX "AccessRequest_accountUpdateState_accountUpdateClaimedUntil_idx"
  ON "AccessRequest"("accountUpdateState", "accountUpdateClaimedUntil");

ALTER TABLE "MassEmailRecipient"
  ADD COLUMN "emailClaimId" TEXT,
  ADD COLUMN "emailClaimedUntil" TIMESTAMP(3),
  ADD COLUMN "deliveryAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "deliveryFailureCounted" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "MassEmailRecipient_emailClaimId_key"
  ON "MassEmailRecipient"("emailClaimId");
CREATE INDEX "MassEmailRecipient_status_emailClaimedUntil_idx"
  ON "MassEmailRecipient"("status", "emailClaimedUntil");

ALTER TABLE "MassEmailCampaign"
  ADD COLUMN "activationClaimId" TEXT,
  ADD COLUMN "activationClaimedUntil" TIMESTAMP(3);
CREATE UNIQUE INDEX "MassEmailCampaign_activationClaimId_key" ON "MassEmailCampaign"("activationClaimId");
CREATE INDEX "MassEmailCampaign_status_activationClaimedUntil_idx" ON "MassEmailCampaign"("status", "activationClaimedUntil");

-- A pre-cutover sender can no longer prove whether SMTP accepted a message.
-- Preserve that ambiguity for explicit operator reconciliation.
UPDATE "MassEmailRecipient"
SET
  "status" = 'delivery_unknown',
  "failedAt" = COALESCE("failedAt", CURRENT_TIMESTAMP),
  "lastError" = COALESCE(
    "lastError",
    'Send was in progress during durable-claim migration; delivery outcome is unknown'
  )
WHERE "status" = 'sending';

ALTER TABLE "OffboardCampaignRecipient"
  ADD COLUMN "enforcementClaimId" TEXT,
  ADD COLUMN "enforcementClaimedUntil" TIMESTAMP(3),
  ADD COLUMN "enforcementFailureCounted" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "enforcementExpectedVpn" BOOLEAN;

CREATE UNIQUE INDEX "OffboardCampaignRecipient_enforcementClaimId_key"
  ON "OffboardCampaignRecipient"("enforcementClaimId");
CREATE INDEX "OffboardCampaignRecipient_status_enforcementClaimedUntil_idx"
  ON "OffboardCampaignRecipient"("status", "enforcementClaimedUntil");

UPDATE "OffboardCampaignRecipient"
SET
  "status" = 'enforcement_reconciliation_required',
  "enforcementError" = COALESCE(
    "enforcementError",
    'Enforcement was in progress during durable-claim migration; external outcome is unknown'
  ),
  "lastError" = COALESCE(
    "lastError",
    'Operator evidence is required before enforcement can continue'
  )
WHERE "status" = 'enforcement_processing';

ALTER TABLE "FlowTimer"
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN "claimId" TEXT,
  ADD COLUMN "claimedAt" TIMESTAMP(3),
  ADD COLUMN "claimedUntil" TIMESTAMP(3),
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastError" TEXT;

DROP INDEX IF EXISTS "FlowTimer_dueAt_idx";
CREATE UNIQUE INDEX "FlowTimer_claimId_key" ON "FlowTimer"("claimId");
CREATE INDEX "FlowTimer_status_dueAt_idx" ON "FlowTimer"("status", "dueAt");
CREATE INDEX "FlowTimer_status_claimedUntil_idx" ON "FlowTimer"("status", "claimedUntil");

ALTER TABLE "FlowRun" ADD COLUMN "context" JSONB;

CREATE TABLE "FlowActionAttempt" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "runId" TEXT NOT NULL,
  "nodeId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'sending',
  "claimId" TEXT,
  "claimedAt" TIMESTAMP(3),
  "claimedUntil" TIMESTAMP(3),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "messageId" TEXT,
  "lastError" TEXT,
  "outcome" JSONB,
  CONSTRAINT "FlowActionAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FlowActionAttempt_claimId_key" ON "FlowActionAttempt"("claimId");
CREATE UNIQUE INDEX "FlowActionAttempt_runId_nodeId_key" ON "FlowActionAttempt"("runId", "nodeId");
CREATE INDEX "FlowActionAttempt_status_claimedUntil_idx" ON "FlowActionAttempt"("status", "claimedUntil");

ALTER TABLE "FlowActionAttempt"
  ADD CONSTRAINT "FlowActionAttempt_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "FlowRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ProviderLogoutTask" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "username" TEXT NOT NULL,
  "providerSid" TEXT NOT NULL,
  "providerSidHash" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "claimId" TEXT,
  "claimedAt" TIMESTAMP(3),
  "claimedUntil" TIMESTAMP(3),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "completedAt" TIMESTAMP(3),
  "lastError" TEXT,
  CONSTRAINT "ProviderLogoutTask_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProviderLogoutTask_providerSidHash_key" ON "ProviderLogoutTask"("providerSidHash");
CREATE UNIQUE INDEX "ProviderLogoutTask_claimId_key" ON "ProviderLogoutTask"("claimId");
CREATE INDEX "ProviderLogoutTask_status_claimedUntil_idx" ON "ProviderLogoutTask"("status", "claimedUntil");
CREATE INDEX "ProviderLogoutTask_username_createdAt_idx" ON "ProviderLogoutTask"("username", "createdAt");
