-- Release hardening: isolate profile-email bearer tokens and enforce one
-- editable/active workflow version per workflow name.

CREATE TABLE "ProfileEmailVerificationToken" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "accessRequestId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "desiredEmail" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'issuing',
    "claimId" TEXT,
    "claimedUntil" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "usedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "observedMail" TEXT,
    "observedDescription" TEXT,

    CONSTRAINT "ProfileEmailVerificationToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProfileEmailVerificationToken_tokenHash_key"
    ON "ProfileEmailVerificationToken"("tokenHash");
CREATE INDEX "ProfileEmailVerificationToken_accessRequestId_status_idx"
    ON "ProfileEmailVerificationToken"("accessRequestId", "status");
CREATE INDEX "ProfileEmailVerificationToken_expiresAt_idx"
    ON "ProfileEmailVerificationToken"("expiresAt");
CREATE INDEX "ProfileEmailVerificationToken_claimedUntil_idx"
    ON "ProfileEmailVerificationToken"("claimedUntil");
CREATE UNIQUE INDEX "ProfileEmailVerificationToken_active_desiredEmail_key"
    ON "ProfileEmailVerificationToken"(LOWER("desiredEmail"))
    WHERE "status" IN ('pending', 'claimed', 'directory_applied', 'reconciliation_required', 'completed');

ALTER TABLE "ProfileEmailVerificationToken"
    ADD CONSTRAINT "ProfileEmailVerificationToken_accessRequestId_fkey"
    FOREIGN KEY ("accessRequestId") REFERENCES "AccessRequest"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AccessRequest"
    ADD COLUMN "facultyNotificationState" TEXT,
    ADD COLUMN "facultyNotificationClaimId" TEXT,
    ADD COLUMN "facultyNotificationClaimedUntil" TIMESTAMP(3),
    ADD COLUMN "facultyNotificationError" TEXT;

CREATE INDEX "AccessRequest_facultyNotificationState_idx"
    ON "AccessRequest"("facultyNotificationState");

-- Lifecycle work is claimed before any directory/VPN side effect. The claim
-- owner is the only worker allowed to publish a terminal result.
ALTER TABLE "AccountLifecycleAction"
    ADD COLUMN "claimId" TEXT,
    ADD COLUMN "claimedUntil" TIMESTAMP(3),
    ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AccountLifecycleAction"
    ALTER COLUMN "status" SET DEFAULT 'queued';
CREATE INDEX "AccountLifecycleAction_status_claimedUntil_idx"
    ON "AccountLifecycleAction"("status", "claimedUntil");
UPDATE "AccountLifecycleAction"
SET "status" = 'reconciliation_required',
    "errorMessage" = COALESCE("errorMessage", 'Legacy processing row had no exclusive claim; verify AD/VPN state before retrying')
WHERE "status" = 'processing' AND "claimId" IS NULL;

ALTER TABLE "MonitoredEndpoint"
    ADD COLUMN "configVersion" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "InfrastructureTaggingTask" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "syncId" TEXT NOT NULL,
    "adUsername" TEXT NOT NULL,
    "accessRequestId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "claimId" TEXT,
    "claimedUntil" TIMESTAMP(3),
    "lastError" TEXT,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "InfrastructureTaggingTask_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "InfrastructureTaggingTask_syncId_adUsername_key"
    ON "InfrastructureTaggingTask"("syncId", "adUsername");
CREATE INDEX "InfrastructureTaggingTask_status_updatedAt_idx"
    ON "InfrastructureTaggingTask"("status", "updatedAt");
CREATE INDEX "InfrastructureTaggingTask_status_claimedUntil_idx"
    ON "InfrastructureTaggingTask"("status", "claimedUntil");
ALTER TABLE "InfrastructureTaggingTask"
    ADD CONSTRAINT "InfrastructureTaggingTask_syncId_fkey"
    FOREIGN KEY ("syncId") REFERENCES "ADAccountSync"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Older builds could leave more than one draft or enabled version. Keep the
-- newest candidate and archive/deactivate the rest before adding guards.
WITH ranked_drafts AS (
    SELECT "id", ROW_NUMBER() OVER (
        PARTITION BY "name" ORDER BY "version" DESC, "createdAt" DESC
    ) AS row_number
    FROM "WorkflowGraph"
    WHERE "status" = 'draft'
)
UPDATE "WorkflowGraph" AS graph
SET "status" = 'disabled', "enabled" = false
FROM ranked_drafts
WHERE graph."id" = ranked_drafts."id" AND ranked_drafts.row_number > 1;

WITH ranked_enabled AS (
    SELECT "id", ROW_NUMBER() OVER (
        PARTITION BY "name" ORDER BY "version" DESC, "updatedAt" DESC
    ) AS row_number
    FROM "WorkflowGraph"
    WHERE "enabled" = true
)
UPDATE "WorkflowGraph" AS graph
SET "enabled" = false
FROM ranked_enabled
WHERE graph."id" = ranked_enabled."id" AND ranked_enabled.row_number > 1;

CREATE UNIQUE INDEX "WorkflowGraph_one_draft_per_name"
    ON "WorkflowGraph"("name") WHERE "status" = 'draft';
CREATE UNIQUE INDEX "WorkflowGraph_one_enabled_per_name"
    ON "WorkflowGraph"("name") WHERE "enabled" = true;
