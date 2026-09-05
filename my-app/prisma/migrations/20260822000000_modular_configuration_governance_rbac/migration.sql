-- Modular configuration, governance workflow, messaging, and RBAC.
-- Additive only: no existing tables, columns, or rows are modified or dropped.
-- Seeds reproduce current behavior exactly (all modules enabled, the existing
-- Director -> Faculty review chain as workflow version 1, the exact faculty
-- handoff message, and role definitions that grant today's admins unchanged
-- access).

ALTER TABLE "AccessRequest" ADD COLUMN IF NOT EXISTS "requestTypeKey" TEXT;
ALTER TABLE "AccessRequest" ADD COLUMN IF NOT EXISTS "workflowVersionId" TEXT;

CREATE TABLE IF NOT EXISTS "ModuleState" (
    "id" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModuleState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ModuleState_moduleId_key" ON "ModuleState"("moduleId");
CREATE INDEX IF NOT EXISTS "ModuleState_enabled_idx" ON "ModuleState"("enabled");

CREATE TABLE IF NOT EXISTS "SystemConfigEntry" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemConfigEntry_pkey" PRIMARY KEY ("key")
);

CREATE TABLE IF NOT EXISTS "RequestType" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RequestType_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "RequestType_key_key" ON "RequestType"("key");
CREATE INDEX IF NOT EXISTS "RequestType_isActive_idx" ON "RequestType"("isActive");

CREATE TABLE IF NOT EXISTS "WorkflowDefinition" (
    "id" TEXT NOT NULL,
    "requestTypeKey" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'published',
    "stages" JSONB NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowDefinition_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "WorkflowDefinition_requestTypeKey_version_key"
ON "WorkflowDefinition"("requestTypeKey", "version");
CREATE INDEX IF NOT EXISTS "WorkflowDefinition_requestTypeKey_status_idx"
ON "WorkflowDefinition"("requestTypeKey", "status");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'WorkflowDefinition_requestTypeKey_fkey'
    ) THEN
        ALTER TABLE "WorkflowDefinition"
        ADD CONSTRAINT "WorkflowDefinition_requestTypeKey_fkey"
        FOREIGN KEY ("requestTypeKey") REFERENCES "RequestType"("key")
        ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "MessageTemplate" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "variables" JSONB,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessageTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MessageTemplate_key_key" ON "MessageTemplate"("key");
CREATE INDEX IF NOT EXISTS "MessageTemplate_updatedAt_idx" ON "MessageTemplate"("updatedAt");

CREATE TABLE IF NOT EXISTS "RoleDefinition" (
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "permissions" TEXT[] NOT NULL,
    "adGroupDns" TEXT[] NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoleDefinition_pkey" PRIMARY KEY ("key")
);

CREATE INDEX IF NOT EXISTS "RoleDefinition_isSystem_idx" ON "RoleDefinition"("isSystem");

CREATE INDEX IF NOT EXISTS "AccessRequest_workflowVersionId_idx"
ON "AccessRequest"("workflowVersionId");

-- ---------------------------------------------------------------------------
-- Seed data (idempotent): current behavior expressed as configuration.
-- ---------------------------------------------------------------------------

INSERT INTO "RequestType" ("id", "key", "name", "description", "isActive", "createdAt", "updatedAt")
VALUES ('cuid_seed_rt_standard_access', 'standard_access', 'Standard Access Request',
        'The original User Access Request flow: email verification, student director preparation, then faculty approval.',
        true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "WorkflowDefinition" ("id", "requestTypeKey", "version", "status", "stages", "createdBy", "createdAt")
VALUES (
    'cuid_seed_wf_standard_v1',
    'standard_access',
    1,
    'published',
    '[{"key":"student_directors","label":"Pending Directors","reviewerRoleKey":"director","notifyEmails":null},{"key":"faculty","label":"Pending Faculty","reviewerRoleKey":"faculty","notifyEmails":null}]'::jsonb,
    'migration-seed',
    CURRENT_TIMESTAMP
)
ON CONFLICT ("requestTypeKey", "version") DO NOTHING;

INSERT INTO "MessageTemplate" ("id", "key", "label", "body", "variables", "updatedBy", "createdAt", "updatedAt")
VALUES (
    'cuid_seed_mt_faculty_handoff',
    'faculty.handoff_message',
    'Faculty Handoff Message',
    E'Hello!\n\nI am requesting for you to {{actionPhrase}} with the following details:\n\nName: {{name}}\nEmail: {{email}}\n{{vpnUsernameLine}}\nPassword: {{password}}{{accountDisableDate}}\n\nPlease let me know once the account has been created.\n\nThank you!',
    '["actionPhrase","name","email","vpnUsernameLine","password","accountDisableDate"]'::jsonb,
    'migration-seed',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "RoleDefinition" ("key", "name", "description", "permissions", "adGroupDns", "isSystem", "createdAt", "updatedAt")
VALUES
    ('system_administrator', 'System Administrator',
     'Full administrative access. Also granted automatically to members of the legacy domain-admin groups while directory mappings are migrated.',
     '{"settings.manage","modules.manage","governance.configure","messages.manage","roles.manage","directory.configure","access_requests.read","access_requests.review.director","access_requests.review.faculty","tickets.assign","tickets.configure","vpn.manage","audit.read"}'::text[],
     '{}'::text[],
     true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('director', 'Student Director',
     'Prepares access requests during the director review stage (sets usernames and credentials). Grant by adding AD group DNs.',
     '{"access_requests.read","access_requests.review.director"}'::text[],
     '{}'::text[],
     false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('faculty', 'Faculty Reviewer',
     'Approves or rejects access requests at the final faculty stage. Grant by adding AD group DNs.',
     '{"access_requests.read","access_requests.review.faculty"}'::text[],
     '{}'::text[],
     false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
