import Link from "next/link";
import { ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { ticketCategoryLabel } from "@/lib/support/ticket-categories";

import { batchLocalDate, statusTone, words } from "./BatchDetailShared";
import type { BatchAccountCounts, BatchDetail } from "./BatchDetailTypes";

interface BatchDetailOverviewProps {
  batch: BatchDetail;
  accountCounts: BatchAccountCounts;
}

function CurrentItemStates({
  accountCounts,
}: {
  accountCounts: BatchAccountCounts;
}) {
  const needsStateBreakdown =
    accountCounts.rolledBack > 0 ||
    accountCounts.reconciliation > 0 ||
    accountCounts.open > 0 ||
    accountCounts.other > 0;

  return (
    <div className="px-4 py-3 sm:px-5">
      <dt className="text-xs text-muted-foreground">Current item states</dt>
      <dd className="mt-1 text-sm font-medium tabular-nums">
        {accountCounts.completed} completed · {accountCounts.failed} failed
        {needsStateBreakdown && (
          <span className="block text-xs font-normal text-muted-foreground">
            {accountCounts.rolledBack} rolled back ·{" "}
            {accountCounts.reconciliation} reconciliation · {accountCounts.open}{" "}
            open
            {accountCounts.other > 0 ? ` · ${accountCounts.other} other` : ""}
          </span>
        )}
      </dd>
    </div>
  );
}

export function BatchDetailOverview({
  batch,
  accountCounts,
}: BatchDetailOverviewProps) {
  const directBatchItems = batch.accounts.filter(
    (account) => account.lifecycleOwnerKind === "batch_item",
  ).length;
  const legacyRequestItems = batch.accounts.filter(
    (account) => account.lifecycleOwnerKind === "access_request_legacy",
  ).length;
  const unresolvedOwnerItems = batch.accounts.filter(
    (account) => account.lifecycleOwnerKind === "unresolved",
  ).length;

  return (
    <section
      aria-labelledby="batch-overview-heading"
      className="rounded-lg border bg-card"
    >
      <div className="flex flex-wrap items-start justify-between gap-4 border-b px-4 py-4 sm:px-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="batch-overview-heading" className="text-base font-semibold">
              Run overview
            </h2>
            <StatusBadge tone={statusTone(batch.status)}>
              {words(batch.status)}
            </StatusBadge>
          </div>
          <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
            {batch.id}
          </p>
        </div>
        {batch.linkedTicket && (
          <Button variant="outline" size="sm" asChild>
            <Link href={`/admin/support/tickets/${batch.linkedTicket.id}`}>
              Ticket: {batch.linkedTicket.subject}
              <ExternalLink />
            </Link>
          </Button>
        )}
      </div>
      <dl className="grid divide-y sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-5">
        <div className="px-4 py-3 sm:px-5">
          <dt className="text-xs text-muted-foreground">Created</dt>
          <dd className="mt-1 text-sm font-medium">
            {batchLocalDate(batch.createdAt)}
          </dd>
        </div>
        <div className="px-4 py-3 sm:px-5">
          <dt className="text-xs text-muted-foreground">Operator</dt>
          <dd className="mt-1 text-sm font-medium">{batch.createdBy}</dd>
        </div>
        <div className="px-4 py-3 sm:px-5">
          <dt className="text-xs text-muted-foreground">Finished</dt>
          <dd className="mt-1 text-sm font-medium">
            {batchLocalDate(batch.completedAt, "Still running")}
          </dd>
        </div>
        <CurrentItemStates accountCounts={accountCounts} />
        <div className="px-4 py-3 sm:px-5">
          <dt className="text-xs text-muted-foreground">Lifecycle tracking</dt>
          <dd className="mt-1 text-sm font-medium tabular-nums">
            {directBatchItems} batch item{directBatchItems === 1 ? "" : "s"} ·{" "}
            {legacyRequestItems} legacy request{legacyRequestItems === 1 ? "" : "s"}
            {unresolvedOwnerItems > 0 && (
              <span className="block text-xs font-normal text-amber-700 dark:text-amber-300">
                {unresolvedOwnerItems} item{unresolvedOwnerItems === 1 ? " needs" : "s need"} owner review
              </span>
            )}
          </dd>
        </div>
      </dl>
      <div className="border-t px-4 py-3 text-xs text-muted-foreground sm:px-5">
        Recorded processing outcomes: {batch.successfulAccounts} successful ·{" "}
        {batch.failedAccounts} failed. These historical counters may differ from
        current item states after rollback or cancellation.
        {batch.linkedTicket && (
          <span className="block mt-1">
            Support ticket: {batch.linkedTicket.status}
            {batch.linkedTicket.category
              ? ` · ${ticketCategoryLabel(batch.linkedTicket.category)}`
              : ""}
            {batch.linkedTicket.severity
              ? ` · ${batch.linkedTicket.severity}`
              : ""}
          </span>
        )}
      </div>
    </section>
  );
}
