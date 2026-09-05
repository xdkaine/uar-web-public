"use client";

import { useMemo, useReducer, useRef, useState } from "react";
import { useToast } from "@/hooks/useToast";
import { executeLifecyclePlan } from "./LifecycleAccountsExecution";
import { useLifecycleAccountsInventory } from "./LifecycleAccountsInventory";
import { useLifecycleAccountsSelectionCommands } from "./LifecycleAccountsSelectionCommands";
import {
  DEFAULT_LIFECYCLE_PAGE_SIZE,
  type ActionType,
  type AccountStateFilter,
  type SystemFilter,
  type WorkspaceStage,
} from "./lifecycleAccountsWorkspaceUtils";
import {
  deriveLifecycleAccountPermissions,
  deriveLifecyclePageSelection,
  deriveLifecyclePlanReview,
  deriveLifecycleSelection,
  filterLifecycleAccounts,
} from "./LifecycleAccountsDerived";

export interface LifecycleAccountsWorkspaceProps {
  permissions: ReadonlySet<string>;
  onOperationsChanged: () => void;
}

type LifecycleActionDraft = {
  chosenActionType: ActionType | null;
  exceptionEvidence: string;
  overrideAcknowledgement: string;
  irreversibleAcknowledgement: boolean;
  bulkDeletionAcknowledgement: string;
  interruptedPlan: { accountRef: string; actionType: ActionType } | null;
};

const INITIAL_LIFECYCLE_ACTION_DRAFT: LifecycleActionDraft = {
  chosenActionType: null, exceptionEvidence: "", overrideAcknowledgement: "", irreversibleAcknowledgement: false, bulkDeletionAcknowledgement: "", interruptedPlan: null,
};

export type LifecycleActionDraftUpdate =
  | { type: "clear" } | { type: "choose"; actionType: ActionType }
  | { type: "exceptionEvidence"; value: string } | { type: "overrideAcknowledgement"; value: string }
  | { type: "bulkDeletionAcknowledgement"; value: string } | { type: "irreversibleAcknowledgement"; value: boolean }
  | { type: "interruptedPlan"; value: LifecycleActionDraft["interruptedPlan"] };

function lifecycleActionDraftReducer(state: LifecycleActionDraft, action: LifecycleActionDraftUpdate): LifecycleActionDraft {
  switch (action.type) {
    case "clear": return INITIAL_LIFECYCLE_ACTION_DRAFT;
    case "choose": return { ...INITIAL_LIFECYCLE_ACTION_DRAFT, chosenActionType: action.actionType };
    case "exceptionEvidence": return { ...state, exceptionEvidence: action.value };
    case "overrideAcknowledgement": return { ...state, overrideAcknowledgement: action.value };
    case "bulkDeletionAcknowledgement": return { ...state, bulkDeletionAcknowledgement: action.value };
    case "irreversibleAcknowledgement": return { ...state, irreversibleAcknowledgement: action.value };
    case "interruptedPlan": return { ...state, interruptedPlan: action.value };
  }
}

export function useLifecycleAccountsWorkspaceController({
  permissions,
  onOperationsChanged,
}: LifecycleAccountsWorkspaceProps) {
  const { showToast } = useToast();
  const { inventory, loading, loadError, loadAccounts } =
    useLifecycleAccountsInventory();
  const [stage, setStage] = useState<WorkspaceStage>("accounts");
  const [query, setQuery] = useState("");
  const [systemFilter, setSystemFilter] = useState<SystemFilter>("all");
  const [stateFilter, setStateFilter] = useState<AccountStateFilter>("all");
  const [pageSize, setPageSize] = useState(DEFAULT_LIFECYCLE_PAGE_SIZE);
  const [requestedPage, setRequestedPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [reference, setReference] = useState("");
  const [actionDraft, dispatchActionDraft] = useReducer(
    lifecycleActionDraftReducer,
    INITIAL_LIFECYCLE_ACTION_DRAFT,
  );
  const {
    chosenActionType,
    exceptionEvidence,
    overrideAcknowledgement,
    irreversibleAcknowledgement,
    bulkDeletionAcknowledgement,
    interruptedPlan,
  } = actionDraft;
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [running, setRunning] = useState(false);
  // Request keys are imperative recovery data. They never affect rendering, but
  // must survive a rerender so an uncertain request is not replayed with a new key.
  const executionKeys = useRef<Record<string, string>>({});

  const lifecyclePermissions = useMemo(
    () => deriveLifecycleAccountPermissions(permissions),
    [permissions],
  );
  const {
    canManageDirectory,
    canDeleteDirectory,
    canManageVpn,
    canDeleteVpn,
    canOverride,
    canDeleteUnmanaged,
    unmanagedDeletionPermissionNotice,
  } = lifecyclePermissions;
  const selection = useMemo(
    () =>
      deriveLifecycleSelection({
        accounts: inventory.accounts,
        selected,
        vpnModuleEnabled: inventory.vpnModuleEnabled,
        chosenActionType,
      }),
    [chosenActionType, inventory.accounts, inventory.vpnModuleEnabled, selected],
  );
  const {
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
  } = selection;

  const filteredAccounts = useMemo(
    () => filterLifecycleAccounts({ accounts: inventory.accounts, query, systemFilter, stateFilter }),
    [inventory.accounts, query, stateFilter, systemFilter],
  );
  const { pagedAccounts, visibleSelectedCount, allVisibleSelected } = useMemo(
    () =>
      deriveLifecyclePageSelection({
        accounts: filteredAccounts,
        requestedPage,
        pageSize,
        selected,
      }),
    [filteredAccounts, pageSize, requestedPage, selected],
  );
  const {
    actionPermissionAvailable: selectedActionPermissionAvailable,
    overrideReady,
    plannedDeletionRecordCount,
    bulkDeletionPhrase,
    deletionReady,
    planReady,
  } = useMemo(
    () =>
      deriveLifecyclePlanReview({
        selection,
        permissions: lifecyclePermissions,
        readOnly: inventory.readOnly,
        reason,
        reference,
        exceptionEvidence,
        overrideAcknowledgement,
        irreversibleAcknowledgement,
        bulkDeletionAcknowledgement,
      }),
    [
      bulkDeletionAcknowledgement,
      exceptionEvidence,
      inventory.readOnly,
      irreversibleAcknowledgement,
      lifecyclePermissions,
      overrideAcknowledgement,
      reason,
      reference,
      selection,
    ],
  );

  const { toggleAccount, selectVisible, clearSelection, chooseAction } =
    useLifecycleAccountsSelectionCommands({
      setSelected,
      dispatchActionDraft,
      executionKeys,
      visibleAccounts: pagedAccounts.items,
      allVisibleSelected,
    });

  const runPlan = () =>
    executeLifecyclePlan({
      planReady, selectedAction, setConfirmationOpen, setRunning, executionKeys,
      selectedAccounts, selectedIsDeletion, plannedDeletionRecordCount, accountByRef,
      reason, notes, reference, irreversibleAcknowledgement, bulkDeletionAcknowledgement,
      exceptionEvidence, overrideAcknowledgement, clearSelection, setReason, setNotes,
      setReference, setStage, showToast, loadAccounts, onOperationsChanged,
      onInterrupted: (accountRef, actionType) =>
        dispatchActionDraft({ type: "interruptedPlan", value: { accountRef, actionType } }),
    });

  return { permissions, onOperationsChanged, inventory, loading, loadError, stage, setStage, query, setQuery, systemFilter, setSystemFilter, stateFilter, setStateFilter, pageSize, setPageSize, requestedPage, setRequestedPage, selected, reason, setReason, notes, setNotes, reference, setReference, actionDraft, dispatchActionDraft, chosenActionType, exceptionEvidence, overrideAcknowledgement, irreversibleAcknowledgement, bulkDeletionAcknowledgement, interruptedPlan, confirmationOpen, setConfirmationOpen, running, canManageDirectory, canDeleteDirectory, canManageVpn, canDeleteVpn, canOverride, canDeleteUnmanaged, unmanagedDeletionPermissionNotice, loadAccounts, accountByRef, selectedAccounts, actionOptions, availableActions, unavailableActions, selectedAction, filteredAccounts, pagedAccounts, visibleSelectedCount, allVisibleSelected, selectedIsDirectoryDeletion, selectedIsVpnDeletion, selectedIsCombinedDeletion, selectedIsDeletion, selectedNeedsOverride, deletionAccount, deletionUsername, overrideAccount, actionPermissionAvailable: selectedActionPermissionAvailable, overrideReady, plannedDeletionRecordCount, bulkDeletionPhrase, deletionReady, planReady, toggleAccount, selectVisible, clearSelection, chooseAction, runPlan };
}

export type LifecycleAccountsWorkspaceController = ReturnType<
  typeof useLifecycleAccountsWorkspaceController
>;
