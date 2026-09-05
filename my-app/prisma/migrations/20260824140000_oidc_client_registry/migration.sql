-- Dynamic OIDC client registry (Auth Manager). Owned by the auth service;
-- the portal manages rows through its internal API. Secrets are functional
-- credentials stored verbatim (rotatable), NOT password material.
CREATE TABLE "OidcClient" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "redirectUris" JSONB NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'openid email profile amr',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OidcClient_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OidcClient_clientId_key" ON "OidcClient"("clientId");
CREATE INDEX "OidcClient_enabled_idx" ON "OidcClient"("enabled");
