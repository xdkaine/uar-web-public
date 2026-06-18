'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { usePolling } from '@/hooks/usePolling';
import Link from 'next/link';
import Toast from '@/components/Toast';
import { useToast } from '@/hooks/useToast';
import { fetchWithCsrf } from '@/lib/csrf';
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
import { Card, CardContent } from "@/components/ui/card";
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger 
} from "@/components/ui/dropdown-menu";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { MoreHorizontal, FileText, Send, X, ExternalLink, Download, Search, RefreshCw, Play, Pause, AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface AccessRequest {
  id: string;
  createdAt: string;
  name: string;
  email: string;
  isInternal: boolean;
  needsDomainAccount: boolean;
  institution?: string;
  eventReason?: string;
  eventId?: string;
  event?: {
    id: string;
    name: string;
  };
  accountExpiresAt?: string;
  isVerified: boolean;
  status: string;
  verifiedAt?: string;
}

interface AccessRequestsTabProps {
  requests?: AccessRequest[];
}

type StatusFilter = 'all' | 'pending_verification' | 'pending_student_directors' | 'pending_faculty' | 'approved' | 'rejected' | 'offboarded';
type TypeFilter = 'all' | 'internal' | 'external';
type VerificationFilter = 'all' | 'verified' | 'unverified';

export default function AccessRequestsTab({ requests }: AccessRequestsTabProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [verificationFilter, setVerificationFilter] = useState<VerificationFilter>('all');
  const [eventFilter, setEventFilter] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sortField, setSortField] = useState<'createdAt' | 'name' | 'email' | 'status'>('createdAt');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [resendingId, setResendingId] = useState<string | null>(null);

  const [localRequests, setLocalRequests] = useState<AccessRequest[]>(requests ?? []);
  const { toast, showToast, hideToast } = useToast();

  // Polling for live updates
  const fetchRequests = useCallback(async () => {
    const response = await fetch('/api/admin/requests?limit=500');
    if (!response.ok) throw new Error('Failed to fetch requests');
    const data = await response.json();
    return data.requests;
  }, []);

  const { 
    data: polledData, 
    isLoading: isPollingLoading, 
    isPolling, 
    togglePolling, 
    refresh,
    lastUpdated
  } = usePolling(fetchRequests, {
    interval: 30000,
    onSuccess: (data) => {
      setLocalRequests(data);
    }
  });

  // Update local state when prop changes (initial load or parent update)
  useEffect(() => {
    if (requests !== undefined) {
      setLocalRequests(requests);
    }
  }, [requests]);

  // Extract unique events from requests
  const availableEvents = useMemo(() => {
    const eventSet = new Set<string>();

    localRequests.forEach(req => {
      if (req.event?.name) {
        eventSet.add(req.event.name);
      } else if (req.eventReason) {
        eventSet.add(req.eventReason);
      }
    });
    return Array.from(eventSet).sort();
  }, [localRequests]);

  // Export filtered requests to CSV
  const exportToCSV = () => {
    const headers = ['Date', 'Name', 'Email', 'Type', 'Event', 'Institution', 'Access Ends', 'Status', 'Verified'];
    const csvData = filteredRequests.map(req => [
      new Date(req.createdAt).toLocaleDateString(),
      req.name,
      req.email,
      req.isInternal ? 'Internal' : 'External',
      req.event?.name || req.eventReason || '',
      req.institution || '',
      req.accountExpiresAt ? new Date(req.accountExpiresAt).toLocaleDateString() : '',
      req.status,
      req.isVerified ? 'Yes' : 'No'
    ]);

    const csvContent = [
      headers.join(','),
      ...csvData.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `access_requests_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Filter requests
  const filteredRequests = localRequests.filter(req => {
    // Text search filter
    const searchLower = searchQuery.toLowerCase();
    const matchesSearch = !searchQuery || (
      req.name.toLowerCase().includes(searchLower) ||
      req.email.toLowerCase().includes(searchLower) ||
      (req.institution && req.institution.toLowerCase().includes(searchLower)) ||
      (req.event?.name && req.event.name.toLowerCase().includes(searchLower)) ||
      (req.eventReason && req.eventReason.toLowerCase().includes(searchLower))
    );

    // Status filter
    const matchesStatus = statusFilter === 'all' || req.status === statusFilter;

    // Type filter
    const matchesType = 
      typeFilter === 'all' ||
      (typeFilter === 'internal' && req.isInternal) ||
      (typeFilter === 'external' && !req.isInternal);

    // Verification filter
    const matchesVerification = 
      verificationFilter === 'all' ||
      (verificationFilter === 'verified' && req.isVerified) ||
      (verificationFilter === 'unverified' && !req.isVerified);

    // Event filter
    const matchesEvent = !eventFilter || 
      (req.event?.name === eventFilter) ||
      (req.eventReason === eventFilter);

    return matchesSearch && matchesStatus && matchesType && matchesVerification && matchesEvent;
  });

  // Sort requests
  const sortedRequests = [...filteredRequests].sort((a, b) => {
    let aValue: string | boolean | number = '';
    let bValue: string | boolean | number = '';

    switch (sortField) {
      case 'createdAt':
        aValue = new Date(a.createdAt).getTime();
        bValue = new Date(b.createdAt).getTime();
        break;
      case 'name':
        aValue = a.name.toLowerCase();
        bValue = b.name.toLowerCase();
        break;
      case 'email':
        aValue = a.email.toLowerCase();
        bValue = b.email.toLowerCase();
        break;
      case 'status':
        aValue = a.status.toLowerCase();
        bValue = b.status.toLowerCase();
        break;
    }

    if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
    if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
    return 0;
  });

  const totalPages = Math.ceil(sortedRequests.length / pageSize);
  const paginatedRequests = sortedRequests.slice(
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

  const totalRequests = localRequests.length;
  const pendingVerification = localRequests.filter(r => r.status === 'pending_verification').length;
  const pendingStudentDirectors = localRequests.filter(r => r.status === 'pending_student_directors').length;
  const pendingFaculty = localRequests.filter(r => r.status === 'pending_faculty').length;
  const approved = localRequests.filter(r => r.status === 'approved').length;

  const getStatusBadge = (status: string) => {
    const styles = {
      pending_verification: 'bg-gray-100 text-gray-800',
      pending_student_directors: 'bg-blue-100 text-blue-800',
      pending_faculty: 'bg-yellow-100 text-yellow-800',
      approved: 'bg-green-100 text-green-800',
      rejected: 'bg-red-100 text-red-800',
      offboarded: 'bg-slate-100 text-slate-800',
    };
    
    const labels = {
      pending_verification: 'Pending Verification',
      pending_student_directors: 'Pending Directors',
      pending_faculty: 'Pending Faculty',
      approved: 'Approved',
      rejected: 'Rejected',
      offboarded: 'Offboarded',
    };
    
    return (
      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${styles[status as keyof typeof styles] || 'bg-gray-100 text-gray-800'}`}>
        {labels[status as keyof typeof labels] || status}
      </span>
    );
  };

  const handleResendVerification = useCallback(async (requestId: string) => {
    try {
      setResendingId(requestId);
      // Dropdown closes automatically with Shadcn
      const response = await fetchWithCsrf(`/api/admin/requests/${requestId}/resend-verification`, {
        method: 'POST',
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        const message = errorBody?.error || 'Failed to send verification email';
        showToast(message, 'error');
        return;
      }

      const data = await response.json().catch(() => null);
      showToast(data?.message || 'Verification email resent successfully', 'success');
    } catch (error) {
      console.error('Failed to resend verification email:', error);
      showToast('Failed to send verification email. Please try again.', 'error');
    } finally {
      setResendingId((current: string | null) => (current === requestId ? null : current));
    }
  }, [showToast]);

  return (
    <>
      <Alert className="mb-6 bg-blue-50 border-blue-200 text-blue-900">
        <AlertCircle className="h-4 w-4 text-blue-500" />
        <div className="ml-2">
          <p className="text-sm">
            <span className="font-semibold">Verification Email:</span> For requests with <span className="font-medium italic">"Pending Verification"</span> status and unverified emails, 
            use the <span className="font-semibold">"Actions"</span> dropdown in the Actions column to view the request or resend the verification email.
          </p>
        </div>
      </Alert>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 sm:gap-4 mb-6 sm:mb-8">
        <div className="bg-white p-4 sm:p-6 rounded-lg shadow-lg border-2 border-gray-200">
          <div className="text-gray-600 text-xs sm:text-sm font-medium">Total Requests</div>
          <div className="text-2xl sm:text-3xl font-bold text-gray-900 mt-2">{totalRequests}</div>
        </div>
        <div className="bg-white p-4 sm:p-6 rounded-lg shadow-lg border-2 border-gray-200">
          <div className="text-gray-600 text-xs sm:text-sm font-medium">Pending Verification</div>
          <div className="text-2xl sm:text-3xl font-bold text-gray-500 mt-2">{pendingVerification}</div>
        </div>
        <div className="bg-white p-4 sm:p-6 rounded-lg shadow-lg border-2 border-gray-200">
          <div className="text-gray-600 text-xs sm:text-sm font-medium">Pending Student Directors</div>
          <div className="text-2xl sm:text-3xl font-bold text-blue-500 mt-2">{pendingStudentDirectors}</div>
        </div>
        <div className="bg-white p-4 sm:p-6 rounded-lg shadow-lg border-2 border-gray-200">
          <div className="text-gray-600 text-xs sm:text-sm font-medium">Pending Faculty</div>
          <div className="text-2xl sm:text-3xl font-bold text-yellow-500 mt-2">{pendingFaculty}</div>
        </div>
        <div className="bg-white p-4 sm:p-6 rounded-lg shadow-lg border-2 border-gray-200">
          <div className="text-gray-600 text-xs sm:text-sm font-medium">Approved</div>
          <div className="text-2xl sm:text-3xl font-bold text-green-600 mt-2">{approved}</div>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row justify-end items-start sm:items-center gap-4 mb-6">
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

      <div className="bg-white rounded-lg shadow-lg border-2 border-gray-200 p-6 mb-4">
        <div className="flex flex-wrap gap-6 text-sm mb-6">
          <div>
            <span className="font-semibold text-gray-700">Total:</span>
            <span className="ml-2 text-gray-900 font-bold">{localRequests.length}</span>
          </div>
          <div>
            <span className="font-semibold text-gray-700">Filtered:</span>
            <span className="ml-2 text-blue-600 font-bold">{filteredRequests.length}</span>
          </div>
          <div>
            <span className="font-semibold text-gray-700">Internal:</span>
            <span className="ml-2 text-blue-600 font-bold">{localRequests.filter(r => r.isInternal).length}</span>
          </div>
          <div>
            <span className="font-semibold text-gray-700">External:</span>
            <span className="ml-2 text-purple-600 font-bold">{localRequests.filter(r => !r.isInternal).length}</span>
          </div>
          <div>
            <span className="font-semibold text-gray-700">Verified:</span>
            <span className="ml-2 text-green-600 font-bold">{localRequests.filter(r => r.isVerified).length}</span>
          </div>
        </div>

        <div className="flex gap-3 mb-4">
          <div className="flex-1">
            <div className="relative">
              <Input
                type="text"
                placeholder="Search by name, email, institution, or event..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setCurrentPage(1);
                }}
                className="pl-10"
              />
              <Search className="absolute left-3 top-2.5 h-5 w-5 text-gray-400" />
            </div>
          </div>
          <Button
            onClick={exportToCSV}
            className="bg-blue-600 hover:bg-blue-700 text-white gap-2"
          >
            <Download className="w-4 h-4" />
            Export
          </Button>
          <Button
            variant={showAdvancedFilters ? "default" : "secondary"}
            onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
            className={showAdvancedFilters ? "" : "bg-gray-200 hover:bg-gray-300 text-gray-700"}
          >
            {showAdvancedFilters ? 'Hide Filters' : 'Advanced Filters'}
          </Button>
          {(searchQuery || statusFilter !== 'all' || typeFilter !== 'all' || verificationFilter !== 'all' || eventFilter) && (
            <Button
              variant="ghost"
              onClick={() => {
                setSearchQuery('');
                setStatusFilter('all');
                setTypeFilter('all');
                setVerificationFilter('all');
                setEventFilter('');
                setCurrentPage(1);
              }}
              className="bg-red-100 text-red-700 hover:bg-red-200 hover:text-red-800"
            >
              Clear All
            </Button>
          )}
        </div>

        {showAdvancedFilters && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 pt-4 border-t border-gray-200">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Request Status
              </label>
              <Select value={statusFilter} onValueChange={(val) => { setStatusFilter(val as StatusFilter); setCurrentPage(1); }}>
                <SelectTrigger>
                  <SelectValue placeholder="All Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="pending_verification">Pending Verification</SelectItem>
                  <SelectItem value="pending_student_directors">Pending Directors</SelectItem>
                  <SelectItem value="pending_faculty">Pending Faculty</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                  <SelectItem value="offboarded">Offboarded</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Request Type
              </label>
              <Select value={typeFilter} onValueChange={(val) => { setTypeFilter(val as TypeFilter); setCurrentPage(1); }}>
                <SelectTrigger>
                  <SelectValue placeholder="All Types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="internal">Internal Only</SelectItem>
                  <SelectItem value="external">External Only</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Email Verification
              </label>
              <Select value={verificationFilter} onValueChange={(val) => { setVerificationFilter(val as VerificationFilter); setCurrentPage(1); }}>
                <SelectTrigger>
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="verified">Verified Only</SelectItem>
                  <SelectItem value="unverified">Unverified Only</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Event
              </label>
              <Select value={eventFilter} onValueChange={(val) => { setEventFilter(val); setCurrentPage(1); }}>
                <SelectTrigger>
                  <SelectValue placeholder="All Events" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all_events" onClick={() => setEventFilter('')}>All Events</SelectItem>
                  {availableEvents.map((event: string) => (
                    <SelectItem key={event} value={event}>{event}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {(statusFilter !== 'all' || typeFilter !== 'all' || verificationFilter !== 'all' || eventFilter) && (
          <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-gray-200">
            <span className="text-sm font-semibold text-gray-700">Active Filters:</span>
            {statusFilter !== 'all' && (
              <span className="inline-flex items-center gap-1 px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm">
                Status: {statusFilter.replace(/_/g, ' ')}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-4 w-4 ml-1 p-0 hover:bg-transparent hover:text-blue-900"
                  onClick={() => {
                    setStatusFilter('all');
                    setCurrentPage(1);
                  }}
                >
                  <X className="h-3 w-3" />
                </Button>
              </span>
            )}
            {typeFilter !== 'all' && (
              <span className="inline-flex items-center gap-1 px-3 py-1 bg-purple-100 text-purple-800 rounded-full text-sm">
                Type: {typeFilter}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-4 w-4 ml-1 p-0 hover:bg-transparent hover:text-purple-900"
                  onClick={() => {
                    setTypeFilter('all');
                    setCurrentPage(1);
                  }}
                >
                  <X className="h-3 w-3" />
                </Button>
              </span>
            )}
            {verificationFilter !== 'all' && (
              <span className="inline-flex items-center gap-1 px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm">
                Verification: {verificationFilter}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-4 w-4 ml-1 p-0 hover:bg-transparent hover:text-green-900"
                  onClick={() => {
                    setVerificationFilter('all');
                    setCurrentPage(1);
                  }}
                >
                  <X className="h-3 w-3" />
                </Button>
              </span>
            )}
            {eventFilter && (
              <span className="inline-flex items-center gap-1 px-3 py-1 bg-orange-100 text-orange-800 rounded-full text-sm">
                Event: {eventFilter}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-4 w-4 ml-1 p-0 hover:bg-transparent hover:text-orange-900"
                  onClick={() => {
                    setEventFilter('');
                    setCurrentPage(1);
                  }}
                >
                  <X className="h-3 w-3" />
                </Button>
              </span>
            )}
          </div>
        )}
      </div>

      <Card className="overflow-hidden">
        {sortedRequests.length === 0 ? (
          <div className="p-6 sm:p-8 text-center text-muted-foreground">
            No requests found matching your search
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead 
                    className="cursor-pointer hover:bg-muted/50 select-none"
                    onClick={() => handleSort('createdAt')}
                  >
                    <div className="flex items-center gap-2">
                      Date
                      {sortField === 'createdAt' && (
                        <span>{sortDirection === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </div>
                  </TableHead>
                  <TableHead 
                    className="cursor-pointer hover:bg-muted/50 select-none"
                    onClick={() => handleSort('name')}
                  >
                    <div className="flex items-center gap-2">
                      Name
                      {sortField === 'name' && (
                        <span>{sortDirection === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </div>
                  </TableHead>
                  <TableHead 
                    className="cursor-pointer hover:bg-muted/50 select-none"
                    onClick={() => handleSort('email')}
                  >
                    <div className="flex items-center gap-2">
                      Email
                      {sortField === 'email' && (
                        <span>{sortDirection === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </div>
                  </TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>
                    Access Ends
                  </TableHead>
                  <TableHead 
                    className="cursor-pointer hover:bg-muted/50 select-none"
                    onClick={() => handleSort('status')}
                  >
                    <div className="flex items-center gap-2">
                      Status
                      {sortField === 'status' && (
                        <span>{sortDirection === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </div>
                  </TableHead>
                  <TableHead className="w-20 text-center">
                    Verified
                  </TableHead>
                  <TableHead className="w-28 text-center">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedRequests.map((req) => (
                  <TableRow key={req.id} className="hover:bg-muted/50">
                    <TableCell className="whitespace-nowrap">
                      {new Date(req.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="font-medium" title={req.name}>
                      <div className="max-w-[180px] truncate">{req.name}</div>
                    </TableCell>
                    <TableCell className="text-muted-foreground" title={req.email}>
                      <div className="max-w-[200px] truncate">{req.email}</div>
                    </TableCell>
                    <TableCell>
                      <span className={`px-2 py-0.5 rounded-md text-xs font-semibold whitespace-nowrap ${
                        req.isInternal ? 'bg-blue-100 text-blue-800' : 'bg-purple-100 text-purple-800'
                      }`}>
                        {req.isInternal ? 'Internal' : 'External'}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {req.event ? (
                        <div className="max-w-[200px] truncate font-medium" title={req.event.name}>
                          {req.event.name}
                        </div>
                      ) : req.eventReason ? (
                        <div className="max-w-[200px] truncate text-muted-foreground italic" title={req.eventReason}>
                          {req.eventReason}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {req.accountExpiresAt ? (
                        (() => {
                          const date = new Date(req.accountExpiresAt);
                          const formattedDate = date.toLocaleDateString();
                          const formattedTime = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                          return (
                            <div className="relative inline-block group">
                              <span className="font-medium cursor-help">
                                {formattedDate}
                              </span>
                              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-gray-900 text-white text-xs rounded-lg whitespace-nowrap opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 pointer-events-none z-50">
                                Expires: {formattedDate} at {formattedTime}
                                <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 border-4 border-transparent border-t-gray-900"></div>
                              </div>
                            </div>
                          );
                        })()
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="inline-block">{getStatusBadge(req.status)}</div>
                    </TableCell>
                    <TableCell className="text-center">
                      {req.isVerified ? (
                        <div className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-green-100" title="Verified">
                          <span className="text-green-700 font-bold text-sm">✓</span>
                        </div>
                      ) : (
                        <div className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-gray-100" title="Not Verified">
                          <span className="text-gray-400 font-bold text-sm">✗</span>
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-center">
                        {!req.isVerified && req.status === 'pending_verification' ? (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                disabled={resendingId === req.id}
                                className="h-8 w-8 p-0"
                              >
                                {resendingId === req.id ? (
                                  <RefreshCw className="h-4 w-4 animate-spin" />
                                ) : (
                                  <MoreHorizontal className="h-4 w-4" />
                                )}
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <Link href={`/admin/requests/${req.id}`} passHref>
                                <DropdownMenuItem>
                                  <FileText className="mr-2 h-4 w-4" />
                                  <span>View Request</span>
                                </DropdownMenuItem>
                              </Link>
                              <DropdownMenuItem 
                                onClick={() => handleResendVerification(req.id)}
                                disabled={resendingId === req.id}
                              >
                                <Send className="mr-2 h-4 w-4" />
                                <span>Resend Email</span>
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : (
                          <Button asChild size="sm" variant="outline" className="h-8 text-xs">
                            <Link href={`/admin/requests/${req.id}`}>
                              View
                            </Link>
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-700">Show:</label>
              <Select
                value={pageSize.toString()}
                onValueChange={(val) => {
                  setPageSize(Number(val));
                  setCurrentPage(1);
                }}
              >
                <SelectTrigger className="w-20 h-8">
                  <SelectValue placeholder={pageSize.toString()} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">10</SelectItem>
                  <SelectItem value="25">25</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                  <SelectItem value="100">100</SelectItem>
                </SelectContent>
              </Select>
              <span className="text-sm text-gray-600 ml-4">
                Showing {(currentPage - 1) * pageSize + 1} to {Math.min(currentPage * pageSize, sortedRequests.length)} of {sortedRequests.length}
              </span>
            </div>
            
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(1)}
                disabled={currentPage === 1}
                className="h-8 w-8 p-0"
              >
                <span className="sr-only">First page</span>
                <span aria-hidden="true">«</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(currentPage - 1)}
                disabled={currentPage === 1}
                className="h-8 w-8 p-0"
              >
                <span className="sr-only">Previous page</span>
                <span aria-hidden="true">‹</span>
              </Button>
              
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
                    className="h-8 w-8 p-0"
                  >
                    {pageNum}
                  </Button>
                );
              })}
              
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(currentPage + 1)}
                disabled={currentPage === totalPages}
                className="h-8 w-8 p-0"
              >
                <span className="sr-only">Next page</span>
                <span aria-hidden="true">›</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(totalPages)}
                disabled={currentPage === totalPages}
                className="h-8 w-8 p-0"
              >
                <span className="sr-only">Last page</span>
                <span aria-hidden="true">»</span>
              </Button>
            </div>
          </div>
        )}
      </Card>
      <Toast
        message={toast.message}
        type={toast.type}
        isVisible={toast.isVisible}
        onClose={hideToast}
      />
    </>
  );
}
