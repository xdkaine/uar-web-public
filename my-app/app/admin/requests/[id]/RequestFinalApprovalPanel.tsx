interface RequestFinalApprovalPanelProps {
  stageLabel: string | undefined;
  workflowVersion: number;
  actionLoading: boolean;
  onApprove: () => void;
  onReject: () => void;
}

export default function RequestFinalApprovalPanel({
  stageLabel,
  workflowVersion,
  actionLoading,
  onApprove,
  onReject,
}: RequestFinalApprovalPanelProps) {
  return (
    <section className="border-t border-border pt-4 sm:pt-6">
      <h2 className="text-lg sm:text-xl font-semibold text-foreground">{stageLabel}</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        This is the final stage in workflow v{workflowVersion}. Approval follows the configured reviewer role; legacy faculty handoff controls do not apply to this workflow shape.
      </p>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <button type="button" onClick={onApprove} disabled={actionLoading} className="rounded-lg bg-green-600 px-6 py-3 text-sm font-semibold text-white disabled:opacity-50">
          {actionLoading ? 'Processing...' : 'Approve Request'}
        </button>
        <button type="button" onClick={onReject} disabled={actionLoading} className="rounded-lg border border-red-300 px-6 py-3 text-sm font-semibold text-red-700 disabled:opacity-50 dark:border-red-900 dark:text-red-300">
          Reject Request
        </button>
      </div>
    </section>
  );
}
