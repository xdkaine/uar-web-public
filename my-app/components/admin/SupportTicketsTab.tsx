'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { renderSupportTicketsWorkspace } from './SupportTicketsWorkspace';
import { fetchWithCsrf } from '@/lib/csrf';
import { generateSupportTicketsCsv } from '@/lib/support-ticket-csv';
import { htmlToPlainText } from '@/lib/ticket-content';
import { useRouter } from 'next/navigation';
import { usePolling } from '@/hooks/usePolling';
import { useToast } from '@/hooks/useToast';

interface TicketResponse {
  id: string;
  message: string;
  author: string;
  isStaff: boolean;
  createdAt: string;
}

interface TicketStatusLog {
  id: string;
  createdAt: string;
  oldStatus: string | null;
  newStatus: string;
  changedBy: string;
  isStaff: boolean;
}

interface SupportTicket {
  id: string;
  subject: string;
  category: string | null;
  severity: string | null;
  body: string;
  status: string;
  username: string;
  displayName?: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  closedBy: string | null;
  responses: TicketResponse[];
  statusLogs: TicketStatusLog[];
  assignments?: Array<{ targetLabel: string }>;
  assignees?: string[];
  attachmentCount?: number;
}

interface SupportTicketsTabProps {
  tickets?: SupportTicket[];
  isLoading?: boolean;
}

type StatusFilter = 'all' | 'open' | 'in_progress' | 'closed';
type SeverityFilter = 'all' | 'critical' | 'high' | 'medium' | 'low';
type TicketSortField = 'createdAt' | 'updatedAt' | 'subject' | 'username' | 'status' | 'severity';

interface TicketFilterState {
  searchQuery: string;
  filterStatus: StatusFilter;
  filterSeverity: SeverityFilter;
  filterCategory: string;
  dateFrom: string;
  dateTo: string;
}

function filterSupportTickets(tickets: SupportTicket[], plainBodyById: Map<string, string>, filters: TicketFilterState): SupportTicket[] {
  const searchLower = filters.searchQuery.toLowerCase();
  const fromDate = filters.dateFrom ? new Date(filters.dateFrom) : null;
  const toDate = filters.dateTo ? new Date(`${filters.dateTo}T23:59:59`) : null;

  return tickets.filter((ticket) => {
    const bodyExcerpt = plainBodyById.get(ticket.id) ?? ticket.body;
    const matchesSearch = !filters.searchQuery || [ticket.id, ticket.subject, ticket.username, bodyExcerpt, ticket.category ?? '']
      .some((value) => value.toLowerCase().includes(searchLower));
    const ticketDate = new Date(ticket.createdAt);
    return matchesSearch
      && (filters.filterStatus === 'all' || ticket.status === filters.filterStatus)
      && (filters.filterSeverity === 'all' || ticket.severity === filters.filterSeverity)
      && (!filters.filterCategory || ticket.category === filters.filterCategory)
      && (!fromDate || ticketDate >= fromDate)
      && (!toDate || ticketDate <= toDate);
  });
}

function ticketSortValue(ticket: SupportTicket, field: TicketSortField): string | number {
  switch (field) {
    case 'createdAt': return new Date(ticket.createdAt).getTime();
    case 'updatedAt': return new Date(ticket.updatedAt).getTime();
    case 'subject': return ticket.subject.toLowerCase();
    case 'username': return ticket.username.toLowerCase();
    case 'status': return ticket.status.toLowerCase();
    case 'severity': return ticket.severity || '';
  }
}

function sortSupportTickets(tickets: SupportTicket[], field: TicketSortField, direction: 'asc' | 'desc'): SupportTicket[] {
  return [...tickets].sort((first, second) => {
    const firstValue = ticketSortValue(first, field);
    const secondValue = ticketSortValue(second, field);
    if (firstValue < secondValue) return direction === 'asc' ? -1 : 1;
    if (firstValue > secondValue) return direction === 'asc' ? 1 : -1;
    return 0;
  });
}

export default function SupportTicketsTab({ tickets: initialTickets, isLoading: initialLoading = true }: SupportTicketsTabProps) {
  const router = useRouter();
  const [selectedTicket, setSelectedTicket] = useState<SupportTicket | null>(null);
  const [submittingResponse, setSubmittingResponse] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<StatusFilter>('all');
  const [filterSeverity, setFilterSeverity] = useState<SeverityFilter>('all');
  const [filterCategory, setFilterCategory] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sortField, setSortField] = useState<TicketSortField>('createdAt');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

  const [tickets, setTickets] = useState<SupportTicket[]>(initialTickets ?? []);
  const [loading, setLoading] = useState(initialLoading);
  const { showToast } = useToast();

  useEffect(() => {
    if (initialTickets !== undefined) {
      setTickets(initialTickets);
    }
  }, [initialTickets]);

  useEffect(() => {
    setLoading(initialLoading);
  }, [initialLoading]);

  const fetchTickets = useCallback(async () => {
    const response = await fetchWithCsrf('/api/admin/support/tickets');
    if (!response.ok) throw new Error('Failed to fetch support tickets');
    return await response.json();
  }, []);

  const {
    isLoading: isPollingLoading,
    isPolling,
    togglePolling,
    refresh,
    lastUpdated
  } = usePolling(fetchTickets, {
    onSuccess: (data) => {
      setTickets(data.tickets || []);
      setLoading(false);
    },
    onError: (error) => {
      console.error('Error fetching support tickets:', error);
      setLoading(false);
    }
  });

  const handleAddResponse = async (ticketId: string, message: string) => {
    setSubmittingResponse(true);
    try {
      const response = await fetchWithCsrf(`/api/support/tickets/${ticketId}/responses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bodyHtml: message }),
      });

      if (!response.ok) throw new Error('Failed to add response');

      // Fetch updated ticket data for the modal
      const ticketResponse = await fetchWithCsrf(`/api/support/tickets/${ticketId}`);
      if (ticketResponse.ok) {
        const ticketData = await ticketResponse.json();
        setSelectedTicket(ticketData.ticket);
      }

      await refresh();
    } catch (error) {
      console.error('Error adding response:', error);
      showToast('Failed to add response', 'error');
    } finally {
      setSubmittingResponse(false);
    }
  };

  const handleUploadFiles = async (ticketId: string, files: File[]): Promise<boolean> => {
    if (files.length === 0) return false;
    try {
      const form = new FormData();
      for (const file of files) form.append('files', file);
      const response = await fetchWithCsrf(`/api/support/tickets/${ticketId}/attachments`, {
        method: 'POST',
        body: form,
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        showToast(data.error || 'Failed to attach pasted images', 'error');
        return false;
      }
      await refresh();
      return true;
    } catch {
      showToast('Failed to attach pasted images', 'error');
      return false;
    }
  };

  const handleUpdateStatus = async (ticketId: string, newStatus: string) => {
    setUpdatingStatus(true);
    try {
      const response = await fetchWithCsrf(`/api/support/tickets/${ticketId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });

      if (!response.ok) throw new Error('Failed to update status');

      // Fetch updated ticket data for the modal
      const ticketResponse = await fetchWithCsrf(`/api/support/tickets/${ticketId}`);
      if (ticketResponse.ok) {
        const ticketData = await ticketResponse.json();
        setSelectedTicket(ticketData.ticket);
      }

      await refresh();
    } catch (error) {
      console.error('Error updating status:', error);
      showToast('Failed to update status', 'error');
    } finally {
      setUpdatingStatus(false);
    }
  };

  // Extract unique categories
  const availableCategories = useMemo(() => {
    const categorySet = new Set<string>();
    tickets.forEach(ticket => {
      if (ticket.category) {
        categorySet.add(ticket.category);
      }
    });
    return Array.from(categorySet).sort();
  }, [tickets]);

  // Export filtered tickets to CSV
  const exportToCSV = () => {
    const csvContent = generateSupportTicketsCsv(filteredTickets);

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `support_tickets_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    try {
      link.click();
    } finally {
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 0);
    }
  };

  // Filter tickets
  const plainBodyById = useMemo(() => {
    const map = new Map<string, string>();
    tickets.forEach(ticket => {
      map.set(ticket.id, htmlToPlainText(ticket.body));
    });
    return map;
  }, [tickets]);

  const filteredTickets = filterSupportTickets(tickets, plainBodyById, {
    searchQuery,
    filterStatus,
    filterSeverity,
    filterCategory,
    dateFrom,
    dateTo,
  });
  const sortedTickets = sortSupportTickets(filteredTickets, sortField, sortDirection);

  const totalPages = Math.ceil(sortedTickets.length / pageSize);
  const paginatedTickets = sortedTickets.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  const handleSort = (field: typeof sortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  if (loading) {
    return (
      <div className="bg-card p-6 sm:p-8 rounded-lg shadow-xl border-2 border-border text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-black mx-auto"></div>
        <p className="mt-4 text-muted-foreground">Loading support tickets...</p>
      </div>
    );
  }

  const totalTickets = tickets.length;
  const openTickets = tickets.filter(t => t.status === 'open').length;
  const inProgressTickets = tickets.filter(t => t.status === 'in_progress').length;
  const closedTickets = tickets.filter(t => t.status === 'closed').length;

  return renderSupportTicketsWorkspace({
    selectedTicket, setSelectedTicket, submittingResponse, updatingStatus, tickets, lastUpdated,
    isPolling, togglePolling, refresh, isPollingLoading, filteredTickets, searchQuery,
    setSearchQuery, setCurrentPage, exportToCSV, showAdvancedFilters, setShowAdvancedFilters,
    filterStatus, filterSeverity, filterCategory, dateFrom, dateTo, setFilterStatus,
    setFilterSeverity, setFilterCategory, setDateFrom, setDateTo, availableCategories,
    pageSize, setPageSize, paginatedTickets, handleSort, sortField, sortDirection, router,
    totalPages, currentPage, sortedTickets, totalTickets, openTickets, inProgressTickets, closedTickets,
    handleAddResponse, handleUpdateStatus, handleUploadFiles,
  });
}
