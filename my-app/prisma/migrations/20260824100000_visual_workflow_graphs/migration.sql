-- Visual workflow graphs over curated nodes (ADR-0013). Additive only; no
-- graphs are seeded enabled. Rollback: drop the four tables in reverse order.
--   DROP TABLE IF EXISTS "FlowArtifact";
--   DROP TABLE IF EXISTS "FlowTimer";
--   DROP TABLE IF EXISTS "FlowRun";
--   DROP TABLE IF EXISTS "WorkflowGraph";

CREATE TABLE "WorkflowGraph" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "triggerKey" TEXT NOT NULL,
    "nodes" JSONB NOT NULL,
    "edges" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT,
    "updatedBy" TEXT,

    CONSTRAINT "WorkflowGraph_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FlowRun" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "graphId" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "triggerKey" TEXT NOT NULL,
    "contextDigest" TEXT,
    "status" TEXT NOT NULL DEFAULT 'running',
    "nodeOutcomes" JSONB,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "FlowRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FlowTimer" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "runId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "payload" JSONB,

    CONSTRAINT "FlowTimer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FlowArtifact" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "runId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "refId" TEXT NOT NULL,
    "clearedAt" TIMESTAMP(3),

    CONSTRAINT "FlowArtifact_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkflowGraph_name_version_key" ON "WorkflowGraph"("name", "version");
CREATE INDEX "WorkflowGraph_triggerKey_enabled_idx" ON "WorkflowGraph"("triggerKey", "enabled");

CREATE UNIQUE INDEX "FlowRun_graphId_eventKey_key" ON "FlowRun"("graphId", "eventKey");
CREATE INDEX "FlowRun_triggerKey_idx" ON "FlowRun"("triggerKey");
CREATE INDEX "FlowRun_status_idx" ON "FlowRun"("status");
CREATE INDEX "FlowRun_startedAt_idx" ON "FlowRun"("startedAt");

CREATE INDEX "FlowTimer_dueAt_idx" ON "FlowTimer"("dueAt");

CREATE INDEX "FlowArtifact_runId_idx" ON "FlowArtifact"("runId");
CREATE INDEX "FlowArtifact_refId_idx" ON "FlowArtifact"("refId");

ALTER TABLE "FlowRun" ADD CONSTRAINT "FlowRun_graphId_fkey" FOREIGN KEY ("graphId") REFERENCES "WorkflowGraph"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FlowTimer" ADD CONSTRAINT "FlowTimer_runId_fkey" FOREIGN KEY ("runId") REFERENCES "FlowRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FlowArtifact" ADD CONSTRAINT "FlowArtifact_runId_fkey" FOREIGN KEY ("runId") REFERENCES "FlowRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
