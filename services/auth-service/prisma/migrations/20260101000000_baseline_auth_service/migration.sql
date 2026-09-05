-- Baseline for the auth service's OWN tables (ADR-0012 data ownership).
-- Tables intentionally NOT created here:
--   - AuditLog: owned and migrated by the portal; this service only INSERTs
--     identity/login/branding audit rows into it.
--   - OidcClient: created by the portal's pre-de-merge registry migration
--     (20260824140000) and re-created/owned by THIS service from migration
--     20260826000000_auth_service_owns_oidc_client_registry onward.
--   - PasswordChangeChallenge: owned and migrated solely by the PORTAL
--     (migration 20260509000000_add_password_change_challenges). This service
--     never reads or writes it; an earlier copy of this baseline provisioned a
--     divergent shape (consumedAt instead of used/usedAt/ipAddress/userAgent),
--     so it was removed to keep the shared database drift-free. Do not
--     re-introduce it here.
--
-- Operators applying migration history to a database that already contains
-- these tables (created via `prisma db push` before migrations existed) must
-- record the baseline once first:
--   npx prisma migrate resolve --applied 20260101000000_baseline_auth_service

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

-- Forward recovery: baseline is additive only. Rollback would drop the
-- service's own table, which is destructive and only valid before any
-- break-glass account exists:
--   DROP TABLE IF EXISTS "LocalAccount";
