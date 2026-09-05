BEGIN;

ALTER TABLE "OffboardCampaign"
  ADD COLUMN "workflowMode" TEXT NOT NULL DEFAULT 'verification',
  ADD COLUMN "executionPaused" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "directExecutionCompletedAt" TIMESTAMP(3),
  ADD COLUMN "activationOperationRunId" TEXT,
  ADD COLUMN "directOffboardReason" TEXT,
  ADD COLUMN "directOffboardReference" TEXT,
  ADD COLUMN "directAcknowledgedAt" TIMESTAMP(3),
  ADD COLUMN "directAcknowledgedBy" TEXT,
  ADD COLUMN "finalNoticeSentCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "finalNoticeFailureCount" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "OffboardOperationRun"
  ADD COLUMN "policyVersion" TEXT,
  ADD COLUMN "authorizationEvidence" JSONB;

ALTER TABLE "OffboardCampaignRecipient"
  ADD COLUMN "targetDirectoryObjectGuid" TEXT,
  ADD COLUMN "expectedRequestVersion" INTEGER,
  ADD COLUMN "enforcementExpectedAd" BOOLEAN,
  ADD COLUMN "finalNoticeStatus" TEXT NOT NULL DEFAULT 'not_applicable',
  ADD COLUMN "finalNoticeClaimId" TEXT,
  ADD COLUMN "finalNoticeClaimedAt" TIMESTAMP(3),
  ADD COLUMN "finalNoticeClaimedUntil" TIMESTAMP(3),
  ADD COLUMN "finalNoticeSentAt" TIMESTAMP(3),
  ADD COLUMN "finalNoticeMessageId" TEXT,
  ADD COLUMN "finalNoticeError" TEXT;

ALTER TABLE "AccountLifecycleAction"
  ADD COLUMN "offboardOperationRunId" TEXT;

ALTER TABLE "AccountLifecycleAction"
  ADD CONSTRAINT "AccountLifecycleAction_offboardOperationRunId_fkey"
  FOREIGN KEY ("offboardOperationRunId") REFERENCES "OffboardOperationRun"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "OffboardCampaign_workflowMode_status_idx"
  ON "OffboardCampaign"("workflowMode", "status");
CREATE UNIQUE INDEX "OffboardCampaignRecipient_finalNoticeClaimId_key"
  ON "OffboardCampaignRecipient"("finalNoticeClaimId");
CREATE INDEX "OffboardCampaignRecipient_finalNoticeStatus_finalNoticeClaimedUntil_idx"
  ON "OffboardCampaignRecipient"("finalNoticeStatus", "finalNoticeClaimedUntil");
CREATE INDEX "AccountLifecycleAction_offboardOperationRunId_idx"
  ON "AccountLifecycleAction"("offboardOperationRunId");

CREATE TABLE "VpnIdentityOffboardFence" (
  "canonicalAdUsername" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "recipientId" TEXT NOT NULL,
  "blockedAccessRequestId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VpnIdentityOffboardFence_pkey" PRIMARY KEY ("canonicalAdUsername"),
  CONSTRAINT "VpnIdentityOffboardFence_campaignId_fkey"
    FOREIGN KEY ("campaignId") REFERENCES "OffboardCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "VpnIdentityOffboardFence_recipientId_fkey"
    FOREIGN KEY ("recipientId") REFERENCES "OffboardCampaignRecipient"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "VpnIdentityOffboardFence_recipientId_key"
  ON "VpnIdentityOffboardFence"("recipientId");
CREATE INDEX "VpnIdentityOffboardFence_campaignId_idx"
  ON "VpnIdentityOffboardFence"("campaignId");
CREATE INDEX "VpnIdentityOffboardFence_blockedAccessRequestId_idx"
  ON "VpnIdentityOffboardFence"("blockedAccessRequestId");

-- Existing duplicate live identities intentionally block this migration until
-- an operator reconciles them. Revoked/disabled history remains unrestricted.
CREATE UNIQUE INDEX "VPNAccount_one_live_identity_key"
  ON "VPNAccount" (LOWER(COALESCE(NULLIF(BTRIM("adUsername"), ''), "username")))
  WHERE "status" NOT IN ('revoked', 'disabled');

-- Every path that inserts, links, or reactivates a VPN identity passes through
-- this trigger. The same advisory-lock namespace is acquired while direct
-- offboarding establishes its durable fence, closing the zero-to-one race that
-- a uniqueness constraint alone cannot prevent.
CREATE OR REPLACE FUNCTION "enforceVpnIdentityOffboardFence"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  canonical_username TEXT;
  blocked_request_id TEXT;
  blocked_recipient_status TEXT;
  replacement_request_matches BOOLEAN;
BEGIN
  IF NEW."status" IN ('revoked', 'disabled') THEN
    RETURN NEW;
  END IF;

  canonical_username := LOWER(COALESCE(NULLIF(BTRIM(NEW."adUsername"), ''), BTRIM(NEW."username")));
  PERFORM pg_advisory_xact_lock(hashtextextended(canonical_username, 904772));

  SELECT fence."blockedAccessRequestId", recipient."status"
    INTO blocked_request_id, blocked_recipient_status
  FROM "VpnIdentityOffboardFence" AS fence
  JOIN "OffboardCampaignRecipient" AS recipient ON recipient."id" = fence."recipientId"
  WHERE fence."canonicalAdUsername" = canonical_username
    AND recipient."status" IN ('enforcement_processing', 'enforcement_reconciliation_required', 'enforced');

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  replacement_request_matches := FALSE;
  IF NEW."accessRequestId" IS NOT NULL AND NEW."accessRequestId" IS DISTINCT FROM blocked_request_id THEN
    SELECT EXISTS (
      SELECT 1
      FROM "AccessRequest" AS request
      WHERE request."id" = NEW."accessRequestId"
        AND LOWER(BTRIM(request."ldapUsername")) = canonical_username
    ) INTO replacement_request_matches;
  END IF;

  IF NOT replacement_request_matches THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'VPN identity is fenced by direct offboarding; a new matching account request is required';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "VPNAccount_direct_offboard_fence"
BEFORE INSERT OR UPDATE OF "status", "adUsername", "username", "accessRequestId"
ON "VPNAccount"
FOR EACH ROW
EXECUTE FUNCTION "enforceVpnIdentityOffboardFence"();

COMMIT;
