import type { ChangeEvent } from "react";

interface RequestWorkflowRecoveryPanelProps {
  warning: string | null;
  canConfigureGovernance: boolean | undefined;
  options: Array<{
    id: string;
    version: number;
    status: string;
    stageLabels: string[];
  }>;
  selectedWorkflowId: string;
  reason: string;
  actionLoading: boolean;
  onWorkflowChange: (id: string) => void;
  onReasonChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  onReconcile: () => void;
}

export default function RequestWorkflowRecoveryPanel({
  warning,
  canConfigureGovernance,
  options,
  selectedWorkflowId,
  reason,
  actionLoading,
  onWorkflowChange,
  onReasonChange,
  onReconcile,
}: RequestWorkflowRecoveryPanelProps) {
  if (!warning) return null;

  return (
    <div className="mb-4 sm:mb-6 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
      <p className="font-semibold">Workflow reconciliation required</p>
      <p className="mt-1">{warning}</p>
      <p className="mt-2 text-xs opacity-80">
        All review actions are disabled until an administrator repairs the
        pinned workflow reference.
      </p>
      {canConfigureGovernance && options.length > 0 && (
        <div className="mt-4 grid gap-3 border-t border-amber-300 pt-4 dark:border-amber-900">
          <label className="grid gap-1 font-medium">
            Replacement workflow
            <select
              value={selectedWorkflowId}
              onChange={(event) => onWorkflowChange(event.target.value)}
              className="rounded-md border border-border bg-background px-3 py-2 text-foreground"
            >
              {options.map((option) => (
                <option key={option.id} value={option.id}>
                  v{option.version} ({option.status}) —{" "}
                  {option.stageLabels.join(" → ")}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 font-medium">
            Reconciliation evidence
            <textarea
              value={reason}
              onChange={onReasonChange}
              rows={2}
              maxLength={500}
              className="rounded-md border border-border bg-background px-3 py-2 text-foreground"
              placeholder="Why this immutable workflow version is the correct replacement"
            />
          </label>
          <button
            type="button"
            onClick={onReconcile}
            disabled={actionLoading || reason.trim().length < 10}
            className="w-fit rounded-md bg-amber-800 px-4 py-2 font-semibold text-white disabled:opacity-50"
          >
            Reconcile workflow pin
          </button>
        </div>
      )}
    </div>
  );
}
