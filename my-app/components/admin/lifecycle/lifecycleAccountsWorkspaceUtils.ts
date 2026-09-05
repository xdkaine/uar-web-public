import type { AccountOwnershipSummary } from "@/lib/account-ownership";
import {
  isInventoryGovernanceReady,
  type LifecycleAccountInventoryItem,
} from "@/lib/lifecycle-account-inventory";

export type Intent = "disable" | "restore" | "delete" | "promote" | "demote";
export type SystemScope = "AD" | "VPN" | "BOTH";
export type ActionType =
  | "disable_ad"
  | "enable_ad"
  | "delete_ad"
  | "revoke_vpn"
  | "restore_vpn"
  | "delete_vpn_record"
  | "promote_vpn_role"
  | "demote_vpn_role"
  | "disable_both"
  | "enable_both"
  | "delete_both_records";
export type WorkspaceStage = "accounts" | "actions";
export type SystemFilter = "all" | "AD" | "VPN" | "BOTH";
export type AccountStateFilter =
  "all" | "active" | "restricted" | "attention" | "unlinked";
export type LifecycleEligibilityState =
  "ready" | "attention" | "exception" | "not_applicable";

export type OwnershipInventoryAccount = LifecycleAccountInventoryItem & {
  ownership?: AccountOwnershipSummary | null;
};

export interface InventoryResponse {
  accounts: OwnershipInventoryAccount[];
  readOnly: boolean;
  vpnModuleEnabled: boolean;
  summary: { total: number; directory: number; vpn: number };
}

export interface LifecycleActionOption {
  actionType: ActionType;
  intent: Intent;
  scope: SystemScope;
  label: string;
  description: string;
}

export interface LifecycleActionAvailability extends LifecycleActionOption {
  available: boolean;
  operationMode: "governed" | "batch_governed" | "directory_override" | null;
  reason: string;
}

export const EMPTY_SUMMARY: InventoryResponse["summary"] = {
  total: 0,
  directory: 0,
  vpn: 0,
};
export const MAX_LIFECYCLE_SELECTION = 25;
export const DEFAULT_LIFECYCLE_PAGE_SIZE = 25;

const UNMANAGED_DELETION_PERMISSIONS = [
  "users.manage",
  "lifecycle.manage",
  "lifecycle.override",
  "lifecycle.delete",
  "lifecycle.delete_unmanaged",
] as const;

export const ACTION_OPTIONS: LifecycleActionOption[] = [
  {
    actionType: "disable_ad",
    intent: "disable",
    scope: "AD",
    label: "Disable Active Directory",
    description: "Disable sign-in for each selected directory account.",
  },
  {
    actionType: "enable_ad",
    intent: "restore",
    scope: "AD",
    label: "Enable Active Directory",
    description: "Restore sign-in for each selected directory account.",
  },
  {
    actionType: "delete_ad",
    intent: "delete",
    scope: "AD",
    label: "Permanently delete Active Directory account",
    description:
      "Remove the selected disabled AD objects. VPN records, audit logs, comments, and request/batch history are retained.",
  },
  {
    actionType: "revoke_vpn",
    intent: "disable",
    scope: "VPN",
    label: "Revoke VPN",
    description: "Revoke each selected VPN account.",
  },
  {
    actionType: "restore_vpn",
    intent: "restore",
    scope: "VPN",
    label: "Restore VPN",
    description: "Restore each selected revocable VPN account.",
  },
  {
    actionType: "delete_vpn_record",
    intent: "delete",
    scope: "VPN",
    label: "Permanently delete revoked VPN record",
    description:
      "Remove a revoked live VPN record and credential while retaining its logs, comments, and audit history.",
  },
  {
    actionType: "delete_both_records",
    intent: "delete",
    scope: "BOTH",
    label: "Permanently delete AD and VPN records",
    description:
      "Remove the selected disabled AD objects and revoked VPN records, including stored VPN credentials. Audit logs, comments, and request/batch history are retained.",
  },
  {
    actionType: "disable_both",
    intent: "disable",
    scope: "BOTH",
    label: "Disable AD and revoke VPN",
    description:
      "Apply both access restrictions as one tracked operation per account.",
  },
  {
    actionType: "enable_both",
    intent: "restore",
    scope: "BOTH",
    label: "Enable AD and restore VPN",
    description: "Restore both systems as one tracked operation per account.",
  },
  {
    actionType: "promote_vpn_role",
    intent: "promote",
    scope: "VPN",
    label: "Promote VPN role",
    description: "Change each selected VPN account from Limited to Management.",
  },
  {
    actionType: "demote_vpn_role",
    intent: "demote",
    scope: "VPN",
    label: "Demote VPN role",
    description: "Change each selected VPN account from Management to Limited.",
  },
];

export function unmanagedDeletionPermissionMessage(
  permissions: ReadonlySet<string>,
): string | null {
  const missing = UNMANAGED_DELETION_PERMISSIONS.filter(
    (permission) => !permissions.has(permission),
  );
  return missing.length === 0
    ? null
    : `Your role is missing: ${missing.join(", ")}.`;
}

export function lifecyclePage<T>(
  items: T[],
  requestedPage: number,
  pageSize: number,
) {
  const safePageSize = [25, 50, 100].includes(pageSize)
    ? pageSize
    : DEFAULT_LIFECYCLE_PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(items.length / safePageSize));
  const page = Math.min(Math.max(1, requestedPage), totalPages);
  const startIndex = (page - 1) * safePageSize;
  return {
    page,
    totalPages,
    start: items.length === 0 ? 0 : startIndex + 1,
    end: Math.min(startIndex + safePageSize, items.length),
    items: items.slice(startIndex, startIndex + safePageSize),
  };
}

function hasRequestedSystems(
  account: LifecycleAccountInventoryItem,
  scope: SystemScope,
): boolean {
  return scope === "AD"
    ? Boolean(account.directory)
    : scope === "VPN"
      ? Boolean(account.vpn)
      : Boolean(account.directory && account.vpn);
}

export function accountHasRequestedState(
  account: LifecycleAccountInventoryItem,
  intent: Intent,
  scope: SystemScope,
): boolean {
  if (intent === "promote") return account.vpn?.portalType === "Limited";
  if (intent === "demote") return account.vpn?.portalType === "Management";
  if (intent === "delete") {
    const adReady =
      Boolean(account.directory && !account.directory.enabled) &&
      (account.governance.adAccountStatus === "disabled" ||
        account.governance.bindingPosture === "missing");
    const vpnReady = account.vpn?.status.toLowerCase() === "revoked";
    return scope === "AD"
      ? adReady
      : scope === "VPN"
        ? vpnReady
        : adReady && vpnReady;
  }
  const adApplicable = Boolean(
    account.directory &&
    (intent === "disable"
      ? account.directory.enabled
      : !account.directory.enabled),
  );
  const vpnStatus = account.vpn?.status.toLowerCase();
  const vpnApplicable = Boolean(
    account.vpn &&
    (intent === "disable"
      ? vpnStatus !== "revoked" && vpnStatus !== "disabled"
      : vpnStatus === "revoked"),
  );
  return scope === "AD"
    ? adApplicable
    : scope === "VPN"
      ? vpnApplicable
      : adApplicable && vpnApplicable;
}

export function lifecycleEligibilityState(
  account: LifecycleAccountInventoryItem,
  intent: Intent,
  scope: SystemScope,
): LifecycleEligibilityState {
  if (
    !hasRequestedSystems(account, scope) ||
    !accountHasRequestedState(account, intent, scope)
  )
    return "not_applicable";
  if (
    (scope === "VPN" || scope === "BOTH") &&
    intent === "restore" &&
    account.vpn?.canRestore === false
  )
    return "attention";
  if (scope === "BOTH" && (account.vpn?.relatedAccountCount ?? 1) !== 1)
    return "attention";
  if (scope === "VPN")
    return account.governance.bindingPosture === "conflict"
      ? "attention"
      : "ready";
  if (account.governance.bindingPosture === "missing")
    return scope === "AD" ? "exception" : "attention";
  if (intent === "delete" && account.governance.bindingPosture !== "verified")
    return "attention";
  if (account.governance.bindingPosture !== "verified") return "attention";
  return (intent === "disable" ||
    intent === "restore" ||
    intent === "delete") &&
    isInventoryGovernanceReady(account, intent)
    ? "ready"
    : "attention";
}

export function isLifecycleAccountSelectable(
  account: LifecycleAccountInventoryItem,
  intent: Intent,
  scope: SystemScope,
): boolean {
  const state = lifecycleEligibilityState(account, intent, scope);
  return state === "ready" || state === "exception";
}

export function isBatchBulkDeletionEligible(
  accounts: LifecycleAccountInventoryItem[],
  scope: SystemScope,
): boolean {
  if (accounts.length < 2) return false;
  // AD plans retain distinct request and standalone-batch execution modes.
  if (scope !== "VPN" && new Set(accounts.map((account) => account.governance.ownerType)).size !== 1)
    return false;
  const batchIds = accounts.map((account) => account.batchProvenance?.batchId);
  if (batchIds.some((batchId) => !batchId))
    return false;
  return accounts.every((account) => {
    const accountTypes = account.batchProvenance?.accountTypes;
    return Boolean(
      accountTypes &&
      (scope === "AD"
        ? accountTypes.includes("AD") || accountTypes.includes("BOTH")
        : scope === "VPN"
          ? accountTypes.includes("VPN") || accountTypes.includes("BOTH")
          : accountTypes.includes("BOTH") ||
            (accountTypes.includes("AD") && accountTypes.includes("VPN"))),
    );
  });
}

export function isRequestOwnedDeletionSelection(
  accounts: LifecycleAccountInventoryItem[],
  scope: SystemScope,
): boolean {
  return accounts.length > 0 && accounts.every((account) =>
    account.governance.ownerType === "access_request" &&
    Boolean(account.governance.requestId) &&
    (scope === "AD" || !account.vpn ||
      account.vpn.accessRequestId === account.governance.requestId),
  );
}

export function lifecycleActionAvailability(
  accounts: LifecycleAccountInventoryItem[],
  option: LifecycleActionOption,
): LifecycleActionAvailability {
  if (accounts.length === 0)
    return {
      ...option,
      available: false,
      operationMode: null,
      reason: "Select at least one account.",
    };
  if (option.actionType === "delete_both_records") {
    const ready = accounts.every(
      (account) =>
        lifecycleEligibilityState(account, "delete", "AD") === "ready" &&
        (!account.vpn ||
          (account.vpn.status.toLowerCase() === "revoked" &&
            account.governance.bindingPosture !== "conflict")),
    );
    if (!ready)
      return {
        ...option,
        available: false,
        operationMode: null,
        reason:
          "Every account needs a governed disabled AD record; any attached VPN record must be revoked and coherently linked.",
      };
    if (
      accounts.some(
        (account) => account.governance.ownerType === "batch_account",
      )
    )
      return {
        ...option,
        available: false,
        operationMode: null,
        reason:
          "Batch-owned AD and VPN records must be deleted as separate reviewed plans.",
      };
    return {
      ...option,
      available: true,
      operationMode: "governed",
      reason:
        "Deletes each AD record and any attached revoked VPN record as separately tracked actions.",
    };
  }
  const states = accounts.map((account) =>
    lifecycleEligibilityState(account, option.intent, option.scope),
  );
  if (
    option.intent === "delete" &&
    option.scope === "AD" &&
    accounts.some((account) => account.directory?.enabled)
  )
    return {
      ...option,
      available: false,
      operationMode: null,
      reason:
        "Permanent deletion remains unavailable until every selected Active Directory account is disabled. Disable is a separate action; the workflow never combines disable and delete.",
    };
  if (option.intent === "delete" && accounts.length > 1) {
    if (option.scope === "AD" && states.every((state) => state === "exception"))
      return {
        ...option,
        available: true,
        operationMode: "directory_override",
        reason: "Available as a reviewed unmanaged-directory deletion plan.",
      };
    const requestOwnedAndReady =
      states.every((state) => state === "ready") &&
      isRequestOwnedDeletionSelection(accounts, option.scope);
    if (
      !requestOwnedAndReady &&
      !isBatchBulkDeletionEligible(accounts, option.scope)
    )
      return {
        ...option,
        available: false,
        operationMode: null,
        reason:
          "Every selected account must be independently deletion-ready and use a compatible governed ownership lane.",
      };
  }
  if (states.every((state) => state === "ready")) {
    const ownerModes = new Set(
      accounts.map((account) => account.governance.ownerType),
    );
    const batchGoverned =
      (option.scope === "AD" || option.scope === "BOTH") &&
      ownerModes.size === 1 &&
      ownerModes.has("batch_account");
    return {
      ...option,
      available: true,
      operationMode: batchGoverned ? "batch_governed" : "governed",
      reason: "Available for every selected account.",
    };
  }
  if (
    accounts.length === 1 &&
    option.scope === "AD" &&
    states[0] === "exception"
  )
    return {
      ...option,
      available: true,
      operationMode: "directory_override",
      reason:
        option.intent === "delete"
          ? "Available as an unmanaged-directory deletion plan for one disabled AD account. Requires lifecycle.delete_unmanaged, lifecycle.delete, lifecycle.override, and users.manage; it never creates or links a request."
          : "Available for one unowned directory account with lifecycle.override. This changes AD only and does not create or link a request.",
    };
  const parts = [
    states.filter((state) => state === "attention").length
      ? `${states.filter((state) => state === "attention").length} need review`
      : "",
    states.filter((state) => state === "not_applicable").length
      ? `${states.filter((state) => state === "not_applicable").length} are already in that state or lack the system`
      : "",
    states.filter((state) => state === "exception").length
      ? `${states.filter((state) => state === "exception").length} require a single-account unowned-directory action`
      : "",
  ].filter(Boolean);
  return {
    ...option,
    available: false,
    operationMode: null,
    reason: parts.join("; ") || "Not available for this selection.",
  };
}

export function lifecycleResponseRequiresReconciliation(data: {
  action?: { status?: string | null } | null;
  processResult?: { reconciliationRequired?: boolean } | null;
}): boolean {
  return (
    data.processResult?.reconciliationRequired === true ||
    data.action?.status === "reconciliation_required"
  );
}

export function lifecycleInterruptionMessage(input: {
  successful: number;
  knownFailures: number;
  attempted: number;
  total: number;
  error: string;
}): string {
  const uncertain = Math.max(
    input.attempted - input.successful - input.knownFailures,
    1,
  );
  const notAttempted = Math.max(input.total - input.attempted, 0);
  const knownFailureSummary =
    input.knownFailures > 0
      ? ` ${input.knownFailures} known failure${input.knownFailures === 1 ? "" : "s"};`
      : "";
  return `${input.successful} completed;${knownFailureSummary} ${uncertain} outcome${uncertain === 1 ? "" : "s"} could not be confirmed; ${notAttempted} not attempted. ${input.error} Review Operations and reconcile the uncertain target before retrying. For an unfinished deletion confirmation, open Interrupted deletions on the Accounts tab.`;
}

export function deletionConfirmationPhrase(
  username: string | null | undefined,
): string {
  return username ? `DELETE ${username}` : "DELETE username";
}
export function vpnDeletionConfirmationPhrase(
  username: string | null | undefined,
): string {
  return username
    ? `DELETE VPN RECORD ${username}`
    : "DELETE VPN RECORD username";
}
export function deletionPlanConfirmationPhrase(
  targetCount: number,
  recordCount: number,
): string {
  return `DELETE ${targetCount} ${targetCount === 1 ? "ACCOUNT" : "ACCOUNTS"} / ${recordCount} ${recordCount === 1 ? "RECORD" : "RECORDS"}`;
}
export function formatState(value: string | null | undefined): string {
  return value ? value.replaceAll("_", " ") : "No state";
}

export function accountMatchesSystem(
  account: LifecycleAccountInventoryItem,
  filter: SystemFilter,
): boolean {
  return filter === "AD"
    ? Boolean(account.directory)
    : filter === "VPN"
      ? Boolean(account.vpn)
      : filter === "BOTH"
        ? Boolean(account.directory && account.vpn)
        : true;
}
export function accountMatchesState(
  account: OwnershipInventoryAccount,
  filter: AccountStateFilter,
): boolean {
  if (filter === "attention")
    return account.ownership?.readiness === "needs_review";
  if (filter === "unlinked") return account.ownership?.readiness === "unowned";
  const vpnStatus = account.vpn?.status.toLowerCase();
  if (filter === "active")
    return Boolean(
      account.directory?.enabled ||
      (account.vpn && vpnStatus !== "revoked" && vpnStatus !== "disabled"),
    );
  if (filter === "restricted")
    return Boolean(
      (account.directory && !account.directory.enabled) ||
      vpnStatus === "revoked" ||
      vpnStatus === "disabled",
    );
  return true;
}
