"use client";

import { CheckCircle2 } from "lucide-react";

import { isInventoryGovernanceReady } from "@/lib/lifecycle-account-inventory";
import { cn } from "@/lib/utils";
import {
  isBatchBulkDeletionEligible,
  isRequestOwnedDeletionSelection,
  type LifecycleActionAvailability,
  type OwnershipInventoryAccount,
} from "./lifecycleAccountsWorkspaceUtils";
import type { LifecycleAccountsWorkspaceController } from "./LifecycleAccountsWorkspaceController";

type VisibleCheck = { label: string; passed: boolean };

function visibleDeletionChecks(input: {
  accounts: OwnershipInventoryAccount[];
  action: LifecycleActionAvailability;
  isVpnDeletion: boolean;
  isCombinedDeletion: boolean;
  vpnModuleEnabled: boolean;
  canDeleteDirectory: boolean;
  canDeleteVpn: boolean;
  canDeleteUnmanaged: boolean;
}): VisibleCheck[] {
  const { accounts, action, isVpnDeletion, isCombinedDeletion } = input;
  const isOverride = action.operationMode === "directory_override";
  const recordScope = isCombinedDeletion ? "AD" : isVpnDeletion ? "VPN" : "AD";
  const ownershipReady = isOverride
    ? accounts.every((account) => account.governance.bindingPosture === "missing")
    : isVpnDeletion
      ? accounts.every((account) => account.governance.bindingPosture !== "conflict")
      : accounts.every((account) => account.governance.bindingPosture === "verified");
  const disabledOrRevoked = isOverride
    ? accounts.every((account) => account.directory?.enabled === false)
    : isCombinedDeletion
      ? accounts.every((account) => account.directory?.enabled === false && (!account.vpn || account.vpn.status.toLowerCase() === "revoked"))
      : isVpnDeletion
        ? accounts.every((account) => account.vpn?.status.toLowerCase() === "revoked")
        : accounts.every((account) => isInventoryGovernanceReady(account, "delete"));
  const portalStateReady = isOverride
    ? true
    : isCombinedDeletion
      ? accounts.every((account) => account.governance.adAccountStatus === "disabled")
      : isVpnDeletion
        ? input.vpnModuleEnabled
        : accounts.every((account) => account.governance.adAccountStatus === "disabled");
  const liveTargetReady = isCombinedDeletion
    ? accounts.every((account) => account.directory?.enabled === false && (!account.vpn || account.vpn.status.toLowerCase() === "revoked"))
    : isVpnDeletion
      ? accounts.every((account) => Boolean(account.vpn))
      : accounts.every((account) => account.directory?.enabled === false);
  const permissionsReady = isOverride
    ? input.canDeleteUnmanaged
    : isCombinedDeletion
      ? input.canDeleteDirectory && input.canDeleteVpn
      : isVpnDeletion
        ? input.canDeleteVpn
        : input.canDeleteDirectory;
  return [
    {
      label: isOverride ? "Selection contains only unowned directory accounts" : "Each account has its own request or recorded batch ownership",
      passed: isOverride || accounts.length === 1 || isRequestOwnedDeletionSelection(accounts, action.scope) || isBatchBulkDeletionEligible(accounts, recordScope),
    },
    {
      label: isOverride ? "No portal owner is recorded" : isVpnDeletion ? "VPN linkage has no conflict" : "Portal ownership is verified",
      passed: ownershipReady,
    },
    {
      label: isOverride ? "Every unmanaged AD target is disabled" : isCombinedDeletion ? "Every AD record is disabled; attached VPN records are revoked" : isVpnDeletion ? "Every VPN record is revoked" : "Every owner record is lifecycle-ready",
      passed: disabledOrRevoked,
    },
    {
      label: isOverride ? "No portal account state will be invented" : isCombinedDeletion ? "Every portal AD state is disabled" : isVpnDeletion ? "VPN module is enabled" : "Every portal state is disabled",
      passed: portalStateReady,
    },
    {
      label: isCombinedDeletion ? "Each live AD target is disabled; VPN may be absent" : isVpnDeletion ? "Only the live VPN records will be removed" : "Every live Active Directory target is disabled",
      passed: liveTargetReady,
    },
    { label: "Your role has every required permanent-delete permission", passed: permissionsReady },
  ];
}

function executionRechecks(isVpnDeletion: boolean): string[] {
  return isVpnDeletion
    ? ["The immutable VPN record ID and username still match", "Status remains revoked with complete revoke evidence", "The latest status log still confirms revocation", "Any request linkage remains coherent", "No other deletion is active for this record", "Logs, comments, activity, and audit evidence are retained"]
    : ["The request or batch-item owner and version have not changed", "DN, object GUID, username, and disabled state still match", "The account is not protected or privilege-bearing", "Portal and provider sessions are fully settled", "No other delete is active for this directory object", "GUID absence is confirmed after deletion"];
}

export function LifecycleAccountsDeletionChecks({ controller }: { controller: LifecycleAccountsWorkspaceController }) {
  const { inventory, selectedAccounts, selectedAction, selectedIsVpnDeletion, selectedIsCombinedDeletion, canDeleteDirectory, canDeleteVpn, canDeleteUnmanaged } = controller;
  if (!selectedAction) return null;
  const checks = visibleDeletionChecks({
    accounts: selectedAccounts, action: selectedAction, isVpnDeletion: selectedIsVpnDeletion,
    isCombinedDeletion: selectedIsCombinedDeletion, vpnModuleEnabled: inventory.vpnModuleEnabled,
    canDeleteDirectory, canDeleteVpn, canDeleteUnmanaged,
  });
  const executionChecks = executionRechecks(selectedIsVpnDeletion);
  return (
    <div className="grid gap-4 p-4 lg:grid-cols-[minmax(18rem,1fr)_minmax(18rem,1fr)]">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Conditions already visible</p>
        <ul className="mt-2 space-y-1.5 text-sm">
          {checks.map((check) => (
            <li key={check.label} className="flex items-center gap-2">
              <CheckCircle2 className={cn("h-4 w-4", check.passed ? "text-foreground" : "text-destructive")} />
              <span>{check.label}</span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Rechecked at execution</p>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
          {executionChecks.map((check) => <li key={check}>{check}</li>)}
        </ul>
      </div>
    </div>
  );
}
