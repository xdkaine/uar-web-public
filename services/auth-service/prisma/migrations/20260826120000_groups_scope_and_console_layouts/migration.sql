-- ADR-0012 amendment + Auth Manager console rework:
--
-- 1. Widen the default registry scope with the opt-in `groups` scope so
--    relying parties (Proxmox first) can map AD groups to local roles.
--    Appending an ALLOWED scope is additive - it permits more, never less -
--    so existing integrations are unaffected. Rows that already carry a
--    custom scope keep it; only the missing token is appended.
--    Rollback: UPDATE "OidcClient" SET scope = replace(scope, ' groups', '')
--    WHERE scope LIKE '% groups%' (informational; the column default change
--    below is harmless to keep).
--
-- 2. Per-admin customizable console dashboard layouts, owned by this service
--    like the rest of its registry state.
--    Rollback: DROP TABLE "AdminConsoleLayout".

ALTER TABLE "OidcClient" ALTER COLUMN "scope" SET DEFAULT 'openid email profile amr groups';

UPDATE "OidcClient"
SET "scope" = "scope" || ' groups'
WHERE "scope" NOT LIKE '%groups%';

CREATE TABLE IF NOT EXISTS "AdminConsoleLayout" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "adminUsername" TEXT NOT NULL,
    "widgets" JSONB NOT NULL,

    CONSTRAINT "AdminConsoleLayout_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AdminConsoleLayout_adminUsername_key" ON "AdminConsoleLayout"("adminUsername");
