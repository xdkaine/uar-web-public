"use client";

import { cn } from "@/lib/utils";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import type { LifecycleAccountsWorkspaceController } from "./LifecycleAccountsWorkspaceController";

function confirmationPresentation(input: {
  isDeletion: boolean;
  needsOverride: boolean;
  actionLabel: string | undefined;
  accountCount: number;
  recordCount: number;
}) {
  const accountSuffix = input.accountCount === 1 ? "" : "s";
  const recordSuffix = input.recordCount === 1 ? "" : "s";
  if (input.isDeletion) {
    return {
      title: `Permanently delete ${input.recordCount} record${recordSuffix}?`,
      description: `This creates one reviewed plan for ${input.accountCount} account${accountSuffix}. AD and VPN outcomes remain separate and inspectable in Operations.`,
      confirmLabel: `Delete ${input.recordCount} record${recordSuffix} permanently`,
    };
  }
  return {
    title: `Run ${input.accountCount} account change${accountSuffix}?`,
    description: input.needsOverride
      ? "This is a privileged unowned-directory action with separate evidence and audit history. It does not delete the account."
      : `${input.actionLabel || "The selected action"} will run for every selected account. Each target retains its own result and audit history.`,
    confirmLabel: "Run changes",
  };
}

export function LifecycleAccountsConfirmationDialog({ controller }: { controller: LifecycleAccountsWorkspaceController }) {
  const { confirmationOpen, setConfirmationOpen, selectedIsDeletion, plannedDeletionRecordCount, selectedAccounts, selectedNeedsOverride, selectedAction, selectedIsCombinedDeletion, reference, bulkDeletionAcknowledgement, runPlan } = controller;
  const presentation = confirmationPresentation({
    isDeletion: selectedIsDeletion,
    needsOverride: selectedNeedsOverride,
    actionLabel: selectedAction?.label,
    accountCount: selectedAccounts.length,
    recordCount: plannedDeletionRecordCount,
  });
  return (
<AlertDialog open={confirmationOpen} onOpenChange={setConfirmationOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {presentation.title}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {presentation.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="max-h-52 overflow-y-auto rounded-md border bg-muted/20 p-3 text-sm">
            {selectedAccounts.map((account) => (
              <div
                key={account.accountRef}
                className="flex justify-between gap-3 py-1"
              >
                <span>{account.displayName}</span>
                <span className="font-mono text-xs text-muted-foreground">
                  {selectedAction?.scope === "VPN"
                    ? account.vpn?.username
                    : account.directory?.username}
                  {selectedIsCombinedDeletion && account.vpn
                    ? ` + ${account.vpn.username}`
                    : ""}
                </span>
              </div>
            ))}
            {selectedIsDeletion && (
              <dl className="mt-3 grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1 border-t pt-3 text-xs">
                <dt className="text-muted-foreground">Reference</dt>
                <dd>{reference}</dd>
                <dt className="text-muted-foreground">Confirmation</dt>
                <dd className="font-mono font-semibold text-foreground">
                  {bulkDeletionAcknowledgement}
                </dd>
              </dl>
            )}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Go back</AlertDialogCancel>
            <AlertDialogAction
              className={cn(
                selectedIsDeletion &&
                  "bg-red-700 !text-white hover:bg-red-800 focus-visible:ring-red-700/30 dark:bg-red-600 dark:!text-white dark:hover:bg-red-500",
              )}
              onClick={() => void runPlan()}
            >
              {presentation.confirmLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
  );
}
