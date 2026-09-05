"use client";

import {
  Ban,
  Edit,
  ExternalLink,
  Power,
  PowerOff,
  Search,
  Trash2,
} from "lucide-react";
import { ClientLocalDate } from "./ClientLocalDate";
import type { BlockedEmail, BlocklistFilterStatus } from "./blocklistTypes";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface Props {
  blockedEmails: BlockedEmail[];
  filteredEmails: BlockedEmail[];
  filterStatus: BlocklistFilterStatus;
  searchQuery: string;
  onFilterStatusChange: (status: BlocklistFilterStatus) => void;
  onSearchChange: (value: string) => void;
  onAdd: () => void;
  onEdit: (block: BlockedEmail) => void;
  onToggleActive: (block: BlockedEmail) => void;
  onDelete: (id: string) => void;
}

export function BlocklistWorkspace({
  blockedEmails,
  filteredEmails,
  filterStatus,
  searchQuery,
  onFilterStatusChange,
  onSearchChange,
  onAdd,
  onEdit,
  onToggleActive,
  onDelete,
}: Props) {
  const activeBlocked = blockedEmails.filter((block) => block.isActive).length;
  const inactiveBlocked = blockedEmails.length - activeBlocked;

  return (
    <>
      <BlocklistSummary
        total={blockedEmails.length}
        active={activeBlocked}
        inactive={inactiveBlocked}
      />
      <div className="flex gap-2 mb-4 sm:mb-6 flex-wrap">
        {(["all", "active", "inactive"] as const).map((status) => (
          <Button
            key={status}
            variant={filterStatus === status ? "default" : "outline"}
            onClick={() => onFilterStatusChange(status)}
            className="capitalize"
          >
            {status}
          </Button>
        ))}
        <div className="relative flex-1 min-w-[200px]">
          <Input
            type="text"
            placeholder="Search emails, reasons, or notes..."
            value={searchQuery}
            onChange={(event) => onSearchChange(event.target.value)}
            className="pl-9"
          />
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        </div>
        <Button
          onClick={onAdd}
          className="bg-red-600 hover:bg-red-700 text-white gap-2"
        >
          <Ban className="h-4 w-4" />
          Block Email
        </Button>
      </div>
      <BlocklistTable
        blocks={filteredEmails}
        filterStatus={filterStatus}
        onEdit={onEdit}
        onToggleActive={onToggleActive}
        onDelete={onDelete}
      />
    </>
  );
}

function BlocklistSummary({
  total,
  active,
  inactive,
}: {
  total: number;
  active: number;
  inactive: number;
}) {
  const cards = [
    ["Total Blocked", total, "text-foreground"],
    ["Active Blocks", active, "text-red-500"],
    ["Inactive Blocks", inactive, "text-muted-foreground"],
  ] as const;
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4 mb-6 sm:mb-8">
      {cards.map(([label, value, color]) => (
        <Card key={label}>
          <CardContent className="p-4 sm:p-6">
            <div className="text-muted-foreground text-xs sm:text-sm font-medium">
              {label}
            </div>
            <div className={`text-2xl sm:text-3xl font-bold mt-2 ${color}`}>
              {value}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function BlocklistTable({
  blocks,
  filterStatus,
  onEdit,
  onToggleActive,
  onDelete,
}: {
  blocks: BlockedEmail[];
  filterStatus: BlocklistFilterStatus;
  onEdit: (block: BlockedEmail) => void;
  onToggleActive: (block: BlockedEmail) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="bg-card rounded-lg overflow-hidden shadow-xl border-2 border-border">
      {blocks.length === 0 ? (
        <div className="p-6 sm:p-8 text-center text-muted-foreground">
          No {filterStatus !== "all" ? filterStatus : ""} blocked emails found
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead>Blocked By</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {blocks.map((block) => (
                <TableRow key={block.id} className="hover:bg-muted/50">
                  <TableCell className="font-medium text-foreground">
                    {block.email}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {block.reason}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {block.notes || "-"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {block.blockedBy}
                    <br />
                    <span className="text-xs text-muted-foreground">
                      <ClientLocalDate value={block.createdAt} format="date" />
                    </span>
                  </TableCell>
                  <TableCell>
                    <span
                      className={`px-3 py-1 rounded-full text-xs font-semibold ${block.isActive ? "bg-red-100 dark:bg-red-950/60 text-red-800" : "bg-muted text-foreground"}`}
                    >
                      {block.isActive ? "Active" : "Inactive"}
                    </span>
                  </TableCell>
                  <TableCell>
                    <BlockActions
                      block={block}
                      onEdit={onEdit}
                      onToggleActive={onToggleActive}
                      onDelete={onDelete}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function BlockActions({
  block,
  onEdit,
  onToggleActive,
  onDelete,
}: {
  block: BlockedEmail;
  onEdit: (block: BlockedEmail) => void;
  onToggleActive: (block: BlockedEmail) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onEdit(block)}
        className="text-blue-600 dark:text-blue-400 hover:text-blue-800 hover:bg-blue-50 dark:bg-blue-950/40"
      >
        <Edit className="h-4 w-4 mr-1" />
        Edit
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onToggleActive(block)}
        className={
          block.isActive
            ? "text-yellow-600 dark:text-yellow-400 hover:text-yellow-800 hover:bg-yellow-50 dark:bg-yellow-950/40"
            : "text-green-600 dark:text-green-400 hover:text-green-800 hover:bg-green-50 dark:bg-green-950/40"
        }
      >
        {block.isActive ? (
          <>
            <PowerOff className="h-4 w-4 mr-1" />
            Deactivate
          </>
        ) : (
          <>
            <Power className="h-4 w-4 mr-1" />
            Reactivate
          </>
        )}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onDelete(block.id)}
        className="text-red-600 dark:text-red-400 hover:text-red-800 hover:bg-red-50 dark:bg-red-950/40"
      >
        <Trash2 className="h-4 w-4 mr-1" />
        Delete
      </Button>
      {block.linkedTicketId && (
        <Button
          variant="ghost"
          size="sm"
          asChild
          className="text-purple-600 dark:text-purple-400 hover:text-purple-800 hover:bg-purple-50 dark:bg-purple-950/40"
        >
          <a href={`/admin#ticket-${block.linkedTicketId}`}>
            <ExternalLink className="h-4 w-4 mr-1" />
            Ticket
          </a>
        </Button>
      )}
    </div>
  );
}
