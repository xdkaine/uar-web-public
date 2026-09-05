import { useCallback, useState } from "react";
import { fetchWithCsrf } from "@/lib/csrf";
import type { AccessRequest } from "./RequestDetailTypes";

type ReconciliationPath =
  | "reconcile-account-update"
  | "reconcile-faculty-notification"
  | "reconcile-stage-notification";
type ReconciliationResolution = "not_applied" | "delivered" | "not_delivered";

interface RequestRecoveryActionsOptions {
  requestId: string;
  request: AccessRequest | null;
  recoveryWorkflowId: string;
  onRecoveryStart: () => void;
  onActionComplete: () => void;
  showToast: (message: string, type: "success" | "error" | "warning") => void;
  refreshRequest: () => Promise<void>;
}

export function buildWorkflowReconciliationBody(
  request: AccessRequest,
  targetWorkflowDefinitionId: string,
  reason: string,
) {
  return {
    targetWorkflowDefinitionId,
    expectedRequestVersion: request.version,
    expectedWorkflowVersionId: request.workflowVersionId ?? null,
    expectedStatus: request.status,
    reason,
  };
}

export function useRequestRecoveryActions({
  requestId,
  request,
  recoveryWorkflowId,
  onRecoveryStart,
  onActionComplete,
  showToast,
  refreshRequest,
}: RequestRecoveryActionsOptions) {
  const [workflowRecoveryReason, setWorkflowRecoveryReason] = useState("");

  const reconcileOperation = useCallback(
    async (path: ReconciliationPath, resolution: ReconciliationResolution) => {
      const evidence = window.prompt(
        "Enter provider or directory evidence (at least 10 characters).",
      );
      if (!evidence) return;
      onRecoveryStart();
      try {
        const response = await fetchWithCsrf(
          `/api/admin/requests/${requestId}/${path}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ resolution, evidence }),
          },
        );
        const data = await response.json();
        if (!response.ok)
          throw new Error(data.error || "Reconciliation failed");
        showToast("Recovery evidence recorded.", "success");
        await refreshRequest();
      } catch (error) {
        showToast(
          error instanceof Error ? error.message : "Reconciliation failed",
          "error",
        );
      } finally {
        onActionComplete();
      }
    },
    [onActionComplete, onRecoveryStart, refreshRequest, requestId, showToast],
  );

  const reconcileRequestWorkflow = useCallback(async () => {
    if (
      !request ||
      !recoveryWorkflowId ||
      workflowRecoveryReason.trim().length < 10
    ) {
      showToast(
        "Choose a replacement and provide at least 10 characters of reconciliation evidence.",
        "warning",
      );
      return;
    }
    onRecoveryStart();
    try {
      const response = await fetchWithCsrf(
        `/api/admin/requests/${request.id}/reconcile-workflow`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            buildWorkflowReconciliationBody(
              request,
              recoveryWorkflowId,
              workflowRecoveryReason,
            ),
          ),
        },
      );
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Workflow reconciliation failed");
      showToast("The request workflow pin was reconciled.", "success");
      setWorkflowRecoveryReason("");
      await refreshRequest();
    } catch (error) {
      showToast(
        error instanceof Error
          ? error.message
          : "Workflow reconciliation failed",
        "error",
      );
    } finally {
      onActionComplete();
    }
  }, [
    onActionComplete,
    onRecoveryStart,
    recoveryWorkflowId,
    refreshRequest,
    request,
    showToast,
    workflowRecoveryReason,
  ]);

  return {
    workflowRecoveryReason,
    setWorkflowRecoveryReason,
    reconcileOperation,
    reconcileRequestWorkflow,
  };
}
