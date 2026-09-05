-- Local break-glass accounts and session provider attribution (ADR-0009).
-- Additive only. No credentials are seeded: the LocalAccount table starts
-- empty, so first-deployment login behavior is identical (AD-only).

ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "authProvider" TEXT NOT NULL DEFAULT 'ad';

CREATE TABLE IF NOT EXISTS "LocalAccount" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'break_glass',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "lastUsedIp" TEXT,

    CONSTRAINT "LocalAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "LocalAccount_username_key" ON "LocalAccount"("username");
CREATE INDEX IF NOT EXISTS "LocalAccount_isActive_idx" ON "LocalAccount"("isActive");

-- Rollback notes:
--   DROP TABLE IF EXISTS "LocalAccount";
--   ALTER TABLE "Session" DROP COLUMN IF EXISTS "authProvider";
