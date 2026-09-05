import { AlertTriangle, ShieldCheck } from "lucide-react";

import { cn } from "@/lib/utils";

import type { BatchAccountCounts, BatchDetail } from "./BatchDetailTypes";

interface BatchDetailIntegrityNoticeProps {
  batch: BatchDetail;
  accountCounts: BatchAccountCounts;
}

export function BatchDetailIntegrityNotice({
  batch,
  accountCounts,
}: BatchDetailIntegrityNoticeProps) {
  const hasIntegrityFindings =
    batch.integrityIssues.length > 0 || accountCounts.issues > 0;
  const findingCount = batch.integrityIssues.length + accountCounts.issues;

  return (
    <section
      aria-labelledby="data-check-heading"
      className={cn(
        "rounded-lg border px-4 py-3 sm:px-5",
        hasIntegrityFindings
          ? "border-amber-500/40 bg-amber-500/5"
          : "bg-muted/15",
      )}
    >
      <div className="flex items-start gap-3">
        {hasIntegrityFindings ? (
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" />
        ) : (
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <div className="min-w-0">
          <h2 id="data-check-heading" className="text-sm font-semibold">
            {hasIntegrityFindings
              ? "Recorded data needs review"
              : "No structural data issues detected"}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {hasIntegrityFindings
              ? `${batch.integrityIssues.length} batch-level and ${accountCounts.issues} account-level finding${findingCount === 1 ? "" : "s"}. Expand affected rows for the exact evidence.`
              : "Account systems, usernames, outcome counts, and required tracking evidence are consistent."}
          </p>
          {batch.integrityIssues.length > 0 && (
            <ul className="mt-2 space-y-1 text-sm">
              {batch.integrityIssues.map((issue) => (
                <li key={issue.code}>• {issue.message}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
