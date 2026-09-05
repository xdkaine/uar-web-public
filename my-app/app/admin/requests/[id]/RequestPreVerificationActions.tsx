interface RequestPreVerificationActionsProps {
  status: string;
  canReject: boolean;
  actionLoading: boolean;
  onReject: () => void;
}

export default function RequestPreVerificationActions({
  status,
  canReject,
  actionLoading,
  onReject,
}: RequestPreVerificationActionsProps) {
  if (status !== "pending_verification" || !canReject) return null;

  return (
    <section className="border-t border-border pt-4 sm:pt-6">
      <h2 className="text-lg sm:text-xl font-semibold mb-3 sm:mb-4 text-foreground">
        Request Actions
      </h2>
      <div className="bg-muted/50 p-4 rounded-lg border border-border">
        <p className="text-sm text-muted-foreground mb-4">
          This request is currently pending email verification from the user.
          You can reject it now if it appears to be spam or invalid.
        </p>
        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={onReject}
            disabled={actionLoading}
            className="w-full sm:w-auto bg-card border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 hover:border-red-300 font-semibold px-6 py-3 rounded-lg shadow-sm hover:shadow transition-[background-color,border-color,box-shadow] disabled:opacity-50 disabled:cursor-not-allowed text-sm flex items-center justify-center gap-2"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
            {actionLoading ? "Processing..." : "Reject Request"}
          </button>
        </div>
      </div>
    </section>
  );
}
