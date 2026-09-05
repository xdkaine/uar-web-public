-- Batch-created identities are governed by their batch item rather than a
-- synthetic AccessRequest. Existing accessRequestId links remain readable for
-- compatibility, while new items use the lifecycle projection below.
ALTER TABLE "BatchAccountItem"
  ADD COLUMN "lifecycleOwnerKind" TEXT,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "adAccountStatus" TEXT,
  ADD COLUMN "adDisabledAt" TIMESTAMP(3),
  ADD COLUMN "adDisabledBy" TEXT,
  ADD COLUMN "adDisabledReason" TEXT,
  ADD COLUMN "adEnabledAt" TIMESTAMP(3),
  ADD COLUMN "adEnabledBy" TEXT;

ALTER TABLE "AccountLifecycleAction"
  ADD COLUMN "relatedBatchAccountItemId" TEXT;

ALTER TABLE "VPNAccount"
  ADD COLUMN "batchAccountItemId" TEXT;

UPDATE "BatchAccountItem"
SET "lifecycleOwnerKind" = CASE
  WHEN "accessRequestId" IS NOT NULL THEN 'access_request_legacy'
  ELSE 'unresolved'
END;

ALTER TABLE "BatchAccountItem"
  ALTER COLUMN "lifecycleOwnerKind" SET DEFAULT 'batch_item',
  ALTER COLUMN "lifecycleOwnerKind" SET NOT NULL;

-- Preserve historical VPN batch provenance only when one completed item is an
-- exact case-insensitive username match in the same creation batch. Ambiguous
-- or incomplete rows remain unlinked and fail closed for operator review.
UPDATE "VPNAccount" AS vpn
SET "batchAccountItemId" = item."id"
FROM "BatchAccountItem" AS item
WHERE vpn."batchAccountItemId" IS NULL
  AND vpn."batchId" IS NOT NULL
  AND item."batchId" = vpn."batchId"
  AND item."accountType" IN ('VPN', 'BOTH')
  AND item."status" = 'completed'
  AND item."vpnUsername" IS NOT NULL
  AND LOWER(item."vpnUsername") = LOWER(vpn."username")
  AND NOT EXISTS (
    SELECT 1
    FROM "VPNAccount" AS competing_vpn
    WHERE competing_vpn."id" <> vpn."id"
      AND competing_vpn."batchId" = vpn."batchId"
      AND LOWER(competing_vpn."username") = LOWER(vpn."username")
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "BatchAccountItem" AS competing
    WHERE competing."id" <> item."id"
      AND competing."batchId" = vpn."batchId"
      AND competing."accountType" IN ('VPN', 'BOTH')
      AND competing."status" = 'completed'
      AND competing."vpnUsername" IS NOT NULL
      AND LOWER(competing."vpnUsername") = LOWER(vpn."username")
  );

-- The successful exact VPN backfill supplies the immutable evidence needed to
-- promote that item. Historical unlinked AD items remain unresolved because
-- their live enabled state cannot be established by a static migration.
UPDATE "BatchAccountItem" AS item
SET "lifecycleOwnerKind" = 'batch_item'
WHERE item."accessRequestId" IS NULL
  AND EXISTS (
    SELECT 1
    FROM "VPNAccount" AS vpn
    WHERE vpn."batchAccountItemId" = item."id"
  );

ALTER TABLE "AccountLifecycleAction"
  ADD CONSTRAINT "AccountLifecycleAction_relatedBatchAccountItemId_fkey"
  FOREIGN KEY ("relatedBatchAccountItemId") REFERENCES "BatchAccountItem"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "VPNAccount"
  ADD CONSTRAINT "VPNAccount_batchAccountItemId_fkey"
  FOREIGN KEY ("batchAccountItemId") REFERENCES "BatchAccountItem"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "VPNAccount_batchAccountItemId_key"
  ON "VPNAccount"("batchAccountItemId");

CREATE INDEX "BatchAccountItem_adAccountStatus_idx"
  ON "BatchAccountItem"("adAccountStatus");

CREATE INDEX "AccountLifecycleAction_relatedBatchAccountItemId_idx"
  ON "AccountLifecycleAction"("relatedBatchAccountItemId");
