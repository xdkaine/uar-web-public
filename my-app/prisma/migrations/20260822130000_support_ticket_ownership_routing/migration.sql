-- Support ticket ownership and directory-group routing (ADR-0007).
-- Additive only: no existing tables, columns, or rows are modified or dropped.
-- With zero seeded rows the portal behaves exactly as before (unassigned
-- tickets notify the adminEmail queue); the only behavior change is the new
-- creator receipt email.

ALTER TABLE "SupportTicket" ADD COLUMN IF NOT EXISTS "requestedForGroupDn" TEXT;

CREATE INDEX IF NOT EXISTS "SupportTicket_requestedForGroupDn_idx"
ON "SupportTicket"("requestedForGroupDn");

CREATE TABLE IF NOT EXISTS "AllowedTicketSubjectGroup" (
    "dn" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mail" TEXT,
    "canBeRequestedFor" BOOLEAN NOT NULL DEFAULT true,
    "canBeAssignee" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncedAt" TIMESTAMP(3),
    "lastSyncStatus" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AllowedTicketSubjectGroup_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AllowedTicketSubjectGroup_dn_key"
ON "AllowedTicketSubjectGroup"("dn");
CREATE INDEX IF NOT EXISTS "AllowedTicketSubjectGroup_isActive_idx"
ON "AllowedTicketSubjectGroup"("isActive");

CREATE TABLE IF NOT EXISTS "DirectorySyncRun" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "triggeredBy" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "groupsProcessed" INTEGER NOT NULL DEFAULT 0,
    "membersCaptured" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB,

    CONSTRAINT "DirectorySyncRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "DirectorySyncRun_status_idx" ON "DirectorySyncRun"("status");
CREATE INDEX IF NOT EXISTS "DirectorySyncRun_startedAt_idx" ON "DirectorySyncRun"("startedAt");

CREATE TABLE IF NOT EXISTS "DirectoryGroupMemberSnapshot" (
    "id" TEXT NOT NULL,
    "groupDn" TEXT NOT NULL,
    "syncRunId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT,
    "displayName" TEXT,
    "accountEnabled" BOOLEAN,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DirectoryGroupMemberSnapshot_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'DirectoryGroupMemberSnapshot_groupDn_fkey'
    ) THEN
        ALTER TABLE "DirectoryGroupMemberSnapshot"
        ADD CONSTRAINT "DirectoryGroupMemberSnapshot_groupDn_fkey"
        FOREIGN KEY ("groupDn") REFERENCES "AllowedTicketSubjectGroup"("dn")
        ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS "DirectoryGroupMemberSnapshot_groupDn_username_key"
ON "DirectoryGroupMemberSnapshot"("groupDn", "username");
CREATE INDEX IF NOT EXISTS "DirectoryGroupMemberSnapshot_username_idx"
ON "DirectoryGroupMemberSnapshot"("username");
CREATE INDEX IF NOT EXISTS "DirectoryGroupMemberSnapshot_syncRunId_idx"
ON "DirectoryGroupMemberSnapshot"("syncRunId");

CREATE TABLE IF NOT EXISTS "SupportTicketAssignment" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ticketId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetUsername" TEXT,
    "targetGroupDn" TEXT,
    "targetLabel" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "assignedBy" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportTicketAssignment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SupportTicketAssignment_ticketId_fkey" FOREIGN KEY ("ticketId")
        REFERENCES "SupportTicket"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "SupportTicketAssignment_ticketId_idx"
ON "SupportTicketAssignment"("ticketId");
CREATE INDEX IF NOT EXISTS "SupportTicketAssignment_targetUsername_idx"
ON "SupportTicketAssignment"("targetUsername");
CREATE INDEX IF NOT EXISTS "SupportTicketAssignment_targetGroupDn_idx"
ON "SupportTicketAssignment"("targetGroupDn");
CREATE INDEX IF NOT EXISTS "SupportTicketAssignment_isActive_idx"
ON "SupportTicketAssignment"("isActive");

CREATE TABLE IF NOT EXISTS "TicketAssignmentHistory" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ticketId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetLabel" TEXT NOT NULL,
    "actorUsername" TEXT NOT NULL,
    "details" JSONB,

    CONSTRAINT "TicketAssignmentHistory_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TicketAssignmentHistory_ticketId_fkey" FOREIGN KEY ("ticketId")
        REFERENCES "SupportTicket"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "TicketAssignmentHistory_ticketId_idx"
ON "TicketAssignmentHistory"("ticketId");
CREATE INDEX IF NOT EXISTS "TicketAssignmentHistory_createdAt_idx"
ON "TicketAssignmentHistory"("createdAt");

-- The ticket permission keys (tickets.assign, tickets.configure) are part of
-- the system_administrator seed in migration 20260822000000, so no patch
-- UPDATE is needed here; both migrations ship in the same release.

-- Enforce one ACTIVE assignment per target per ticket at the database level:
-- the application's find-then-upsert is not race-safe on its own. Inactive
-- rows are excluded so deactivate/reactivate history stays possible.
CREATE UNIQUE INDEX IF NOT EXISTS "SupportTicketAssignment_active_user_uq"
ON "SupportTicketAssignment"("ticketId", "targetUsername")
WHERE "isActive" AND "targetType" = 'user';

CREATE UNIQUE INDEX IF NOT EXISTS "SupportTicketAssignment_active_group_uq"
ON "SupportTicketAssignment"("ticketId", "targetGroupDn")
WHERE "isActive" AND "targetType" = 'directory_group';
