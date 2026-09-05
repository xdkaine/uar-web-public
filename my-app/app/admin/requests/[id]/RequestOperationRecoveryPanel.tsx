interface RecoveryChoice {
  message: string;
  onDelivered: () => void;
  onNotDelivered: () => void;
}

interface RequestOperationRecoveryPanelProps {
  actionLoading: boolean;
  accountUpdate: { message: string; onNotApplied: () => void } | null;
  facultyNotification: RecoveryChoice | null;
  stageNotification: (RecoveryChoice & { label: string }) | null;
}

export default function RequestOperationRecoveryPanel({
  actionLoading,
  accountUpdate,
  facultyNotification,
  stageNotification,
}: RequestOperationRecoveryPanelProps) {
  return (
    <section className="border border-amber-300 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 rounded-lg p-4">
      <h2 className="text-lg font-semibold text-amber-950 dark:text-amber-100">Operator recovery required</h2>
      <p className="mt-1 text-sm text-amber-900 dark:text-amber-200">
        Do not retry an ambiguous external operation until directory or mail-provider evidence establishes its outcome.
      </p>
      {accountUpdate && (
        <div className="mt-4 border-t border-amber-200 dark:border-amber-900 pt-3">
          <p className="text-sm font-medium">Account update: {accountUpdate.message}</p>
          <button
            type="button"
            disabled={actionLoading}
            onClick={accountUpdate.onNotApplied}
            className="mt-2 rounded-md bg-amber-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            Verify no changes and re-arm
          </button>
        </div>
      )}
      {facultyNotification && (
        <RecoveryChoices actionLoading={actionLoading} label="Faculty email" choice={facultyNotification} />
      )}
      {stageNotification && (
        <RecoveryChoices actionLoading={actionLoading} label={`${stageNotification.label} notification`} choice={stageNotification} />
      )}
    </section>
  );
}

function RecoveryChoices({ actionLoading, label, choice }: { actionLoading: boolean; label: string; choice: RecoveryChoice }) {
  return (
    <div className="mt-4 border-t border-amber-200 dark:border-amber-900 pt-3">
      <p className="text-sm font-medium">{label}: {choice.message}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={actionLoading}
          onClick={choice.onDelivered}
          className="rounded-md bg-emerald-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          Confirm delivered
        </button>
        <button
          type="button"
          disabled={actionLoading}
          onClick={choice.onNotDelivered}
          className="rounded-md bg-amber-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          Confirm non-delivery
        </button>
      </div>
    </div>
  );
}
