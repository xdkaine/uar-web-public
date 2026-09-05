-- Auth Manager recovery identities are owned by the auth service and are
-- intentionally separate from the portal-owned "LocalAccount" table.
-- This migration does not copy or drop portal credentials.
CREATE TABLE IF NOT EXISTS "AuthAdminLocalAccount" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "credentialVersion" INTEGER NOT NULL DEFAULT 1,
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "passwordChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "lastUsedIp" TEXT,

    CONSTRAINT "AuthAdminLocalAccount_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AuthAdminLocalAccount_credentialVersion_check" CHECK ("credentialVersion" > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "AuthAdminLocalAccount_username_key"
    ON "AuthAdminLocalAccount"("username");
CREATE INDEX IF NOT EXISTS "AuthAdminLocalAccount_isActive_idx"
    ON "AuthAdminLocalAccount"("isActive");
