import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { actionLabel, batchLocalDate } from "./BatchDetailShared";
import type { AuditLog } from "./BatchDetailTypes";

export function BatchDetailAuditTrail({
  auditLogs,
}: {
  auditLogs: AuditLog[];
}) {
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/20 hover:bg-muted/20">
            <TableHead className="pl-4">Time</TableHead>
            <TableHead>Event</TableHead>
            <TableHead>Account</TableHead>
            <TableHead>Operator</TableHead>
            <TableHead>Outcome</TableHead>
            <TableHead className="w-[42%]">Details</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {auditLogs.map((log) => (
            <TableRow key={log.id}>
              <TableCell className="pl-4 text-xs text-muted-foreground">
                {batchLocalDate(log.createdAt)}
              </TableCell>
              <TableCell className="font-medium">
                {actionLabel(log.action)}
              </TableCell>
              <TableCell className="font-mono text-xs">
                {log.accountName || "Batch"}
              </TableCell>
              <TableCell>{log.performedBy}</TableCell>
              <TableCell>
                <StatusBadge tone={log.success ? "success" : "danger"}>
                  {log.success ? "Succeeded" : "Failed"}
                </StatusBadge>
              </TableCell>
              <TableCell className="whitespace-normal text-sm text-muted-foreground">
                {log.details}
              </TableCell>
            </TableRow>
          ))}
          {auditLogs.length === 0 && (
            <TableRow>
              <TableCell
                colSpan={6}
                className="h-28 text-center text-sm text-muted-foreground"
              >
                No audit events were recorded for this batch.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
