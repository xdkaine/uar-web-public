'use client';

import type { ReactNode } from 'react';
import { ArrowUpDown, ChevronLeft, ChevronRight, MessageSquare, Users } from 'lucide-react';

import TicketPeek from '@/components/support/TicketPeek';
import { LocalizedRelativeTime } from '@/components/support/LocalizedDateTime';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ticketCategoryLabel } from '@/lib/support/ticket-categories';
import { cn } from '@/lib/utils';

import type { Ticket } from './TicketsClient';

export type SortField = 'createdAt' | 'updatedAt' | 'subject' | 'status' | 'severity';

interface SortHeadProps {
  field: SortField;
  currentField: SortField;
  direction: 'asc' | 'desc';
  onSort: (field: SortField) => void;
  children: ReactNode;
  className?: string;
}

function SortHead({ field, currentField, direction, onSort, children, className }: SortHeadProps) {
  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => onSort(field)}
        className={cn(
          'inline-flex items-center gap-1 font-semibold transition-colors hover:text-foreground',
          currentField === field ? 'text-foreground' : 'text-muted-foreground'
        )}
      >
        {children}
        {currentField === field && <span>{direction === 'asc' ? '↑' : '↓'}</span>}
      </button>
    </TableHead>
  );
}

function severityClasses(severity: string | null): string {
  switch (severity) {
    case 'critical':
      return 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400';
    case 'high':
      return 'border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-400';
    case 'medium':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400';
    case 'low':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400';
    default:
      return 'border-border bg-muted text-muted-foreground';
  }
}

function statusClasses(status: string): string {
  switch (status) {
    case 'open':
      return 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-400';
    case 'in_progress':
      return 'border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-400';
    default:
      return 'border-border bg-muted text-muted-foreground';
  }
}

function formatStatus(status: string): string {
  return status.replace('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

interface TicketsListTableProps {
  direction: 'asc' | 'desc';
  pageSize: number;
  paginatedTickets: Ticket[];
  safePage: number;
  sortField: SortField;
  sortedTicketCount: number;
  totalPages: number;
  onOpenTicket: (ticketId: string) => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  onSort: (field: SortField) => void;
}

export default function TicketsListTable({
  direction,
  pageSize,
  paginatedTickets,
  safePage,
  sortField,
  sortedTicketCount,
  totalPages,
  onOpenTicket,
  onPageChange,
  onPageSizeChange,
  onSort,
}: TicketsListTableProps) {
  return (
    <>
      <Table>
        <TableHeader>
          <TableRow className="border-b border-border bg-muted/40 hover:bg-muted/40">
            <TableHead className="w-[110px] pl-5 text-muted-foreground">ID</TableHead>
            <SortHead field="subject" currentField={sortField} direction={direction} onSort={onSort}>Subject</SortHead>
            <TableHead className="hidden w-[140px] text-muted-foreground md:table-cell">Category</TableHead>
            <SortHead field="status" currentField={sortField} direction={direction} onSort={onSort} className="w-[120px]">Status</SortHead>
            <SortHead field="severity" currentField={sortField} direction={direction} onSort={onSort} className="w-[110px]">Severity</SortHead>
            <TableHead className="hidden w-[150px] text-muted-foreground lg:table-cell">Activity</TableHead>
            <SortHead field="createdAt" currentField={sortField} direction={direction} onSort={onSort} className="w-[130px]">Created</SortHead>
            <TableHead className="w-[90px] pr-5 text-right text-muted-foreground">
              <ArrowUpDown className="ml-auto h-3.5 w-3.5" />
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {paginatedTickets.map((ticket) => {
            const lastActivity = ticket.responses.length
              ? ticket.responses[ticket.responses.length - 1].createdAt
              : ticket.updatedAt;
            const staffReplied = ticket.responses.some((response) => response.isStaff);
            return (
              <TableRow
                key={ticket.id}
                tabIndex={0}
                onClick={() => onOpenTicket(ticket.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') onOpenTicket(ticket.id);
                }}
                className="cursor-pointer transition-colors hover:bg-accent/40 focus-visible:bg-accent/40"
              >
                <TableCell className="py-3 pl-5 font-mono text-xs text-muted-foreground">
                  {ticket.id.slice(0, 8)}
                </TableCell>
                <TableCell className="max-w-md py-3">
                  <TicketPeek ticket={ticket} href={`/support/tickets/${ticket.id}`} showAssignees={false} />
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    {ticket.isOwn === false && (
                      <span className="inline-flex items-center gap-1 rounded bg-indigo-500/10 px-1.5 py-0.5 text-xs font-medium text-indigo-700 dark:text-indigo-300">
                        <Users className="h-3 w-3" /> Group queue
                      </span>
                    )}
                    {staffReplied && (
                      <span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                        <MessageSquare className="h-3 w-3" /> Staff replied
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                  {ticket.category ? ticketCategoryLabel(ticket.category) : '—'}
                </TableCell>
                <TableCell className="py-3">
                  <span className={cn('inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium', statusClasses(ticket.status))}>
                    {formatStatus(ticket.status)}
                  </span>
                </TableCell>
                <TableCell className="py-3">
                  <span className={cn('inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold uppercase tracking-wide', severityClasses(ticket.severity))}>
                    {ticket.severity ?? '—'}
                  </span>
                </TableCell>
                <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
                  <span className="inline-flex items-center gap-1.5">
                    <MessageSquare className="h-3.5 w-3.5" />
                    {ticket.responses.length}
                    <span className="text-border">|</span>
                    <LocalizedRelativeTime value={lastActivity} />
                  </span>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  <LocalizedRelativeTime value={ticket.createdAt} />
                </TableCell>
                <TableCell className="pr-5 text-right">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenTicket(ticket.id);
                    }}
                  >
                    Open
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      {sortedTicketCount > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3">
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span>{sortedTicketCount} ticket{sortedTicketCount !== 1 ? 's' : ''}</span>
            <Select value={String(pageSize)} onValueChange={(value) => onPageSizeChange(Number(value))}>
              <SelectTrigger className="h-8 w-[110px] bg-card text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="10">10 per page</SelectItem>
                <SelectItem value="25">25 per page</SelectItem>
                <SelectItem value="50">50 per page</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onPageChange(Math.max(1, safePage - 1))}
                disabled={safePage === 1}
              >
                <ChevronLeft className="h-4 w-4" />
                Previous
              </Button>
              <span className="text-sm text-muted-foreground">Page {safePage} of {totalPages}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onPageChange(Math.min(totalPages, safePage + 1))}
                disabled={safePage === totalPages}
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
