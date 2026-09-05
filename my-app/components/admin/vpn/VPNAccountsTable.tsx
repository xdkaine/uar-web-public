"use client";

import { Button } from "@/components/ui/button";
import { ClientLocalDate } from "@/components/admin/ClientLocalDate";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AlertTriangle, Check } from "lucide-react";
import { getPortalBadge, getStatusBadge } from "./vpnBadgePresentation";
import type { VPNAccount } from "./vpnManagementTypes";
export type { VPNAccount } from "./vpnManagementTypes";

type VPNSortField = "username" | "name" | "email" | "createdAt" | "expiresAt";

function SortIndicator({
  field,
  sortField,
  sortDirection,
}: {
  field: VPNSortField;
  sortField: VPNSortField;
  sortDirection: "asc" | "desc";
}) {
  if (sortField !== field) {
    return <span className="text-muted-foreground">↕</span>;
  }
  return <span>{sortDirection === "asc" ? "↑" : "↓"}</span>;
}

function displayText(value: string | null | undefined, fallback = "-"): string {
  return value?.trim() || fallback;
}

interface VPNAccountsTableProps {
  accounts: VPNAccount[];
  title?: string;
  titleColor?: string;
  selectedIds: Set<string>;
  onToggleSelection: (id: string) => void;
  onToggleAllSelection: (checked: boolean) => void;
  onViewAccount: (accountId: string) => void;
  onManageAccount?: (account: VPNAccount) => void;
  sortField: VPNSortField;
  sortDirection: "asc" | "desc";
  onSort: (field: VPNSortField) => void;
  isLoading?: boolean;
}

export default function VPNAccountsTable({
  accounts: accountsList,
  title,
  titleColor: color,
  selectedIds: selectedAccountIds,
  onToggleSelection: toggleAccountSelection,
  onToggleAllSelection,
  onViewAccount,
  onManageAccount,
  sortField,
  sortDirection,
  onSort: handleSort,
  isLoading = false,
}: VPNAccountsTableProps) {
  if (isLoading) {
    return (
      <div className="rounded-md border bg-card animate-pulse">
        <div className="h-12 bg-muted rounded-t-md"></div>
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-14 border-t bg-muted/50"></div>
        ))}
      </div>
    );
  }

  if (accountsList.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-8">
        {title ? `No ${title.toLowerCase()} accounts` : "No accounts found"}
      </div>
    );
  }

  return (
    <div className={title ? "mb-8" : ""}>
      {title && (
        <h3 className={`text-lg font-bold mb-4 ${color}`}>
          {title} ({accountsList.length})
        </h3>
      )}
      <div className="rounded-md border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[50px]">
                <Checkbox
                  checked={accountsList.every((a: VPNAccount) =>
                    selectedAccountIds.has(a.id),
                  )}
                  onCheckedChange={(checked) =>
                    onToggleAllSelection(Boolean(checked))
                  }
                  aria-label="Select all"
                />
              </TableHead>
              <TableHead
                className="cursor-pointer hover:bg-muted"
                onClick={() => handleSort("username")}
              >
                <div className="flex items-center gap-1">
                  Username{" "}
                  <SortIndicator
                    field="username"
                    sortField={sortField}
                    sortDirection={sortDirection}
                  />
                </div>
              </TableHead>
              <TableHead
                className="cursor-pointer hover:bg-muted"
                onClick={() => handleSort("name")}
              >
                <div className="flex items-center gap-1">
                  Name{" "}
                  <SortIndicator
                    field="name"
                    sortField={sortField}
                    sortDirection={sortDirection}
                  />
                </div>
              </TableHead>
              <TableHead
                className="cursor-pointer hover:bg-muted"
                onClick={() => handleSort("email")}
              >
                <div className="flex items-center gap-1">
                  Email{" "}
                  <SortIndicator
                    field="email"
                    sortField={sortField}
                    sortDirection={sortDirection}
                  />
                </div>
              </TableHead>
              {!title && <TableHead>Portal</TableHead>}
              <TableHead>Status</TableHead>
              <TableHead
                className="cursor-pointer hover:bg-muted"
                onClick={() => handleSort("createdAt")}
              >
                <div className="flex items-center gap-1">
                  Created{" "}
                  <SortIndicator
                    field="createdAt"
                    sortField={sortField}
                    sortDirection={sortDirection}
                  />
                </div>
              </TableHead>
              <TableHead
                className="cursor-pointer hover:bg-muted"
                onClick={() => handleSort("expiresAt")}
              >
                <div className="flex items-center gap-1">
                  Expires{" "}
                  <SortIndicator
                    field="expiresAt"
                    sortField={sortField}
                    sortDirection={sortDirection}
                  />
                </div>
              </TableHead>
              <TableHead>Faculty</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {accountsList.map((account) => (
              <TableRow
                key={account.id}
                className={
                  selectedAccountIds.has(account.id)
                    ? "bg-blue-50 dark:bg-blue-950/40 hover:bg-blue-100"
                    : ""
                }
              >
                <TableCell>
                  <Checkbox
                    checked={selectedAccountIds.has(account.id)}
                    onCheckedChange={() => toggleAccountSelection(account.id)}
                    onClick={(e) => e.stopPropagation()}
                    aria-label={`Select ${account.username}`}
                  />
                </TableCell>
                <TableCell
                  className="font-semibold font-mono cursor-pointer"
                  onClick={() => onViewAccount(account.id)}
                >
                  {account.username}
                </TableCell>
                <TableCell
                  className="cursor-pointer"
                  onClick={() => onViewAccount(account.id)}
                >
                  {account.name}
                </TableCell>
                <TableCell
                  className="cursor-pointer"
                  onClick={() => onViewAccount(account.id)}
                >
                  {displayText(account.email)}
                </TableCell>
                {!title && (
                  <TableCell
                    className="cursor-pointer"
                    onClick={() => onViewAccount(account.id)}
                  >
                    {getPortalBadge(account.portalType)}
                  </TableCell>
                )}
                <TableCell
                  className="cursor-pointer"
                  onClick={() => onViewAccount(account.id)}
                >
                  {getStatusBadge(account.status)}
                </TableCell>
                <TableCell
                  className="cursor-pointer"
                  onClick={() => onViewAccount(account.id)}
                >
                  <div><ClientLocalDate value={account.createdAt} format="date" /></div>
                  <div className="text-xs text-muted-foreground">
                    by {account.createdBy}
                  </div>
                </TableCell>
                <TableCell
                  className="cursor-pointer"
                  onClick={() => onViewAccount(account.id)}
                >
                  {account.expiresAt
                    ? <ClientLocalDate value={account.expiresAt} format="date" />
                    : "N/A"}
                </TableCell>
                <TableCell
                  className="cursor-pointer"
                  onClick={() => onViewAccount(account.id)}
                >
                  {account.createdByFaculty ? (
                    <span className="text-green-600 dark:text-green-400 font-semibold flex items-center gap-1">
                      <Check className="w-4 h-4" /> Approved
                    </span>
                  ) : (
                    <span className="text-yellow-600 dark:text-yellow-400 flex items-center gap-1">
                      <AlertTriangle className="w-4 h-4" /> Pending
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <Button
                    variant="link"
                    className="h-auto p-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (onManageAccount) onManageAccount(account);
                      else onViewAccount(account.id);
                    }}
                  >
                    {onManageAccount ? "Manage" : "View"}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
