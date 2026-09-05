-- Historical bootstrap generated from the exact pre-migration Prisma schema at
-- commit 34334d6f05df521a0781aaa43e6509bcca6f414a.
-- Source schema SHA-256: 2954dcec09bce972675aeecdb4e8956e0ebaafad589d84a30f6ab575f5b5d41a
--
-- This migration is intentionally before the old blank baseline. It may only
-- create the historical shape on an empty public schema. An existing database
-- is accepted only when its relations, columns, key/index counts, and foreign
-- key count match the recognized pre-migration shape; partial or foreign state
-- fails closed before any CREATE statement is reached.

DO $$
DECLARE
  expected_tables TEXT[] := ARRAY[
    'AccessRequest', 'RequestComment', 'Event', 'PasswordResetToken',
    'AccountActivationToken', 'SupportTicket', 'TicketResponse',
    'TicketStatusLog', 'BatchAccountCreation', 'BatchAccountItem',
    'BatchAuditLog', 'VPNAccount', 'VPNAccountStatusLog', 'VPNAccountComment',
    'VPNImport', 'VPNImportRecord', 'Session', 'BlockedEmail', 'SystemSettings',
    'NotificationBanner', 'AuditLog', 'AccountLifecycleAction',
    'OffboardCampaign', 'OffboardCampaignRecipient',
    'OffboardCampaignRecipientToken', 'OffboardCampaignLog',
    'AccountLifecycleBatch', 'AccountLifecycleHistory', 'VPNRoleChange',
    'ADAccountSync', 'ADAccountMatch', 'ADAccountActivityLog',
    'VPNAccountActivityLog', 'ADAccountComment'
  ];
  known_migrations TEXT[] := ARRAY[
    '20260507000000_legacy_schema_bootstrap',
    '20260508000000_baseline',
    '20260509000000_add_password_change_challenges',
    '20260511130000_audit_action_history',
    '20260519000000_add_mass_email',
    '20260612000000_offboard_campaign_extensions',
    '20260612010000_offboard_recipient_tokens',
    '20260822000000_modular_configuration_governance_rbac',
    '20260822130000_support_ticket_ownership_routing',
    '20260822200000_config_revisions_cron_runs_auditor',
    '20260823100000_automation_service_alerts_ticket_evidence',
    '20260823200000_local_break_glass_accounts',
    '20260824000000_message_template_subject',
    '20260824100000_visual_workflow_graphs',
    '20260824120000_session_provider_sid',
    '20260824130000_auth_branding_profile',
    '20260824140000_oidc_client_registry',
    '20260824150000_system_settings_auth_mode',
    '20260825000000_group_auto_approve_join_and_example_workflows',
    '20260825090000_preserve_auth_tables_before_portal_drop',
    '20260825100000_drop_portal_auth_branding_oidc_clients',
    '20260825110000_restore_auth_tables_after_portal_drop',
    '20260825120000_privilege_first_rbac',
    '20260827000000_device_binding_audit_fields',
    '20260827030000_ticket_attachment_quarantine',
    '20260827040000_monitored_endpoints',
    '20260827050000_user_notifications',
    '20260827060000_ticket_response_idempotency',
    '20260827070000_operational_leases',
    '20260827080000_flow_outbox_delivery_leases',
    '20260827100000_release_hardening',
    '20260828000000_workflow_authoring_redesign',
    '20260828170000_ticket_assignment_recipient',
    '20260828210000_operational_detector_evidence',
    '20260828220000_offboard_operation_runs',
    '20260828220000_split_settings_privileges',
    '20260828223000_managed_page_revision_invariants',
    '20260101000000_baseline_auth_service',
    '20260825000000_add_auth_branding_profile',
    '20260826000000_auth_service_owns_oidc_client_registry',
    '20260826120000_groups_scope_and_console_layouts',
    '20260827000000_identity_console_product'
  ];
  actual_tables TEXT[];
  relation_count INTEGER;
  column_fingerprint TEXT;
  column_definition_fingerprint TEXT;
  index_count INTEGER;
  index_fingerprint TEXT;
  foreign_key_count INTEGER;
  foreign_key_fingerprint TEXT;
  missing_legacy_tables INTEGER;
  unknown_migrations INTEGER;
  unresolved_migrations INTEGER;
  recognized_baseline INTEGER;
BEGIN
  SELECT count(*)::integer,
         coalesce(array_agg(c.relname ORDER BY c.relname), ARRAY[]::TEXT[])
    INTO relation_count, actual_tables
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p')
    AND c.relname <> '_prisma_migrations';

  IF relation_count = 0 THEN
    RETURN;
  END IF;

  -- Existing deployments receive this immutable-history bootstrap after later
  -- migrations are already in their ledger. Accept only a fully successful,
  -- repository-known ledger with the historical table foundation intact.
  -- Every following DDL statement is IF NOT EXISTS (and every FK is guarded),
  -- so the remainder is a no-op for this recognized evolved shape.
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    SELECT count(*)::integer
      INTO recognized_baseline
    FROM "_prisma_migrations"
    WHERE migration_name = '20260508000000_baseline'
      AND finished_at IS NOT NULL
      AND rolled_back_at IS NULL;

    IF recognized_baseline > 0 THEN
      SELECT count(*)::integer
        INTO missing_legacy_tables
      FROM unnest(expected_tables) AS expected(table_name)
      WHERE to_regclass(format('%I.%I', 'public', expected.table_name)) IS NULL;

      SELECT count(*)::integer
        INTO unknown_migrations
      FROM "_prisma_migrations"
      WHERE NOT (migration_name = ANY(known_migrations));

      SELECT count(*)::integer
        INTO unresolved_migrations
      FROM "_prisma_migrations"
      WHERE migration_name <> '20260507000000_legacy_schema_bootstrap'
        AND (finished_at IS NULL OR rolled_back_at IS NOT NULL);

      IF missing_legacy_tables = 0 AND unknown_migrations = 0 AND unresolved_migrations = 0 THEN
        RETURN;
      END IF;

      RAISE EXCEPTION 'legacy schema bootstrap refused: evolved database has a partial schema, unknown migration, or unresolved migration ledger entry';
    END IF;
  END IF;

  IF relation_count <> cardinality(expected_tables)
     OR actual_tables <> (SELECT array_agg(table_name ORDER BY table_name) FROM unnest(expected_tables) AS table_name) THEN
    RAISE EXCEPTION 'legacy schema bootstrap refused: public schema is neither empty nor the recognized 34334d6 legacy shape';
  END IF;

  SELECT md5(string_agg(c.relname || ':' || a.attname, ',' ORDER BY c.relname, a.attname))
    INTO column_fingerprint
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_attribute a ON a.attrelid = c.oid
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p')
    AND a.attnum > 0
    AND NOT a.attisdropped;

  SELECT count(*)::integer INTO index_count
  FROM pg_index i
  JOIN pg_class c ON c.oid = i.indrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p');

  SELECT md5(string_agg(
    c.relname || ':' || a.attname || ':' || pg_catalog.format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text,
    ',' ORDER BY c.relname, a.attname
  )) INTO column_definition_fingerprint
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_attribute a ON a.attrelid = c.oid
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p')
    AND a.attnum > 0
    AND NOT a.attisdropped;

  SELECT md5(string_agg(i.relname, ',' ORDER BY i.relname)) INTO index_fingerprint
  FROM pg_index idx
  JOIN pg_class i ON i.oid = idx.indexrelid
  JOIN pg_class c ON c.oid = idx.indrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p')
    AND c.relname <> '_prisma_migrations';

  SELECT count(*)::integer INTO foreign_key_count
  FROM pg_constraint fk
  JOIN pg_class c ON c.oid = fk.conrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND fk.contype = 'f';

  SELECT md5(string_agg(fk.conname, ',' ORDER BY fk.conname)) INTO foreign_key_fingerprint
  FROM pg_constraint fk
  JOIN pg_class c ON c.oid = fk.conrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND fk.contype = 'f';

  IF column_fingerprint <> 'ef721f9d4a829d80806e6a907ebb7718'
     OR column_definition_fingerprint <> '8d41db765e01b6902c22f7f64308b2cf'
     OR index_count <> 190
     OR index_fingerprint <> 'ff5053da02f544c8a2097028ae673661'
     OR foreign_key_count <> 23
     OR foreign_key_fingerprint <> 'd630e0002b4bd8496a1d4df14e88e446' THEN
    RAISE EXCEPTION 'legacy schema bootstrap refused: recognized legacy relation names have an unexpected schema fingerprint';
  END IF;
END $$;
-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE IF NOT EXISTS "AccessRequest" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "isInternal" BOOLEAN NOT NULL,
    "needsDomainAccount" BOOLEAN NOT NULL,
    "institution" TEXT,
    "eventReason" TEXT,
    "eventId" TEXT,
    "accessEndTime" TIMESTAMP(3),
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "verificationToken" TEXT,
    "verificationAttempts" INTEGER NOT NULL DEFAULT 0,
    "verifiedAt" TIMESTAMP(3),
    "verificationTokenExpiresAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'pending_verification',
    "acknowledgedByDirector" BOOLEAN NOT NULL DEFAULT false,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "ldapUsername" TEXT,
    "vpnUsername" TEXT,
    "accountPassword" TEXT,
    "accountCreatedAt" TIMESTAMP(3),
    "provisioningState" TEXT,
    "provisioningStartedAt" TIMESTAMP(3),
    "provisioningCompletedAt" TIMESTAMP(3),
    "provisioningError" TEXT,
    "accountExpiresAt" TIMESTAMP(3),
    "sentToFacultyAt" TIMESTAMP(3),
    "sentToFacultyBy" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectedBy" TEXT,
    "rejectionReason" TEXT,
    "approvalMessage" TEXT,
    "isGrandfatheredAccount" BOOLEAN NOT NULL DEFAULT false,
    "isManuallyAssigned" BOOLEAN NOT NULL DEFAULT false,
    "manuallyAssignedAt" TIMESTAMP(3),
    "manuallyAssignedBy" TEXT,
    "linkedAdUsername" TEXT,
    "linkedVpnUsername" TEXT,
    "manualAssignmentNotes" TEXT,
    "adAccountStatus" TEXT DEFAULT 'active',
    "adDisabledAt" TIMESTAMP(3),
    "adDisabledBy" TEXT,
    "adDisabledReason" TEXT,
    "adEnabledAt" TIMESTAMP(3),
    "adEnabledBy" TEXT,
    "vpnAccountStatus" TEXT DEFAULT 'active',
    "vpnRevokedAt" TIMESTAMP(3),
    "vpnRevokedBy" TEXT,
    "vpnRevokedReason" TEXT,
    "vpnRestoredAt" TIMESTAMP(3),
    "vpnRestoredBy" TEXT,

    CONSTRAINT "AccessRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "RequestComment" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "comment" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "type" TEXT,

    CONSTRAINT "RequestComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Event" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "endDate" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "usedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AccountActivationToken" (
    "id" TEXT NOT NULL,
    "accessRequestId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "usedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountActivationToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "SupportTicket" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "subject" TEXT NOT NULL,
    "category" TEXT,
    "severity" TEXT,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "username" TEXT NOT NULL,
    "closedAt" TIMESTAMP(3),
    "closedBy" TEXT,
    "relatedRequestId" TEXT,

    CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "TicketResponse" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "message" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "isStaff" BOOLEAN NOT NULL DEFAULT false,
    "ticketId" TEXT NOT NULL,

    CONSTRAINT "TicketResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "TicketStatusLog" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ticketId" TEXT NOT NULL,
    "oldStatus" TEXT,
    "newStatus" TEXT NOT NULL,
    "changedBy" TEXT NOT NULL,
    "isStaff" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "TicketStatusLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "BatchAccountCreation" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "totalAccounts" INTEGER NOT NULL,
    "successfulAccounts" INTEGER NOT NULL DEFAULT 0,
    "failedAccounts" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'processing',
    "completedAt" TIMESTAMP(3),
    "linkedTicketId" TEXT,

    CONSTRAINT "BatchAccountCreation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "BatchAccountItem" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "batchId" TEXT NOT NULL,
    "accountType" TEXT NOT NULL DEFAULT 'AD',
    "name" TEXT NOT NULL,
    "email" TEXT,
    "ldapUsername" TEXT NOT NULL,
    "vpnUsername" TEXT,
    "password" TEXT NOT NULL,
    "accountExpiresAt" TIMESTAMP(3),
    "isInternal" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "ldapCreatedAt" TIMESTAMP(3),
    "vpnCreatedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "BatchAccountItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "BatchAuditLog" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "batchId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "details" TEXT NOT NULL,
    "performedBy" TEXT NOT NULL,
    "accountName" TEXT,
    "success" BOOLEAN NOT NULL,

    CONSTRAINT "BatchAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "VPNAccount" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "username" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "portalType" TEXT NOT NULL,
    "isInternal" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'pending_faculty',
    "expiresAt" TIMESTAMP(3),
    "password" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdByFaculty" BOOLEAN NOT NULL DEFAULT false,
    "facultyCreatedAt" TIMESTAMP(3),
    "disabledAt" TIMESTAMP(3),
    "disabledBy" TEXT,
    "disabledReason" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokedBy" TEXT,
    "revokedReason" TEXT,
    "restoredAt" TIMESTAMP(3),
    "restoredBy" TEXT,
    "canRestore" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "batchId" TEXT,
    "accessRequestId" TEXT,
    "importId" TEXT,
    "adUsername" TEXT,

    CONSTRAINT "VPNAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "VPNAccountStatusLog" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accountId" TEXT NOT NULL,
    "oldStatus" TEXT,
    "newStatus" TEXT NOT NULL,
    "changedBy" TEXT NOT NULL,
    "reason" TEXT,

    CONSTRAINT "VPNAccountStatusLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "VPNAccountComment" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "comment" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "type" TEXT,

    CONSTRAINT "VPNAccountComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "VPNImport" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userType" TEXT NOT NULL,
    "portalType" TEXT,
    "fileName" TEXT NOT NULL,
    "importedBy" TEXT NOT NULL,
    "totalRecords" INTEGER NOT NULL,
    "matchedRecords" INTEGER NOT NULL DEFAULT 0,
    "processedRecords" INTEGER NOT NULL DEFAULT 0,
    "createdAccounts" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "notes" TEXT,
    "processedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "VPNImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "VPNImportRecord" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "importId" TEXT NOT NULL,
    "vpnUsername" TEXT NOT NULL,
    "fullName" TEXT,
    "email" TEXT,
    "notes" TEXT,
    "rawData" TEXT,
    "matchStatus" TEXT NOT NULL DEFAULT 'unmatched',
    "adUsername" TEXT,
    "adDisplayName" TEXT,
    "adEmail" TEXT,
    "adDepartment" TEXT,
    "matchedBy" TEXT,
    "matchedAt" TIMESTAMP(3),
    "matchNotes" TEXT,
    "vpnAccountCreated" BOOLEAN NOT NULL DEFAULT false,
    "vpnAccountId" TEXT,
    "createdAt_vpn" TIMESTAMP(3),

    CONSTRAINT "VPNImportRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Session" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastActivity" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "ipAddress" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "BlockedEmail" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "email" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "notes" TEXT,
    "linkedTicketId" TEXT,
    "blockedBy" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deactivatedAt" TIMESTAMP(3),
    "deactivatedBy" TEXT,
    "deactivationNotes" TEXT,

    CONSTRAINT "BlockedEmail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "SystemSettings" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "loginDisabled" BOOLEAN NOT NULL DEFAULT false,
    "internalRegistrationDisabled" BOOLEAN NOT NULL DEFAULT false,
    "externalRegistrationDisabled" BOOLEAN NOT NULL DEFAULT false,
    "globalNotificationBanner" TEXT,
    "notificationBannerType" TEXT,
    "lastModifiedBy" TEXT,
    "manualOverride" BOOLEAN NOT NULL DEFAULT false,
    "emailFrom" TEXT,
    "adminEmail" TEXT,
    "facultyEmail" TEXT,
    "studentDirectorEmails" TEXT,

    CONSTRAINT "SystemSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "NotificationBanner" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "message" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "dismissible" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "NotificationBanner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AuditLog" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "action" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "targetId" TEXT,
    "targetType" TEXT,
    "details" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "errorMessage" TEXT,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AccountLifecycleAction" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "actionType" TEXT NOT NULL,
    "targetAccountType" TEXT NOT NULL,
    "targetUsername" TEXT NOT NULL,
    "targetUserId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'processing',
    "reason" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scheduledFor" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "processedBy" TEXT,
    "completedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "rollbackData" TEXT,
    "relatedRequestId" TEXT,
    "relatedTicketId" TEXT,
    "vpnRoleChange" TEXT,
    "adDisabled" BOOLEAN NOT NULL DEFAULT false,
    "vpnDisabled" BOOLEAN NOT NULL DEFAULT false,
    "canRestore" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "batchId" TEXT,
    "offboardCampaignId" TEXT,
    "offboardRecipientId" TEXT,

    CONSTRAINT "AccountLifecycleAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "OffboardCampaign" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "name" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'dry_run',
    "dryRunAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activatedAt" TIMESTAMP(3),
    "activatedBy" TEXT,
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" TEXT,
    "emergencyStoppedAt" TIMESTAMP(3),
    "emergencyStoppedBy" TEXT,
    "activeLockKey" TEXT,
    "waveSize" INTEGER NOT NULL DEFAULT 25,
    "canarySize" INTEGER NOT NULL DEFAULT 0,
    "currentWave" INTEGER NOT NULL DEFAULT 0,
    "pauseAfterEachWave" BOOLEAN NOT NULL DEFAULT true,
    "sendingPaused" BOOLEAN NOT NULL DEFAULT true,
    "remindersPaused" BOOLEAN NOT NULL DEFAULT false,
    "enforcementPaused" BOOLEAN NOT NULL DEFAULT false,
    "sendingCompletedAt" TIMESTAMP(3),
    "rollbackState" TEXT NOT NULL DEFAULT 'none',
    "rollbackStartedAt" TIMESTAMP(3),
    "rollbackStartedBy" TEXT,
    "rollbackCompletedAt" TIMESTAMP(3),
    "manualExcludedUsernames" JSONB,
    "manualExcludedEmails" JSONB,
    "summaryJson" JSONB,
    "totalRecipients" INTEGER NOT NULL DEFAULT 0,
    "eligibleRecipients" INTEGER NOT NULL DEFAULT 0,
    "skippedRecipients" INTEGER NOT NULL DEFAULT 0,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "reminder3Count" INTEGER NOT NULL DEFAULT 0,
    "reminder6Count" INTEGER NOT NULL DEFAULT 0,
    "verifiedCount" INTEGER NOT NULL DEFAULT 0,
    "enforcedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "rollbackSuccessCount" INTEGER NOT NULL DEFAULT 0,
    "rollbackFailureCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "OffboardCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "OffboardCampaignRecipient" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "campaignId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT,
    "adUsername" TEXT NOT NULL,
    "adDn" TEXT,
    "linkedVpnUsername" TEXT,
    "accessRequestId" TEXT,
    "vpnAccountId" TEXT,
    "originalAdEnabled" BOOLEAN,
    "originalAdStatus" TEXT,
    "originalVpnStatus" TEXT,
    "originalVpnPortalType" TEXT,
    "originalSnapshot" JSONB,
    "tokenHash" TEXT,
    "waveNumber" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'dry_run_ready',
    "skipReason" TEXT,
    "projectedDeadlineAt" TIMESTAMP(3),
    "projectedAction" TEXT,
    "emailClaimedAt" TIMESTAMP(3),
    "initialEmailSentAt" TIMESTAMP(3),
    "initialEmailMessageId" TEXT,
    "reminder3ClaimedAt" TIMESTAMP(3),
    "reminder3SentAt" TIMESTAMP(3),
    "reminder6ClaimedAt" TIMESTAMP(3),
    "reminder6SentAt" TIMESTAMP(3),
    "deadlineAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "verifiedIpAddress" TEXT,
    "verifiedUserAgent" TEXT,
    "enforcementClaimedAt" TIMESTAMP(3),
    "enforcedAt" TIMESTAMP(3),
    "enforcementSkippedAt" TIMESTAMP(3),
    "enforcementError" TEXT,
    "adLifecycleActionId" TEXT,
    "vpnLifecycleActionId" TEXT,
    "rollbackStatus" TEXT,
    "rollbackClaimedAt" TIMESTAMP(3),
    "rollbackAdActionId" TEXT,
    "rollbackVpnActionId" TEXT,
    "rollbackError" TEXT,
    "lastError" TEXT,

    CONSTRAINT "OffboardCampaignRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "OffboardCampaignRecipientToken" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recipientId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'initial',
    "expiresAt" TIMESTAMP(3),
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "OffboardCampaignRecipientToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "OffboardCampaignLog" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "campaignId" TEXT NOT NULL,
    "recipientId" TEXT,
    "level" TEXT NOT NULL DEFAULT 'info',
    "eventType" TEXT NOT NULL,
    "actor" TEXT,
    "message" TEXT NOT NULL,
    "details" JSONB,

    CONSTRAINT "OffboardCampaignLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AccountLifecycleBatch" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "batchType" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "totalActions" INTEGER NOT NULL,
    "completedActions" INTEGER NOT NULL DEFAULT 0,
    "failedActions" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "relatedTicketId" TEXT,
    "notes" TEXT,

    CONSTRAINT "AccountLifecycleBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AccountLifecycleHistory" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actionId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "details" TEXT,
    "performedBy" TEXT,
    "previousStatus" TEXT,
    "newStatus" TEXT,

    CONSTRAINT "AccountLifecycleHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "VPNRoleChange" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vpnAccountId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "previousRole" TEXT NOT NULL,
    "newRole" TEXT NOT NULL,
    "changedBy" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "relatedActionId" TEXT,
    "notes" TEXT,

    CONSTRAINT "VPNRoleChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ADAccountSync" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'running',
    "triggeredBy" TEXT NOT NULL,
    "totalADAccounts" INTEGER NOT NULL DEFAULT 0,
    "totalVPNAccounts" INTEGER NOT NULL DEFAULT 0,
    "matchedAccounts" INTEGER NOT NULL DEFAULT 0,
    "unmatchedAD" INTEGER NOT NULL DEFAULT 0,
    "unmatchedVPN" INTEGER NOT NULL DEFAULT 0,
    "autoAssigned" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "notes" TEXT,

    CONSTRAINT "ADAccountSync_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ADAccountMatch" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "syncId" TEXT NOT NULL,
    "adUsername" TEXT NOT NULL,
    "adDisplayName" TEXT NOT NULL,
    "adEmail" TEXT NOT NULL,
    "vpnUsername" TEXT,
    "vpnAccountId" TEXT,
    "accessRequestId" TEXT,
    "requestEmail" TEXT,
    "requestName" TEXT,
    "matchType" TEXT NOT NULL,
    "wasAutoAssigned" BOOLEAN NOT NULL DEFAULT false,
    "assignedAt" TIMESTAMP(3),
    "notes" TEXT,

    CONSTRAINT "ADAccountMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ADAccountActivityLog" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accountId" TEXT NOT NULL,
    "accountUsername" TEXT NOT NULL,
    "accountName" TEXT,
    "accountEmail" TEXT,
    "actionType" TEXT NOT NULL,
    "performedBy" TEXT NOT NULL,
    "reason" TEXT,
    "lifecycleActionId" TEXT,
    "notes" TEXT,
    "ldapSuccess" BOOLEAN NOT NULL DEFAULT false,
    "ldapError" TEXT,

    CONSTRAINT "ADAccountActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "VPNAccountActivityLog" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accountId" TEXT NOT NULL,
    "accountUsername" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "accountEmail" TEXT,
    "actionType" TEXT NOT NULL,
    "performedBy" TEXT NOT NULL,
    "reason" TEXT,
    "lifecycleActionId" TEXT,
    "oldPortalType" TEXT,
    "newPortalType" TEXT,
    "notes" TEXT,

    CONSTRAINT "VPNAccountActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ADAccountComment" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "accountId" TEXT NOT NULL,
    "accountUsername" TEXT NOT NULL,
    "comment" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "isInternal" BOOLEAN NOT NULL DEFAULT false,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,

    CONSTRAINT "ADAccountComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "AccessRequest_verificationToken_key" ON "AccessRequest"("verificationToken");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AccessRequest_email_idx" ON "AccessRequest"("email");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AccessRequest_verificationToken_idx" ON "AccessRequest"("verificationToken");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AccessRequest_status_idx" ON "AccessRequest"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AccessRequest_eventId_idx" ON "AccessRequest"("eventId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AccessRequest_ldapUsername_idx" ON "AccessRequest"("ldapUsername");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AccessRequest_vpnUsername_idx" ON "AccessRequest"("vpnUsername");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AccessRequest_isManuallyAssigned_idx" ON "AccessRequest"("isManuallyAssigned");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AccessRequest_linkedAdUsername_idx" ON "AccessRequest"("linkedAdUsername");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AccessRequest_linkedVpnUsername_idx" ON "AccessRequest"("linkedVpnUsername");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AccessRequest_adAccountStatus_idx" ON "AccessRequest"("adAccountStatus");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AccessRequest_vpnAccountStatus_idx" ON "AccessRequest"("vpnAccountStatus");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RequestComment_requestId_idx" ON "RequestComment"("requestId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RequestComment_createdAt_idx" ON "RequestComment"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Event_isActive_idx" ON "Event"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PasswordResetToken_email_idx" ON "PasswordResetToken"("email");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PasswordResetToken_tokenHash_idx" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PasswordResetToken_expiresAt_idx" ON "PasswordResetToken"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "AccountActivationToken_accessRequestId_key" ON "AccountActivationToken"("accessRequestId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "AccountActivationToken_tokenHash_key" ON "AccountActivationToken"("tokenHash");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AccountActivationToken_tokenHash_idx" ON "AccountActivationToken"("tokenHash");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AccountActivationToken_expiresAt_idx" ON "AccountActivationToken"("expiresAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AccountActivationToken_accessRequestId_idx" ON "AccountActivationToken"("accessRequestId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SupportTicket_username_idx" ON "SupportTicket"("username");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SupportTicket_status_idx" ON "SupportTicket"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SupportTicket_createdAt_idx" ON "SupportTicket"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SupportTicket_relatedRequestId_idx" ON "SupportTicket"("relatedRequestId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TicketResponse_ticketId_idx" ON "TicketResponse"("ticketId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TicketResponse_createdAt_idx" ON "TicketResponse"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TicketStatusLog_ticketId_idx" ON "TicketStatusLog"("ticketId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TicketStatusLog_createdAt_idx" ON "TicketStatusLog"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BatchAccountCreation_createdBy_idx" ON "BatchAccountCreation"("createdBy");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BatchAccountCreation_createdAt_idx" ON "BatchAccountCreation"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BatchAccountCreation_status_idx" ON "BatchAccountCreation"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BatchAccountCreation_linkedTicketId_idx" ON "BatchAccountCreation"("linkedTicketId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BatchAccountItem_batchId_idx" ON "BatchAccountItem"("batchId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BatchAccountItem_status_idx" ON "BatchAccountItem"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BatchAccountItem_ldapUsername_idx" ON "BatchAccountItem"("ldapUsername");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BatchAuditLog_batchId_idx" ON "BatchAuditLog"("batchId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BatchAuditLog_createdAt_idx" ON "BatchAuditLog"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BatchAuditLog_performedBy_idx" ON "BatchAuditLog"("performedBy");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "VPNAccount_username_key" ON "VPNAccount"("username");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "VPNAccount_username_idx" ON "VPNAccount"("username");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "VPNAccount_portalType_idx" ON "VPNAccount"("portalType");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "VPNAccount_status_idx" ON "VPNAccount"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "VPNAccount_createdBy_idx" ON "VPNAccount"("createdBy");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "VPNAccount_createdAt_idx" ON "VPNAccount"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "VPNAccount_accessRequestId_idx" ON "VPNAccount"("accessRequestId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "VPNAccount_importId_idx" ON "VPNAccount"("importId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "VPNAccount_revokedAt_idx" ON "VPNAccount"("revokedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "VPNAccount_adUsername_idx" ON "VPNAccount"("adUsername");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "VPNAccountStatusLog_accountId_idx" ON "VPNAccountStatusLog"("accountId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "VPNAccountStatusLog_createdAt_idx" ON "VPNAccountStatusLog"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "VPNAccountComment_accountId_idx" ON "VPNAccountComment"("accountId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "VPNAccountComment_createdAt_idx" ON "VPNAccountComment"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "VPNImport_portalType_idx" ON "VPNImport"("portalType");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "VPNImport_userType_idx" ON "VPNImport"("userType");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "VPNImport_importedBy_idx" ON "VPNImport"("importedBy");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "VPNImport_createdAt_idx" ON "VPNImport"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "VPNImport_status_idx" ON "VPNImport"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "VPNImport_processedAt_idx" ON "VPNImport"("processedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "VPNImport_expiresAt_idx" ON "VPNImport"("expiresAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "VPNImportRecord_importId_idx" ON "VPNImportRecord"("importId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "VPNImportRecord_vpnUsername_idx" ON "VPNImportRecord"("vpnUsername");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "VPNImportRecord_matchStatus_idx" ON "VPNImportRecord"("matchStatus");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "VPNImportRecord_adUsername_idx" ON "VPNImportRecord"("adUsername");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Session_username_idx" ON "Session"("username");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "BlockedEmail_email_key" ON "BlockedEmail"("email");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BlockedEmail_email_idx" ON "BlockedEmail"("email");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BlockedEmail_isActive_idx" ON "BlockedEmail"("isActive");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BlockedEmail_blockedBy_idx" ON "BlockedEmail"("blockedBy");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BlockedEmail_createdAt_idx" ON "BlockedEmail"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SystemSettings_loginDisabled_idx" ON "SystemSettings"("loginDisabled");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SystemSettings_internalRegistrationDisabled_idx" ON "SystemSettings"("internalRegistrationDisabled");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SystemSettings_externalRegistrationDisabled_idx" ON "SystemSettings"("externalRegistrationDisabled");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "NotificationBanner_isActive_idx" ON "NotificationBanner"("isActive");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "NotificationBanner_priority_idx" ON "NotificationBanner"("priority");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "NotificationBanner_startDate_idx" ON "NotificationBanner"("startDate");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "NotificationBanner_endDate_idx" ON "NotificationBanner"("endDate");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AuditLog_username_idx" ON "AuditLog"("username");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AuditLog_category_idx" ON "AuditLog"("category");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AuditLog_targetType_idx" ON "AuditLog"("targetType");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AuditLog_success_idx" ON "AuditLog"("success");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AccountLifecycleAction_targetUsername_idx" ON "AccountLifecycleAction"("targetUsername");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AccountLifecycleAction_status_idx" ON "AccountLifecycleAction"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AccountLifecycleAction_actionType_idx" ON "AccountLifecycleAction"("actionType");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AccountLifecycleAction_requestedBy_idx" ON "AccountLifecycleAction"("requestedBy");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AccountLifecycleAction_createdAt_idx" ON "AccountLifecycleAction"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AccountLifecycleAction_scheduledFor_idx" ON "AccountLifecycleAction"("scheduledFor");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AccountLifecycleAction_batchId_idx" ON "AccountLifecycleAction"("batchId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AccountLifecycleAction_relatedRequestId_idx" ON "AccountLifecycleAction"("relatedRequestId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AccountLifecycleAction_relatedTicketId_idx" ON "AccountLifecycleAction"("relatedTicketId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AccountLifecycleAction_targetUserId_idx" ON "AccountLifecycleAction"("targetUserId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AccountLifecycleAction_offboardCampaignId_idx" ON "AccountLifecycleAction"("offboardCampaignId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AccountLifecycleAction_offboardRecipientId_idx" ON "AccountLifecycleAction"("offboardRecipientId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "OffboardCampaign_activeLockKey_key" ON "OffboardCampaign"("activeLockKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OffboardCampaign_status_idx" ON "OffboardCampaign"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OffboardCampaign_createdAt_idx" ON "OffboardCampaign"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OffboardCampaign_activeLockKey_idx" ON "OffboardCampaign"("activeLockKey");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "OffboardCampaignRecipient_tokenHash_key" ON "OffboardCampaignRecipient"("tokenHash");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OffboardCampaignRecipient_campaignId_idx" ON "OffboardCampaignRecipient"("campaignId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OffboardCampaignRecipient_status_idx" ON "OffboardCampaignRecipient"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OffboardCampaignRecipient_email_idx" ON "OffboardCampaignRecipient"("email");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OffboardCampaignRecipient_adUsername_idx" ON "OffboardCampaignRecipient"("adUsername");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OffboardCampaignRecipient_linkedVpnUsername_idx" ON "OffboardCampaignRecipient"("linkedVpnUsername");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OffboardCampaignRecipient_waveNumber_idx" ON "OffboardCampaignRecipient"("waveNumber");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OffboardCampaignRecipient_deadlineAt_idx" ON "OffboardCampaignRecipient"("deadlineAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OffboardCampaignRecipient_verifiedAt_idx" ON "OffboardCampaignRecipient"("verifiedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OffboardCampaignRecipient_enforcedAt_idx" ON "OffboardCampaignRecipient"("enforcedAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "OffboardCampaignRecipient_campaignId_adUsername_key" ON "OffboardCampaignRecipient"("campaignId", "adUsername");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "OffboardCampaignRecipientToken_tokenHash_key" ON "OffboardCampaignRecipientToken"("tokenHash");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OffboardCampaignRecipientToken_recipientId_idx" ON "OffboardCampaignRecipientToken"("recipientId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OffboardCampaignRecipientToken_expiresAt_idx" ON "OffboardCampaignRecipientToken"("expiresAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OffboardCampaignRecipientToken_usedAt_idx" ON "OffboardCampaignRecipientToken"("usedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OffboardCampaignLog_campaignId_idx" ON "OffboardCampaignLog"("campaignId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OffboardCampaignLog_recipientId_idx" ON "OffboardCampaignLog"("recipientId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OffboardCampaignLog_eventType_idx" ON "OffboardCampaignLog"("eventType");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OffboardCampaignLog_level_idx" ON "OffboardCampaignLog"("level");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OffboardCampaignLog_createdAt_idx" ON "OffboardCampaignLog"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AccountLifecycleBatch_requestedBy_idx" ON "AccountLifecycleBatch"("requestedBy");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AccountLifecycleBatch_status_idx" ON "AccountLifecycleBatch"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AccountLifecycleBatch_createdAt_idx" ON "AccountLifecycleBatch"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AccountLifecycleHistory_actionId_idx" ON "AccountLifecycleHistory"("actionId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AccountLifecycleHistory_createdAt_idx" ON "AccountLifecycleHistory"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "VPNRoleChange_vpnAccountId_idx" ON "VPNRoleChange"("vpnAccountId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "VPNRoleChange_username_idx" ON "VPNRoleChange"("username");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "VPNRoleChange_createdAt_idx" ON "VPNRoleChange"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "VPNRoleChange_relatedActionId_idx" ON "VPNRoleChange"("relatedActionId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ADAccountSync_triggeredBy_idx" ON "ADAccountSync"("triggeredBy");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ADAccountSync_createdAt_idx" ON "ADAccountSync"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ADAccountSync_status_idx" ON "ADAccountSync"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ADAccountMatch_syncId_idx" ON "ADAccountMatch"("syncId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ADAccountMatch_adUsername_idx" ON "ADAccountMatch"("adUsername");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ADAccountMatch_vpnUsername_idx" ON "ADAccountMatch"("vpnUsername");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ADAccountMatch_accessRequestId_idx" ON "ADAccountMatch"("accessRequestId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ADAccountMatch_matchType_idx" ON "ADAccountMatch"("matchType");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ADAccountActivityLog_accountId_idx" ON "ADAccountActivityLog"("accountId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ADAccountActivityLog_accountUsername_idx" ON "ADAccountActivityLog"("accountUsername");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ADAccountActivityLog_lifecycleActionId_idx" ON "ADAccountActivityLog"("lifecycleActionId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ADAccountActivityLog_createdAt_idx" ON "ADAccountActivityLog"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ADAccountActivityLog_performedBy_idx" ON "ADAccountActivityLog"("performedBy");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "VPNAccountActivityLog_accountId_idx" ON "VPNAccountActivityLog"("accountId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "VPNAccountActivityLog_accountUsername_idx" ON "VPNAccountActivityLog"("accountUsername");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "VPNAccountActivityLog_lifecycleActionId_idx" ON "VPNAccountActivityLog"("lifecycleActionId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "VPNAccountActivityLog_createdAt_idx" ON "VPNAccountActivityLog"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "VPNAccountActivityLog_performedBy_idx" ON "VPNAccountActivityLog"("performedBy");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ADAccountComment_accountId_idx" ON "ADAccountComment"("accountId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ADAccountComment_author_idx" ON "ADAccountComment"("author");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ADAccountComment_createdAt_idx" ON "ADAccountComment"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ADAccountComment_isPinned_idx" ON "ADAccountComment"("isPinned");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ADAccountComment_deletedAt_idx" ON "ADAccountComment"("deletedAt");

-- AddForeignKey
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AccessRequest_eventId_fkey' AND conrelid = '"AccessRequest"'::regclass) THEN
    ALTER TABLE "AccessRequest" ADD CONSTRAINT "AccessRequest_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $fk$;

-- AddForeignKey
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RequestComment_requestId_fkey' AND conrelid = '"RequestComment"'::regclass) THEN
    ALTER TABLE "RequestComment" ADD CONSTRAINT "RequestComment_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "AccessRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $fk$;

-- AddForeignKey
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AccountActivationToken_accessRequestId_fkey' AND conrelid = '"AccountActivationToken"'::regclass) THEN
    ALTER TABLE "AccountActivationToken" ADD CONSTRAINT "AccountActivationToken_accessRequestId_fkey" FOREIGN KEY ("accessRequestId") REFERENCES "AccessRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $fk$;

-- AddForeignKey
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SupportTicket_relatedRequestId_fkey' AND conrelid = '"SupportTicket"'::regclass) THEN
    ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_relatedRequestId_fkey" FOREIGN KEY ("relatedRequestId") REFERENCES "AccessRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $fk$;

-- AddForeignKey
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TicketResponse_ticketId_fkey' AND conrelid = '"TicketResponse"'::regclass) THEN
    ALTER TABLE "TicketResponse" ADD CONSTRAINT "TicketResponse_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $fk$;

-- AddForeignKey
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TicketStatusLog_ticketId_fkey' AND conrelid = '"TicketStatusLog"'::regclass) THEN
    ALTER TABLE "TicketStatusLog" ADD CONSTRAINT "TicketStatusLog_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $fk$;

-- AddForeignKey
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BatchAccountCreation_linkedTicketId_fkey' AND conrelid = '"BatchAccountCreation"'::regclass) THEN
    ALTER TABLE "BatchAccountCreation" ADD CONSTRAINT "BatchAccountCreation_linkedTicketId_fkey" FOREIGN KEY ("linkedTicketId") REFERENCES "SupportTicket"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $fk$;

-- AddForeignKey
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BatchAccountItem_batchId_fkey' AND conrelid = '"BatchAccountItem"'::regclass) THEN
    ALTER TABLE "BatchAccountItem" ADD CONSTRAINT "BatchAccountItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "BatchAccountCreation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $fk$;

-- AddForeignKey
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BatchAuditLog_batchId_fkey' AND conrelid = '"BatchAuditLog"'::regclass) THEN
    ALTER TABLE "BatchAuditLog" ADD CONSTRAINT "BatchAuditLog_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "BatchAccountCreation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $fk$;

-- AddForeignKey
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'VPNAccountStatusLog_accountId_fkey' AND conrelid = '"VPNAccountStatusLog"'::regclass) THEN
    ALTER TABLE "VPNAccountStatusLog" ADD CONSTRAINT "VPNAccountStatusLog_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "VPNAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $fk$;

-- AddForeignKey
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'VPNAccountComment_accountId_fkey' AND conrelid = '"VPNAccountComment"'::regclass) THEN
    ALTER TABLE "VPNAccountComment" ADD CONSTRAINT "VPNAccountComment_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "VPNAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $fk$;

-- AddForeignKey
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'VPNImportRecord_importId_fkey' AND conrelid = '"VPNImportRecord"'::regclass) THEN
    ALTER TABLE "VPNImportRecord" ADD CONSTRAINT "VPNImportRecord_importId_fkey" FOREIGN KEY ("importId") REFERENCES "VPNImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $fk$;

-- AddForeignKey
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AccountLifecycleAction_batchId_fkey' AND conrelid = '"AccountLifecycleAction"'::regclass) THEN
    ALTER TABLE "AccountLifecycleAction" ADD CONSTRAINT "AccountLifecycleAction_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "AccountLifecycleBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $fk$;

-- AddForeignKey
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AccountLifecycleAction_offboardCampaignId_fkey' AND conrelid = '"AccountLifecycleAction"'::regclass) THEN
    ALTER TABLE "AccountLifecycleAction" ADD CONSTRAINT "AccountLifecycleAction_offboardCampaignId_fkey" FOREIGN KEY ("offboardCampaignId") REFERENCES "OffboardCampaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $fk$;

-- AddForeignKey
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AccountLifecycleAction_offboardRecipientId_fkey' AND conrelid = '"AccountLifecycleAction"'::regclass) THEN
    ALTER TABLE "AccountLifecycleAction" ADD CONSTRAINT "AccountLifecycleAction_offboardRecipientId_fkey" FOREIGN KEY ("offboardRecipientId") REFERENCES "OffboardCampaignRecipient"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $fk$;

-- AddForeignKey
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OffboardCampaignRecipient_campaignId_fkey' AND conrelid = '"OffboardCampaignRecipient"'::regclass) THEN
    ALTER TABLE "OffboardCampaignRecipient" ADD CONSTRAINT "OffboardCampaignRecipient_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "OffboardCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $fk$;

-- AddForeignKey
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OffboardCampaignRecipientToken_recipientId_fkey' AND conrelid = '"OffboardCampaignRecipientToken"'::regclass) THEN
    ALTER TABLE "OffboardCampaignRecipientToken" ADD CONSTRAINT "OffboardCampaignRecipientToken_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "OffboardCampaignRecipient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $fk$;

-- AddForeignKey
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OffboardCampaignLog_campaignId_fkey' AND conrelid = '"OffboardCampaignLog"'::regclass) THEN
    ALTER TABLE "OffboardCampaignLog" ADD CONSTRAINT "OffboardCampaignLog_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "OffboardCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $fk$;

-- AddForeignKey
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OffboardCampaignLog_recipientId_fkey' AND conrelid = '"OffboardCampaignLog"'::regclass) THEN
    ALTER TABLE "OffboardCampaignLog" ADD CONSTRAINT "OffboardCampaignLog_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "OffboardCampaignRecipient"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $fk$;

-- AddForeignKey
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AccountLifecycleHistory_actionId_fkey' AND conrelid = '"AccountLifecycleHistory"'::regclass) THEN
    ALTER TABLE "AccountLifecycleHistory" ADD CONSTRAINT "AccountLifecycleHistory_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "AccountLifecycleAction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $fk$;

-- AddForeignKey
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ADAccountMatch_syncId_fkey' AND conrelid = '"ADAccountMatch"'::regclass) THEN
    ALTER TABLE "ADAccountMatch" ADD CONSTRAINT "ADAccountMatch_syncId_fkey" FOREIGN KEY ("syncId") REFERENCES "ADAccountSync"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $fk$;

-- AddForeignKey
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ADAccountActivityLog_lifecycleActionId_fkey' AND conrelid = '"ADAccountActivityLog"'::regclass) THEN
    ALTER TABLE "ADAccountActivityLog" ADD CONSTRAINT "ADAccountActivityLog_lifecycleActionId_fkey" FOREIGN KEY ("lifecycleActionId") REFERENCES "AccountLifecycleAction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $fk$;

-- AddForeignKey
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'VPNAccountActivityLog_lifecycleActionId_fkey' AND conrelid = '"VPNAccountActivityLog"'::regclass) THEN
    ALTER TABLE "VPNAccountActivityLog" ADD CONSTRAINT "VPNAccountActivityLog_lifecycleActionId_fkey" FOREIGN KEY ("lifecycleActionId") REFERENCES "AccountLifecycleAction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $fk$;
