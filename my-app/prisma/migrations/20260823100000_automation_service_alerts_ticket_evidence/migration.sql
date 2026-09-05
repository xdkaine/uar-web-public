-- Workflow automation, service alerts, and ticket evidence
-- (ADR-0008, ADR-0010, ADR-0011). Additive only: no existing tables,
-- columns, or rows are modified or dropped. No automation rule is seeded
-- enabled; with zero rules the portal behaves exactly as before.

ALTER TABLE "SupportTicket" ADD COLUMN IF NOT EXISTS "joinGroupDn" TEXT;

CREATE INDEX IF NOT EXISTS "SupportTicket_joinGroupDn_idx"
ON "SupportTicket"("joinGroupDn");

ALTER TABLE "AllowedTicketSubjectGroup"
ADD COLUMN IF NOT EXISTS "canJoinViaTicket" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "AutomationRule" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "triggerKey" TEXT NOT NULL,
    "triggerConfig" JSONB,
    "conditions" JSONB,
    "actions" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT,
    "updatedBy" TEXT,

    CONSTRAINT "AutomationRule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AutomationRule_triggerKey_enabled_idx"
ON "AutomationRule"("triggerKey", "enabled");

CREATE TABLE IF NOT EXISTS "AutomationRun" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ruleId" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "triggerKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'succeeded',
    "matched" BOOLEAN NOT NULL DEFAULT false,
    "outcomes" JSONB,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "AutomationRun_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'AutomationRun_ruleId_fkey'
    ) THEN
        ALTER TABLE "AutomationRun"
        ADD CONSTRAINT "AutomationRun_ruleId_fkey"
        FOREIGN KEY ("ruleId") REFERENCES "AutomationRule"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS "AutomationRun_ruleId_eventKey_key"
ON "AutomationRun"("ruleId", "eventKey");
CREATE INDEX IF NOT EXISTS "AutomationRun_triggerKey_idx" ON "AutomationRun"("triggerKey");
CREATE INDEX IF NOT EXISTS "AutomationRun_startedAt_idx" ON "AutomationRun"("startedAt");

CREATE TABLE IF NOT EXISTS "ServiceAlert" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'warning',
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "occurrenceCount" INTEGER NOT NULL DEFAULT 1,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "dismissedBy" TEXT,
    "dismissedAt" TIMESTAMP(3),
    "metadata" JSONB,

    CONSTRAINT "ServiceAlert_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ServiceAlert_dedupeKey_key" ON "ServiceAlert"("dedupeKey");
CREATE INDEX IF NOT EXISTS "ServiceAlert_status_idx" ON "ServiceAlert"("status");
CREATE INDEX IF NOT EXISTS "ServiceAlert_category_idx" ON "ServiceAlert"("category");

CREATE TABLE IF NOT EXISTS "TicketAttachment" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ticketId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "uploadedBy" TEXT NOT NULL,

    CONSTRAINT "TicketAttachment_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'TicketAttachment_ticketId_fkey'
    ) THEN
        ALTER TABLE "TicketAttachment"
        ADD CONSTRAINT "TicketAttachment_ticketId_fkey"
        FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS "TicketAttachment_storageKey_key" ON "TicketAttachment"("storageKey");
CREATE INDEX IF NOT EXISTS "TicketAttachment_ticketId_idx" ON "TicketAttachment"("ticketId");

-- Keep the compatibility system_administrator grant equal to the full
-- catalog (see ADR-0011 and migration 20260822200000 for the precedent):
-- resolveActorAuthorization uses the STORED row whenever it exists, so new
-- permission keys must be appended here or legacy administrators lose access
-- once routes begin enforcing them. Keys are inert until they appear in the
-- code catalog; guards make re-runs idempotent.
UPDATE "RoleDefinition"
SET "permissions" = array_append("permissions", 'tickets.read'),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'system_administrator'
  AND NOT ('tickets.read' = ANY("permissions"));

UPDATE "RoleDefinition"
SET "permissions" = array_append("permissions", 'tickets.respond'),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'system_administrator'
  AND NOT ('tickets.respond' = ANY("permissions"));

UPDATE "RoleDefinition"
SET "permissions" = array_append("permissions", 'service_alerts.read'),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'system_administrator'
  AND NOT ('service_alerts.read' = ANY("permissions"));

UPDATE "RoleDefinition"
SET "permissions" = array_append("permissions", 'service_alerts.manage'),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'system_administrator'
  AND NOT ('service_alerts.manage' = ANY("permissions"));

UPDATE "RoleDefinition"
SET "permissions" = array_append("permissions", 'automation.manage'),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'system_administrator'
  AND NOT ('automation.manage' = ANY("permissions"));

-- Rollback notes:
--   DROP TABLE IF EXISTS "TicketAttachment";
--   DROP TABLE IF EXISTS "ServiceAlert";
--   DROP TABLE IF EXISTS "AutomationRun";
--   DROP TABLE IF EXISTS "AutomationRule";
--   ALTER TABLE "AllowedTicketSubjectGroup" DROP COLUMN IF EXISTS "canJoinViaTicket";
--   ALTER TABLE "SupportTicket" DROP COLUMN IF EXISTS "joinGroupDn";
--   UPDATE "RoleDefinition" SET "permissions" = array_remove(array_remove(array_remove(array_remove(array_remove(
--     "permissions", 'tickets.read'), 'tickets.respond'), 'service_alerts.read'), 'service_alerts.manage'), 'automation.manage')
--   WHERE "key" = 'system_administrator';
