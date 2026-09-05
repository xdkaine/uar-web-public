"use client";

import { ArrowRight, ShieldAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import LifecycleDeletionRecovery from "./LifecycleDeletionRecovery";
import { LifecycleAccountsActionPicker } from "./LifecycleAccountsActionPicker";
import { LifecycleAccountsActionReview } from "./LifecycleAccountsActionReview";
import { LifecycleAccountsConfirmationDialog } from "./LifecycleAccountsConfirmationDialog";
import { LifecycleAccountsList } from "./LifecycleAccountsList";
import type { useLifecycleAccountsWorkspaceController } from "./LifecycleAccountsWorkspaceController";

type LifecycleAccountsController = ReturnType<typeof useLifecycleAccountsWorkspaceController>;

export function LifecycleAccountsWorkspaceView({ controller }: { controller: LifecycleAccountsController }) {
  const { permissions, onOperationsChanged, inventory, stage, setStage, running, selectedAccounts } = controller;
return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <LifecycleDeletionRecovery
          disabled={
            running ||
            inventory.readOnly ||
            !permissions.has("lifecycle.manage")
          }
          onRecovered={onOperationsChanged}
        />
      </div>
      {inventory.readOnly && (
        <Alert className="border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
          <ShieldAlert />
          <AlertTitle>Production-clone safety is on</AlertTitle>
          <AlertDescription>
            You can inspect accounts and build a selection here, but account
            changes are disabled in this environment.
          </AlertDescription>
        </Alert>
      )}

      <nav
        aria-label="Account lifecycle steps"
        className="flex items-center gap-2 border-b pb-3 text-sm"
      >
        <button
          type="button"
          onClick={() => setStage("accounts")}
          className={cn(
            "flex items-center gap-2 font-medium",
            stage === "accounts"
              ? "text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <span
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded-full border text-xs",
              stage === "accounts" &&
                "border-foreground bg-foreground text-background",
            )}
          >
            1
          </span>
          Select accounts
        </button>
        <ArrowRight className="h-4 w-4 text-muted-foreground" />
        <button
          type="button"
          disabled={selectedAccounts.length === 0}
          onClick={() => setStage("actions")}
          className={cn(
            "flex items-center gap-2 font-medium disabled:cursor-not-allowed disabled:opacity-50",
            stage === "actions"
              ? "text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <span
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded-full border text-xs",
              stage === "actions" &&
                "border-foreground bg-foreground text-background",
            )}
          >
            2
          </span>
          Choose action
        </button>
      </nav>

      {stage === "accounts" ? (
        <LifecycleAccountsList controller={controller} />
      ) : (
        <div className="space-y-4">
          <LifecycleAccountsActionPicker controller={controller} />

          <LifecycleAccountsActionReview controller={controller} />
        </div>
      )}

      <LifecycleAccountsConfirmationDialog controller={controller} />
    </div>
  );
}
