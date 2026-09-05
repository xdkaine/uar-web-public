import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import logger from '@/lib/logger';
import { getClientIp } from '@/lib/ratelimit';

export type AuditActorType = 'admin' | 'user' | 'system' | 'anonymous';
export type AuditEventKind = 'read' | 'write' | 'notification' | 'security' | 'system' | 'lifecycle' | 'sync';
export type AuditOutcome = 'success' | 'failure' | 'denied' | 'pending' | 'rollback' | 'skipped';

export interface AuditLogEntry {
  action: string;
  category: string;
  username: string;
  actorType?: AuditActorType;
  targetId?: string;
  targetType?: string;
  subjectUsername?: string | null;
  subjectEmail?: string | null;
  relatedRequestId?: string | null;
  relatedVpnAccountId?: string | null;
  relatedLifecycleActionId?: string | null;
  eventKind?: AuditEventKind;
  outcome?: AuditOutcome;
  correlationId?: string | null;
  details?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  success?: boolean;
  errorMessage?: string;
}

const SENSITIVE_KEY_PATTERN = /(password|token|tokenHash|secret|credential|authorization|apiKey|api_key|distinguishedName|userDN|dn)$/i;
const SENSITIVE_TEXT_PATTERN = /(password|token|secret|credential|authorization|bearer|distinguishedName|userDN|DN)\s*[:=]/i;

export function sanitizeDatabaseText(value: string, maxLength = 5000): string {
  return value
    .replace(/\0/g, '')
    .replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '')
    .substring(0, maxLength);
}

function redactString(value: string): string {
  const safeValue = sanitizeDatabaseText(value);

  if (SENSITIVE_TEXT_PATTERN.test(safeValue)) {
    return '[REDACTED]';
  }

  return sanitizeDatabaseText(safeValue
    .replace(/password["\s:=]+[^\s,}]*/gi, 'password=[REDACTED]')
    .replace(/token["\s:=]+[^\s,}]*/gi, 'token=[REDACTED]')
    .replace(/secret["\s:=]+[^\s,}]*/gi, 'secret=[REDACTED]')
    .replace(/credential[s]?["\s:=]+[^\s,}]*/gi, 'credential=[REDACTED]')
    .replace(/authorization["\s:=]+[^\s,}]*/gi, 'authorization=[REDACTED]')
    .replace(/bearer\s+[^\s,}]+/gi, 'bearer [REDACTED]')
    .replace(/DN:\s*[^\s,}]*/gi, 'DN=[REDACTED]')
    .replace(/distinguishedName["\s:=]+[^\s,}]*/gi, 'distinguishedName=[REDACTED]'));
}

export function sanitizeAuditDetails(value: unknown): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') {
    return redactString(value);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeAuditDetails(item));
  }

  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        SENSITIVE_KEY_PATTERN.test(key) ? '[REDACTED]' : sanitizeAuditDetails(item),
      ])
    );
  }

  return '[UNSUPPORTED]';
}

function normalizeNullable(value: string | null | undefined): string | undefined {
  const normalized = value ? sanitizeDatabaseText(value).trim() : undefined;
  return normalized || undefined;
}

function normalizeAuditEntry(entry: AuditLogEntry): AuditLogEntry {
  const safeDetails = entry.details
    ? sanitizeAuditDetails(entry.details) as Record<string, unknown>
    : undefined;

  return {
    ...entry,
    action: sanitizeDatabaseText(entry.action),
    category: sanitizeDatabaseText(entry.category),
    username: sanitizeDatabaseText(entry.username),
    actorType: entry.actorType || 'admin',
    targetId: normalizeNullable(entry.targetId),
    targetType: normalizeNullable(entry.targetType),
    subjectUsername: normalizeNullable(entry.subjectUsername),
    subjectEmail: normalizeNullable(entry.subjectEmail)?.toLowerCase(),
    relatedRequestId: normalizeNullable(entry.relatedRequestId),
    relatedVpnAccountId: normalizeNullable(entry.relatedVpnAccountId),
    relatedLifecycleActionId: normalizeNullable(entry.relatedLifecycleActionId),
    correlationId: normalizeNullable(entry.correlationId),
    ipAddress: normalizeNullable(entry.ipAddress),
    userAgent: normalizeNullable(entry.userAgent),
    errorMessage: normalizeNullable(entry.errorMessage),
    outcome: entry.outcome || (entry.success === false ? 'failure' : 'success'),
    details: safeDetails,
  } satisfies AuditLogEntry;
}

/** Emit the operational audit event after its associated transaction commits. */
export function emitAuditActionLog(entry: AuditLogEntry): void {
  const normalizedEntry = normalizeAuditEntry(entry);
  logger.info(normalizedEntry.action, {
    type: 'audit_log',
    ...normalizedEntry,
    details: normalizedEntry.details,
  });
}

/**
 * Logs an admin action to the audit log
 * @param entry The audit log entry data
 */
export async function logAuditAction(
  entry: AuditLogEntry,
  database: Pick<Prisma.TransactionClient, 'auditLog'> = prisma,
  options: { emitOperationalLog?: boolean } = {},
): Promise<void> {
  const normalizedEntry = normalizeAuditEntry(entry);

  if (options.emitOperationalLog !== false) {
    emitAuditActionLog(normalizedEntry);
  }

  try {
    // Log to database
    await database.auditLog.create({
      data: {
        action: normalizedEntry.action,
        category: normalizedEntry.category,
        username: normalizedEntry.username,
        actorType: normalizedEntry.actorType,
        targetId: normalizedEntry.targetId,
        targetType: normalizedEntry.targetType,
        subjectUsername: normalizedEntry.subjectUsername,
        subjectEmail: normalizedEntry.subjectEmail,
        relatedRequestId: normalizedEntry.relatedRequestId,
        relatedVpnAccountId: normalizedEntry.relatedVpnAccountId,
        relatedLifecycleActionId: normalizedEntry.relatedLifecycleActionId,
        eventKind: normalizedEntry.eventKind,
        outcome: normalizedEntry.outcome,
        correlationId: normalizedEntry.correlationId,
        details: normalizedEntry.details ? JSON.stringify(normalizedEntry.details) : null,
        ipAddress: normalizedEntry.ipAddress,
        userAgent: normalizedEntry.userAgent,
        success: normalizedEntry.success ?? true,
        errorMessage: normalizedEntry.errorMessage,
      },
    });
  } catch (error) {
    console.error('Failed to log audit action:', error);
    throw error instanceof Error
      ? error
      : new Error('Unknown error occurred while writing audit log');
  }
}

/**
 * Helper to extract IP address from request headers
 */
export function getIpAddress(request: Request): string | undefined {
  const ipAddress = getClientIp(request);
  return ipAddress === 'unknown' ? undefined : ipAddress;
}

/**
 * Helper to get user agent from request
 */
export function getUserAgent(request: Request): string | undefined {
  return request.headers.get('user-agent') || undefined;
}

// Action types for consistency
export const AuditActions = {
  // Auth Manager client registry
  AUTH_CLIENT_REGISTERED: 'auth_client_registered',
  AUTH_CLIENT_UPDATED: 'auth_client_updated',
  AUTH_CLIENT_SECRET_ROTATED: 'auth_client_secret_rotated',
  AUTH_CLIENT_DELETED: 'auth_client_deleted',

  // Navigation
  VIEW_PAGE: 'view_page',
  SWITCH_TAB: 'switch_tab',
  ADMIN_LOGOUT: 'admin_logout',

  // Access Requests
  VIEW_REQUEST: 'view_request',
  APPROVE_REQUEST: 'approve_request',
  REJECT_REQUEST: 'reject_request',
  ACKNOWLEDGE_REQUEST: 'acknowledge_request',
  CREATE_ACCOUNT: 'create_account',
  SAVE_REQUEST_CREDENTIALS: 'save_request_credentials',
  UPDATE_ACCOUNT: 'update_account',
  RECONCILE_ACCOUNT_UPDATE: 'reconcile_account_update',
  RECONCILE_FACULTY_DELIVERY: 'reconcile_faculty_delivery',
  RECONCILE_STAGE_NOTIFICATION: 'reconcile_stage_notification',
  RECONCILE_REQUEST_WORKFLOW: 'reconcile_request_workflow',
  MOVE_BACK_REQUEST: 'move_back_request',
  UNDO_FACULTY_NOTIFICATION: 'undo_faculty_notification',
  SEND_TO_FACULTY: 'send_to_faculty',
  ADD_COMMENT: 'add_comment',
  RESEND_VERIFICATION_EMAIL: 'resend_verification_email',
  RESEND_ACTIVATION_EMAIL: 'resend_activation_email',
  ADMIN_TRIGGER_PASSWORD_RESET: 'admin_trigger_password_reset',
  ACCOUNT_HISTORY_VIEW: 'account_history_view',

  // Events
  VIEW_EVENT_LIST: 'view_event_list',
  CREATE_EVENT: 'create_event',
  UPDATE_EVENT: 'update_event',
  DELETE_EVENT: 'delete_event',
  ACTIVATE_EVENT: 'activate_event',
  DEACTIVATE_EVENT: 'deactivate_event',
  VIEW_EVENT: 'view_event',

  // Users
  VIEW_USER: 'view_user',
  VIEW_USER_LIST: 'view_user_list',
  SEARCH_USERS: 'search_users',
  UPDATE_USER: 'update_user',
  DELETE_USER: 'delete_user',
  DISABLE_USER: 'disable_user',
  ENABLE_USER: 'enable_user',
  VIEW_PASSWORD_EXPIRATION_REPORT: 'view_password_expiration_report',
  PASSWORD_EXPIRATION_EMAIL_SENT: 'password_expiration_email_sent',
  PASSWORD_EXPIRATION_EMAIL_SKIPPED: 'password_expiration_email_skipped',
  PASSWORD_EXPIRATION_EMAIL_FAILURE: 'password_expiration_email_failure',
  PASSWORD_EXPIRATION_SCHEDULER_RUN: 'password_expiration_scheduler_run',

  // Batch Accounts
  CREATE_BATCH: 'create_batch',
  CANCEL_BATCH: 'cancel_batch',
  VIEW_BATCH: 'view_batch',
  VIEW_BATCH_DETAILS: 'view_batch_details',

  // VPN Management
  CREATE_VPN_ACCOUNT: 'create_vpn_account',
  UPDATE_VPN_ACCOUNT: 'update_vpn_account',
  DELETE_VPN_ACCOUNT: 'delete_vpn_account',
  DISABLE_VPN_ACCOUNT: 'disable_vpn_account',
  ENABLE_VPN_ACCOUNT: 'enable_vpn_account',
  SEND_VPN_TO_FACULTY: 'send_vpn_to_faculty',
  VIEW_VPN_ACCOUNT: 'view_vpn_account',
  CLEAR_VPN_IMPORT_QUEUE: 'clear_vpn_import_queue',
  VPN_COMMENT: 'vpn_comment',

  // Support Tickets
  VIEW_TICKET: 'view_ticket',
  CREATE_TICKET_RESPONSE: 'create_ticket_response',
  UPDATE_TICKET_STATUS: 'update_ticket_status',
  CLOSE_TICKET: 'close_ticket',
  REOPEN_TICKET: 'reopen_ticket',
  ASSIGN_TICKET: 'assign_ticket',
  UNASSIGN_TICKET: 'unassign_ticket',
  VIEW_TICKET_ASSIGNMENTS: 'view_ticket_assignments',
  SYNC_TICKET_GROUPS: 'sync_ticket_groups',
  MANAGE_TICKET_GROUPS: 'manage_ticket_groups',

  // Blocklist
  ADD_BLOCKLIST: 'add_blocklist',
  REMOVE_BLOCKLIST: 'remove_blocklist',
  UPDATE_BLOCKLIST: 'update_blocklist',
  VIEW_BLOCKLIST: 'view_blocklist',

  // Settings
  UPDATE_SETTINGS: 'update_settings',
  TOGGLE_LOGIN: 'toggle_login',
  TOGGLE_REGISTRATION: 'toggle_registration',
  CREATE_NOTIFICATION: 'create_notification',
  UPDATE_NOTIFICATION: 'update_notification',
  DELETE_NOTIFICATION: 'delete_notification',

  // Logs
  VIEW_AUDIT_LOGS: 'view_audit_logs',
  EXPORT_AUDIT_LOGS: 'export_audit_logs',

  // Rate Limiting
  VIEW_RATE_LIMITS: 'view_rate_limits',
  RELEASE_RATE_LIMIT: 'release_rate_limit',

  // Search & Check Operations
  CHECK_USERNAME: 'check_username',
  SEARCH_AD: 'search_ad',

  // Cleanup Operations
  RUN_CLEANUP: 'run_cleanup',

  // Infrastructure Operations
  SYNC_INFRASTRUCTURE: 'sync_infrastructure',
  SYNC_ACCOUNT_PROCESSED: 'sync_account_processed',
  VIEW_SYNC_RESULTS: 'view_sync_results',
  VIEW_SYNC_STATUS: 'view_sync_status',

  // List View Operations
  VIEW_REQUESTS_LIST: 'view_requests_list',
  VIEW_TICKETS_LIST: 'view_tickets_list',
  VIEW_VPN_ACCOUNTS_LIST: 'view_vpn_accounts_list',
  VIEW_IMPORT_DETAILS: 'view_import_details',

  // Manual Assignment
  MANUAL_ASSIGN_REQUEST: 'manual_assign_request',

  // Account Lifecycle Management
  CREATE_LIFECYCLE_ACTION: 'create_lifecycle_action',
  PROCESS_LIFECYCLE_ACTION: 'process_lifecycle_action',
  CANCEL_LIFECYCLE_ACTION: 'cancel_lifecycle_action',
  RETRY_LIFECYCLE_ACTION: 'retry_lifecycle_action',
  DELETE_LIFECYCLE_ACTION: 'delete_lifecycle_action',
  CREATE_LIFECYCLE_BATCH: 'create_lifecycle_batch',
  DISABLE_AD_ACCOUNT: 'disable_ad_account',
  ENABLE_AD_ACCOUNT: 'enable_ad_account',
  REVOKE_VPN_ACCESS: 'revoke_vpn_access',
  RESTORE_VPN_ACCESS: 'restore_vpn_access',
  PROMOTE_VPN_ROLE: 'promote_vpn_role',
  DEMOTE_VPN_ROLE: 'demote_vpn_role',
  VIEW_LIFECYCLE_ACTIONS: 'view_lifecycle_actions',
  VIEW_LIFECYCLE_HISTORY: 'view_lifecycle_history',

  // Offboard Campaigns
  CREATE_OFFBOARD_CAMPAIGN: 'create_offboard_campaign',
  OFFBOARD_DRY_RUN: 'offboard_dry_run',
  ACTIVATE_OFFBOARD_CAMPAIGN: 'activate_offboard_campaign',
  PAUSE_OFFBOARD_CAMPAIGN: 'pause_offboard_campaign',
  RESUME_OFFBOARD_CAMPAIGN: 'resume_offboard_campaign',
  EMERGENCY_STOP_OFFBOARD_CAMPAIGN: 'emergency_stop_offboard_campaign',
  CANCEL_OFFBOARD_CAMPAIGN: 'cancel_offboard_campaign',
  DELETE_OFFBOARD_DRY_RUN: 'delete_offboard_dry_run',
  OFFBOARD_EMAIL_FAILURE: 'offboard_email_failure',
  OFFBOARD_EMAIL_SENT: 'offboard_email_sent',
  OFFBOARD_REMINDER_SENT: 'offboard_reminder_sent',
  OFFBOARD_ENFORCEMENT_FAILURE: 'offboard_enforcement_failure',
  OFFBOARD_ENFORCEMENT_COMPLETED: 'offboard_enforcement_completed',
  OFFBOARD_ENFORCEMENT_SKIPPED: 'offboard_enforcement_skipped',
  OFFBOARD_ENFORCEMENT_RECONCILED: 'offboard_enforcement_reconciled',
  OFFBOARD_RECIPIENT_VERIFIED: 'offboard_recipient_verified',
  OFFBOARD_CAMPAIGN_COMPLETED: 'offboard_campaign_completed',
  OFFBOARD_CAMPAIGN_EVENT: 'offboard_campaign_event',
  OFFBOARD_ROLLBACK_START: 'offboard_rollback_start',
  OFFBOARD_ROLLBACK_SUCCESS: 'offboard_rollback_success',
  OFFBOARD_ROLLBACK_FAILURE: 'offboard_rollback_failure',
  OFFBOARD_PROCESS_ALL: 'offboard_process_all',
  OFFBOARD_DEADLINE_EXTENSION: 'offboard_deadline_extension',
  OFFBOARD_EXTENSION_NOTIFICATION_RETRY: 'offboard_extension_notification_retry',
  VIEW_OFFBOARD_CAMPAIGNS: 'view_offboard_campaigns',
  EXPORT_OFFBOARD_CAMPAIGN: 'export_offboard_campaign',

  // Mass Email Campaigns
  VIEW_MASS_EMAIL_CAMPAIGNS: 'view_mass_email_campaigns',
  PREVIEW_MASS_EMAIL: 'preview_mass_email',
  RESOLVE_MASS_EMAIL_RECIPIENTS: 'resolve_mass_email_recipients',
  CREATE_MASS_EMAIL_CAMPAIGN: 'create_mass_email_campaign',
  UPDATE_MASS_EMAIL_CAMPAIGN: 'update_mass_email_campaign',
  ACTIVATE_MASS_EMAIL_CAMPAIGN: 'activate_mass_email_campaign',
  QUICK_SEND_MASS_EMAIL: 'quick_send_mass_email',
  TEST_MASS_EMAIL: 'test_mass_email',
  PROCESS_MASS_EMAIL_CAMPAIGN: 'process_mass_email_campaign',
  CANCEL_MASS_EMAIL_CAMPAIGN: 'cancel_mass_email_campaign',
  MASS_EMAIL_SENT: 'mass_email_sent',
  MASS_EMAIL_FAILURE: 'mass_email_failure',
  RECONCILE_WORKFLOW_OPERATION: 'reconcile_workflow_operation',
  MASS_EMAIL_COMPLETED: 'mass_email_completed',

  // AD Account Comments
  CREATE_AD_COMMENT: 'create_ad_comment',
  UPDATE_AD_COMMENT: 'update_ad_comment',
  DELETE_AD_COMMENT: 'delete_ad_comment',
  PIN_AD_COMMENT: 'pin_ad_comment',
  UNPIN_AD_COMMENT: 'unpin_ad_comment',

  // Generic API Request Logging
  ADMIN_API_REQUEST: 'admin_api_request',

  // Group Management
  VIEW_GROUP_LIST: 'view_group_list',
  ADD_GROUP_MEMBER: 'add_group_member',
  REMOVE_GROUP_MEMBER: 'remove_group_member',

  // Authentication
  LOGIN_SUCCESS: 'login_success',
  LOGIN_FAILURE: 'login_failure',
  LOCAL_BREAK_GLASS_LOGIN: 'local_break_glass_login',
  OIDC_OUTAGE_FALLBACK_OPEN_AUTHORIZED: 'oidc_outage_fallback_open_authorized',
  OIDC_OUTAGE_FALLBACK_OPENED: 'oidc_outage_fallback_opened',
  OIDC_OUTAGE_FALLBACK_ACTIVATION_FAILED: 'oidc_outage_fallback_activation_failed',
  OIDC_OUTAGE_FALLBACK_RECOVERED: 'oidc_outage_fallback_recovered',
  OIDC_OUTAGE_FALLBACK_CLOSED_FAIL_CLOSED: 'oidc_outage_fallback_closed_fail_closed',
  OIDC_OUTAGE_FALLBACK_DENIED: 'oidc_outage_fallback_denied',
  OIDC_ALTERNATE_SIGNIN_DENIED: 'oidc_alternate_signin_denied',
  PASSWORD_CHANGE_REQUIRED: 'password_change_required',
  PASSWORD_CHANGE_DIRECTORY_MUTATION_COMPLETED: 'password_change_directory_mutation_completed',
  PASSWORD_CHANGE_SUCCESS: 'password_change_success',
  PASSWORD_CHANGE_FAILURE: 'password_change_failure',
  PASSWORD_RESET_REQUESTED: 'password_reset_requested',
  PASSWORD_RESET_LINK_SENT: 'password_reset_link_sent',
  PASSWORD_RESET_DENIED: 'password_reset_denied',
  PASSWORD_RESET_TOKEN_INVALID: 'password_reset_token_invalid',
  PASSWORD_RESET_COMPLETED: 'password_reset_completed',
  PASSWORD_RESET_TOKEN_ROLLED_BACK: 'password_reset_token_rolled_back',
  ACCOUNT_ACTIVATION_LINK_SENT: 'account_activation_link_sent',
  ACCOUNT_ACTIVATION_FAILED: 'account_activation_failed',
  ACCOUNT_ACTIVATION_COMPLETED: 'account_activation_completed',
  ACCOUNT_ACTIVATION_TOKEN_ROLLED_BACK: 'account_activation_token_rolled_back',
  EMAIL_VERIFICATION_COMPLETED: 'email_verification_completed',
  EMAIL_VERIFICATION_FAILED: 'email_verification_failed',
} as const;

// Categories for organizing logs
export const AuditCategories = {
  NAVIGATION: 'navigation',
  ACCESS_REQUEST: 'access_request',
  EVENT: 'event',
  USER: 'user',
  GROUP: 'group',
  BATCH: 'batch',
  VPN: 'vpn',
  SUPPORT: 'support',
  BLOCKLIST: 'blocklist',
  SETTINGS: 'settings',
  LOGS: 'logs',
  LIFECYCLE: 'lifecycle',
  OFFBOARD_CAMPAIGN: 'offboard_campaign',
  MASS_EMAIL: 'mass_email',
  SYNC_STATUS: 'sync_status',
  SESSION: 'session',
  RATE_LIMIT: 'rate_limit',
  SEARCH: 'search',
  AUTH: 'auth',
  CONFIGURATION: 'configuration',
} as const;

/**
 * Categorize admin API request by pathname
 */
export function categorizeRequest(pathname: string): string {
  if (pathname.includes('/requests')) return AuditCategories.ACCESS_REQUEST;
  if (pathname.includes('/password-expiration')) return AuditCategories.USER;
  if (pathname.includes('/events')) return AuditCategories.EVENT;
  if (pathname.includes('/users')) return AuditCategories.USER;
  if (pathname.includes('/vpn')) return AuditCategories.VPN;
  if (pathname.includes('/support')) return AuditCategories.SUPPORT;
  if (pathname.includes('/batch')) return AuditCategories.BATCH;
  if (pathname.includes('/lifecycle')) return AuditCategories.LIFECYCLE;
  if (pathname.includes('/offboard-campaigns')) return AuditCategories.OFFBOARD_CAMPAIGN;
  if (pathname.includes('/mass-email')) return AuditCategories.MASS_EMAIL;
  if (pathname.includes('/settings')) return AuditCategories.SETTINGS;
  if (pathname.includes('/logs')) return AuditCategories.LOGS;
  if (pathname.includes('/sessions')) return AuditCategories.SESSION;
  if (pathname.includes('/ratelimits')) return AuditCategories.RATE_LIMIT;
  if (pathname.includes('/sync-status')) return AuditCategories.SYNC_STATUS;
  if (pathname.includes('/search')) return AuditCategories.SEARCH;
  if (pathname.includes('/blocklist')) return AuditCategories.BLOCKLIST;
  if (pathname.includes('/track-view')) return AuditCategories.NAVIGATION;
  return AuditCategories.NAVIGATION;
}
