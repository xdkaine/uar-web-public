"use client";

import { Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { AccountOwnershipDetails } from "../AccountOwnershipDetails";
import { LifecycleAccountsDeletionChecks } from "./LifecycleAccountsDeletionChecks";
import type { LifecycleAccountsWorkspaceController } from "./LifecycleAccountsWorkspaceController";

function formatState(value: string | null | undefined): string { return value ? value.replaceAll("_", " ") : "No state"; }
function formatTimestamp(value: string | null | undefined): string { if (!value) return "Not recorded"; const timestamp = new Date(value); return Number.isNaN(timestamp.getTime()) ? "Unreadable timestamp" : timestamp.toLocaleString(); }

function deletionSummary(input: {
  isVpn: boolean;
  account: LifecycleAccountsWorkspaceController["deletionAccount"];
}) {
  const { isVpn, account } = input;
  const vpnStatus = account?.vpn?.status;
  return {
    targetKind: isVpn ? "live VPN record" : "Active Directory object",
    usernameLabel: isVpn ? "VPN username" : "AD username",
    targetLabel: isVpn ? "VPN record ID" : "Directory DN",
    targetValue: isVpn ? account?.vpn?.id : account?.directory?.dn,
    username: isVpn ? account?.vpn?.username : account?.directory?.username,
    liveState: isVpn ? formatState(vpnStatus) : account?.directory?.enabled ? "Enabled — blocked" : "Disabled",
    portalState: formatState(isVpn ? vpnStatus : account?.governance.adAccountStatus),
    restrictedAt: isVpn ? "Verified by server history" : formatTimestamp(account?.governance.adDisabledAt),
    restrictedBy: isVpn ? "Verified by server history" : account?.governance.adDisabledBy || "Not recorded",
    evidence: isVpn ? "Revocation timestamp, actor, reason, and latest status log are required." : account?.governance.adDisabledReason || "Not recorded",
  };
}

function deletionPermissionNotice(input: {
  isOverride: boolean;
  isCombined: boolean;
  isVpn: boolean;
  canDeleteDirectory: boolean;
  canDeleteVpn: boolean;
  canDeleteUnmanaged: boolean;
  unmanagedNotice: string | null;
}): string | null {
  if (input.isOverride && !input.canDeleteUnmanaged) return input.unmanagedNotice;
  if (input.isCombined && (!input.canDeleteDirectory || !input.canDeleteVpn)) return "Your role needs both lifecycle.delete and vpn.delete.";
  if (input.isVpn && !input.canDeleteVpn) return "Your role does not have vpn.delete.";
  return input.canDeleteDirectory ? null : "Your role does not have lifecycle.delete.";
}

export function LifecycleAccountsDeletionReview({ controller }: { controller: LifecycleAccountsWorkspaceController }) {
  const { dispatchActionDraft, irreversibleAcknowledgement, bulkDeletionAcknowledgement, canDeleteDirectory, canDeleteVpn, canDeleteUnmanaged, unmanagedDeletionPermissionNotice, selectedAccounts, selectedAction, selectedIsDeletion, selectedIsVpnDeletion, selectedIsCombinedDeletion, deletionAccount, plannedDeletionRecordCount, bulkDeletionPhrase } = controller;
  if (!selectedIsDeletion || !selectedAction) return null;
  const summary = deletionSummary({ isVpn: selectedIsVpnDeletion, account: deletionAccount });
  const permissionNotice = deletionPermissionNotice({
    isOverride: selectedAction.operationMode === "directory_override",
    isCombined: selectedIsCombinedDeletion,
    isVpn: selectedIsVpnDeletion,
    canDeleteDirectory, canDeleteVpn, canDeleteUnmanaged,
    unmanagedNotice: unmanagedDeletionPermissionNotice,
  });
  return (
    <>
{selectedIsDeletion && (
                  <div className="lg:col-span-2 overflow-hidden rounded-md border border-destructive/40">
                    <div className="border-b border-destructive/30 bg-destructive/5 px-4 py-3">
                      <div className="flex items-start gap-3">
                        <Trash2 className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                        <div>
                          <h3 className="font-semibold text-destructive">
                            Permanent deletion safety record
                          </h3>
                          <p className="mt-1 text-sm text-muted-foreground">
                            Review the exact target and every visible condition.
                            The server rechecks these conditions immediately
                            before deleting the{" "}
                            {summary.targetKind}
                            .
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="grid border-b md:grid-cols-2">
                      <dl className="divide-y border-b text-sm md:border-b-0 md:border-r">
                        <div className="grid grid-cols-[8.5rem_1fr] gap-3 px-4 py-2.5">
                          <dt className="text-muted-foreground">Account</dt>
                          <dd className="font-medium">
                            {deletionAccount?.displayName}
                          </dd>
                        </div>
                        <div className="grid grid-cols-[8.5rem_1fr] gap-3 px-4 py-2.5">
                          <dt className="text-muted-foreground">
                            {summary.usernameLabel}
                          </dt>
                          <dd className="font-mono text-xs">
                            {summary.username}
                          </dd>
                        </div>
                        <div className="grid grid-cols-[8.5rem_1fr] gap-3 px-4 py-2.5">
                          <dt className="text-muted-foreground">
                            Portal ownership
                          </dt>
                          <dd>
                            <AccountOwnershipDetails
                              ownership={deletionAccount?.ownership}
                              compact
                            />
                          </dd>
                        </div>
                        <div className="grid grid-cols-[8.5rem_1fr] gap-3 px-4 py-2.5">
                          <dt className="text-muted-foreground">
                            {summary.targetLabel}
                          </dt>
                          <dd className="break-all font-mono text-xs">
                            {summary.targetValue}
                          </dd>
                        </div>
                      </dl>
                      <dl className="divide-y text-sm">
                        <div className="grid grid-cols-[8.5rem_1fr] gap-3 px-4 py-2.5">
                          <dt className="text-muted-foreground">Live state</dt>
                          <dd>
                            {summary.liveState}
                          </dd>
                        </div>
                        <div className="grid grid-cols-[8.5rem_1fr] gap-3 px-4 py-2.5">
                          <dt className="text-muted-foreground">
                            Portal state
                          </dt>
                          <dd>
                            {summary.portalState}
                          </dd>
                        </div>
                        <div className="grid grid-cols-[8.5rem_1fr] gap-3 px-4 py-2.5">
                          <dt className="text-muted-foreground">
                            Restricted at
                          </dt>
                          <dd>
                            {summary.restrictedAt}
                          </dd>
                        </div>
                        <div className="grid grid-cols-[8.5rem_1fr] gap-3 px-4 py-2.5">
                          <dt className="text-muted-foreground">
                            Restricted by
                          </dt>
                          <dd>
                            {summary.restrictedBy}
                          </dd>
                        </div>
                        <div className="grid grid-cols-[8.5rem_1fr] gap-3 px-4 py-2.5">
                          <dt className="text-muted-foreground">Evidence</dt>
                          <dd className="break-words">
                            {summary.evidence}
                          </dd>
                        </div>
                      </dl>
                    </div>
                    <LifecycleAccountsDeletionChecks controller={controller} />
                    <div className="space-y-3 border-t bg-destructive/5 p-4">
                      <Label
                        htmlFor="bulk-delete-ack"
                        className="block leading-6"
                      >
                        Type this exact confirmation:
                      </Label>
                      <div className="w-fit max-w-full rounded-md border border-destructive/30 bg-background px-3 py-2 font-mono text-sm font-semibold text-foreground shadow-sm">
                        {bulkDeletionPhrase}
                      </div>
                      <p className="text-sm text-foreground">
                        This covers {selectedAccounts.length} account
                        {selectedAccounts.length === 1 ? "" : "s"} and{" "}
                        {plannedDeletionRecordCount} record
                        {plannedDeletionRecordCount === 1 ? "" : "s"}.
                      </p>
                      <Input
                        id="bulk-delete-ack"
                        aria-label={`Type ${bulkDeletionPhrase} exactly`}
                        value={bulkDeletionAcknowledgement}
                        onChange={(event) =>
                          dispatchActionDraft({ type: "bulkDeletionAcknowledgement", value: event.target.value })
                        }
                        autoComplete="off"
                        spellCheck={false}
                        className="font-mono text-foreground"
                      />
                      <p className="text-xs text-muted-foreground">
                        The server creates one reviewed plan, then rechecks and
                        records every AD or VPN deletion independently. An
                        uncertain directory result pauses the remaining plan for
                        reconciliation.
                      </p>
                    </div>
                    <div className="space-y-3 border-t bg-muted/10 p-4">
                      {permissionNotice && (
                        <p className="text-sm font-medium text-destructive">
                          {permissionNotice}
                        </p>
                      )}
                      <div className="flex items-start gap-2">
                        <Checkbox
                          id="delete-impact-ack"
                          checked={irreversibleAcknowledgement}
                          onCheckedChange={(checked) =>
                            dispatchActionDraft({ type: "irreversibleAcknowledgement", value: checked === true })
                          }
                        />
                        <Label
                          htmlFor="delete-impact-ack"
                          className="font-normal leading-5"
                        >
                          I understand the selected live records will be removed
                          permanently. Request linkage, lifecycle history,
                          comments, status evidence, and audit records will be
                          retained where they exist; unmanaged directory
                          accounts retain their lifecycle and audit evidence
                          without creating a request.
                        </Label>
                      </div>
                    </div>
                  </div>
                )}
    </>
  );
}
