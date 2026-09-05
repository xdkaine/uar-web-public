-- Ownership transfer completion (de-merge): the OIDC client registry now
-- belongs to THIS service. The portal's copy was removed by its migration
-- 20260825100000_drop_portal_auth_branding_oidc_clients; this service is the
-- only reader/writer, so it owns creation and evolution from here on.
--
-- NOTE for upgraded deployments: databases where the portal DROP already ran
-- get a fresh table here - previously registered clients must be re-registered
-- through the Auth Manager console. Databases that never ran the portal DROP
-- keep their rows; IF NOT EXISTS / ADD COLUMN IF NOT EXISTS make this idempotent.
--
-- sessionTtlSeconds: per-application provider-session lifetime in seconds
-- (ADR-0014). NULL => default 8h, or the legacy AUTH_SESSION_TTL_* env override.
-- Rollback: DROP TABLE "OidcClient" (registry reverts to env-only bootstrap).

CREATE TABLE IF NOT EXISTS "OidcClient" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "redirectUris" JSONB NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'openid email profile amr',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sessionTtlSeconds" INTEGER,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OidcClient_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "OidcClient" ADD COLUMN IF NOT EXISTS "sessionTtlSeconds" INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS "OidcClient_clientId_key" ON "OidcClient"("clientId");
CREATE INDEX IF NOT EXISTS "OidcClient_enabled_idx" ON "OidcClient"("enabled");
