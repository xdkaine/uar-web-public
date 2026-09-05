export type BatchAccountSystem = 'AD' | 'VPN' | 'UNKNOWN';
export type BatchAccountIssueSeverity = 'warning' | 'error';

export interface BatchAccountDetailIssue {
  code: string;
  severity: BatchAccountIssueSeverity;
  message: string;
}

export interface BatchAccountDetailSource {
  id: string;
  createdAt: Date | string;
  updatedAt: Date | string;
  accountType: string;
  name: string;
  email: string | null;
  ldapUsername: string;
  vpnUsername: string | null;
  accessRequestId: string | null;
  accountExpiresAt: Date | string | null;
  isInternal: boolean;
  status: string;
  mutationStage: string | null;
  ldapCreatedAt: Date | string | null;
  vpnCreatedAt: Date | string | null;
  errorMessage: string | null;
  completedAt: Date | string | null;
  targetDirectoryDn: string | null;
  targetDirectoryObjectGuid: string | null;
}

export interface BatchAccountDetailView {
  id: string;
  createdAt: Date | string;
  updatedAt: Date | string;
  accountSystem: BatchAccountSystem;
  accountSystemLabel: string;
  username: string;
  name: string;
  email: string | null;
  accessRequestId: string | null;
  accountExpiresAt: Date | string | null;
  isInternal: boolean;
  status: string;
  stageLabel: string;
  provisionedAt: Date | string | null;
  errorMessage: string | null;
  completedAt: Date | string | null;
  directoryDn: string | null;
  directoryObjectGuid: string | null;
  issues: BatchAccountDetailIssue[];
  needsAttention: boolean;
}

export interface BatchAccountStateCounts {
  completed: number;
  failed: number;
  rolledBack: number;
  reconciliation: number;
  open: number;
  other: number;
}

interface BatchAccountProjectionContext {
  batchStatus?: string;
}

const STAGE_LABELS: Record<string, string> = {
  prepared: 'Prepared in portal',
  ldap_create_started: 'Creating AD account',
  ldap_create_returned: 'AD creation returned',
  ldap_identity_confirmed: 'AD identity confirmed',
  ldap_password_started: 'Setting AD password',
  ldap_password_set: 'AD password set',
  ldap_expiration_started: 'Setting AD expiration',
  ldap_expiration_set: 'AD expiration set',
  vpn_create_started: 'Creating VPN account',
  external_mutations_complete: 'External changes complete',
};

const KNOWN_ITEM_STATUSES = new Set([
  'pending',
  'processing',
  'completed',
  'failed',
  'rolled_back',
  'reconciliation_required',
  'skipped',
]);

const AMBIGUOUS_STARTED_STAGES = new Set([
  'ldap_create_started',
  'ldap_password_started',
  'ldap_expiration_started',
  'vpn_create_started',
]);

function normalized(value: string | null | undefined): string {
  return value?.trim() ?? '';
}

function accountSystem(accountType: string): BatchAccountSystem {
  const normalizedType = accountType.trim().toUpperCase();
  if (normalizedType === 'AD' || normalizedType === 'VPN') return normalizedType;
  return 'UNKNOWN';
}

function fallbackLabel(value: string | null): string {
  if (!value) return 'Not started';
  return value.replaceAll('_', ' ').replace(/\b\w/g, character => character.toUpperCase());
}

export function projectBatchAccountDetail(
  source: BatchAccountDetailSource,
  context: BatchAccountProjectionContext = {}
): BatchAccountDetailView {
  const system = accountSystem(source.accountType);
  const directoryUsername = normalized(source.ldapUsername);
  const vpnUsername = normalized(source.vpnUsername);
  const username = system === 'VPN' ? (vpnUsername || directoryUsername) : directoryUsername;
  const issues: BatchAccountDetailIssue[] = [];

  if (system === 'UNKNOWN') {
    issues.push({
      code: 'unsupported_account_system',
      severity: 'error',
      message: `Unsupported account system "${source.accountType || 'blank'}". This record requires review.`,
    });
  }
  if (!normalized(source.name)) {
    issues.push({ code: 'missing_name', severity: 'warning', message: 'The account holder name is missing.' });
  }
  if (!username) {
    issues.push({ code: 'missing_username', severity: 'error', message: 'No usable username is recorded.' });
  }
  if (!KNOWN_ITEM_STATUSES.has(source.status)) {
    issues.push({
      code: 'unsupported_status',
      severity: 'warning',
      message: `Unrecognized account status "${source.status || 'blank'}".`,
    });
  }

  if (system === 'AD') {
    if (vpnUsername || source.vpnCreatedAt) {
      issues.push({
        code: 'unexpected_vpn_evidence',
        severity: 'warning',
        message: 'The AD item contains VPN-only username or provisioning evidence.',
      });
    }
    if (!normalized(source.email)) {
      issues.push({ code: 'missing_ad_email', severity: 'warning', message: 'The AD account has no email address.' });
    }
    if (!source.accessRequestId) {
      issues.push({
        code: 'missing_access_request',
        severity: 'warning',
        message: 'No access request is linked. This is legacy or incomplete tracking and should be reviewed before later account changes.',
      });
    }
    if (source.status === 'completed' && !source.ldapCreatedAt) {
      issues.push({
        code: 'missing_ad_completion_time',
        severity: 'warning',
        message: 'The item is completed but has no AD creation timestamp.',
      });
    }
    if (source.status === 'completed' && (!source.targetDirectoryDn || !source.targetDirectoryObjectGuid)) {
      issues.push({
        code: 'missing_directory_identity',
        severity: 'warning',
        message: 'The completed AD item is missing its directory DN or object GUID evidence.',
      });
    }
  }

  if (system === 'VPN') {
    if (source.accessRequestId) {
      issues.push({
        code: 'unexpected_vpn_request_link',
        severity: 'error',
        message: 'A VPN-only batch item must not claim an AD access request link.',
      });
    }
    if (source.targetDirectoryDn || source.targetDirectoryObjectGuid || source.ldapCreatedAt) {
      issues.push({
        code: 'unexpected_directory_evidence',
        severity: 'error',
        message: 'The VPN item contains Active Directory identity or provisioning evidence.',
      });
    }
    if (!vpnUsername && directoryUsername) {
      issues.push({
        code: 'legacy_vpn_username_fallback',
        severity: 'warning',
        message: 'The VPN username field is missing. The legacy stored username is shown as a fallback.',
      });
    }
    if (source.status === 'completed' && !source.vpnCreatedAt) {
      issues.push({
        code: 'missing_vpn_completion_time',
        severity: 'warning',
        message: 'The item is completed but has no VPN creation timestamp.',
      });
    }
  }

  if (source.status === 'completed' && source.errorMessage) {
    issues.push({
      code: 'completed_with_error',
      severity: 'warning',
      message: 'The item is completed but still contains an error message.',
    });
  }
  if (['failed', 'reconciliation_required'].includes(source.status) && !source.errorMessage) {
    issues.push({
      code: 'missing_failure_reason',
      severity: 'warning',
      message: 'The item needs attention but no failure explanation was recorded.',
    });
  }
  if (
    context.batchStatus === 'reconciliation_required'
    && ['pending', 'processing'].includes(source.status)
    && AMBIGUOUS_STARTED_STAGES.has(source.mutationStage ?? '')
  ) {
    issues.push({
      code: 'unreconciled_external_mutation',
      severity: 'error',
      message: 'An external change may have started, but completion was not confirmed. Do not retry or roll back this item until a read-only reconciliation confirms the target system state.',
    });
  }

  return {
    id: source.id,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
    accountSystem: system,
    accountSystemLabel: system === 'AD'
      ? 'Active Directory'
      : system === 'VPN'
        ? 'VPN'
        : `Unknown (${source.accountType || 'blank'})`,
    username,
    name: source.name,
    email: source.email,
    accessRequestId: system === 'AD' ? source.accessRequestId : null,
    accountExpiresAt: source.accountExpiresAt,
    isInternal: source.isInternal,
    status: source.status,
    stageLabel: STAGE_LABELS[source.mutationStage ?? ''] ?? fallbackLabel(source.mutationStage),
    provisionedAt: system === 'AD' ? source.ldapCreatedAt : system === 'VPN' ? source.vpnCreatedAt : null,
    errorMessage: source.errorMessage,
    completedAt: source.completedAt,
    directoryDn: system === 'AD' ? source.targetDirectoryDn : null,
    directoryObjectGuid: system === 'AD' ? source.targetDirectoryObjectGuid : null,
    issues,
    needsAttention: ['failed', 'reconciliation_required'].includes(source.status) || issues.length > 0,
  };
}

export function summarizeBatchAccountStates(accounts: BatchAccountDetailView[]): BatchAccountStateCounts {
  const counts: BatchAccountStateCounts = {
    completed: 0,
    failed: 0,
    rolledBack: 0,
    reconciliation: 0,
    open: 0,
    other: 0,
  };

  for (const account of accounts) {
    if (account.status === 'completed') counts.completed += 1;
    else if (account.status === 'failed') counts.failed += 1;
    else if (account.status === 'rolled_back') counts.rolledBack += 1;
    else if (account.status === 'reconciliation_required') counts.reconciliation += 1;
    else if (['pending', 'processing'].includes(account.status)) counts.open += 1;
    else counts.other += 1;
  }

  return counts;
}

export function inspectBatchAccountSummary(
  batch: {
    status: string;
    totalAccounts: number;
    successfulAccounts: number;
    failedAccounts: number;
    completedAt: Date | string | null;
  },
  accounts: BatchAccountDetailView[]
): BatchAccountDetailIssue[] {
  const issues: BatchAccountDetailIssue[] = [];
  const stateCounts = summarizeBatchAccountStates(accounts);
  if (batch.totalAccounts !== accounts.length) {
    issues.push({
      code: 'account_count_mismatch',
      severity: 'error',
      message: `The batch records ${batch.totalAccounts} accounts but ${accounts.length} item records were returned.`,
    });
  }
  if (batch.successfulAccounts < 0 || batch.failedAccounts < 0 || batch.successfulAccounts + batch.failedAccounts > batch.totalAccounts) {
    issues.push({
      code: 'outcome_count_mismatch',
      severity: 'error',
      message: 'The recorded success and failure totals are not possible for this batch size.',
    });
  }
  if (batch.status === 'completed' && batch.successfulAccounts + batch.failedAccounts !== batch.totalAccounts) {
    issues.push({
      code: 'incomplete_completed_summary',
      severity: 'warning',
      message: 'The batch is marked completed but its outcome totals do not cover every account.',
    });
  }
  if (
    batch.status === 'completed'
    && (batch.successfulAccounts !== stateCounts.completed || batch.failedAccounts !== stateCounts.failed)
  ) {
    issues.push({
      code: 'completed_outcome_state_mismatch',
      severity: 'error',
      message: `The completed batch records ${batch.successfulAccounts} successful and ${batch.failedAccounts} failed outcomes, but its item rows show ${stateCounts.completed} completed and ${stateCounts.failed} failed.`,
    });
  }
  const nonCompletedItems = accounts.filter(account => account.status !== 'completed').length;
  if (batch.status === 'completed' && nonCompletedItems > 0) {
    issues.push({
      code: 'completed_with_open_items',
      severity: 'error',
      message: `The batch is marked completed but ${nonCompletedItems} account item${nonCompletedItems === 1 ? ' is' : 's are'} not completed.`,
    });
  }
  if (batch.status === 'processing' && batch.completedAt) {
    issues.push({
      code: 'processing_with_completion_time',
      severity: 'warning',
      message: 'The batch is still processing but already has a completion timestamp.',
    });
  }
  const unreconciledTargets = accounts.filter(account =>
    account.issues.some(issue => issue.code === 'unreconciled_external_mutation')
  ).length;
  if (batch.status === 'reconciliation_required' && unreconciledTargets > 0) {
    issues.push({
      code: 'reconciliation_targets_pending',
      severity: 'error',
      message: `${unreconciledTargets} account item${unreconciledTargets === 1 ? '' : 's'} may have an unfinished external change. Inspect the affected row and reconcile read-only before any retry or rollback.`,
    });
  }
  return issues;
}
