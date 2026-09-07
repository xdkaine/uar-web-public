import { Fragment } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Search,
  ShieldCheck,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

import { batchLocalDate, statusTone, words } from "./BatchDetailShared";
import type {
  AccountFilter,
  BatchAccount,
  BatchAccountCounts,
} from "./BatchDetailTypes";

interface BatchDetailAccountsPanelProps {
  accountCounts: BatchAccountCounts;
  accountFilter: AccountFilter;
  expandedAccounts: Set<string>;
  query: string;
  visibleAccounts: BatchAccount[];
  onAccountFilterChange: (filter: AccountFilter) => void;
  onQueryChange: (query: string) => void;
  onToggleExpanded: (accountId: string) => void;
}

function AccountFilters({
  accountCounts,
  accountFilter,
  query,
  onAccountFilterChange,
  onQueryChange,
}: Omit<
  BatchDetailAccountsPanelProps,
  "expandedAccounts" | "visibleAccounts" | "onToggleExpanded"
>) {
  const filters: ReadonlyArray<readonly [AccountFilter, string, number]> = [
    ["all", "All", accountCounts.all],
    ["attention", "Needs attention", accountCounts.attention],
    ["ad", "Active Directory", accountCounts.ad],
    ["vpn", "VPN", accountCounts.vpn],
  ];

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-wrap gap-2" aria-label="Filter accounts">
        {filters.map(([value, label, count]) => (
          <Button
            key={value}
            type="button"
            size="sm"
            variant={accountFilter === value ? "secondary" : "ghost"}
            aria-pressed={accountFilter === value}
            onClick={() => onAccountFilterChange(value)}
          >
            {label}
            <span className="tabular-nums text-muted-foreground">{count}</span>
          </Button>
        ))}
      </div>
      <div className="relative w-full lg:w-80">
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search name, username, email, or request"
          aria-label="Search batch accounts"
          className="pl-9"
        />
      </div>
    </div>
  );
}

function AccountTracking({ account }: { account: BatchAccount }) {
  if (
    account.lifecycleOwnerKind === "access_request_legacy" &&
    account.accessRequestId
  ) {
    return (
      <Link
        href={`/admin/requests/${account.accessRequestId}`}
        className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
      >
        Legacy request <ExternalLink className="h-3 w-3" />
      </Link>
    );
  }
  if (account.lifecycleOwnerKind === "batch_item") {
    return (
      <span
        className="text-xs text-muted-foreground"
        title={`Batch run ${account.batchId}; batch item ${account.id}`}
      >
        Batch item
      </span>
    );
  }
  if (account.lifecycleOwnerKind === "access_request_legacy") {
    return (
      <span className="text-xs text-amber-700 dark:text-amber-300">
        Request link missing
      </span>
    );
  }
  return (
    <span className="text-xs text-amber-700 dark:text-amber-300">
      Owner review needed
    </span>
  );
}

function AccountChecks({ account }: { account: BatchAccount }) {
  if (account.issues.length > 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-300">
        <AlertTriangle className="h-3.5 w-3.5" />
        {account.issues.length}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <CheckCircle2 className="h-3.5 w-3.5" />
      Passed
    </span>
  );
}

function BatchAccountDetails({ account }: { account: BatchAccount }) {
  return (
    <TableRow className="bg-muted/10 hover:bg-muted/10">
      <TableCell colSpan={8} className="whitespace-normal px-4 py-4">
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,0.8fr)]">
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <dt className="text-xs text-muted-foreground">
                Account category
              </dt>
              <dd className="mt-1 font-medium">
                {account.isInternal ? "Internal" : "External"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Provisioned</dt>
              <dd className="mt-1 font-medium">
                {batchLocalDate(account.provisionedAt)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Expires</dt>
              <dd className="mt-1 font-medium">
                {batchLocalDate(
                  account.accountExpiresAt,
                  "No expiration recorded",
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Completed</dt>
              <dd className="mt-1 font-medium">
                {batchLocalDate(account.completedAt)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Last updated</dt>
              <dd className="mt-1 font-medium">
                {batchLocalDate(account.updatedAt)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Item ID</dt>
              <dd className="mt-1 break-all font-mono text-xs">{account.id}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs text-muted-foreground">Batch run ID</dt>
              <dd className="mt-1 break-all font-mono text-xs">
                {account.batchId}
              </dd>
            </div>
            {account.directoryDn && (
              <div className="sm:col-span-2">
                <dt className="text-xs text-muted-foreground">Directory DN</dt>
                <dd className="mt-1 break-all font-mono text-xs">
                  {account.directoryDn}
                </dd>
              </div>
            )}
            {account.directoryObjectGuid && (
              <div>
                <dt className="text-xs text-muted-foreground">
                  Directory object GUID
                </dt>
                <dd className="mt-1 break-all font-mono text-xs">
                  {account.directoryObjectGuid}
                </dd>
              </div>
            )}
          </dl>
          <div className="space-y-3">
            {account.errorMessage && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
                <p className="text-xs font-semibold text-destructive">
                  Recorded failure
                </p>
                <p className="mt-1 text-sm">{account.errorMessage}</p>
              </div>
            )}
            <AccountDetailChecks account={account} />
          </div>
        </div>
      </TableCell>
    </TableRow>
  );
}

function AccountDetailChecks({ account }: { account: BatchAccount }) {
  if (account.issues.length === 0) {
    return (
      <div className="rounded-md border p-3 text-sm text-muted-foreground">
        <ShieldCheck className="mr-2 inline h-4 w-4" />
        Required tracking fields are present.
      </div>
    );
  }

  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
      <p className="text-xs font-semibold">Data checks</p>
      <ul className="mt-2 space-y-2 text-sm">
        {account.issues.map((issue) => (
          <li key={issue.code} className="flex gap-2">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700 dark:text-amber-300" />
            <span>{issue.message}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function BatchAccountRow({
  account,
  expanded,
  onToggleExpanded,
}: {
  account: BatchAccount;
  expanded: boolean;
  onToggleExpanded: (accountId: string) => void;
}) {
  return (
    <Fragment>
      <TableRow
        className={cn(account.needsAttention && "bg-amber-500/[0.035]")}
      >
        <TableCell className="pl-4 whitespace-normal">
          <p className="font-medium">{account.name || "Name missing"}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {account.email || "No email recorded"}
          </p>
        </TableCell>
        <TableCell>
          <span className="text-sm">{account.accountSystemLabel}</span>
        </TableCell>
        <TableCell>
          <span className="font-mono text-xs">
            {account.username || "Missing"}
          </span>
        </TableCell>
        <TableCell>
          <AccountTracking account={account} />
        </TableCell>
        <TableCell className="text-xs text-muted-foreground">
          {account.stageLabel}
        </TableCell>
        <TableCell>
          <StatusBadge tone={statusTone(account.status)}>
            {words(account.status)}
          </StatusBadge>
        </TableCell>
        <TableCell className="text-right">
          <AccountChecks account={account} />
        </TableCell>
        <TableCell className="pr-3 text-right">
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-expanded={expanded}
            aria-label={`${expanded ? "Hide" : "Show"} details for ${account.username || account.name}`}
            onClick={() => onToggleExpanded(account.id)}
          >
            {expanded ? <ChevronDown /> : <ChevronRight />}
          </Button>
        </TableCell>
      </TableRow>
      {expanded && <BatchAccountDetails account={account} />}
    </Fragment>
  );
}

function BatchAccountsTable({
  expandedAccounts,
  visibleAccounts,
  onToggleExpanded,
}: Pick<
  BatchDetailAccountsPanelProps,
  "expandedAccounts" | "visibleAccounts" | "onToggleExpanded"
>) {
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/20 hover:bg-muted/20">
            <TableHead className="w-[24%] pl-4">Account</TableHead>
            <TableHead>System</TableHead>
            <TableHead>Username</TableHead>
            <TableHead>Tracking</TableHead>
            <TableHead>Stage</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Checks</TableHead>
            <TableHead>
              <span className="sr-only">Details</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visibleAccounts.map((account) => (
            <BatchAccountRow
              key={account.id}
              account={account}
              expanded={expandedAccounts.has(account.id)}
              onToggleExpanded={onToggleExpanded}
            />
          ))}
          {visibleAccounts.length === 0 && (
            <TableRow>
              <TableCell
                colSpan={8}
                className="h-28 text-center text-sm text-muted-foreground"
              >
                No accounts match the current filter.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

export function BatchDetailAccountsPanel(props: BatchDetailAccountsPanelProps) {
  return (
    <div className="space-y-3">
      <AccountFilters {...props} />
      <BatchAccountsTable {...props} />
    </div>
  );
}
