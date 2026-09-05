-- Workflow-owned monitoring, durable group targets, and versioned authoring.
BEGIN;

ALTER TABLE "AccountLifecycleAction"
  ADD COLUMN "targetGroupDn" TEXT,
  ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "AccountLifecycleAction_idempotencyKey_key"
  ON "AccountLifecycleAction"("idempotencyKey");
CREATE INDEX "AccountLifecycleAction_targetGroupDn_idx"
  ON "AccountLifecycleAction"("targetGroupDn");

-- Historical notes are operator-entered text and some rows predate the JSON
-- convention. Parse defensively so one malformed legacy note cannot block the
-- entire forward migration.
CREATE FUNCTION "__uar_workflow_try_jsonb"(value TEXT) RETURNS JSONB
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN value::jsonb;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

UPDATE "AccountLifecycleAction"
SET "targetGroupDn" = NULLIF(("__uar_workflow_try_jsonb"("notes") ->> 'groupDn'), '')
WHERE "actionType" IN ('add_group_member', 'remove_from_group')
  AND "notes" IS NOT NULL;

DROP FUNCTION "__uar_workflow_try_jsonb"(TEXT);

ALTER TABLE "FlowRun"
  ADD COLUMN "sourceNodeId" TEXT,
  ADD COLUMN "sourceHandle" TEXT;

ALTER TABLE "FlowEventOutbox"
  ADD COLUMN "graphId" TEXT,
  ADD COLUMN "sourceNodeId" TEXT,
  ADD COLUMN "sourceHandle" TEXT;

CREATE TABLE "WorkflowMonitorCheck" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "graphId" TEXT NOT NULL,
  "sourceNodeId" TEXT NOT NULL,
  "checkKey" TEXT NOT NULL,
  "configHash" TEXT NOT NULL,
  "config" JSONB NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT false,
  "nextProbeAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "currentState" TEXT NOT NULL DEFAULT 'unknown',
  "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
  "consecutiveSuccesses" INTEGER NOT NULL DEFAULT 0,
  "lastCheckedAt" TIMESTAMP(3),
  "lastTransitionAt" TIMESTAMP(3),
  "lastLatencyMs" INTEGER,
  "lastStatusCode" INTEGER,
  "lastError" TEXT,
  CONSTRAINT "WorkflowMonitorCheck_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WorkflowMonitorCheck_graphId_fkey" FOREIGN KEY ("graphId") REFERENCES "WorkflowGraph"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "WorkflowMonitorCheck_graphId_sourceNodeId_checkKey_key"
  ON "WorkflowMonitorCheck"("graphId", "sourceNodeId", "checkKey");
CREATE INDEX "WorkflowMonitorCheck_active_nextProbeAt_idx"
  ON "WorkflowMonitorCheck"("active", "nextProbeAt");
CREATE INDEX "WorkflowMonitorCheck_graphId_active_idx"
  ON "WorkflowMonitorCheck"("graphId", "active");

CREATE TABLE "MonitorCredential" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "configVersion" INTEGER NOT NULL DEFAULT 0,
  "name" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "username" TEXT,
  "headerName" TEXT,
  "secret" TEXT NOT NULL,
  "allowedHosts" TEXT[] NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdBy" TEXT NOT NULL,
  "updatedBy" TEXT NOT NULL,
  CONSTRAINT "MonitorCredential_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MonitorCredential_enabled_idx" ON "MonitorCredential"("enabled");
CREATE INDEX "MonitorCredential_kind_idx" ON "MonitorCredential"("kind");

CREATE TABLE "ManagedPageRevision" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "pageKey" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "document" JSONB NOT NULL,
  "createdBy" TEXT NOT NULL,
  "updatedBy" TEXT NOT NULL,
  "publishedAt" TIMESTAMP(3),
  "publishedBy" TEXT,
  CONSTRAINT "ManagedPageRevision_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ManagedPageRevision_pageKey_version_key" ON "ManagedPageRevision"("pageKey", "version");
CREATE INDEX "ManagedPageRevision_pageKey_status_idx" ON "ManagedPageRevision"("pageKey", "status");

CREATE TABLE "MessageTemplateRevision" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "templateKey" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "subject" TEXT,
  "body" TEXT NOT NULL,
  "css" TEXT,
  "createdBy" TEXT NOT NULL,
  "updatedBy" TEXT NOT NULL,
  "publishedAt" TIMESTAMP(3),
  "publishedBy" TEXT,
  CONSTRAINT "MessageTemplateRevision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MessageTemplateRevision_templateKey_fkey" FOREIGN KEY ("templateKey") REFERENCES "MessageTemplate"("key") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "MessageTemplateRevision_templateKey_version_key" ON "MessageTemplateRevision"("templateKey", "version");
CREATE INDEX "MessageTemplateRevision_templateKey_status_idx" ON "MessageTemplateRevision"("templateKey", "status");

INSERT INTO "MessageTemplateRevision" (
  "id", "createdAt", "updatedAt", "templateKey", "version", "status",
  "subject", "body", "createdBy", "updatedBy", "publishedAt", "publishedBy"
)
SELECT
  'msgrev_' || md5("key"), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, "key", 1,
  'published', "subject", "body", COALESCE("updatedBy", 'migration'),
  COALESCE("updatedBy", 'migration'), CURRENT_TIMESTAMP, COALESCE("updatedBy", 'migration')
FROM "MessageTemplate"
ON CONFLICT ("templateKey", "version") DO NOTHING;

COMMIT;
