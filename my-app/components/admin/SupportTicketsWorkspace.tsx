'use client';

import TicketDetailModal from './TicketDetailModal';
import { ticketCategoryLabel } from '@/lib/support/ticket-categories';
import TicketPeek from '@/components/support/TicketPeek';
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
import { StatusBadge, type StatusTone } from '@/components/ui/status-badge';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Filter,
  X,
  Search,
  RefreshCw,
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
  assignments?: Array<{ targetLabel: string }>;
  assignees?: string[];
  attachmentCount?: number;
}

type StatusFilter = 'all' | 'open' | 'in_progress' | 'closed';
type SeverityFilter = 'all' | 'critical' | 'high' | 'medium' | 'low';
type TicketSortField = 'createdAt' | 'updatedAt' | 'subject' | 'username' | 'status' | 'severity';

const getSeverityTone = (severity: string | null): StatusTone => {
  switch (severity) {
    case 'critical': return 'critical';
    case 'high': return 'danger';
    case 'medium': return 'warning';
    case 'low': return 'info';
    default: return 'neutral';
  }
};

const getStatusTone = (status: string): StatusTone => {
  switch (status) {
    case 'open': return 'info';
    case 'in_progress': return 'warning';
    case 'closed': return 'neutral';
    default: return 'neutral';
  }
};

const formatStatus = (status: string) => {
  return status.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
};

interface SupportTicketsWorkspaceView {
  selectedTicket: SupportTicket | null;
  setSelectedTicket: (ticket: SupportTicket | null) => void;
  submittingResponse: boolean;
  updatingStatus: boolean;
  tickets: SupportTicket[];
  lastUpdated: Date | null;
  isPolling: boolean;
  togglePolling: () => void;
  refresh: () => Promise<unknown>;
  isPollingLoading: boolean;
  filteredTickets: SupportTicket[];
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  setCurrentPage: (value: number) => void;
  exportToCSV: () => void;
  showAdvancedFilters: boolean;
  setShowAdvancedFilters: (value: boolean) => void;
  filterStatus: StatusFilter;
  filterSeverity: SeverityFilter;
  filterCategory: string;
  dateFrom: string;
  dateTo: string;
  setFilterStatus: (value: StatusFilter) => void;
  setFilterSeverity: (value: SeverityFilter) => void;
  setFilterCategory: (value: string) => void;
  setDateFrom: (value: string) => void;
  setDateTo: (value: string) => void;
  availableCategories: string[];
  pageSize: number;
  setPageSize: (value: number) => void;
  paginatedTickets: SupportTicket[];
  handleSort: (field: TicketSortField) => void;
  sortField: TicketSortField;
  sortDirection: 'asc' | 'desc';
  router: { push: (path: string) => void };
  totalPages: number;
  currentPage: number;
  sortedTickets: SupportTicket[];
  totalTickets: number;
  openTickets: number;
  inProgressTickets: number;
  closedTickets: number;
  handleAddResponse: (ticketId: string, message: string) => Promise<void>;
  handleUpdateStatus: (ticketId: string, status: string) => Promise<void>;
  handleUploadFiles: (ticketId: string, files: File[]) => Promise<boolean>;
}

export function renderSupportTicketsWorkspace(view: SupportTicketsWorkspaceView) {
  const {
    selectedTicket, setSelectedTicket, submittingResponse, updatingStatus, tickets, lastUpdated,
    isPolling, togglePolling, refresh, isPollingLoading, filteredTickets, searchQuery,
    setSearchQuery, setCurrentPage, exportToCSV, showAdvancedFilters, setShowAdvancedFilters,
    filterStatus, filterSeverity, filterCategory, dateFrom, dateTo, setFilterStatus,
    setFilterSeverity, setFilterCategory, setDateFrom, setDateTo, availableCategories,
    pageSize, setPageSize, paginatedTickets, handleSort, sortField, sortDirection, router,
    totalPages, currentPage, sortedTickets, totalTickets, openTickets, inProgressTickets, closedTickets,
    handleAddResponse, handleUpdateStatus, handleUploadFiles,
  } = view;

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mb-6 sm:mb-8">
        <div className="bg-card p-4 sm:p-6 rounded-lg shadow-lg border-2 border-border">
          <div className="text-muted-foreground text-xs sm:text-sm font-medium">Total Tickets</div>
          <div className="text-2xl sm:text-3xl font-bold text-foreground mt-2">{totalTickets}</div>
        </div>
        <div className="bg-card p-4 sm:p-6 rounded-lg shadow-lg border-2 border-border">
          <div className="text-muted-foreground text-xs sm:text-sm font-medium">Open</div>
          <div className="text-2xl sm:text-3xl font-bold text-blue-500 mt-2">{openTickets}</div>
        </div>
        <div className="bg-card p-4 sm:p-6 rounded-lg shadow-lg border-2 border-border">
          <div className="text-muted-foreground text-xs sm:text-sm font-medium">In Progress</div>
          <div className="text-2xl sm:text-3xl font-bold text-purple-500 mt-2">{inProgressTickets}</div>
        </div>
        <div className="bg-card p-4 sm:p-6 rounded-lg shadow-lg border-2 border-border">
          <div className="text-muted-foreground text-xs sm:text-sm font-medium">Closed</div>
          <div className="text-2xl sm:text-3xl font-bold text-muted-foreground mt-2">{closedTickets}</div>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row justify-end items-start sm:items-center gap-4 mb-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          {lastUpdated && (
            <span>Updated: {lastUpdated.toLocaleTimeString()}</span>
          )}
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={togglePolling}
            className={`gap-2 ${isPolling ? 'bg-green-50 dark:bg-green-950/40 text-green-700 dark:text-green-200 border-green-200 dark:border-green-900 hover:bg-green-100' : 'bg-muted/50 text-muted-foreground'}`}
          >
            <div className={`w-2 h-2 rounded-full ${isPolling ? 'bg-green-500 animate-pulse' : 'bg-muted-foreground'}`} />
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
              <span className="font-semibold text-muted-foreground">Total:</span>
              <span className="ml-2 text-foreground font-bold">{tickets.length}</span>
            </div>
            <div>
              <span className="font-semibold text-muted-foreground">Filtered:</span>
              <span className="ml-2 text-blue-600 dark:text-blue-400 font-bold">{filteredTickets.length}</span>
            </div>
            <div>
              <span className="font-semibold text-muted-foreground">Critical:</span>
              <span className="ml-2 text-red-600 dark:text-red-400 font-bold">{tickets.filter(t => t.severity === 'critical').length}</span>
            </div>
            <div>
              <span className="font-semibold text-muted-foreground">High:</span>
              <span className="ml-2 text-orange-600 dark:text-orange-400 font-bold">{tickets.filter(t => t.severity === 'high').length}</span>
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
              <Search className="absolute left-3 top-2.5 h-5 w-5 text-muted-foreground" />
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
                className={showAdvancedFilters ? "" : "bg-muted hover:bg-muted text-muted-foreground border-border"}
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
                  className="bg-red-50 dark:bg-red-950/40 text-red-600 hover:bg-red-100 hover:text-red-700 dark:hover:text-red-200 dark:text-red-200"
                >
                  <X className="w-4 h-4 mr-2" />
                  Clear All
                </Button>
              )}
            </div>
          </div>

          {showAdvancedFilters && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 bg-muted/50 rounded-lg border border-border">
              <div>
                <label className="block text-sm font-semibold text-muted-foreground mb-2" htmlFor="ticket-status-filter">Status</label>
                <Select
                  value={filterStatus}
                  onValueChange={(value) => {
                    setFilterStatus(value as StatusFilter);
                    setCurrentPage(1);
                  }}
                >
                  <SelectTrigger id="ticket-status-filter" className="bg-card">
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
                <label className="block text-sm font-semibold text-muted-foreground mb-2" htmlFor="ticket-severity-filter">Severity</label>
                <Select
                  value={filterSeverity}
                  onValueChange={(value) => {
                    setFilterSeverity(value as SeverityFilter);
                    setCurrentPage(1);
                  }}
                >
                  <SelectTrigger id="ticket-severity-filter" className="bg-card">
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
                <label className="block text-sm font-semibold text-muted-foreground mb-2" htmlFor="ticket-category-filter">Category</label>
                <Select
                  value={filterCategory}
                  onValueChange={(value) => {
                    setFilterCategory(value);
                    setCurrentPage(1);
                  }}
                >
                  <SelectTrigger id="ticket-category-filter" className="bg-card">
                    <SelectValue placeholder="All Categories" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Categories</SelectItem>
                    {availableCategories.map(cat => (
                      <SelectItem key={cat} value={cat}>{ticketCategoryLabel(cat)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-muted-foreground mb-2" htmlFor="ticket-date-from">From Date</label>
                <Input
                  id="ticket-date-from"
                  type="date"
                  value={dateFrom}
                  onChange={(e) => {
                    setDateFrom(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="bg-card"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-muted-foreground mb-2" htmlFor="ticket-date-to">To Date</label>
                <Input
                  id="ticket-date-to"
                  type="date"
                  value={dateTo}
                  onChange={(e) => {
                    setDateTo(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="bg-card"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-muted-foreground mb-2" htmlFor="ticket-page-size">Results per page</label>
                <Select
                  value={pageSize.toString()}
                  onValueChange={(value) => {
                    setPageSize(Number(value));
                    setCurrentPage(1);
                  }}
                >
                  <SelectTrigger id="ticket-page-size" className="bg-card">
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

      <div className="bg-card rounded-lg overflow-hidden shadow-xl border-2 border-border">
        {paginatedTickets.length === 0 ? (
          <div className="p-6 sm:p-8 text-center text-muted-foreground">
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
                      Requester
                      {sortField === 'username' && (
                        <span>{sortDirection === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </div>
                  </TableHead>
                  <TableHead>Owners</TableHead>
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
                    <TableCell>
                      <TicketPeek ticket={ticket} />
                    </TableCell>
                    <TableCell className="text-muted-foreground" title={ticket.username}>
                      {ticket.displayName || ticket.username}
                    </TableCell>
                    <TableCell className="max-w-[220px] text-xs text-muted-foreground">
                      <span className="line-clamp-2">
                        {[ticket.displayName || ticket.username, 'Support staff', ...(ticket.assignees ?? [])].join(', ')}
                      </span>
                    </TableCell>
                    <TableCell>
                      <StatusBadge tone={getStatusTone(ticket.status)}>
                        {formatStatus(ticket.status)}
                      </StatusBadge>
                    </TableCell>
                    <TableCell>
                      {ticket.severity ? (
                        <StatusBadge tone={getSeverityTone(ticket.severity)}>
                          {ticket.severity.toUpperCase()}
                        </StatusBadge>
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
                          className="bg-primary hover:bg-primary/90 text-primary-foreground"
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
          <Card className="px-6 py-4 flex items-center justify-between bg-muted/50">
            <div className="text-sm text-muted-foreground">
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
                      className={`h-8 w-8 p-0 ${currentPage !== pageNum ? "hover:bg-muted/50" : ""}`}
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
        onUploadFiles={handleUploadFiles}
        isSubmitting={submittingResponse}
        isUpdatingStatus={updatingStatus}
      />
    </>
  );
}
