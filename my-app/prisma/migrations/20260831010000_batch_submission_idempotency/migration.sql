ALTER TABLE "BatchAccountCreation"
  ADD COLUMN "submissionKey" TEXT,
  ADD COLUMN "submissionFingerprint" TEXT;

CREATE UNIQUE INDEX "BatchAccountCreation_submissionKey_key"
  ON "BatchAccountCreation"("submissionKey");
