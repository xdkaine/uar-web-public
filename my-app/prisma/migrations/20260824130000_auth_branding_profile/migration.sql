-- Per-client sign-in branding profiles owned by the auth service (ADR-0012).
CREATE TABLE "AuthBrandingProfile" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthBrandingProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AuthBrandingProfile_clientId_key" ON "AuthBrandingProfile"("clientId");
