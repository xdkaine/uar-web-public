'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import TicketDetailModal from './TicketDetailModal';
import { fetchWithCsrf } from '@/lib/csrf';
import { useRouter } from 'next/navigation';
import { usePolling } from '@/hooks/usePolling';
import { useToast } from '@/hooks/useToast';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  FileText,
  Download,
  Filter,
  X,
  Search,
  RefreshCw,
  Play,
  Pause
} from "lucide-react";

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
}

interface SupportTicketsTabProps {
  tickets?: SupportTicket[];
  isLoading?: boolean;
}

type StatusFilter = 'all' | 'open' | 'in_progress' | 'closed';
type SeverityFilter = 'all' | 'critical' | 'high' | 'medium' | 'low';

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
  const [sortField, setSortField] = useState<'createdAt' | 'updatedAt' | 'subject' | 'username' | 'status' | 'severity'>('createdAt');
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
    data: polledData,
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
        body: JSON.stringify({ message }),
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
    const headers = ['ID', 'Subject', 'Username', 'Category', 'Severity', 'Status', 'Responses', 'Created', 'Updated', 'Closed'];
    const csvData = filteredTickets.map(ticket => [
      ticket.id,
      ticket.subject,
      ticket.username,
      ticket.category || '',
      ticket.severity || '',
      ticket.status,
      ticket.responses.length.toString(),
      new Date(ticket.createdAt).toLocaleDateString(),
      new Date(ticket.updatedAt).toLocaleDateString(),
      ticket.closedAt ? new Date(ticket.closedAt).toLocaleDateString() : ''
    ]);

    const csvContent = [
      headers.join(','),
      ...csvData.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `support_tickets_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Filter tickets
  const filteredTickets = tickets.filter(ticket => {
    // Text search filter
    const searchLower = searchQuery.toLowerCase();
    const matchesSearch = !searchQuery || (
      ticket.id.toLowerCase().includes(searchLower) ||
      ticket.subject.toLowerCase().includes(searchLower) ||
      ticket.username.toLowerCase().includes(searchLower) ||
      ticket.body.toLowerCase().includes(searchLower) ||
      (ticket.category && ticket.category.toLowerCase().includes(searchLower))
    );

    // Status filter
    const matchesStatus = filterStatus === 'all' || ticket.status === filterStatus;

    // Severity filter
    const matchesSeverity = filterSeverity === 'all' || ticket.severity === filterSeverity;

    // Category filter
    const matchesCategory = !filterCategory || ticket.category === filterCategory;

    // Date filters
    const ticketDate = new Date(ticket.createdAt);
    const matchesDateFrom = !dateFrom || ticketDate >= new Date(dateFrom);
    const matchesDateTo = !dateTo || ticketDate <= new Date(dateTo + 'T23:59:59');

    return matchesSearch && matchesStatus && matchesSeverity && matchesCategory && matchesDateFrom && matchesDateTo;
  });

  // Sort tickets
  const sortedTickets = [...filteredTickets].sort((a, b) => {
    let aValue: string | number = '';
    let bValue: string | number = '';

    switch (sortField) {
      case 'createdAt':
        aValue = new Date(a.createdAt).getTime();
        bValue = new Date(b.createdAt).getTime();
        break;
      case 'updatedAt':
        aValue = new Date(a.updatedAt).getTime();
        bValue = new Date(b.updatedAt).getTime();
        break;
      case 'subject':
        aValue = a.subject.toLowerCase();
        bValue = b.subject.toLowerCase();
        break;
      case 'username':
        aValue = a.username.toLowerCase();
        bValue = b.username.toLowerCase();
        break;
      case 'status':
        aValue = a.status.toLowerCase();
        bValue = b.status.toLowerCase();
        break;
      case 'severity':
        aValue = a.severity || '';
        bValue = b.severity || '';
        break;
    }

    if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
    if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
    return 0;
  });

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

  const getSeverityColor = (severity: string | null) => {
    if (!severity) return 'bg-gray-100 text-gray-800';
    switch (severity) {
      case 'critical': return 'bg-red-100 text-red-800';
      case 'high': return 'bg-orange-100 text-orange-800';
      case 'medium': return 'bg-yellow-100 text-yellow-800';
      case 'low': return 'bg-green-100 text-green-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'open': return 'bg-blue-100 text-blue-800';
      case 'in_progress': return 'bg-purple-100 text-purple-800';
      case 'closed': return 'bg-gray-100 text-gray-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const formatStatus = (status: string) => {
    return status.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  if (loading) {
    return (
      <div className="bg-white p-6 sm:p-8 rounded-lg shadow-xl border-2 border-gray-200 text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-black mx-auto"></div>
        <p className="mt-4 text-gray-600">Loading support tickets...</p>
      </div>
    );
  }

  const totalTickets = tickets.length;
  const openTickets = tickets.filter(t => t.status === 'open').length;
  const inProgressTickets = tickets.filter(t => t.status === 'in_progress').length;
  const closedTickets = tickets.filter(t => t.status === 'closed').length;

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mb-6 sm:mb-8">
        <div className="bg-white p-4 sm:p-6 rounded-lg shadow-lg border-2 border-gray-200">
          <div className="text-gray-600 text-xs sm:text-sm font-medium">Total Tickets</div>
          <div className="text-2xl sm:text-3xl font-bold text-gray-900 mt-2">{totalTickets}</div>
        </div>
        <div className="bg-white p-4 sm:p-6 rounded-lg shadow-lg border-2 border-gray-200">
          <div className="text-gray-600 text-xs sm:text-sm font-medium">Open</div>
          <div className="text-2xl sm:text-3xl font-bold text-blue-500 mt-2">{openTickets}</div>
        </div>
        <div className="bg-white p-4 sm:p-6 rounded-lg shadow-lg border-2 border-gray-200">
          <div className="text-gray-600 text-xs sm:text-sm font-medium">In Progress</div>
          <div className="text-2xl sm:text-3xl font-bold text-purple-500 mt-2">{inProgressTickets}</div>
        </div>
        <div className="bg-white p-4 sm:p-6 rounded-lg shadow-lg border-2 border-gray-200">
          <div className="text-gray-600 text-xs sm:text-sm font-medium">Closed</div>
          <div className="text-2xl sm:text-3xl font-bold text-gray-600 mt-2">{closedTickets}</div>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row justify-end items-start sm:items-center gap-4 mb-4">
        <div className="flex items-center gap-2 text-sm text-gray-500">
          {lastUpdated && (
            <span>Updated: {lastUpdated.toLocaleTimeString()}</span>
          )}
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={togglePolling}
            className={`gap-2 ${isPolling ? 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100' : 'bg-gray-50 text-gray-700'}`}
          >
            <div className={`w-2 h-2 rounded-full ${isPolling ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
            {isPolling ? 'Live Updates On' : 'Live Updates Off'}
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => refresh()}
            disabled={isPollingLoading}
            className="gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${isPollingLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      <Card className="mb-4">
        <CardContent className="p-6">
          <div className="flex flex-wrap gap-6 text-sm mb-6">
            <div>
              <span className="font-semibold text-gray-700">Total:</span>
              <span className="ml-2 text-gray-900 font-bold">{tickets.length}</span>
            </div>
            <div>
              <span className="font-semibold text-gray-700">Filtered:</span>
              <span className="ml-2 text-blue-600 font-bold">{filteredTickets.length}</span>
            </div>
            <div>
              <span className="font-semibold text-gray-700">Critical:</span>
              <span className="ml-2 text-red-600 font-bold">{tickets.filter(t => t.severity === 'critical').length}</span>
            </div>
            <div>
              <span className="font-semibold text-gray-700">High:</span>
              <span className="ml-2 text-orange-600 font-bold">{tickets.filter(t => t.severity === 'high').length}</span>
            </div>
          </div>

          <div className="flex flex-col md:flex-row gap-3 mb-4">
            <div className="flex-1 relative">
              <Input
                placeholder="Search by subject, username, or content..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setCurrentPage(1);
                }}
                className="pl-10"
              />
              <Search className="absolute left-3 top-2.5 h-5 w-5 text-gray-400" />
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={exportToCSV}
                className="bg-blue-600 text-white hover:bg-blue-700 border-blue-600 hover:text-white"
                title="Export filtered results to CSV"
              >
                <Download className="w-4 h-4 mr-2" />
                Export
              </Button>
              <Button
                variant={showAdvancedFilters ? "default" : "outline"}
                onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
                className={showAdvancedFilters ? "" : "bg-gray-100 hover:bg-gray-200 text-gray-700 border-gray-200"}
              >
                <Filter className="w-4 h-4 mr-2" />
                {showAdvancedFilters ? 'Hide Filters' : 'Advanced Filters'}
              </Button>
              {(searchQuery || filterStatus !== 'all' || filterSeverity !== 'all' || filterCategory || dateFrom || dateTo) && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setSearchQuery('');
                    setFilterStatus('all');
                    setFilterSeverity('all');
                    setFilterCategory('');
                    setDateFrom('');
                    setDateTo('');
                    setCurrentPage(1);
                  }}
                  className="bg-red-50 text-red-600 hover:bg-red-100 hover:text-red-700"
                >
                  <X className="w-4 h-4 mr-2" />
                  Clear All
                </Button>
              )}
            </div>
          </div>

          {showAdvancedFilters && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Status</label>
                <Select
                  value={filterStatus}
                  onValueChange={(value) => {
                    setFilterStatus(value as StatusFilter);
                    setCurrentPage(1);
                  }}
                >
                  <SelectTrigger className="bg-white">
                    <SelectValue placeholder="All Statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    <SelectItem value="open">Open</SelectItem>
                    <SelectItem value="in_progress">In Progress</SelectItem>
                    <SelectItem value="closed">Closed</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Severity</label>
                <Select
                  value={filterSeverity}
                  onValueChange={(value) => {
                    setFilterSeverity(value as SeverityFilter);
                    setCurrentPage(1);
                  }}
                >
                  <SelectTrigger className="bg-white">
                    <SelectValue placeholder="All Severities" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Severities</SelectItem>
                    <SelectItem value="critical">Critical</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Category</label>
                <Select
                  value={filterCategory}
                  onValueChange={(value) => {
                    setFilterCategory(value);
                    setCurrentPage(1);
                  }}
                >
                  <SelectTrigger className="bg-white">
                    <SelectValue placeholder="All Categories" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Categories</SelectItem>
                    {availableCategories.map(cat => (
                      <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">From Date</label>
                <Input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => {
                    setDateFrom(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="bg-white"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">To Date</label>
                <Input
                  type="date"
                  value={dateTo}
                  onChange={(e) => {
                    setDateTo(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="bg-white"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Results per page</label>
                <Select
                  value={pageSize.toString()}
                  onValueChange={(value) => {
                    setPageSize(Number(value));
                    setCurrentPage(1);
                  }}
                >
                  <SelectTrigger className="bg-white">
                    <SelectValue placeholder="10" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="5">5</SelectItem>
                    <SelectItem value="10">10</SelectItem>
                    <SelectItem value="25">25</SelectItem>
                    <SelectItem value="50">50</SelectItem>
                    <SelectItem value="100">100</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex gap-2 mb-4 sm:mb-6 flex-wrap">
        {(['all', 'open', 'in_progress', 'closed'] as const).map((f) => (
          <Button
            key={f}
            variant={filterStatus === f ? "default" : "outline"}
            onClick={() => setFilterStatus(f)}
            className="capitalize"
          >
            {f === 'all' ? 'All' : f === 'in_progress' ? 'In Progress' : f}
          </Button>
        ))}
      </div>

      <div className="bg-white rounded-lg overflow-hidden shadow-xl border-2 border-gray-200">
        {paginatedTickets.length === 0 ? (
          <div className="p-6 sm:p-8 text-center text-gray-600">
            No {filterStatus !== 'all' ? formatStatus(filterStatus).toLowerCase() : ''} tickets found
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[100px]">ID</TableHead>
                  <TableHead
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => handleSort('subject')}
                  >
                    <div className="flex items-center gap-1">
                      Subject
                      {sortField === 'subject' && (
                        <span>{sortDirection === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </div>
                  </TableHead>
                  <TableHead
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => handleSort('username')}
                  >
                    <div className="flex items-center gap-1">
                      User
                      {sortField === 'username' && (
                        <span>{sortDirection === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </div>
                  </TableHead>
                  <TableHead
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => handleSort('status')}
                  >
                    <div className="flex items-center gap-1">
                      Status
                      {sortField === 'status' && (
                        <span>{sortDirection === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </div>
                  </TableHead>
                  <TableHead
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => handleSort('severity')}
                  >
                    <div className="flex items-center gap-1">
                      Severity
                      {sortField === 'severity' && (
                        <span>{sortDirection === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </div>
                  </TableHead>
                  <TableHead>Responses</TableHead>
                  <TableHead
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => handleSort('createdAt')}
                  >
                    <div className="flex items-center gap-1">
                      Created
                      {sortField === 'createdAt' && (
                        <span>{sortDirection === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </div>
                  </TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedTickets.map((ticket) => (
                  <TableRow key={ticket.id} className="hover:bg-muted/50">
                    <TableCell className="font-medium">
                      {ticket.id.slice(0, 8)}
                    </TableCell>
                    <TableCell title={ticket.subject}>
                      {ticket.subject.length > 60 ? `${ticket.subject.slice(0, 60)}...` : ticket.subject}
                    </TableCell>
                    <TableCell className="text-muted-foreground" title={ticket.username}>
                      {ticket.displayName || ticket.username}
                    </TableCell>
                    <TableCell>
                      <span className={`px-2 py-1 rounded-full text-xs font-semibold ${getStatusColor(ticket.status)}`}>
                        {formatStatus(ticket.status)}
                      </span>
                    </TableCell>
                    <TableCell>
                      {ticket.severity ? (
                        <span className={`px-2 py-1 rounded-full text-xs font-semibold ${getSeverityColor(ticket.severity)}`}>
                          {ticket.severity.toUpperCase()}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {ticket.responses.length}
                    </TableCell>
                    <TableCell className="text-muted-foreground whitespace-nowrap">
                      {new Date(ticket.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          onClick={() => setSelectedTicket(ticket)}
                          size="sm"
                          variant="outline"
                        >
                          Quick View
                        </Button>
                        <Button
                          onClick={() => router.push(`/admin/support/tickets/${ticket.id}`)}
                          size="sm"
                          className="bg-black hover:bg-gray-800 text-white"
                        >
                          View
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="mt-4">
          <Card className="px-6 py-4 flex items-center justify-between bg-gray-50/50">
            <div className="text-sm text-gray-700">
              Showing {((currentPage - 1) * pageSize) + 1} to {Math.min(currentPage * pageSize, sortedTickets.length)} of {sortedTickets.length} results
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                disabled={currentPage === 1}
                className="h-8 md:h-9"
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                Previous
              </Button>

              <div className="hidden items-center gap-1 sm:flex">
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  let pageNum;
                  if (totalPages <= 5) {
                    pageNum = i + 1;
                  } else if (currentPage <= 3) {
                    pageNum = i + 1;
                  } else if (currentPage >= totalPages - 2) {
                    pageNum = totalPages - 4 + i;
                  } else {
                    pageNum = currentPage - 2 + i;
                  }

                  return (
                    <Button
                      key={pageNum}
                      variant={currentPage === pageNum ? "default" : "outline"}
                      size="sm"
                      onClick={() => setCurrentPage(pageNum)}
                      className={`h-8 w-8 p-0 ${currentPage !== pageNum ? "hover:bg-gray-50" : ""}`}
                    >
                      {pageNum}
                    </Button>
                  );
                })}
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                disabled={currentPage === totalPages}
                className="h-8 md:h-9"
              >
                Next
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </Card>
        </div>
      )}

      <TicketDetailModal
        ticket={selectedTicket}
        onClose={() => setSelectedTicket(null)}
        onAddResponse={handleAddResponse}
        onUpdateStatus={handleUpdateStatus}
        isSubmitting={submittingResponse}
        isUpdatingStatus={updatingStatus}
      />
    </>
  );
}
