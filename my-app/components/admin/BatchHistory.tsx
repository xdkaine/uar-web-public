"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { ClientLocalDate } from "./ClientLocalDate";
import type { BatchCreation } from "./BatchAccountsTab";

interface Props {
  batches: BatchCreation[];
  onView: (id: string) => void;
  onCancel: (batch: BatchCreation) => void;
}

function statusClass(status: string) {
  if (status === "completed")
    return "border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-300";
  if (status === "failed")
    return "border-red-300 text-red-700 dark:border-red-800 dark:text-red-300";
  if (status === "partial" || status === "reconciliation_required")
    return "border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-300";
  if (status === "processing")
    return "border-blue-300 text-blue-700 dark:border-blue-800 dark:text-blue-300";
  return "text-muted-foreground";
}
function isStaleProcessingBatch(batch: BatchCreation) {
  return (
    batch.status === "processing" &&
    (!batch.processingClaimedUntil ||
      new Date(batch.processingClaimedUntil).getTime() <= Date.now())
  );
}
function canRecover(batch: BatchCreation) {
  return (
    ["failed", "partial", "reconciliation_required"].includes(batch.status) ||
    isStaleProcessingBatch(batch)
  );
}

export function BatchHistory({ batches, onView, onCancel }: Props) {
  return (
    <Card
      id="batch-history"
      className="scroll-mt-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <CardHeader className="border-b">
        <CardTitle className="text-base">Batch history</CardTitle>
      </CardHeader>
      {batches.length === 0 ? (
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          No batch operations yet.
        </CardContent>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Created</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Results</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {batches.map((batch) => (
                <TableRow key={batch.id}>
                  <TableCell className="whitespace-nowrap text-sm">
                    <ClientLocalDate value={batch.createdAt} />
                  </TableCell>
                  <TableCell>
                    <p className="font-medium">{batch.description}</p>
                    {batch.linkedTicket && (
                      <p className="text-xs text-muted-foreground">
                        {batch.linkedTicket.subject}
                      </p>
                    )}
                  </TableCell>
                  <TableCell>{batch.createdBy}</TableCell>
                  <TableCell className="whitespace-nowrap text-sm tabular-nums">
                    {batch.successfulAccounts} successful ·{" "}
                    {batch.failedAccounts} failed
                  </TableCell>
                  <TableCell>
                    <span
                      className={cn(
                        "inline-flex rounded-md border px-2 py-1 text-xs font-medium capitalize",
                        statusClass(batch.status),
                      )}
                    >
                      {batch.status.replaceAll("_", " ")}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="link"
                        size="sm"
                        onClick={() => onView(batch.id)}
                      >
                        View details
                      </Button>
                      {canRecover(batch) && (
                        <Button
                          variant="link"
                          size="sm"
                          className="text-destructive"
                          onClick={() => onCancel(batch)}
                        >
                          {isStaleProcessingBatch(batch)
                            ? "Recover stale batch"
                            : "Cancel and reconcile"}
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Card>
  );
}
