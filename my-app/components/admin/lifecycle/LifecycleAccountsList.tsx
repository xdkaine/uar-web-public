"use client";

import { AlertTriangle, ArrowLeft, ArrowRight, Loader2, Search } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { AccountOwnershipDetails } from "../AccountOwnershipDetails";
import { ownershipPresentation } from "../accountOwnershipPresentation";
import { MAX_LIFECYCLE_SELECTION, type AccountStateFilter, type SystemFilter } from "./lifecycleAccountsWorkspaceUtils";
import type { LifecycleAccountsWorkspaceController } from "./LifecycleAccountsWorkspaceController";

function formatState(value: string | null | undefined): string {
  return value ? value.replaceAll("_", " ") : "No state";
}

export function LifecycleAccountsList({ controller }: { controller: LifecycleAccountsWorkspaceController }) {
  const { inventory, loading, loadError, selectedAccounts, clearSelection, setStage, query, setQuery, setRequestedPage, systemFilter, setSystemFilter, stateFilter, setStateFilter, pageSize, setPageSize, loadAccounts, pagedAccounts, visibleSelectedCount, allVisibleSelected, selectVisible, selected, toggleAccount, filteredAccounts } = controller;
  return (
<Card className="overflow-hidden shadow-none">
          <CardHeader className="border-b pb-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <CardTitle className="text-base">Accounts</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  Select up to {MAX_LIFECYCLE_SELECTION} accounts across pages.
                  Available actions are calculated from the full selection.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="font-mono">
                  {selectedAccounts.length}/{MAX_LIFECYCLE_SELECTION} selected
                </Badge>
                {selectedAccounts.length > 0 && (
                  <Button variant="ghost" size="sm" onClick={clearSelection}>
                    Clear
                  </Button>
                )}
                <Button
                  disabled={selectedAccounts.length === 0}
                  onClick={() => setStage("actions")}
                >
                  Continue <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="grid gap-2 md:grid-cols-[minmax(16rem,1fr)_11rem_11rem]">
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setRequestedPage(1);
                  }}
                  className="pl-9"
                  placeholder="Search name, username, request, batch item, or batch run ID"
                />
              </div>
              <Select
                value={systemFilter}
                onValueChange={(value) => {
                  setSystemFilter(value as SystemFilter);
                  setRequestedPage(1);
                }}
              >
                <SelectTrigger aria-label="Filter by managed system">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All systems</SelectItem>
                  <SelectItem value="AD">Active Directory</SelectItem>
                  <SelectItem
                    value="VPN"
                    disabled={!inventory.vpnModuleEnabled}
                  >
                    VPN
                  </SelectItem>
                  <SelectItem
                    value="BOTH"
                    disabled={!inventory.vpnModuleEnabled}
                  >
                    AD and VPN
                  </SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={stateFilter}
                onValueChange={(value) => {
                  setStateFilter(value as AccountStateFilter);
                  setRequestedPage(1);
                }}
              >
                <SelectTrigger aria-label="Filter by account state">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All states</SelectItem>
                  <SelectItem value="active">Active access</SelectItem>
                  <SelectItem value="restricted">
                    Disabled or revoked
                  </SelectItem>
                  <SelectItem value="attention">
                    Needs ownership review
                  </SelectItem>
                  <SelectItem value="unlinked">No portal owner</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="flex flex-col gap-2 border-b bg-muted/10 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-muted-foreground">
                Selection stays checked while you search, filter, or move
                between pages.
              </p>
              <div className="flex items-center gap-2">
                <Label
                  htmlFor="lifecycle-page-size"
                  className="text-xs font-normal text-muted-foreground"
                >
                  Rows
                </Label>
                <Select
                  value={String(pageSize)}
                  onValueChange={(value) => {
                    setPageSize(Number(value));
                    setRequestedPage(1);
                  }}
                >
                  <SelectTrigger
                    id="lifecycle-page-size"
                    className="h-8 w-20"
                    aria-label="Rows per page"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="25">25</SelectItem>
                    <SelectItem value="50">50</SelectItem>
                    <SelectItem value="100">100</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading account
                inventory…
              </div>
            ) : loadError ? (
              <div className="p-6">
                <Alert variant="destructive">
                  <AlertTriangle />
                  <AlertTitle>Account inventory unavailable</AlertTitle>
                  <AlertDescription>
                    {loadError}
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-2"
                      onClick={() => void loadAccounts()}
                    >
                      Try again
                    </Button>
                  </AlertDescription>
                </Alert>
              </div>
            ) : (
              <div className="max-h-[56rem] overflow-auto">
                <table className="w-full min-w-[980px] text-sm">
                  <thead className="sticky top-0 z-10 border-b bg-background text-left text-xs text-muted-foreground shadow-[0_1px_0_hsl(var(--border))]">
                    <tr>
                      <th className="w-12 px-4 py-3">
                        <Checkbox
                          aria-label={`Select accounts on page ${pagedAccounts.page}`}
                          checked={
                            allVisibleSelected
                              ? true
                              : visibleSelectedCount > 0
                                ? "indeterminate"
                                : false
                          }
                          onCheckedChange={selectVisible}
                        />
                      </th>
                      <th className="px-3 py-3 font-medium">Account</th>
                      <th className="w-[17rem] px-3 py-3 font-medium">
                        Active Directory
                      </th>
                      <th className="w-[17rem] px-3 py-3 font-medium">VPN</th>
                      <th className="w-[19rem] px-3 py-3 font-medium">
                        Portal ownership
                      </th>
                    </tr>
                  </thead>
                  <LifecycleAccountsTableRows
                    accounts={pagedAccounts.items}
                    selected={selected}
                    selectedAccountCount={selectedAccounts.length}
                    onToggle={toggleAccount}
                    empty={filteredAccounts.length === 0}
                  />
                </table>
              </div>
            )}
            <div className="flex flex-col gap-3 border-t bg-muted/10 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
              <p className="text-xs text-muted-foreground">
                Showing {pagedAccounts.start}–{pagedAccounts.end} of{" "}
                {filteredAccounts.length} matching accounts ·{" "}
                {inventory.summary.total} total.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pagedAccounts.page === 1}
                  onClick={() =>
                    setRequestedPage((page) => Math.max(1, page - 1))
                  }
                >
                  <ArrowLeft className="h-4 w-4" /> Previous
                </Button>
                <span className="min-w-20 text-center text-sm text-muted-foreground">
                  Page {pagedAccounts.page} of {pagedAccounts.totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pagedAccounts.page === pagedAccounts.totalPages}
                  onClick={() =>
                    setRequestedPage((page) =>
                      Math.min(pagedAccounts.totalPages, page + 1),
                    )
                  }
                >
                  Next <ArrowRight className="h-4 w-4" />
                </Button>
                <Button
                  disabled={selectedAccounts.length === 0}
                  onClick={() => setStage("actions")}
                >
                  Continue with {selectedAccounts.length || 0} selected{" "}
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
  );
}



function LifecycleAccountsTableRows({ accounts, selected, selectedAccountCount, onToggle, empty }: {
  accounts: LifecycleAccountsWorkspaceController["pagedAccounts"]["items"];
  selected: ReadonlySet<string>;
  selectedAccountCount: number;
  onToggle: (accountRef: string) => void;
  empty: boolean;
}) {
  return (
    <tbody>
        {accounts.map((account) => {
          const checked = selected.has(account.accountRef);
          const ownership = ownershipPresentation(
            account.ownership,
          );
          return (
            <tr
              key={account.accountRef}
              className={cn(
                "border-b transition-colors last:border-0 hover:bg-muted/20",
                checked && "bg-muted/35",
              )}
            >
              <td className="px-4 py-3 align-top">
                <Checkbox
                  checked={checked}
                  disabled={
                    !checked &&
                    selectedAccountCount >=
                      MAX_LIFECYCLE_SELECTION
                  }
                  onCheckedChange={() =>
                    onToggle(account.accountRef)
                  }
                  aria-label={`Select ${account.displayName}`}
                />
              </td>
              <td className="px-3 py-3 align-top">
                <button
                  type="button"
                  onClick={() => onToggle(account.accountRef)}
                  className="text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <span className="block font-medium hover:underline">
                    {account.displayName}
                  </span>
                  <span className="block max-w-64 truncate text-xs text-muted-foreground">
                    {account.email || "No email recorded"}
                  </span>
                  {account.batchProvenance && (
                    <span className="mt-1 block max-w-64 truncate text-[11px] text-muted-foreground">
                      Batch: {account.batchProvenance.description}
                    </span>
                  )}
                  {account.governance.requestId && (
                    <span className="mt-1 block max-w-64 break-all font-mono text-[11px] text-muted-foreground">
                      Owner request: {account.governance.requestId}
                    </span>
                  )}
                </button>
              </td>
              <td className="px-3 py-3 align-top">
                {account.directory ? (
                  <>
                    <span className="block font-mono text-xs">
                      {account.directory.username}
                    </span>
                    <span
                      className={cn(
                        "mt-1 block text-xs",
                        account.directory.enabled
                          ? "text-teal-700 dark:text-teal-300"
                          : "text-muted-foreground",
                      )}
                    >
                      {account.directory.enabled
                        ? "Enabled"
                        : "Disabled"}
                    </span>
                  </>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    Not present
                  </span>
                )}
              </td>
              <td className="px-3 py-3 align-top">
                {account.vpn ? (
                  <>
                    <span className="block font-mono text-xs">
                      {account.vpn.username}
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {formatState(account.vpn.status)} ·{" "}
                      {account.vpn.portalType}
                    </span>
                  </>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    Not present
                  </span>
                )}
              </td>
              <td className="px-3 py-3 align-top">
                <AccountOwnershipDetails
                  ownership={account.ownership}
                  compact
                />
                {ownership.label === "No portal owner" && (
                  <span className="mt-1.5 block text-xs text-muted-foreground">
                    Unmanaged directory deletion requires{" "}
                    <code>lifecycle.delete_unmanaged</code> after
                    selection.
                  </span>
                )}
                {account.accountRef.startsWith("vpn:") && account.governance.requestId && (
                  <span className="mt-1.5 block text-xs text-muted-foreground">
                    This VPN record is governed independently. Delete it as a VPN-only plan; its request ID does not need to match a separate AD owner.
                  </span>
                )}
              </td>
            </tr>
          );
        })}
        {empty && (
          <tr>
            <td colSpan={5} className="px-4 py-14 text-center">
              <p className="font-medium">No accounts match</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Change the search or filters to widen the list.
              </p>
            </td>
          </tr>
        )}
    </tbody>
  );
}
