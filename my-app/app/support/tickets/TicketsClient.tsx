'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import * as m from 'framer-motion/m';
import PortalPageHeading from '@/components/appearance/PortalPageHeading';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';

import TicketsListEmptyState from './TicketsListEmptyState';
import TicketsListFilters, { type SeverityFilter, type StatusFilter } from './TicketsListFilters';
import TicketsListTable, { type SortField } from './TicketsListTable';

export interface Ticket {
  id: string;
  subject: string;
  category: string | null;
  severity: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  body: string;
  username: string;
  displayName?: string;
  attachmentCount?: number;
  isOwn?: boolean;
  responses: Array<{
    id: string;
    message: string;
    author: string;
    isStaff: boolean;
    createdAt: string;
  }>;
}

const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

interface TicketsClientProps {
  tickets: Ticket[];
  loadError: string;
}

export default function TicketsClient({ tickets, loadError }: TicketsClientProps) {
  const router = useRouter();
  // Filters and sorting
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<StatusFilter>('all');
  const [filterSeverity, setFilterSeverity] = useState<SeverityFilter>('all');
  const [filterCategory, setFilterCategory] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sortField, setSortField] = useState<SortField>('createdAt');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  const availableCategories = useMemo(() => {
    const categorySet = new Set<string>();
    tickets.forEach(ticket => {
      if (ticket.category) {
        categorySet.add(ticket.category);
      }
    });
    return Array.from(categorySet).sort();
  }, [tickets]);

  const counts = useMemo(
    () => ({
      all: tickets.length,
      open: tickets.filter(t => t.status === 'open').length,
      in_progress: tickets.filter(t => t.status === 'in_progress').length,
      closed: tickets.filter(t => t.status === 'closed').length,
    }),
    [tickets]
  );

  const hasActiveFilters =
    !!searchQuery ||
    filterStatus !== 'all' ||
    filterSeverity !== 'all' ||
    filterCategory !== 'all';

  const filteredTickets = useMemo(() => tickets.filter(ticket => {
    const searchLower = searchQuery.toLowerCase();
    const matchesSearch = !searchQuery || (
      ticket.id.toLowerCase().includes(searchLower) ||
      ticket.subject.toLowerCase().includes(searchLower) ||
      (ticket.category && ticket.category.toLowerCase().includes(searchLower))
    );

    const matchesStatus = filterStatus === 'all' || ticket.status === filterStatus;
    const matchesSeverity = filterSeverity === 'all' || ticket.severity === filterSeverity;
    const matchesCategory = filterCategory === 'all' || ticket.category === filterCategory;

    return matchesSearch && matchesStatus && matchesSeverity && matchesCategory;
  }), [tickets, searchQuery, filterStatus, filterSeverity, filterCategory]);

  const sortedTickets = useMemo(() => [...filteredTickets].sort((a, b) => {
    let cmp = 0;
    switch (sortField) {
      case 'createdAt':
        cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        break;
      case 'updatedAt':
        cmp = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
        break;
      case 'subject':
        cmp = a.subject.toLowerCase().localeCompare(b.subject.toLowerCase());
        break;
      case 'status':
        cmp = a.status.toLowerCase().localeCompare(b.status.toLowerCase());
        break;
      case 'severity': {
        const aRank = SEVERITY_ORDER[a.severity ?? ''] ?? 99;
        const bRank = SEVERITY_ORDER[b.severity ?? ''] ?? 99;
        cmp = aRank - bRank;
        break;
      }
    }
    return sortDirection === 'asc' ? cmp : -cmp;
  }), [filteredTickets, sortField, sortDirection]);

  const totalPages = Math.max(1, Math.ceil(sortedTickets.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedTickets = sortedTickets.slice(
    (safePage - 1) * pageSize,
    safePage * pageSize
  );

  const handleSort = (field: typeof sortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection(field === 'severity' || field === 'createdAt' ? 'desc' : 'asc');
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-none px-4 py-8 sm:px-6 lg:px-10">
        {/* Header */}
        <m.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="mb-6 flex flex-wrap items-center justify-between gap-4"
        >
          <PortalPageHeading
            page="supportTickets"
            action={<Button onClick={() => router.push('/support/create')}><Plus className="mr-2 h-4 w-4" />New Ticket</Button>}
          />
        </m.div>

        {loadError && (
          <div className="mb-6 rounded-lg border border-destructive/40 bg-destructive/10 p-4">
            <p className="text-sm text-destructive">{loadError}</p>
          </div>
        )}

        {/* Toolbar: quick views + search */}
        <m.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.05 }}
          className="mb-4 space-y-3"
        >
          <TicketsListFilters
            availableCategories={availableCategories}
            counts={counts}
            filterCategory={filterCategory}
            filterSeverity={filterSeverity}
            filterStatus={filterStatus}
            hasActiveFilters={hasActiveFilters}
            searchQuery={searchQuery}
            onCategoryChange={(value) => {
              setFilterCategory(value);
              setCurrentPage(1);
            }}
            onClear={() => {
              setSearchQuery('');
              setFilterStatus('all');
              setFilterSeverity('all');
              setFilterCategory('all');
              setCurrentPage(1);
            }}
            onSearchChange={(value) => {
              setSearchQuery(value);
              setCurrentPage(1);
            }}
            onSeverityChange={(value) => {
              setFilterSeverity(value);
              setCurrentPage(1);
            }}
            onStatusChange={(value) => {
              setFilterStatus(value);
              setCurrentPage(1);
            }}
          />
        </m.div>

        {/* Queue table */}
        <m.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1 }}
          className="overflow-hidden rounded-xl border border-border bg-card shadow-sm"
        >
          {paginatedTickets.length === 0 ? (
            <TicketsListEmptyState
              hasTickets={tickets.length > 0}
              onCreateTicket={() => router.push('/support/create')}
            />
          ) : (
            <TicketsListTable
              direction={sortDirection}
              pageSize={pageSize}
              paginatedTickets={paginatedTickets}
              safePage={safePage}
              sortField={sortField}
              sortedTicketCount={sortedTickets.length}
              totalPages={totalPages}
              onOpenTicket={(ticketId) => router.push(`/support/tickets/${ticketId}`)}
              onPageChange={setCurrentPage}
              onPageSizeChange={(value) => {
                setPageSize(value);
                setCurrentPage(1);
              }}
              onSort={handleSort}
            />
          )}
        </m.div>
      </div>
    </div>
  );
}
