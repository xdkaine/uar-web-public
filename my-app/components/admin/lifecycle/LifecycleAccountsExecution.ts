import type { Dispatch, MutableRefObject, SetStateAction } from "react";

import { fetchWithCsrf } from "@/lib/csrf";
import {
  deletionConfirmationPhrase,
  lifecycleInterruptionMessage,
  lifecycleResponseRequiresReconciliation,
  vpnDeletionConfirmationPhrase,
  type ActionType,
  type LifecycleActionAvailability,
  type OwnershipInventoryAccount,
  type WorkspaceStage,
} from "./lifecycleAccountsWorkspaceUtils";

type LifecyclePlanExecutionDependencies = {
  planReady: boolean;
  selectedAction: LifecycleActionAvailability | null;
  setConfirmationOpen: Dispatch<SetStateAction<boolean>>;
  setRunning: Dispatch<SetStateAction<boolean>>;
  executionKeys: MutableRefObject<Record<string, string>>;
  selectedAccounts: OwnershipInventoryAccount[];
  selectedIsDeletion: boolean;
  plannedDeletionRecordCount: number;
  accountByRef: Map<string, OwnershipInventoryAccount>;
  reason: string;
  notes: string;
  reference: string;
  irreversibleAcknowledgement: boolean;
  bulkDeletionAcknowledgement: string;
  exceptionEvidence: string;
  overrideAcknowledgement: string;
  clearSelection: () => void;
  setReason: Dispatch<SetStateAction<string>>;
  setNotes: Dispatch<SetStateAction<string>>;
  setReference: Dispatch<SetStateAction<string>>;
  setStage: Dispatch<SetStateAction<WorkspaceStage>>;
  showToast: (message: string, type: "success" | "warning") => void;
  loadAccounts: () => Promise<void>;
  onOperationsChanged: () => void;
  onInterrupted: (accountRef: string, actionType: ActionType) => void;
};

export async function executeLifecyclePlan({
  planReady, selectedAction, setConfirmationOpen, setRunning, executionKeys,
  selectedAccounts, selectedIsDeletion, plannedDeletionRecordCount, accountByRef,
  reason, notes, reference, irreversibleAcknowledgement, bulkDeletionAcknowledgement,
  exceptionEvidence, overrideAcknowledgement, clearSelection, setReason, setNotes,
  setReference, setStage, showToast, loadAccounts, onOperationsChanged, onInterrupted,
}: LifecyclePlanExecutionDependencies): Promise<void> {
    if (!planReady || !selectedAction) return;
    setConfirmationOpen(false);
    setRunning(true);
    let successful = 0;
    let attempted = 0;
    const failures: string[] = [];
    const intakeFailures: string[] = [];
    let currentAccountKey: string | null = null;
    const stableKeys = { ...executionKeys.current };
    selectedAccounts.forEach((account) => {
      stableKeys[`delete_ad:${account.accountRef}`] ||= crypto.randomUUID();
      stableKeys[`delete_vpn_record:${account.accountRef}`] ||=
        crypto.randomUUID();
      stableKeys[`${selectedAction.actionType}:${account.accountRef}`] ||=
        crypto.randomUUID();
    });
    stableKeys["deletion-plan"] ||= crypto.randomUUID();
    executionKeys.current = stableKeys;
    let deletionPlanId: string | null = null;
    let totalPlannedActions = selectedIsDeletion
      ? plannedDeletionRecordCount
      : selectedAccounts.length;
    try {
      let executionTargets: Array<{
        key: string;
        operationMode: "governed" | "batch_governed" | "directory_override";
        requestId: string | null;
        sourceBatchItemId: string | null;
        directory: { username: string } | null;
        vpn: { id: string; username: string } | null;
      }> = selectedAccounts.map((account) => ({
        key: account.accountRef,
        operationMode: selectedAction.operationMode ?? "governed",
        requestId: account.governance.requestId,
        sourceBatchItemId: account.governance.batchAccountItemId ?? null,
        directory: account.directory
          ? { username: account.directory.username }
          : null,
        vpn: account.vpn
          ? { id: account.vpn.id, username: account.vpn.username }
          : null,
      }));
      if (selectedIsDeletion) {
        const planResponse = await fetchWithCsrf(
          "/api/admin/account-lifecycle/deletion-plans",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: selectedAction.actionType,
              targets: selectedAccounts.map((account) => ({
                accountRef: account.accountRef,
                requestId: account.governance.requestId,
                sourceBatchId: account.batchProvenance?.batchId,
                directoryUsername: account.directory?.username,
                vpnUsername: account.vpn?.username,
                vpnRecordId: account.vpn?.id,
              })),
              reason: reason.trim(),
              reference: reference.trim(),
              notes: notes.trim() || undefined,
              irreversibleAcknowledgement,
              destructiveAcknowledgement: bulkDeletionAcknowledgement,
              idempotencyKey: stableKeys["deletion-plan"],
            }),
          },
        );
        const planData = await planResponse.json();
        if (!planResponse.ok)
          throw new Error(
            planData.error || "Unable to create the reviewed deletion plan",
          );
        deletionPlanId = planData.plan?.id ?? null;
        const manifest =
          planData.plan?.manifest ??
          planData.plan?.authorizationEvidence?.manifest;
        if (!deletionPlanId || !Array.isArray(manifest))
          throw new Error(
            "The server did not return a usable deletion manifest.",
          );
        executionTargets = manifest;
        totalPlannedActions = Number(
          planData.plan.totalActions ?? plannedDeletionRecordCount,
        );
      }

      let stopForUncertainOutcome = false;
      for (const account of executionTargets) {
        currentAccountKey = account.key;
        const sourceAccount = accountByRef.get(account.key);
        // The reviewed manifest is immutable for this operation. Keep the
        // target values together so every request below uses the same
        // execution identity that was approved by the server.
        const vpnUsername = account.vpn?.username;
        const directoryUsername = account.directory?.username;
        const requests =
          selectedAction.actionType === "delete_both_records"
            ? [
                ...(account.vpn
                  ? [
                      {
                        actionType: "delete_vpn_record" as const,
                        targetAccountType: "VPN" as const,
                        targetUsername: vpnUsername,
                      },
                    ]
                  : []),
                ...(account.directory
                  ? [
                      {
                        actionType: "delete_ad" as const,
                        targetAccountType: "AD" as const,
                        targetUsername: directoryUsername,
                      },
                    ]
                  : []),
              ]
            : selectedAction.actionType === "delete_vpn_record"
              ? [
                  {
                    actionType: "delete_vpn_record" as const,
                    targetAccountType: "VPN" as const,
                    targetUsername: vpnUsername,
                  },
                ]
              : selectedAction.actionType === "delete_ad"
                ? [
                    {
                    actionType: "delete_ad" as const,
                    targetAccountType: "AD" as const,
                    targetUsername: directoryUsername,
                    },
                  ]
                : [
                    {
                      actionType: selectedAction.actionType,
                      targetAccountType: selectedAction.scope,
                      targetUsername:
                        selectedAction.scope === "VPN"
                          ? vpnUsername
                          : directoryUsername,
                    },
                  ];
        let accountFailed = false;
        for (const planned of requests) {
          const targetUsername = planned.targetUsername;
          if (!targetUsername) {
            const failure = `${sourceAccount?.displayName || account.key}: target account is unavailable`;
            failures.push(failure);
            intakeFailures.push(failure);
            accountFailed = true;
            continue;
          }
          attempted += 1;
          const response = await fetchWithCsrf("/api/admin/account-lifecycle", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              actionType: planned.actionType,
              targetAccountType: planned.targetAccountType,
              targetUsername,
              reason: reason.trim(),
              notes: notes.trim() || undefined,
              relatedRequestId: account.requestId || undefined,
              relatedBatchAccountItemId: account.sourceBatchItemId || undefined,
              relatedTicketId: reference.trim() || undefined,
              operationMode: account.operationMode,
              exceptionEvidence:
                account.operationMode === "directory_override" &&
                !selectedIsDeletion
                  ? exceptionEvidence.trim()
                  : undefined,
              overrideAcknowledgement:
                account.operationMode === "directory_override" &&
                !selectedIsDeletion
                  ? overrideAcknowledgement
                  : undefined,
              destructiveAcknowledgement: selectedIsDeletion
                ? undefined
                : planned.actionType === "delete_vpn_record"
                  ? vpnDeletionConfirmationPhrase(targetUsername)
                  : deletionConfirmationPhrase(targetUsername),
              irreversibleAcknowledgement: selectedIsDeletion
                ? irreversibleAcknowledgement
                : undefined,
              deletionPlanId: deletionPlanId || undefined,
              planTargetKey: deletionPlanId ? account.key : undefined,
              idempotencyKey:
                stableKeys[`${planned.actionType}:${account.key}`],
            }),
          });
          const data = await response.json();
          const reconciliationRequired =
            lifecycleResponseRequiresReconciliation(data);
          if (!response.ok || !data.success || reconciliationRequired) {
            const failure = `${targetUsername}: ${data.error || data.processResult?.error || "Action requires review"}`;
            failures.push(failure);
            if (!response.ok) intakeFailures.push(failure);
            accountFailed = true;
            if (reconciliationRequired) {
              stopForUncertainOutcome = true;
              break;
            }
          }
        }
        if (!accountFailed) successful += 1;
        if (stopForUncertainOutcome) break;
      }
      if (deletionPlanId) {
        const completionResponse = await fetchWithCsrf(
          `/api/admin/account-lifecycle/deletion-plans/${deletionPlanId}/complete`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          },
        );
        if (!completionResponse.ok)
          throw new Error(
            "The deletion actions were recorded, but the reviewed plan could not be finalized.",
          );
      }
      if (failures.length === 0) {
        showToast(
          `${successful} account action${successful === 1 ? "" : "s"} completed`,
          "success",
        );
        clearSelection();
        setReason("");
        setNotes("");
        setReference("");
        setStage("accounts");
      } else {
        const skipped = Math.max(totalPlannedActions - attempted, 0);
        showToast(
          `${successful} accounts completed; ${failures.length} records require review; ${skipped} records not attempted. ${failures[0]} Use Operations for recovery before creating another plan.`,
          "warning",
        );
        clearSelection();
        setStage("accounts");
      }
    } catch (error) {
      // A thrown request has an uncertain server outcome. Keep any server-owned
      // deletion plan recoverable from Accounts instead of guessing that intake failed.
      showToast(
        lifecycleInterruptionMessage({
          successful,
          knownFailures: failures.length,
          attempted,
          total: totalPlannedActions,
          error:
            error instanceof Error
              ? error.message
              : "The lifecycle response could not be read.",
        }),
        "warning",
      );
      const uncertainAccount = currentAccountKey
        ? accountByRef.get(currentAccountKey)
        : null;
      if (uncertainAccount) {
        onInterrupted(uncertainAccount.accountRef, selectedAction.actionType);
      }
    } finally {
      await loadAccounts();
      onOperationsChanged();
      setRunning(false);
    }

}
