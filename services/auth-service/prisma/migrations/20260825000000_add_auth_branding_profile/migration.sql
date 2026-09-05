-- Adds per-client branding profiles for the login interaction pages.
-- Additive change: no existing table or column is touched, so rollback is a
-- simple drop with no data-loss implications beyond saved branding drafts:
--   DROP TABLE IF EXISTS "AuthBrandingProfile";
--
-- NOTE for upgraded deployments: IF NOT EXISTS makes this idempotent, matching
-- 20260826000000_auth_service_owns_oidc_client_registry. A database that
-- already provisioned this table (e.g. via `prisma db push`) keeps its rows;
-- a fresh database gets the table created here.

CREATE TABLE IF NOT EXISTS "AuthBrandingProfile" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "clientId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "doc" JSONB NOT NULL,
    "updatedBy" TEXT NOT NULL,

    CONSTRAINT "AuthBrandingProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AuthBrandingProfile_clientId_key" ON "AuthBrandingProfile"("clientId");
