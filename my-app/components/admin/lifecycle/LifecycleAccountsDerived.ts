import {
  ACTION_OPTIONS,
  accountMatchesState,
  accountMatchesSystem,
  deletionPlanConfirmationPhrase,
  lifecycleActionAvailability,
  lifecyclePage,
  MAX_LIFECYCLE_SELECTION,
  unmanagedDeletionPermissionMessage,
  type AccountStateFilter,
  type ActionType,
  type LifecycleActionAvailability,
  type OwnershipInventoryAccount,
  type SystemFilter,
} from "./lifecycleAccountsWorkspaceUtils";

export type LifecycleAccountPermissions = {
  canManageDirectory: boolean;
  canDeleteDirectory: boolean;
  canManageVpn: boolean;
  canDeleteVpn: boolean;
  canOverride: boolean;
  canDeleteUnmanaged: boolean;
  unmanagedDeletionPermissionNotice: string | null;
};

export function deriveLifecycleAccountPermissions(
  permissions: ReadonlySet<string>,
): LifecycleAccountPermissions {
  const canManageDirectory =
    permissions.has("users.manage") && permissions.has("lifecycle.manage");
  const canDeleteDirectory =
    permissions.has("lifecycle.delete") && canManageDirectory;
  const canManageVpn =
    permissions.has("vpn.manage") && permissions.has("lifecycle.manage");
  const canDeleteVpn = permissions.has("vpn.delete") && canManageVpn;
  const canOverride =
    permissions.has("lifecycle.override") && canManageDirectory;

  return {
    canManageDirectory,
    canDeleteDirectory,
    canManageVpn,
    canDeleteVpn,
    canOverride,
    canDeleteUnmanaged:
      permissions.has("lifecycle.delete_unmanaged") &&
      canDeleteDirectory &&
      canOverride,
    unmanagedDeletionPermissionNotice: unmanagedDeletionPermissionMessage(permissions),
  };
}

function isLifecycleActionPermissionAvailable(input: {
  action: LifecycleActionAvailability | null;
  isDirectoryDeletion: boolean;
  isVpnDeletion: boolean;
  isCombinedDeletion: boolean;
  permissions: LifecycleAccountPermissions;
}): boolean {
  const { action, permissions } = input;
  if (!action) return false;
  if (input.isDirectoryDeletion) {
    return action.operationMode === "directory_override"
      ? permissions.canDeleteUnmanaged
      : permissions.canDeleteDirectory;
  }
  if (input.isVpnDeletion) return permissions.canDeleteVpn;
  if (input.isCombinedDeletion) {
    return permissions.canDeleteDirectory && permissions.canDeleteVpn;
  }
  if (action.scope === "AD") return permissions.canManageDirectory;
  if (action.scope === "VPN") return permissions.canManageVpn;
  return permissions.canManageDirectory && permissions.canManageVpn;
}

function deletionRecordCount(input: {
  accounts: OwnershipInventoryAccount[];
  isDirectoryDeletion: boolean;
  isVpnDeletion: boolean;
  isCombinedDeletion: boolean;
}): number {
  if (input.isDirectoryDeletion) {
    return input.accounts.filter((account) => account.directory).length;
  }
  if (input.isVpnDeletion) {
    return input.accounts.filter((account) => account.vpn).length;
  }
  if (!input.isCombinedDeletion) return 0;
  return input.accounts.reduce(
    (count, account) => count + Number(Boolean(account.directory)) + Number(Boolean(account.vpn)),
    0,
  );
}

export function filterLifecycleAccounts(input: {
  accounts: OwnershipInventoryAccount[];
  query: string;
  systemFilter: SystemFilter;
  stateFilter: AccountStateFilter;
}): OwnershipInventoryAccount[] {
  const normalized = input.query.trim().toLowerCase();
  return input.accounts.filter((account) => {
    if (
      !accountMatchesSystem(account, input.systemFilter) ||
      !accountMatchesState(account, input.stateFilter)
    ) {
      return false;
    }
    if (!normalized) return true;
    return [
      account.displayName,
      account.email,
      account.directory?.username,
      account.vpn?.username,
      account.ownership?.requestId,
      account.ownership?.batchItemId,
      account.ownership?.batchRunId,
      account.governance.status,
    ].some((value) => value?.toLowerCase().includes(normalized));
  });
}

export function deriveLifecycleSelection(input: {
  accounts: OwnershipInventoryAccount[];
  selected: ReadonlySet<string>;
  vpnModuleEnabled: boolean;
  chosenActionType: ActionType | null;
}) {
  const accountByRef = new Map(
    input.accounts.map((account) => [account.accountRef, account]),
  );
  const selectedAccounts = Array.from(input.selected, (accountRef) =>
    accountByRef.get(accountRef),
  ).filter((account): account is OwnershipInventoryAccount => Boolean(account));
  const actionOptions: LifecycleActionAvailability[] = [];
  for (const option of ACTION_OPTIONS) {
    if (input.vpnModuleEnabled || option.scope === "AD") {
      actionOptions.push(lifecycleActionAvailability(selectedAccounts, option));
    }
  }
  const availableActions = actionOptions.filter((option) => option.available);
  const unavailableActions = actionOptions.filter((option) => !option.available);
  const selectedAction =
    actionOptions.find(
      (option) =>
        option.actionType === input.chosenActionType && option.available,
    ) ?? null;
  const selectedIsDirectoryDeletion = selectedAction?.actionType === "delete_ad";
  const selectedIsVpnDeletion =
    selectedAction?.actionType === "delete_vpn_record";
  const selectedIsCombinedDeletion =
    selectedAction?.actionType === "delete_both_records";
  const selectedIsDeletion =
    selectedIsDirectoryDeletion ||
    selectedIsVpnDeletion ||
    selectedIsCombinedDeletion;
  const selectedNeedsOverride =
    selectedAction?.operationMode === "directory_override" &&
    !selectedIsDeletion;
  const deletionAccount = selectedIsDeletion ? selectedAccounts[0] : null;
  const deletionUsername = selectedIsVpnDeletion
    ? deletionAccount?.vpn?.username
    : deletionAccount?.directory?.username;
  const overrideAccount = selectedNeedsOverride ? selectedAccounts[0] : null;

  return {
    accountByRef,
    selectedAccounts,
    actionOptions,
    availableActions,
    unavailableActions,
    selectedAction,
    selectedIsDirectoryDeletion,
    selectedIsVpnDeletion,
    selectedIsCombinedDeletion,
    selectedIsDeletion,
    selectedNeedsOverride,
    deletionAccount,
    deletionUsername,
    overrideAccount,
  };
}

export function deriveLifecyclePlanReview(input: {
  selection: ReturnType<typeof deriveLifecycleSelection>;
  permissions: LifecycleAccountPermissions;
  readOnly: boolean;
  reason: string;
  reference: string;
  exceptionEvidence: string;
  overrideAcknowledgement: string;
  irreversibleAcknowledgement: boolean;
  bulkDeletionAcknowledgement: string;
}) {
  const { selection } = input;
  const actionPermissionAvailable = isLifecycleActionPermissionAvailable({
    action: selection.selectedAction,
    isDirectoryDeletion: selection.selectedIsDirectoryDeletion,
    isVpnDeletion: selection.selectedIsVpnDeletion,
    isCombinedDeletion: selection.selectedIsCombinedDeletion,
    permissions: input.permissions,
  });
  const overrideReady =
    !selection.selectedNeedsOverride ||
    (input.permissions.canOverride &&
      input.reference.trim().length > 0 &&
      input.exceptionEvidence.trim().length >= 20 &&
      input.overrideAcknowledgement === selection.overrideAccount?.directory?.username);
  const plannedDeletionRecordCount = deletionRecordCount({
    accounts: selection.selectedAccounts,
    isDirectoryDeletion: selection.selectedIsDirectoryDeletion,
    isVpnDeletion: selection.selectedIsVpnDeletion,
    isCombinedDeletion: selection.selectedIsCombinedDeletion,
  });
  const bulkDeletionPhrase = selection.selectedIsDeletion
    ? deletionPlanConfirmationPhrase(
        selection.selectedAccounts.length,
        plannedDeletionRecordCount,
      )
    : "";
  const deletionReady =
    !selection.selectedIsDeletion ||
    (input.reference.trim().length >= 3 &&
      input.reason.trim().length >= 10 &&
      input.irreversibleAcknowledgement &&
      input.bulkDeletionAcknowledgement === bulkDeletionPhrase);
  const planReady =
    Boolean(selection.selectedAction) &&
    !input.readOnly &&
    selection.selectedAccounts.length > 0 &&
    selection.selectedAccounts.length <= MAX_LIFECYCLE_SELECTION &&
    actionPermissionAvailable &&
    input.reason.trim().length > 0 &&
    overrideReady &&
    deletionReady;

  return {
    actionPermissionAvailable,
    overrideReady,
    plannedDeletionRecordCount,
    bulkDeletionPhrase,
    deletionReady,
    planReady,
  };
}

export function deriveLifecyclePageSelection(input: {
  accounts: OwnershipInventoryAccount[];
  requestedPage: number;
  pageSize: number;
  selected: ReadonlySet<string>;
}) {
  const pagedAccounts = lifecyclePage(
    input.accounts,
    input.requestedPage,
    input.pageSize,
  );
  const visibleSelectedCount = pagedAccounts.items.filter((account) =>
    input.selected.has(account.accountRef),
  ).length;
  return {
    pagedAccounts,
    visibleSelectedCount,
    allVisibleSelected:
      pagedAccounts.items.length > 0 &&
      visibleSelectedCount === pagedAccounts.items.length,
  };
}
