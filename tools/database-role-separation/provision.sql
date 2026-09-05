\set ON_ERROR_STOP on
\getenv portal_password PORTAL_DATABASE_PASSWORD
\getenv auth_password AUTH_DATABASE_PASSWORD
\getenv migration_password MIGRATION_DATABASE_PASSWORD

BEGIN;

SELECT 'CREATE ROLE uar_schema_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'uar_schema_owner')
\gexec

SELECT 'CREATE ROLE uar_migration NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION INHERIT'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'uar_migration')
\gexec

SELECT 'CREATE ROLE uar_portal_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION INHERIT'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'uar_portal_runtime')
\gexec

SELECT 'CREATE ROLE uar_auth_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION INHERIT'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'uar_auth_runtime')
\gexec

ALTER ROLE uar_schema_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE uar_migration LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT PASSWORD :'migration_password';
ALTER ROLE uar_portal_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT PASSWORD :'portal_password';
ALTER ROLE uar_auth_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT PASSWORD :'auth_password';

GRANT uar_schema_owner TO uar_migration;
SELECT format('GRANT uar_schema_owner TO %I', current_user)
\gexec
REVOKE uar_schema_owner FROM uar_portal_runtime, uar_auth_runtime;
REVOKE uar_migration FROM uar_portal_runtime, uar_auth_runtime;

-- The no-login owner role lets the migration login own and evolve the shared
-- schema without granting either runtime role DDL rights.
ALTER SCHEMA public OWNER TO uar_schema_owner;

DO $ownership$
DECLARE
  object record;
BEGIN
  FOR object IN
    SELECT
      c.relkind,
      n.nspname AS schema_name,
      c.relname AS object_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p', 'S', 'v', 'm', 'f')
      AND c.relowner <> 'uar_schema_owner'::regrole
    ORDER BY c.relkind, c.relname
  LOOP
    EXECUTE format(
      'ALTER %s %I.%I OWNER TO uar_schema_owner',
      CASE object.relkind
        WHEN 'S' THEN 'SEQUENCE'
        WHEN 'v' THEN 'VIEW'
        WHEN 'm' THEN 'MATERIALIZED VIEW'
        WHEN 'f' THEN 'FOREIGN TABLE'
        ELSE 'TABLE'
      END,
      object.schema_name,
      object.object_name
    );
  END LOOP;
END
$ownership$;

DO $types$
DECLARE
  object record;
BEGIN
  FOR object IN
    SELECT n.nspname AS schema_name, t.typname AS object_name, t.typtype
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typtype IN ('d', 'e')
      AND t.typowner <> 'uar_schema_owner'::regrole
    ORDER BY t.typname
  LOOP
    EXECUTE format(
      'ALTER %s %I.%I OWNER TO uar_schema_owner',
      CASE object.typtype WHEN 'd' THEN 'DOMAIN' ELSE 'TYPE' END,
      object.schema_name,
      object.object_name
    );
  END LOOP;
END
$types$;

DO $routines$
DECLARE
  object record;
BEGIN
  FOR object IN
    SELECT
      n.nspname AS schema_name,
      p.proname AS object_name,
      p.prokind,
      pg_get_function_identity_arguments(p.oid) AS identity_arguments
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind IN ('f', 'p')
      AND p.proowner <> 'uar_schema_owner'::regrole
      AND NOT EXISTS (
        SELECT 1
        FROM pg_depend d
        WHERE d.classid = 'pg_proc'::regclass
          AND d.objid = p.oid
          AND d.deptype = 'e'
      )
    ORDER BY p.proname, identity_arguments
  LOOP
    EXECUTE format(
      'ALTER %s %I.%I(%s) OWNER TO uar_schema_owner',
      CASE object.prokind WHEN 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END,
      object.schema_name,
      object.object_name,
      object.identity_arguments
    );
  END LOOP;
END
$routines$;

SELECT format('GRANT CONNECT ON DATABASE %I TO uar_migration, uar_portal_runtime, uar_auth_runtime', current_database())
\gexec
GRANT USAGE, CREATE ON SCHEMA public TO uar_migration;
GRANT USAGE ON SCHEMA public TO uar_portal_runtime, uar_auth_runtime;
REVOKE CREATE ON SCHEMA public FROM PUBLIC, uar_portal_runtime, uar_auth_runtime;

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM PUBLIC, uar_portal_runtime, uar_auth_runtime;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, uar_portal_runtime, uar_auth_runtime;

-- Fail closed for future migrations. Every table must be classified here
-- before either runtime role receives access. AuditLog remains portal-owned
-- and receives bounded SELECT/INSERT access from auth-service below.
CREATE TEMP TABLE runtime_table_classification (
  table_name text PRIMARY KEY,
  runtime_owner text NOT NULL CHECK (runtime_owner IN ('portal', 'auth', 'migration'))
) ON COMMIT DROP;

INSERT INTO runtime_table_classification (table_name, runtime_owner) VALUES
  ('ADAccountActivityLog', 'portal'),
  ('ADAccountComment', 'portal'),
  ('ADAccountMatch', 'portal'),
  ('ADAccountSync', 'portal'),
  ('AccessRequest', 'portal'),
  ('AccountActivationToken', 'portal'),
  ('AccountLifecycleAction', 'portal'),
  ('AccountLifecycleBatch', 'portal'),
  ('AccountLifecycleHistory', 'portal'),
  ('AllowedTicketSubjectGroup', 'portal'),
  ('AuditLog', 'portal'),
  ('AutomationRule', 'portal'),
  ('AutomationRun', 'portal'),
  ('BatchAccountCreation', 'portal'),
  ('BatchAccountItem', 'portal'),
  ('BatchAuditLog', 'portal'),
  ('BlockedEmail', 'portal'),
  ('ConfigurationRevision', 'portal'),
  ('CronRun', 'portal'),
  ('DirectoryGroupMemberSnapshot', 'portal'),
  ('DirectorySyncRun', 'portal'),
  ('Event', 'portal'),
  ('FlowActionAttempt', 'portal'),
  ('FlowArtifact', 'portal'),
  ('FlowEventOutbox', 'portal'),
  ('FlowRun', 'portal'),
  ('FlowTimer', 'portal'),
  ('InfrastructureTaggingTask', 'portal'),
  ('LocalAccount', 'portal'),
  ('ManagedPageRevision', 'portal'),
  ('MassEmailCampaign', 'portal'),
  ('MassEmailLog', 'portal'),
  ('MassEmailRecipient', 'portal'),
  ('MessageTemplate', 'portal'),
  ('MessageTemplateRevision', 'portal'),
  ('ModuleState', 'portal'),
  ('MonitorCredential', 'portal'),
  ('MonitoredEndpoint', 'portal'),
  ('NotificationBanner', 'portal'),
  ('OffboardCampaign', 'portal'),
  ('OffboardCampaignExtension', 'portal'),
  ('OffboardCampaignExtensionReminder', 'portal'),
  ('OffboardCampaignLog', 'portal'),
  ('OffboardCampaignRecipient', 'portal'),
  ('OffboardCampaignRecipientToken', 'portal'),
  ('OffboardOperationRun', 'portal'),
  ('OffboardOperationRunItem', 'portal'),
  ('OperationalEvidenceArchive', 'portal'),
  ('OperationalLease', 'portal'),
  ('OperationalSignal', 'portal'),
  ('OperationalSignalEvent', 'portal'),
  ('PasswordChangeChallenge', 'portal'),
  ('PasswordResetToken', 'portal'),
  ('PrivilegeAssignment', 'portal'),
  ('ProfileEmailVerificationToken', 'portal'),
  ('ProviderLogoutTask', 'portal'),
  ('QuarantinedTicketAttachment', 'portal'),
  ('RequestComment', 'portal'),
  ('RequestCommentAttachment', 'portal'),
  ('RequestType', 'portal'),
  ('RoleDefinition', 'portal'),
  ('ServiceAlert', 'portal'),
  ('Session', 'portal'),
  ('SupportTicket', 'portal'),
  ('SupportTicketAssignment', 'portal'),
  ('SystemConfigEntry', 'portal'),
  ('SystemSettings', 'portal'),
  ('TicketAssignmentHistory', 'portal'),
  ('TicketAttachment', 'portal'),
  ('TicketResponse', 'portal'),
  ('TicketStatusLog', 'portal'),
  ('UserNotification', 'portal'),
  ('UserNotificationPreference', 'portal'),
  ('VPNAccount', 'portal'),
  ('VPNAccountActivityLog', 'portal'),
  ('VPNAccountComment', 'portal'),
  ('VPNAccountStatusLog', 'portal'),
  ('VPNImport', 'portal'),
  ('VPNImportRecord', 'portal'),
  ('VPNRoleChange', 'portal'),
  ('VpnIdentityOffboardFence', 'portal'),
  ('WorkflowDefinition', 'portal'),
  ('WorkflowGraph', 'portal'),
  ('WorkflowMonitorCheck', 'portal'),
  ('AdminConsoleLayout', 'auth'),
  ('ApplicationCatalogEntry', 'auth'),
  ('AuthAdminLocalAccount', 'auth'),
  ('AuthBrandingProfile', 'auth'),
  ('AuthBrandingRevision', 'auth'),
  ('DeviceObservation', 'auth'),
  ('OidcClient', 'auth'),
  ('_prisma_migrations', 'migration');

DO $classification$
DECLARE
  unclassified text;
BEGIN
  SELECT string_agg(t.table_name, ', ' ORDER BY t.table_name)
  INTO unclassified
  FROM information_schema.tables t
  LEFT JOIN runtime_table_classification c ON c.table_name = t.table_name
  WHERE t.table_schema = 'public'
    AND t.table_type = 'BASE TABLE'
    AND c.table_name IS NULL;

  IF unclassified IS NOT NULL THEN
    RAISE EXCEPTION 'Unclassified public tables: %. Update runtime_table_classification before granting runtime access.', unclassified;
  END IF;
END
$classification$;

DO $portal_grants$
DECLARE
  table_name text;
BEGIN
  FOR table_name IN
    SELECT c.table_name
    FROM runtime_table_classification c
    WHERE c.runtime_owner = 'portal'
      AND to_regclass(format('%I.%I', 'public', c.table_name)) IS NOT NULL
    ORDER BY c.table_name
  LOOP
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO uar_portal_runtime',
      table_name
    );
  END LOOP;
END
$portal_grants$;

DO $auth_grants$
DECLARE
  table_name text;
BEGIN
  FOR table_name IN
    SELECT c.table_name
    FROM runtime_table_classification c
    WHERE c.runtime_owner = 'auth'
      AND to_regclass(format('%I.%I', 'public', c.table_name)) IS NOT NULL
    ORDER BY c.table_name
  LOOP
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO uar_auth_runtime',
      table_name
    );
  END LOOP;
END
$auth_grants$;

GRANT SELECT, INSERT ON TABLE public."AuditLog" TO uar_auth_runtime;

DO $sequence_grants$
DECLARE
  object record;
BEGIN
  FOR object IN
    SELECT DISTINCT
      sequence.relname AS sequence_name,
      owned_table.relname AS table_name,
      classification.runtime_owner
    FROM pg_class sequence
    JOIN pg_namespace sequence_schema ON sequence_schema.oid = sequence.relnamespace
    JOIN pg_depend dependency
      ON dependency.objid = sequence.oid
      AND dependency.deptype IN ('a', 'i')
    JOIN pg_class owned_table ON owned_table.oid = dependency.refobjid
    JOIN pg_namespace table_schema ON table_schema.oid = owned_table.relnamespace
    JOIN runtime_table_classification classification ON classification.table_name = owned_table.relname
    WHERE sequence.relkind = 'S'
      AND sequence_schema.nspname = 'public'
      AND table_schema.nspname = 'public'
    ORDER BY sequence.relname, owned_table.relname, classification.runtime_owner
  LOOP
    IF object.runtime_owner = 'auth' THEN
      EXECUTE format(
        'GRANT USAGE, SELECT, UPDATE ON SEQUENCE public.%I TO uar_auth_runtime',
        object.sequence_name
      );
    ELSIF object.runtime_owner = 'portal' THEN
      EXECUTE format(
        'GRANT USAGE, SELECT, UPDATE ON SEQUENCE public.%I TO uar_portal_runtime',
        object.sequence_name
      );
    END IF;
  END LOOP;
END
$sequence_grants$;

-- A migration can add either application's table. Re-run this script after
-- every portal-first/auth-second migration so the intended runtime receives
-- its explicit grants before replicas start.
ALTER DEFAULT PRIVILEGES FOR ROLE uar_schema_owner IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE uar_migration IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE uar_schema_owner IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE uar_migration IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC;

COMMIT;
