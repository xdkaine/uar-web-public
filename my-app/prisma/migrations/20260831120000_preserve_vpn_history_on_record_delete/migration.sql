-- VPN account deletion removes only the live credential-bearing record.
-- Status history and operator comments retain the immutable historical account ID.

ALTER TABLE "VPNAccountStatusLog"
  ADD COLUMN "liveAccountId" TEXT;

ALTER TABLE "VPNAccountComment"
  ADD COLUMN "liveAccountId" TEXT;

UPDATE "VPNAccountStatusLog"
SET "liveAccountId" = "accountId";

UPDATE "VPNAccountComment"
SET "liveAccountId" = "accountId";

ALTER TABLE "VPNAccountStatusLog"
  DROP CONSTRAINT "VPNAccountStatusLog_accountId_fkey";

ALTER TABLE "VPNAccountComment"
  DROP CONSTRAINT "VPNAccountComment_accountId_fkey";

ALTER TABLE "VPNAccountStatusLog"
  ADD CONSTRAINT "VPNAccountStatusLog_liveAccountId_fkey"
  FOREIGN KEY ("liveAccountId") REFERENCES "VPNAccount"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "VPNAccountComment"
  ADD CONSTRAINT "VPNAccountComment_liveAccountId_fkey"
  FOREIGN KEY ("liveAccountId") REFERENCES "VPNAccount"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "VPNAccountStatusLog_liveAccountId_idx"
  ON "VPNAccountStatusLog"("liveAccountId");

CREATE INDEX "VPNAccountComment_liveAccountId_idx"
  ON "VPNAccountComment"("liveAccountId");
