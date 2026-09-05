import {
  expectedDirectoryDeletePolicyVersion,
  hasCurrentDirectoryDeleteMethod,
} from "@/lib/lifecycle-directory-deletion-policy";

export const lifecycleTimestampFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

export function formatLifecycleTimestamp(value: Date | string): string {
  return lifecycleTimestampFormatter.format(new Date(value));
}

export interface LifecycleAction {
  id: string; createdAt: string; actionType: string; operationMode?: string; targetAccountType: string; targetUsername: string;
  canRetry?: boolean; canCancel?: boolean; canReconcile?: boolean; targetDisplayName?: string | null; status: string; reason: string;
  requestedBy: string; requestedByDisplayName?: string | null; relatedRequestId: string | null; relatedTicketId: string | null;
  notes: string | null; batchId?: string | null; errorMessage: string | null; bindingFailureCode?: string | null;
  targetDirectoryDn?: string | null; policyVersion?: string | null; preflightSnapshot?: Record<string, unknown> | null;
  resultSnapshot?: Record<string, unknown> | null; authorizationEvidence?: Record<string, unknown> | null; historyTotal?: number;
  history: Array<{ id: string; createdAt: string; event: string; details: string | null; performedBy: string | null; performedByDisplayName?: string | null }>;
}

export type LifecycleRecoveryAction = { id: string; username: string; operation: "retry" | "cancel" };
export type LifecycleReconcileAction = { id: string; username: string };

export function needsFreshDirectoryDeletionReview(action: LifecycleAction): boolean {
  return action.actionType === "delete_ad" && (
    action.policyVersion !== expectedDirectoryDeletePolicyVersion(action.operationMode ?? "")
    || !hasCurrentDirectoryDeleteMethod(action.authorizationEvidence)
  );
}

export function lifecycleStatusClass(status: string) {
  if (status === "completed") return "border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-300";
  if (status === "failed") return "border-red-300 text-red-700 dark:border-red-800 dark:text-red-300";
  if (status === "reconciliation_required") return "border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-300";
  if (status === "queued") return "border-blue-300 text-blue-700 dark:border-blue-800 dark:text-blue-300";
  return "";
}
