-- Additive identity-console product storage. Apply before deploying code that
-- writes catalog, revision, or device evidence rows. Rollback is code-first:
-- disable device evidence collection and keep these tables/columns so evidence is not
-- destroyed during an incident.

ALTER TABLE "AuditLog"
  ADD COLUMN IF NOT EXISTS "clientId" TEXT,
  ADD COLUMN IF NOT EXISTS "providerSid" TEXT,
  ADD COLUMN IF NOT EXISTS "riskLevel" TEXT;

CREATE INDEX IF NOT EXISTS "AuditLog_clientId_createdAt_idx" ON "AuditLog"("clientId", "createdAt");
CREATE INDEX IF NOT EXISTS "AuditLog_riskLevel_createdAt_idx" ON "AuditLog"("riskLevel", "createdAt");
CREATE INDEX IF NOT EXISTS "AuditLog_outcome_createdAt_idx" ON "AuditLog"("outcome", "createdAt");

ALTER TABLE "OidcClient"
  ADD COLUMN IF NOT EXISTS "postLogoutRedirectUris" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS "backchannelLogoutUri" TEXT;

ALTER TABLE "OidcClient" ALTER COLUMN "scope" SET DEFAULT 'openid email profile';

CREATE TABLE IF NOT EXISTS "ApplicationCatalogEntry" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "launchUrl" TEXT NOT NULL,
  "iconUrl" TEXT,
  "kind" TEXT NOT NULL DEFAULT 'external',
  "oidcClientId" TEXT,
  "visibility" TEXT NOT NULL DEFAULT 'hidden',
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "publishedAt" TIMESTAMP(3),
  "createdBy" TEXT NOT NULL,
  "updatedBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ApplicationCatalogEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ApplicationCatalogEntry_oidcClientId_fkey" FOREIGN KEY ("oidcClientId") REFERENCES "OidcClient"("clientId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "ApplicationCatalogEntry_slug_key" ON "ApplicationCatalogEntry"("slug");
CREATE UNIQUE INDEX IF NOT EXISTS "ApplicationCatalogEntry_oidcClientId_key" ON "ApplicationCatalogEntry"("oidcClientId");
CREATE INDEX IF NOT EXISTS "ApplicationCatalogEntry_visibility_publishedAt_sortOrder_idx" ON "ApplicationCatalogEntry"("visibility", "publishedAt", "sortOrder");

CREATE TABLE IF NOT EXISTS "AuthBrandingRevision" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "doc" JSONB NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "publishedAt" TIMESTAMP(3),
  CONSTRAINT "AuthBrandingRevision_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AuthBrandingRevision_clientId_revision_key" ON "AuthBrandingRevision"("clientId", "revision");
CREATE INDEX IF NOT EXISTS "AuthBrandingRevision_clientId_status_createdAt_idx" ON "AuthBrandingRevision"("clientId", "status", "createdAt");

CREATE TABLE IF NOT EXISTS "DeviceObservation" (
  "id" TEXT NOT NULL,
  "username" TEXT NOT NULL,
  "clientId" TEXT,
  "providerSid" TEXT,
  "deviceCookieHash" TEXT,
  "fingerprintHash" TEXT,
  "fingerprintVersion" INTEGER NOT NULL,
  "signals" JSONB NOT NULL,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "riskScore" INTEGER NOT NULL DEFAULT 0,
  "riskLevel" TEXT NOT NULL DEFAULT 'low',
  "riskReasons" JSONB NOT NULL,
  "enforcement" TEXT NOT NULL DEFAULT 'evidence',
  "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DeviceObservation_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "DeviceObservation_username_observedAt_idx" ON "DeviceObservation"("username", "observedAt");
CREATE INDEX IF NOT EXISTS "DeviceObservation_deviceCookieHash_observedAt_idx" ON "DeviceObservation"("deviceCookieHash", "observedAt");
CREATE INDEX IF NOT EXISTS "DeviceObservation_fingerprintHash_observedAt_idx" ON "DeviceObservation"("fingerprintHash", "observedAt");
CREATE INDEX IF NOT EXISTS "DeviceObservation_riskLevel_observedAt_idx" ON "DeviceObservation"("riskLevel", "observedAt");
CREATE INDEX IF NOT EXISTS "DeviceObservation_expiresAt_idx" ON "DeviceObservation"("expiresAt");
