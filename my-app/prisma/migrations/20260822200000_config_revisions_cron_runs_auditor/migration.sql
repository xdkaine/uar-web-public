-- Configuration revisions, cron observability, and the read-only Auditor role.
-- Additive only: no existing tables, columns, or rows are modified or dropped.
-- With zero revision/cron-run rows and no auditor AD-group mapping, the portal
-- behaves exactly as before. The only data change appends "audit.export" to
-- the seeded system_administrator permission list so legacy administrators keep
-- their full-catalog access when the catalog grows.

CREATE TABLE IF NOT EXISTS "ConfigurationRevision" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "previousValue" JSONB,
    "newValue" JSONB,
    "changeKind" TEXT NOT NULL DEFAULT 'update',
    "changedBy" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConfigurationRevision_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ConfigurationRevision_key_idx"
ON "ConfigurationRevision"("key");
CREATE INDEX IF NOT EXISTS "ConfigurationRevision_createdAt_idx"
ON "ConfigurationRevision"("createdAt");

CREATE TABLE IF NOT EXISTS "CronRun" (
    "id" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "outcome" TEXT NOT NULL DEFAULT 'success',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "itemsProcessed" INTEGER NOT NULL DEFAULT 0,
    "errorClass" TEXT,
    "detail" JSONB,

    CONSTRAINT "CronRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CronRun_route_startedAt_idx"
ON "CronRun"("route", "startedAt");
CREATE INDEX IF NOT EXISTS "CronRun_startedAt_idx"
ON "CronRun"("startedAt");

-- Seed the read-only Auditor role. isSystem=true keeps its permission set
-- fixed to read/export evidence; operators map an AD group post-deploy via
-- Roles & Access. An empty adGroupDns mapping grants NOBODY until configured.
INSERT INTO "RoleDefinition" ("key", "name", "description", "permissions", "adGroupDns", "isSystem", "createdAt", "updatedAt")
SELECT 'auditor', 'Auditor',
       'Read-only evidence access: audit logs, action history, request dossiers, and log export. No operational or configuration permissions.',
       '{"audit.read","audit.export"}'::text[],
       '{}'::text[],
       true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (
    SELECT 1 FROM "RoleDefinition" WHERE "key" = 'auditor'
);

-- Keep the compatibility system_administrator grant equal to the full catalog:
-- resolveActorAuthorization uses the STORED row (not a computed full catalog)
-- whenever it exists, so new permissions must be appended here.
UPDATE "RoleDefinition"
SET "permissions" = array_append("permissions", 'audit.export'),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'system_administrator'
  AND NOT ('audit.export' = ANY("permissions"));

-- Rollback notes:
--   DROP TABLE IF EXISTS "CronRun";
--   DROP TABLE IF EXISTS "ConfigurationRevision";
--   DELETE FROM "RoleDefinition" WHERE "key" = 'auditor';
--   UPDATE "RoleDefinition" SET "permissions" = array_remove("permissions", 'audit.export')
--     WHERE "key" = 'system_administrator';
