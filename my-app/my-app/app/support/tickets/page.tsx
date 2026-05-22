'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
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
  Search,
  Filter,
  X,
  Plus
} from "lucide-react";

interface Ticket {
  id: string;
  subject: string;
  category: string | null;
  severity: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  responses: Array<{
    id: string;
    message: string;
    author: string;
    isStaff: boolean;
    createdAt: string;
  }>;
}

type StatusFilter = 'all' | 'open' | 'in_progress' | 'closed';
type SeverityFilter = 'all' | 'critical' | 'high' | 'medium' | 'low';

export default function MyTicketsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [error, setError] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  // Filters and Sorting
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<StatusFilter>('all');
  const [filterSeverity, setFilterSeverity] = useState<SeverityFilter>('all');
  const [filterCategory, setFilterCategory] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sortField, setSortField] = useState<'createdAt' | 'updatedAt' | 'subject' | 'status' | 'severity'>('createdAt');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

  useEffect(() => {
    document.title = 'My Support Tickets | User Access Request (UAR) Portal';
  }, []);

  useEffect(() => {
    const loadData = async () => {
      try {
        const sessionRes = await fetch('/api/auth/session');
        const sessionData = await sessionRes.json();

        if (!sessionData.isAuthenticated) {
          router.push('/login?redirect=/support/tickets');
          return;
        }

        setIsAuthenticated(true);

        const ticketsRes = await fetch('/api/support/tickets');
        const ticketsData = await ticketsRes.json();

        if (!ticketsRes.ok) {
          throw new Error(ticketsData.error || 'Failed to fetch tickets');
        }

        setTickets(ticketsData.tickets);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred');
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [router]);

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

  // Filter tickets
  const filteredTickets = tickets.filter(ticket => {
    const searchLower = searchQuery.toLowerCase();
    const matchesSearch = !searchQuery || (
      ticket.id.toLowerCase().includes(searchLower) ||
      ticket.subject.toLowerCase().includes(searchLower) ||
      (ticket.category && ticket.category.toLowerCase().includes(searchLower))
    );

    const matchesStatus = filterStatus === 'all' || ticket.status === filterStatus;
    const matchesSeverity = filterSeverity === 'all' || ticket.severity === filterSeverity;
    const matchesCategory = !filterCategory || ticket.category === filterCategory;

    return matchesSearch && matchesStatus && matchesSeverity && matchesCategory;
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
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-black mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading your tickets...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) return null;

  const totalTickets = tickets.length;
  const openTickets = tickets.filter(t => t.status === 'open').length;
  const inProgressTickets = tickets.filter(t => t.status === 'in_progress').length;
  const closedTickets = tickets.filter(t => t.status === 'closed').length;

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-6xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="mb-8 flex justify-between items-center"
        >
          <div>
            <h1 className="text-3xl font-bold text-gray-900 tracking-tight">My Tickets</h1>
            <p className="text-gray-500 mt-1">Manage and track your support requests</p>
          </div>
          <Button
            onClick={() => router.push('/support/create')}
            className="bg-black text-white hover:bg-gray-800"
          >
            <Plus className="w-4 h-4 mr-2" />
            New Ticket
          </Button>
        </motion.div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-red-700">{error}</p>
          </div>
        )}

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        >
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mb-6">
            <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
              <div className="text-gray-500 text-xs font-semibold uppercase tracking-wider">Total</div>
              <div className="text-2xl font-bold text-gray-900 mt-1">{totalTickets}</div>
            </div>
            <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
              <div className="text-gray-500 text-xs font-semibold uppercase tracking-wider">Open</div>
              <div className="text-2xl font-bold text-blue-600 mt-1">{openTickets}</div>
            </div>
            <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
              <div className="text-gray-500 text-xs font-semibold uppercase tracking-wider">In Progress</div>
              <div className="text-2xl font-bold text-purple-600 mt-1">{inProgressTickets}</div>
            </div>
            <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
              <div className="text-gray-500 text-xs font-semibold uppercase tracking-wider">Closed</div>
              <div className="text-2xl font-bold text-gray-600 mt-1">{closedTickets}</div>
            </div>
          </div>

          <Card className="mb-6 shadow-sm border-gray-200">
            <CardContent className="p-4 sm:p-6">
              <div className="flex flex-col md:flex-row gap-4">
                <div className="flex-1 relative">
                  <Input
                    placeholder="Search tickets..."
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setCurrentPage(1);
                    }}
                    className="pl-10"
                  />
                  <Search className="absolute left-3 top-2.5 h-5 w-5 text-gray-400" />
                </div>
                <Button
                  variant={showAdvancedFilters ? "default" : "outline"}
                  onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
                  className={showAdvancedFilters ? "" : "bg-gray-50 text-gray-700 border-gray-300"}
                >
                  <Filter className="w-4 h-4 mr-2" />
                  Filters
                </Button>
                {(searchQuery || filterStatus !== 'all' || filterSeverity !== 'all' || filterCategory) && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setSearchQuery('');
                      setFilterStatus('all');
                      setFilterSeverity('all');
                      setFilterCategory('');
                      setCurrentPage(1);
                    }}
                    className="text-red-600 hover:text-red-700 hover:bg-red-50"
                  >
                    <X className="w-4 h-4 mr-2" />
                    Clear
                  </Button>
                )}
              </div>

              {showAdvancedFilters && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4 pt-4 border-t border-gray-100">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 uppercase mb-1.5">Status</label>
                    <Select value={filterStatus} onValueChange={(v) => { setFilterStatus(v as StatusFilter); setCurrentPage(1); }}>
                      <SelectTrigger className="bg-white">
                        <SelectValue placeholder="All" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All</SelectItem>
                        <SelectItem value="open">Open</SelectItem>
                        <SelectItem value="in_progress">In Progress</SelectItem>
                        <SelectItem value="closed">Closed</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 uppercase mb-1.5">Severity</label>
                    <Select value={filterSeverity} onValueChange={(v) => { setFilterSeverity(v as SeverityFilter); setCurrentPage(1); }}>
                      <SelectTrigger className="bg-white">
                        <SelectValue placeholder="All" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All</SelectItem>
                        <SelectItem value="critical">Critical</SelectItem>
                        <SelectItem value="high">High</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="low">Low</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 uppercase mb-1.5">Category</label>
                    <Select value={filterCategory} onValueChange={(v) => { setFilterCategory(v); setCurrentPage(1); }}>
                      <SelectTrigger className="bg-white">
                        <SelectValue placeholder="All" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All</SelectItem>
                        {availableCategories.map(cat => (
                          <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            {paginatedTickets.length === 0 ? (
              <div className="p-12 text-center">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-gray-100 mb-4">
                  <Search className="w-6 h-6 text-gray-400" />
                </div>
                <h3 className="text-lg font-medium text-gray-900">No tickets found</h3>
                <p className="text-gray-500 mt-1">Try adjusting your search or filters</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50/50 hover:bg-gray-50/50">
                    <TableHead className="w-[100px] font-semibold text-gray-900">ID</TableHead>
                    <TableHead
                      className="cursor-pointer hover:text-black transition-colors font-semibold text-gray-900"
                      onClick={() => handleSort('subject')}
                    >
                      <div className="flex items-center gap-1">
                        Subject
                        {sortField === 'subject' && (
                          <span className="text-gray-400">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                        )}
                      </div>
                    </TableHead>
                    <TableHead
                      className="cursor-pointer hover:text-black transition-colors font-semibold text-gray-900"
                      onClick={() => handleSort('status')}
                    >
                      <div className="flex items-center gap-1">
                        Status
                        {sortField === 'status' && (
                          <span className="text-gray-400">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                        )}
                      </div>
                    </TableHead>
                    <TableHead
                      className="cursor-pointer hover:text-black transition-colors font-semibold text-gray-900"
                      onClick={() => handleSort('severity')}
                    >
                      <div className="flex items-center gap-1">
                        Severity
                        {sortField === 'severity' && (
                          <span className="text-gray-400">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                        )}
                      </div>
                    </TableHead>
                    <TableHead
                      className="cursor-pointer hover:text-black transition-colors font-semibold text-gray-900"
                      onClick={() => handleSort('createdAt')}
                    >
                      <div className="flex items-center gap-1">
                        Created
                        {sortField === 'createdAt' && (
                          <span className="text-gray-400">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                        )}
                      </div>
                    </TableHead>
                    <TableHead className="text-right font-semibold text-gray-900">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedTickets.map((ticket) => (
                    <TableRow key={ticket.id} className="hover:bg-gray-50/50">
                      <TableCell className="font-mono text-xs text-gray-500">
                        {ticket.id.slice(0, 8)}
                      </TableCell>
                      <TableCell className="font-medium text-gray-900">
                        <div className="truncate max-w-[300px]" title={ticket.subject}>
                          {ticket.subject}
                        </div>
                        {ticket.responses.length > 0 && ( // Show active conversation indicator 
                          <div className="mt-1 flex items-center gap-2 text-xs text-gray-500">
                            <div className="flex items-center gap-1">
                              <span className="inline-block w-2 h-2 rounded-full bg-blue-500"></span>
                              {ticket.responses.length} response{ticket.responses.length !== 1 ? 's' : ''}
                            </div>
                            {ticket.responses.some(r => r.isStaff) && (
                              <span className="text-green-600 font-medium bg-green-50 px-1.5 py-0.5 rounded">Staff Replied</span>
                            )}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(ticket.status)}`}>
                          {formatStatus(ticket.status)}
                        </span>
                      </TableCell>
                      <TableCell>
                        {ticket.severity ? (
                          <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${getSeverityColor(ticket.severity)}`}>
                            {ticket.severity.toUpperCase()}
                          </span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-gray-500 text-sm">
                        {new Date(ticket.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          onClick={() => router.push(`/support/tickets/${ticket.id}`)}
                          size="sm"
                          className="bg-white border-2 border-gray-100 text-gray-900 hover:bg-gray-50 hover:border-gray-200 shadow-xs"
                        >
                          View Details
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>

          {totalPages > 1 && (
            <div className="mt-6 flex justify-between items-center">
              <div className="text-sm text-gray-500">
                Page {currentPage} of {totalPages}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                  disabled={currentPage === 1}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                  disabled={currentPage === totalPages}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </motion.div>
      </div>
    </div>
  );
}
