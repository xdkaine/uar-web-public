"use client";

import { AlertTriangle, ArrowLeft, CheckCircle2, Trash2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ACTION_OPTIONS } from "./lifecycleAccountsWorkspaceUtils";
import type { LifecycleAccountsWorkspaceController } from "./LifecycleAccountsWorkspaceController";

export function LifecycleAccountsActionPicker({ controller }: { controller: LifecycleAccountsWorkspaceController }) {
  const { interruptedPlan, accountByRef, setStage, selectedAccounts, availableActions, unavailableActions, chosenActionType, canDeleteUnmanaged, canOverride, canDeleteDirectory, canDeleteVpn, canManageDirectory, canManageVpn, unmanagedDeletionPermissionNotice, chooseAction } = controller;
  return (
    <>
{interruptedPlan && (
            <Alert className="border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
              <AlertTriangle />
              <AlertTitle>Previous run was interrupted</AlertTitle>
              <AlertDescription>
                The outcome for{" "}
                {accountByRef.get(interruptedPlan.accountRef)?.displayName ||
                  interruptedPlan.accountRef}{" "}
                could not be confirmed. Its original retry key is retained.
                Review Operations first; if retry is appropriate, keep only that
                account selected and choose{" "}
                {ACTION_OPTIONS.find(
                  (option) => option.actionType === interruptedPlan.actionType,
                )?.label || "the same action"}
                .
              </AlertDescription>
            </Alert>
          )}
          <Card className="shadow-none">
            <CardHeader className="border-b pb-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle className="text-base">Selected accounts</CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Actions below are available only when they apply to every
                    selected account.
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setStage("accounts")}
                >
                  <ArrowLeft className="h-4 w-4" /> Change selection
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="max-h-48 divide-y overflow-y-auto">
                {selectedAccounts.map((account) => (
                  <div
                    key={account.accountRef}
                    className="grid gap-1 px-4 py-3 text-sm sm:grid-cols-[minmax(12rem,1fr)_13rem_13rem]"
                  >
                    <div>
                      <span className="font-medium">{account.displayName}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {account.email}
                      </span>
                    </div>
                    <span className="font-mono text-xs text-muted-foreground">
                      AD: {account.directory?.username || "—"}
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">
                      VPN: {account.vpn?.username || "—"}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-none">
            <CardHeader className="border-b pb-4">
              <CardTitle className="text-base">Applicable actions</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Choose one action for all {selectedAccounts.length} selected
                account{selectedAccounts.length === 1 ? "" : "s"}.
              </p>
            </CardHeader>
            <CardContent className="pt-4">
              {availableActions.length > 0 ? (
                <div className="divide-y rounded-md border">
                  {availableActions.map((option) => {
                    const unmanagedDeletion =
                      option.actionType === "delete_ad" &&
                      option.operationMode === "directory_override";
                    const unownedDirectoryAction =
                      option.operationMode === "directory_override" &&
                      !unmanagedDeletion;
                    const selectedOption =
                      chosenActionType === option.actionType;
                    const hasPermission = unmanagedDeletion
                      ? canDeleteUnmanaged
                      : unownedDirectoryAction
                        ? canOverride
                        : option.actionType === "delete_ad"
                          ? option.operationMode === "directory_override"
                            ? canDeleteUnmanaged
                            : canDeleteDirectory
                          : option.actionType === "delete_vpn_record"
                            ? canDeleteVpn
                            : option.actionType === "delete_both_records"
                              ? canDeleteDirectory && canDeleteVpn
                              : option.scope === "AD"
                                ? canManageDirectory
                                : option.scope === "VPN"
                                  ? canManageVpn
                                  : canManageDirectory && canManageVpn;
                    return (
                      <button
                        key={option.actionType}
                        type="button"
                        disabled={!hasPermission}
                        aria-pressed={selectedOption}
                        onClick={() => chooseAction(option)}
                        className={cn(
                          "flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
                          selectedOption && "bg-muted/50",
                        )}
                      >
                        <span
                          className={cn(
                            "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                            selectedOption &&
                              "border-foreground bg-foreground text-background",
                          )}
                        >
                          {selectedOption && (
                            <CheckCircle2 className="h-3.5 w-3.5" />
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2 font-medium">
                            {option.intent === "delete" && (
                              <Trash2 className="h-4 w-4 text-destructive" />
                            )}
                            {option.label}
                            {unownedDirectoryAction && (
                              <Badge
                                variant="outline"
                                className="border-amber-300 text-amber-800 dark:border-amber-800 dark:text-amber-200"
                              >
                                Unowned directory · single account
                              </Badge>
                            )}
                            {unmanagedDeletion && (
                              <Badge
                                variant="outline"
                                className="border-amber-300 text-amber-800 dark:border-amber-800 dark:text-amber-200"
                              >
                                Unmanaged directory
                              </Badge>
                            )}
                          </span>
                          <span className="mt-1 block text-xs text-muted-foreground">
                            {unownedDirectoryAction || unmanagedDeletion
                              ? option.reason
                              : option.description}
                          </span>
                          {!hasPermission && (
                            <span className="mt-1 block text-xs text-destructive">
                              {unmanagedDeletion
                                ? unmanagedDeletionPermissionNotice
                                : unownedDirectoryAction
                                  ? "Your role does not have lifecycle.override."
                                  : option.actionType === "delete_ad"
                                    ? "Your role does not have lifecycle.delete."
                                    : option.actionType === "delete_vpn_record"
                                      ? "Your role does not have vpn.delete."
                                      : option.actionType ===
                                          "delete_both_records"
                                        ? "Your role needs both lifecycle.delete and vpn.delete."
                                        : "Your role cannot manage this system."}
                            </span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <Alert>
                  <AlertTriangle />
                  <AlertTitle>No common action is available</AlertTitle>
                  <AlertDescription>
                    The selected rows need different governed actions. If AD and VPN records for the same username have different owner requests, delete the disabled AD row and revoked VPN row in separate reviewed plans; those request IDs are expected to differ. Ownership evidence marked Needs review must still be resolved before either plan can run.
                  </AlertDescription>
                </Alert>
              )}
              {availableActions.length > 0 && unavailableActions.length > 0 && (
                  <details className="mt-3 text-xs text-muted-foreground">
                    <summary className="cursor-pointer font-medium text-foreground">
                      Why other actions are unavailable
                    </summary>
                    <ul className="mt-2 list-disc space-y-1 pl-5">
                      {unavailableActions.map((option) => (
                          <li key={option.actionType}>
                            <span className="font-medium">{option.label}:</span>{" "}
                            {option.reason}
                          </li>
                        ))}
                    </ul>
                  </details>
                )}
            </CardContent>
          </Card>
    </>
  );
}
