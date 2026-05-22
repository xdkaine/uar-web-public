'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { usePolling } from '@/hooks/usePolling';
import { fetchWithCsrf } from '@/lib/csrf';
import DateTimePicker from '@/components/DateTimePicker';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue,
  SelectGroup,
  SelectLabel
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { 
  ChevronLeft, 
  ChevronRight, 
  Search, 
  RefreshCw, 
} from "lucide-react";

interface AuditLog {
  id: string;
  createdAt: string;
  action: string;
  category: string;
  username: string;
  actorType?: string;
  targetId?: string;
  targetType?: string;
  subjectUsername?: string;
  subjectEmail?: string;
  relatedRequestId?: string;
  relatedVpnAccountId?: string;
  relatedLifecycleActionId?: string;
  eventKind?: string;
  outcome?: string;
  correlationId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  success: boolean;
  errorMessage?: string;
}

interface AuditStats {
  last24Hours: number;
  last7Days: number;
  last30Days: number;
  topUsers?: Array<{ username: string; count: number }>;
  topActions?: Array<{ action: string; count: number }>;
  actionsByCategory?: Array<{ category: string; count: number }>;
}

interface LogsTabProps {
  isLoading: boolean;
}

export default function LogsTab({ isLoading: initialLoading }: LogsTabProps) {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [isLoading, setIsLoading] = useState(initialLoading);
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);
  
  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalLogs, setTotalLogs] = useState(0);
  const [limit, setLimit] = useState(50);
  
  // Filters
  const [actionFilter, setActionFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [usernameFilter, setUsernameFilter] = useState('');
  const [targetTypeFilter, setTargetTypeFilter] = useState('');
  const [eventKindFilter, setEventKindFilter] = useState('');
  const [outcomeFilter, setOutcomeFilter] = useState('');
  const [successFilter, setSuccessFilter] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Debounced values for text inputs (to avoid excessive API calls)
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [debouncedUsername, setDebouncedUsername] = useState('');
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Stats
  const [stats, setStats] = useState<AuditStats | null>(null);

  // Debounce search query
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 300);
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [searchQuery]);

  // Debounce username filter
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedUsername(usernameFilter);
    }, 300);
    return () => clearTimeout(timer);
  }, [usernameFilter]);

  const fetchLogsData = useCallback(async () => {
    const params = new URLSearchParams({
      page: currentPage.toString(),
      limit: limit.toString(),
    });
    
    if (actionFilter) params.append('action', actionFilter);
    if (categoryFilter) params.append('category', categoryFilter);
    if (debouncedUsername) params.append('username', debouncedUsername);
    if (targetTypeFilter) params.append('targetType', targetTypeFilter);
    if (eventKindFilter) params.append('eventKind', eventKindFilter);
    if (outcomeFilter) params.append('outcome', outcomeFilter);
    if (successFilter) params.append('success', successFilter);
    if (debouncedSearch) params.append('search', debouncedSearch);
    if (startDate) params.append('startDate', startDate);
    if (endDate) params.append('endDate', endDate);

    const response = await fetch(`/api/admin/logs?${params.toString()}`);
    if (!response.ok) throw new Error('Failed to fetch logs');
    
    return await response.json();
  }, [currentPage, limit, actionFilter, categoryFilter, debouncedUsername, targetTypeFilter, eventKindFilter, outcomeFilter, successFilter, debouncedSearch, startDate, endDate]);

  const { 
    isLoading: isPollingLoading, 
    isPolling, 
    togglePolling, 
    refresh, 
    lastUpdated 
  } = usePolling(fetchLogsData, {
    onSuccess: (data) => {
      setLogs(data.logs);
      setTotalPages(data.pagination.totalPages);
      setTotalLogs(data.pagination.total);
      setIsLoading(false);
    },
    onError: (error) => {
      console.error('Error fetching logs:', error);
      setIsLoading(false);
    }
  });

  // Fetch stats when filters change
  useEffect(() => {
    fetchStats();
  }, [currentPage, limit, actionFilter, categoryFilter, debouncedUsername, targetTypeFilter, eventKindFilter, outcomeFilter, successFilter, debouncedSearch, startDate, endDate]);

  const fetchStats = async () => {
    try {
      const response = await fetchWithCsrf('/api/admin/logs', {
        method: 'POST',
        body: JSON.stringify({ action: 'get_stats' }),
      });
      
      if (!response.ok) throw new Error('Failed to fetch stats');
      const data = await response.json();
      setStats(data.stats);
    } catch (error) {
      console.error('Error fetching stats:', error);
    }
  };

  const clearFilters = () => {
    setActionFilter('');
    setCategoryFilter('');
    setUsernameFilter('');
    setTargetTypeFilter('');
    setEventKindFilter('');
    setOutcomeFilter('');
    setSuccessFilter('');
    setSearchQuery('');
    setStartDate('');
    setEndDate('');
    setDebouncedSearch('');
    setDebouncedUsername('');
    setCurrentPage(1);
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const getCategoryBadgeColor = (category: string) => {
    const colors: Record<string, string> = {
      navigation: 'bg-gray-100 text-gray-800',
      access_request: 'bg-blue-100 text-blue-800',
      event: 'bg-purple-100 text-purple-800',
      user: 'bg-green-100 text-green-800',
      group: 'bg-emerald-100 text-emerald-800',
      batch: 'bg-yellow-100 text-yellow-800',
      vpn: 'bg-indigo-100 text-indigo-800',
      support: 'bg-pink-100 text-pink-800',
      blocklist: 'bg-red-100 text-red-800',
      settings: 'bg-orange-100 text-orange-800',
      logs: 'bg-teal-100 text-teal-800',
      lifecycle: 'bg-cyan-100 text-cyan-800',
      sync_status: 'bg-sky-100 text-sky-800',
      session: 'bg-violet-100 text-violet-800',
      search: 'bg-lime-100 text-lime-800',
    };
    return colors[category] || 'bg-gray-100 text-gray-800';
  };

  const getActionDisplayName = (action: string) => {
    return action
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  if (isLoading && logs.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading audit logs...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white rounded-lg shadow-md p-6 border border-gray-200">
            <h3 className="text-sm font-medium text-gray-500 mb-2">Last 24 Hours</h3>
            <p className="text-3xl font-bold text-gray-900">{stats.last24Hours.toLocaleString()}</p>
            <p className="text-xs text-gray-500 mt-1">actions logged</p>
          </div>
          <div className="bg-white rounded-lg shadow-md p-6 border border-gray-200">
            <h3 className="text-sm font-medium text-gray-500 mb-2">Last 7 Days</h3>
            <p className="text-3xl font-bold text-gray-900">{stats.last7Days.toLocaleString()}</p>
            <p className="text-xs text-gray-500 mt-1">actions logged</p>
          </div>
          <div className="bg-white rounded-lg shadow-md p-6 border border-gray-200">
            <h3 className="text-sm font-medium text-gray-500 mb-2">Last 30 Days</h3>
            <p className="text-3xl font-bold text-gray-900">{stats.last30Days.toLocaleString()}</p>
            <p className="text-xs text-gray-500 mt-1">actions logged</p>
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row justify-end items-start sm:items-center gap-4">
        <div className="flex items-center gap-2 text-sm text-gray-500">
          {lastUpdated && (
            <span>Updated: {lastUpdated.toLocaleTimeString()}</span>
          )}
        </div>
        
        <div className="flex items-center gap-3">
          <Button
            variant={isPolling ? "outline" : "secondary"}
            onClick={togglePolling}
            className={`gap-2 ${
              isPolling 
                ? 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100 hover:text-green-800 focus:ring-green-500' 
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
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

      <Card>
        <CardContent className="p-0">
          <div className="px-6 py-4 border-b border-gray-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <h2 className="text-xl font-semibold text-gray-900">Filters</h2>
            <Button
              variant="outline"
              onClick={clearFilters}
              className="bg-gray-100 hover:bg-gray-200 text-gray-700 border-gray-200"
            >
              Clear Filters
            </Button>
          </div>
          <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-x-4 gap-y-4">
              <div className="flex flex-col">
                <label className="block text-sm font-medium text-gray-700 mb-2">Search</label>
                <div className="relative">
                  <Input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search logs..."
                    className="pl-9"
                  />
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                </div>
              </div>
              <div className="flex flex-col">
                <label className="block text-sm font-medium text-gray-700 mb-2">Category</label>
                <Select
                  value={categoryFilter}
                  onValueChange={setCategoryFilter}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="All Categories" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Categories</SelectItem>
                    <SelectItem value="navigation">Navigation</SelectItem>
                    <SelectItem value="access_request">Access Request</SelectItem>
                    <SelectItem value="event">Event</SelectItem>
                    <SelectItem value="user">User</SelectItem>
                    <SelectItem value="group">Group</SelectItem>
                    <SelectItem value="batch">Batch</SelectItem>
                    <SelectItem value="vpn">VPN</SelectItem>
                    <SelectItem value="support">Support</SelectItem>
                    <SelectItem value="blocklist">Blocklist</SelectItem>
                    <SelectItem value="settings">Settings</SelectItem>
                    <SelectItem value="logs">Logs</SelectItem>
                    <SelectItem value="lifecycle">Lifecycle</SelectItem>
                    <SelectItem value="sync_status">Sync Status</SelectItem>
                    <SelectItem value="session">Session</SelectItem>
                    <SelectItem value="search">Search</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col">
                <label className="block text-sm font-medium text-gray-700 mb-2">Username</label>
                <Input
                  type="text"
                  value={usernameFilter}
                  onChange={(e) => setUsernameFilter(e.target.value)}
                  placeholder="Filter by username"
                />
              </div>
              <div className="flex flex-col">
                <label className="block text-sm font-medium text-gray-700 mb-2">Status</label>
                <Select
                  value={successFilter}
                  onValueChange={setSuccessFilter}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="All Statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    <SelectItem value="true">Success</SelectItem>
                    <SelectItem value="false">Failed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col">
                <label className="block text-sm font-medium text-gray-700 mb-2">Action Type</label>
                <Select
                  value={actionFilter}
                  onValueChange={setActionFilter}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="All Actions" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Actions</SelectItem>
                    <SelectGroup>
                      <SelectLabel>Navigation</SelectLabel>
                      <SelectItem value="view_page">View Page</SelectItem>
                      <SelectItem value="switch_tab">Switch Tab</SelectItem>
                      <SelectItem value="admin_logout">Admin Logout</SelectItem>
                    </SelectGroup>
                    <SelectGroup>
                      <SelectLabel>Access Requests</SelectLabel>
                      <SelectItem value="view_request">View Request</SelectItem>
                      <SelectItem value="approve_request">Approve Request</SelectItem>
                      <SelectItem value="reject_request">Reject Request</SelectItem>
                      <SelectItem value="acknowledge_request">Acknowledge Request</SelectItem>
                      <SelectItem value="create_account">Create Account</SelectItem>
                      <SelectItem value="send_to_faculty">Send to Faculty</SelectItem>
                    </SelectGroup>
                    <SelectGroup>
                      <SelectLabel>VPN Management</SelectLabel>
                      <SelectItem value="create_vpn_account">Create VPN Account</SelectItem>
                      <SelectItem value="update_vpn_account">Update VPN Account</SelectItem>
                      <SelectItem value="disable_vpn_account">Disable VPN Account</SelectItem>
                      <SelectItem value="enable_vpn_account">Enable VPN Account</SelectItem>
                    </SelectGroup>
                    <SelectGroup>
                      <SelectLabel>User Management</SelectLabel>
                      <SelectItem value="view_user">View User</SelectItem>
                      <SelectItem value="update_user">Update User</SelectItem>
                      <SelectItem value="disable_user">Disable User</SelectItem>
                      <SelectItem value="enable_user">Enable User</SelectItem>
                    </SelectGroup>
                    <SelectGroup>
                      <SelectLabel>Group Management</SelectLabel>
                      <SelectItem value="add_group_member">Add Group Member</SelectItem>
                      <SelectItem value="remove_group_member">Remove Group Member</SelectItem>
                    </SelectGroup>
                    <SelectGroup>
                      <SelectLabel>Lifecycle</SelectLabel>
                      <SelectItem value="create_lifecycle_action">Create Lifecycle Action</SelectItem>
                      <SelectItem value="process_lifecycle_action">Process Lifecycle Action</SelectItem>
                      <SelectItem value="cancel_lifecycle_action">Cancel Lifecycle Action</SelectItem>
                    </SelectGroup>
                    <SelectGroup>
                      <SelectLabel>Settings</SelectLabel>
                      <SelectItem value="update_settings">Update Settings</SelectItem>
                      <SelectItem value="toggle_login">Toggle Login</SelectItem>
                      <SelectItem value="toggle_registration">Toggle Registration</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col">
                <label className="block text-sm font-medium text-gray-700 mb-2">Target Type</label>
                <Select
                  value={targetTypeFilter}
                  onValueChange={setTargetTypeFilter}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="All Targets" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Targets</SelectItem>
                    <SelectItem value="AccessRequest">Access Request</SelectItem>
                    <SelectItem value="VPNAccount">VPN Account</SelectItem>
                    <SelectItem value="User">User</SelectItem>
                    <SelectItem value="Event">Event</SelectItem>
                    <SelectItem value="SupportTicket">Support Ticket</SelectItem>
                    <SelectItem value="BatchAccountCreation">Batch Creation</SelectItem>
                    <SelectItem value="BlockedEmail">Blocked Email</SelectItem>
                    <SelectItem value="AccountLifecycleAction">Lifecycle Action</SelectItem>
                    <SelectItem value="Group">Group</SelectItem>
                    <SelectItem value="Settings">Settings</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col">
                <label className="block text-sm font-medium text-gray-700 mb-2">Event Kind</label>
                <Select
                  value={eventKindFilter}
                  onValueChange={setEventKindFilter}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="All Events" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Events</SelectItem>
                    <SelectItem value="read">Read</SelectItem>
                    <SelectItem value="write">Write</SelectItem>
                    <SelectItem value="security">Security</SelectItem>
                    <SelectItem value="notification">Notification</SelectItem>
                    <SelectItem value="lifecycle">Lifecycle</SelectItem>
                    <SelectItem value="sync">Sync</SelectItem>
                    <SelectItem value="system">System</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col">
                <label className="block text-sm font-medium text-gray-700 mb-2">Outcome</label>
                <Select
                  value={outcomeFilter}
                  onValueChange={setOutcomeFilter}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="All Outcomes" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Outcomes</SelectItem>
                    <SelectItem value="success">Success</SelectItem>
                    <SelectItem value="failure">Failure</SelectItem>
                    <SelectItem value="denied">Denied</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="rollback">Rollback</SelectItem>
                    <SelectItem value="skipped">Skipped</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col">
                <DateTimePicker
                  label="Start Date"
                  value={startDate}
                  onChange={setStartDate}
                  placeholder="Filter by start date/time"
                />
              </div>
              <div className="flex flex-col">
                <DateTimePicker
                  label="End Date"
                  value={endDate}
                  onChange={setEndDate}
                  placeholder="Filter by end date/time"
                />
              </div>
              <div className="flex flex-col">
                <label className="block text-sm font-medium text-gray-700 mb-2">Rows per page</label>
                <Select
                  value={limit.toString()}
                  onValueChange={(value) => {
                    setLimit(parseInt(value));
                    setCurrentPage(1);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="50" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="25">25</SelectItem>
                    <SelectItem value="50">50</SelectItem>
                    <SelectItem value="100">100</SelectItem>
                    <SelectItem value="200">200</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="bg-white rounded-lg shadow-md border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
          <h2 className="text-xl font-semibold text-gray-900">Audit Logs</h2>
          <span className="text-sm text-gray-600">{totalLogs.toLocaleString()} total logs</span>
        </div>
        
        <Table>
          <TableHeader className="bg-gray-50">
            <TableRow>
              <TableHead className="w-[180px]">Timestamp</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Username</TableHead>
              <TableHead>Subject</TableHead>
              <TableHead>Event</TableHead>
              <TableHead>Target</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {logs.length === 0 ? (
              <TableRow>
                 <TableCell colSpan={9} className="h-24 text-center">
                  No logs found matching your filters
                </TableCell>
              </TableRow>
            ) : (
              logs.map((log) => (
                <TableRow key={log.id} className="hover:bg-gray-50">
                  <TableCell className="whitespace-nowrap font-medium">
                    {formatDate(log.createdAt)}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`font-medium rounded-full ${getCategoryBadgeColor(log.category)}`}>
                      {log.category}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {getActionDisplayName(log.action)}
                  </TableCell>
                  <TableCell className="font-medium">
                    <div>{log.username}</div>
                    {log.actorType && <div className="text-xs text-gray-500 capitalize">{log.actorType}</div>}
                  </TableCell>
                  <TableCell className="text-gray-500">
                    {log.subjectUsername || log.subjectEmail ? (
                      <div>
                        {log.subjectUsername && <div className="font-medium text-gray-700">{log.subjectUsername}</div>}
                        {log.subjectEmail && <div className="text-xs text-gray-500 truncate max-w-xs">{log.subjectEmail}</div>}
                      </div>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      {log.eventKind && <Badge variant="outline" className="capitalize w-fit">{log.eventKind}</Badge>}
                      {log.outcome && <span className="text-xs text-gray-500 capitalize">{log.outcome}</span>}
                    </div>
                  </TableCell>
                  <TableCell className="text-gray-500">
                    {log.targetType && log.targetId ? (
                      <div>
                        <div className="font-medium text-gray-700">{log.targetType}</div>
                        <div className="text-xs text-gray-500 truncate max-w-xs">{log.targetId}</div>
                      </div>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {log.success ? (
                      <Badge variant="secondary" className="bg-green-100 text-green-800">
                        Success
                      </Badge>
                    ) : (
                      <Badge variant="destructive" className="bg-red-100 text-red-800 hover:bg-red-100">
                        Failed
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="link"
                      onClick={() => setSelectedLog(log)}
                      className="text-blue-600 hover:text-blue-800 p-0 h-auto font-medium"
                    >
                      View
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        {totalPages > 1 && (
          <div className="px-6 py-4 border-t border-gray-200 flex flex-col sm:flex-row items-center justify-between gap-3 bg-gray-50">
            <div className="text-sm text-gray-700">
              Showing page {currentPage} of {totalPages}
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="gap-1"
              >
                <ChevronLeft className="h-4 w-4" />
                Previous
              </Button>
              <Button
                variant="outline"
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="gap-1"
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>

      <Dialog open={!!selectedLog} onOpenChange={(open) => !open && setSelectedLog(null)}>
        {selectedLog && (
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto flex flex-col p-0 gap-0">
            <DialogHeader className="p-6 pb-2 border-b">
              <div className="flex justify-between items-center">
                <DialogTitle className="text-xl font-bold text-gray-900">Log Details</DialogTitle>
              </div>
            </DialogHeader>
            <div className="p-6 space-y-4 flex-1 overflow-y-auto">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-500">Timestamp</label>
                  <p className="mt-1 text-sm text-gray-900">{formatDate(selectedLog.createdAt)}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-500">Username</label>
                  <p className="mt-1 text-sm text-gray-900 font-medium">{selectedLog.username}</p>
                </div>
                {selectedLog.actorType && (
                  <div>
                    <label className="block text-sm font-medium text-gray-500">Actor Type</label>
                    <p className="mt-1 text-sm text-gray-900 capitalize">{selectedLog.actorType}</p>
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium text-gray-500">Category</label>
                  <div className="mt-1">
                    <Badge variant="outline" className={`font-medium rounded-full ${getCategoryBadgeColor(selectedLog.category)}`}>
                      {selectedLog.category}
                    </Badge>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-500">Action</label>
                  <p className="mt-1 text-sm text-gray-900">{getActionDisplayName(selectedLog.action)}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-500">Status</label>
                  <div className="mt-1">
                    {selectedLog.success ? (
                      <Badge variant="secondary" className="bg-green-100 text-green-800">
                        Success
                      </Badge>
                    ) : (
                      <Badge variant="destructive" className="bg-red-100 text-red-800 hover:bg-red-100">
                        Failed
                      </Badge>
                    )}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-500">Log ID</label>
                  <p className="mt-1 text-gray-900 font-mono text-xs">{selectedLog.id}</p>
                </div>
                {(selectedLog.eventKind || selectedLog.outcome) && (
                  <div>
                    <label className="block text-sm font-medium text-gray-500">History Classification</label>
                    <div className="mt-1 flex flex-wrap gap-2">
                      {selectedLog.eventKind && <Badge variant="outline" className="capitalize">{selectedLog.eventKind}</Badge>}
                      {selectedLog.outcome && <Badge variant="secondary" className="capitalize">{selectedLog.outcome}</Badge>}
                    </div>
                  </div>
                )}
              </div>

              {(selectedLog.subjectUsername || selectedLog.subjectEmail || selectedLog.relatedRequestId || selectedLog.relatedVpnAccountId || selectedLog.relatedLifecycleActionId || selectedLog.correlationId) && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded border border-gray-200 bg-gray-50 p-3">
                  {selectedLog.subjectUsername && (
                    <div>
                      <label className="block text-xs font-medium text-gray-500">Subject Username</label>
                      <p className="mt-1 text-sm text-gray-900 font-mono">{selectedLog.subjectUsername}</p>
                    </div>
                  )}
                  {selectedLog.subjectEmail && (
                    <div>
                      <label className="block text-xs font-medium text-gray-500">Subject Email</label>
                      <p className="mt-1 text-sm text-gray-900 break-all">{selectedLog.subjectEmail}</p>
                    </div>
                  )}
                  {selectedLog.relatedRequestId && (
                    <div>
                      <label className="block text-xs font-medium text-gray-500">Related Request</label>
                      <p className="mt-1 text-xs text-gray-900 font-mono break-all">{selectedLog.relatedRequestId}</p>
                    </div>
                  )}
                  {selectedLog.relatedVpnAccountId && (
                    <div>
                      <label className="block text-xs font-medium text-gray-500">Related VPN Account</label>
                      <p className="mt-1 text-xs text-gray-900 font-mono break-all">{selectedLog.relatedVpnAccountId}</p>
                    </div>
                  )}
                  {selectedLog.relatedLifecycleActionId && (
                    <div>
                      <label className="block text-xs font-medium text-gray-500">Related Lifecycle Action</label>
                      <p className="mt-1 text-xs text-gray-900 font-mono break-all">{selectedLog.relatedLifecycleActionId}</p>
                    </div>
                  )}
                  {selectedLog.correlationId && (
                    <div>
                      <label className="block text-xs font-medium text-gray-500">Correlation ID</label>
                      <p className="mt-1 text-xs text-gray-900 font-mono break-all">{selectedLog.correlationId}</p>
                    </div>
                  )}
                </div>
              )}

              {selectedLog.targetType && (
                <div>
                  <label className="block text-sm font-medium text-gray-500">Target</label>
                  <p className="mt-1 text-sm text-gray-900">
                    <span className="font-medium">{selectedLog.targetType}</span>
                    {selectedLog.targetId && (
                      <span className="text-gray-500 ml-2 font-mono text-xs">{selectedLog.targetId}</span>
                    )}
                  </p>
                </div>
              )}

              {selectedLog.ipAddress && (
                <div>
                  <label className="block text-sm font-medium text-gray-500">IP Address</label>
                  <p className="mt-1 text-sm text-gray-900 font-mono">{selectedLog.ipAddress}</p>
                </div>
              )}

              {selectedLog.userAgent && (
                <div>
                  <label className="block text-sm font-medium text-gray-500">User Agent</label>
                  <p className="mt-1 text-sm text-gray-900 break-all">{selectedLog.userAgent}</p>
                </div>
              )}

              {selectedLog.errorMessage && (
                <div>
                  <label className="block text-sm font-medium text-red-500">Error Message</label>
                  <p className="mt-1 text-sm text-red-700 bg-red-50 p-3 rounded border border-red-200 whitespace-pre-wrap wrap-break-word">
                    {selectedLog.errorMessage}
                  </p>
                </div>
              )}

              {selectedLog.details && Object.keys(selectedLog.details).length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-500 mb-2">Additional Details</label>
                  <pre className="mt-1 max-h-80 overflow-y-auto text-xs text-gray-900 bg-gray-50 p-4 rounded border border-gray-200 whitespace-pre-wrap wrap-break-word">
                    {JSON.stringify(selectedLog.details, null, 2)}
                  </pre>
                </div>
              )}
            </div>
            <div className="sticky bottom-0 bg-gray-50 px-6 py-4 border-t border-gray-200 rounded-b-lg">
              <Button
                onClick={() => setSelectedLog(null)}
                className="w-full bg-black text-white hover:bg-gray-800"
              >
                Close
              </Button>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
