"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Mail } from "lucide-react";
import { ClientLocalDate } from "./ClientLocalDate";
import {
  dueText,
  formatStatus,
  statusBadgeClass,
  type PasswordExpirationRow,
  type SortField,
} from "./passwordExpirationModel";

interface Props {
  isLoading: boolean;
  isSending: boolean;
  rows: PasswordExpirationRow[];
  selectedUsernamesSet: Set<string>;
  selectedEligibleCount: number;
  eligibleVisibleCount: number;
  onToggleSort: (field: SortField) => void;
  onToggleSelection: (username: string, selected: boolean) => void;
  onToggleAll: (selected: boolean) => void;
  onSend: (username: string) => void;
}

const SORT_HEADERS: Array<[string, SortField]> = [
  ["Status", "status"],
  ["User", "username"],
  ["Email", "email"],
  ["Last Set", "passwordLastSet"],
  ["Expires", "passwordExpiresAt"],
  ["Due", "days"],
];

export function PasswordExpirationReportTable({
  isLoading,
  isSending,
  rows,
  selectedUsernamesSet,
  selectedEligibleCount,
  eligibleVisibleCount,
  onToggleSort,
  onToggleSelection,
  onToggleAll,
  onSend,
}: Props) {
  return (
    <div className="rounded-md border overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <Checkbox
                checked={
                  rows.length > 0 &&
                  selectedEligibleCount === eligibleVisibleCount
                }
                onCheckedChange={(checked) => onToggleAll(Boolean(checked))}
                aria-label="Select all eligible visible rows"
              />
            </TableHead>
            {SORT_HEADERS.map(([label, field]) => (
              <TableHead key={field}>
                <button
                  className="font-semibold"
                  onClick={() => onToggleSort(field)}
                >
                  {label}
                </button>
              </TableHead>
            ))}
            <TableHead>Last Notice</TableHead>
            <TableHead className="text-right">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableBodyContent
            isLoading={isLoading}
            rows={rows}
            isSending={isSending}
            selectedUsernamesSet={selectedUsernamesSet}
            onToggleSelection={onToggleSelection}
            onSend={onSend}
          />
        </TableBody>
      </Table>
    </div>
  );
}

function TableBodyContent({
  isLoading,
  rows,
  isSending,
  selectedUsernamesSet,
  onToggleSelection,
  onSend,
}: Pick<
  Props,
  | "isLoading"
  | "rows"
  | "isSending"
  | "selectedUsernamesSet"
  | "onToggleSelection"
  | "onSend"
>) {
  if (isLoading)
    return <TableMessage>Loading password expiration report...</TableMessage>;
  if (rows.length === 0)
    return <TableMessage>No accounts match the current filters.</TableMessage>;
  return (
    <>
      {rows.map((row) => (
        <TableRow key={row.username}>
          <TableCell>
            <Checkbox
              checked={selectedUsernamesSet.has(row.username)}
              disabled={!row.eligibleForNotification}
              onCheckedChange={(checked) =>
                onToggleSelection(row.username, Boolean(checked))
              }
              aria-label={`Select ${row.username}`}
            />
          </TableCell>
          <TableCell>
            <Badge
              variant="outline"
              className={`capitalize ${statusBadgeClass(row.status)}`}
            >
              {formatStatus(row.status)}
            </Badge>
          </TableCell>
          <TableCell>
            <div className="font-medium text-foreground">{row.username}</div>
            <div className="text-xs text-muted-foreground">
              {row.displayName}
            </div>
          </TableCell>
          <TableCell>
            <div className="max-w-[220px] truncate text-sm">
              {row.email || "N/A"}
            </div>
            {row.skipReason && (
              <div className="text-xs text-red-600 dark:text-red-400">
                {row.skipReason.replace(/_/g, " ")}
              </div>
            )}
          </TableCell>
          <TableCell className="text-sm text-muted-foreground">
            <LocalDate value={row.passwordLastSet} />
          </TableCell>
          <TableCell className="text-sm text-muted-foreground">
            <LocalDate value={row.passwordExpiresAt} />
          </TableCell>
          <TableCell>
            <div className="text-sm font-medium">{dueText(row)}</div>
            <div
              className="text-xs text-muted-foreground max-w-[220px] truncate"
              title={row.detail}
            >
              {row.detail}
            </div>
          </TableCell>
          <TableCell>
            <div className="text-sm">
              <LocalDate value={row.lastNotificationAt} />
            </div>
            {row.lastNotificationStatus && (
              <div className="text-xs text-muted-foreground">
                {row.lastNotificationStatus}
              </div>
            )}
          </TableCell>
          <TableCell className="text-right">
            <Button
              variant="ghost"
              size="sm"
              disabled={!row.eligibleForNotification || isSending}
              onClick={() => onSend(row.username)}
              className="gap-2"
            >
              <Mail className="h-4 w-4" />
              Send
            </Button>
          </TableCell>
        </TableRow>
      ))}
    </>
  );
}

function LocalDate({ value }: { value: string | null }) {
  return value ? <ClientLocalDate value={value} /> : <>N/A</>;
}
function TableMessage({ children }: { children: string }) {
  return (
    <TableRow>
      <TableCell colSpan={9} className="h-24 text-center text-muted-foreground">
        {children}
      </TableCell>
    </TableRow>
  );
}
