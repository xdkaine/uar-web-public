ALTER TABLE "PasswordChangeChallenge"
  ADD COLUMN "authProvider" TEXT NOT NULL DEFAULT 'ad',
  ADD COLUMN "correlationId" TEXT,
  ADD COLUMN "state" TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN "claimedAt" TIMESTAMP(3);

UPDATE "PasswordChangeChallenge"
SET "state" = 'consumed'
WHERE "used" = true;

COMMENT ON COLUMN "PasswordChangeChallenge"."authProvider" IS
  'Credential path that created the challenge; ad_outage_fallback continuations require the same active outage circuit.';

COMMENT ON COLUMN "PasswordChangeChallenge"."state" IS
  'Single-use lifecycle: active, processing, directory_applied, or consumed. Processing is claimed atomically before an external password mutation; directory_applied is durable reconciliation evidence.';
