'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { useToast } from '@/hooks/useToast';
import { usePolling } from '@/hooks/usePolling';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { 
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Search, RefreshCw, Download, Filter } from "lucide-react";
import { Label } from "@/components/ui/label";

export interface SyncStatusAccount {
  // Core identity
  identifier: string; // Primary identifier (AD username, email, or VPN username)
  name: string;
  email: string | null;
  
  // AD Status
  hasAdAccount: boolean;
  adUsername: string | null;
  adDisplayName: string | null;
  adEmail: string | null;
  adSyncDate: string | null;
  
  // VPN Status
  hasVpnAccount: boolean;
  vpnUsername: string | null;
  vpnPortalType: string | null;
  vpnStatus: string | null;
  vpnCreatedAt: string | null;
  
  // Access Request Status
  hasAccessRequest: boolean;
  requestId: string | null;
  requestStatus: string | null;
  requestCreatedAt: string | null;
  isManuallyAssigned: boolean;
  
  // Sync Status
  syncStatus: 'fully_synced' | 'partial_sync' | 'ad_only' | 'vpn_only' | 'request_only' | 'orphaned';
  syncIssues: string[];
  lastSyncId: string | null;
  wasAutoAssigned: boolean;
}

interface LatestSyncInfo {
  id: string;
  createdAt: string;
  completedAt: string | null;
  status: string;
  totalADAccounts: number;
  totalVPNAccounts: number;
  matchedAccounts: number;
  unmatchedAD: number;
  unmatchedVPN: number;
  autoAssigned: number;
}

interface SyncStatusTabProps {
  accounts?: SyncStatusAccount[];
  isLoading?: boolean;
  latestSync?: LatestSyncInfo | null;
}

type SyncFilter = 'all' | 'fully_synced' | 'partial_sync' | 'ad_only' | 'vpn_only' | 'request_only' | 'orphaned' | 'issues';
type DataSourceFilter = 'all' | 'has_ad' | 'has_vpn' | 'has_request' | 'missing_ad' | 'missing_vpn' | 'missing_request';

function textMatches(value: string | null | undefined, query: string): boolean {
  return (value ?? '').toLowerCase().includes(query);
}

export function matchesSyncStatusSearch(account: SyncStatusAccount, searchQuery: string): boolean {
  const query = searchQuery.trim().toLowerCase();
  if (!query) return true;

  return [
    account.identifier,
    account.name,
    account.email,
    account.adUsername,
    account.vpnUsername,
  ].some(value => textMatches(value, query));
}

export default function AccountSyncStatusTab({ accounts, isLoading = false, latestSync = null }: SyncStatusTabProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [syncFilter, setSyncFilter] = useState<SyncFilter>('all');
  const [dataSourceFilter, setDataSourceFilter] = useState<DataSourceFilter>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sortField, setSortField] = useState<'identifier' | 'name' | 'syncStatus' | 'adSyncDate'>('identifier');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<SyncStatusAccount | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [localAccounts, setLocalAccounts] = useState<SyncStatusAccount[]>(accounts ?? []);
  const [localLatestSync, setLocalLatestSync] = useState<LatestSyncInfo | null>(latestSync);
  const { showToast } = useToast();

  const fetchSyncData = useCallback(async () => {
    const response = await fetch('/api/admin/sync-status');
    if (!response.ok) throw new Error('Failed to fetch sync status');
    return await response.json();
  }, []);

  const { 
    isLoading: isPollingLoading, 
    isPolling, 
    togglePolling, 
    refresh,
    lastUpdated 
  } = usePolling(fetchSyncData, {
    interval: 30000,
    onSuccess: (data) => {
      if (data.accounts) setLocalAccounts(data.accounts);
      if (data.latestSync) setLocalLatestSync(data.latestSync);
    }
  });

  useEffect(() => {
    if (accounts !== undefined) {
      setLocalAccounts(accounts);
    }
  }, [accounts]);

  useEffect(() => {
    setLocalLatestSync(latestSync);
  }, [latestSync]);

  // Statistics
  const stats = useMemo(() => ({
    total: localAccounts.length,
    fullySynced: localAccounts.filter(a => a.syncStatus === 'fully_synced').length,
    partialSync: localAccounts.filter(a => a.syncStatus === 'partial_sync').length,
    adOnly: localAccounts.filter(a => a.syncStatus === 'ad_only').length,
    vpnOnly: localAccounts.filter(a => a.syncStatus === 'vpn_only').length,
    requestOnly: localAccounts.filter(a => a.syncStatus === 'request_only').length,
    orphaned: localAccounts.filter(a => a.syncStatus === 'orphaned').length,
    withIssues: localAccounts.filter(a => a.syncIssues.length > 0).length,
    hasAd: localAccounts.filter(a => a.hasAdAccount).length,
    hasVpn: localAccounts.filter(a => a.hasVpnAccount).length,
    hasRequest: localAccounts.filter(a => a.hasAccessRequest).length,
    autoAssigned: localAccounts.filter(a => a.wasAutoAssigned).length,
  }), [localAccounts]);

  // Filtering
  const filteredAccounts = useMemo(() => {
    let filtered = localAccounts;

    // Search
    if (searchQuery.trim()) {
      filtered = filtered.filter(a => matchesSyncStatusSearch(a, searchQuery));
    }

    // Sync status filter
    if (syncFilter !== 'all') {
      if (syncFilter === 'issues') {
        filtered = filtered.filter(a => a.syncIssues.length > 0);
      } else {
        filtered = filtered.filter(a => a.syncStatus === syncFilter);
      }
    }

    // Data source filter
    if (dataSourceFilter !== 'all') {
      switch (dataSourceFilter) {
        case 'has_ad':
          filtered = filtered.filter(a => a.hasAdAccount);
          break;
        case 'has_vpn':
          filtered = filtered.filter(a => a.hasVpnAccount);
          break;
        case 'has_request':
          filtered = filtered.filter(a => a.hasAccessRequest);
          break;
        case 'missing_ad':
          filtered = filtered.filter(a => !a.hasAdAccount);
          break;
        case 'missing_vpn':
          filtered = filtered.filter(a => !a.hasVpnAccount);
          break;
        case 'missing_request':
          filtered = filtered.filter(a => !a.hasAccessRequest);
          break;
      }
    }

    return filtered;
  }, [localAccounts, searchQuery, syncFilter, dataSourceFilter]);

  // Sorting
  const sortedAccounts = useMemo(() => {
    const sorted = [...filteredAccounts];
    sorted.sort((a, b) => {
      let aVal: string | number | null | undefined = a[sortField];
      let bVal: string | number | null | undefined = b[sortField];

      if (sortField === 'adSyncDate') {
        aVal = a.adSyncDate ? new Date(a.adSyncDate).getTime() : 0;
        bVal = b.adSyncDate ? new Date(b.adSyncDate).getTime() : 0;
      }

      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;

      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortDirection === 'asc'
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      }
      
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
      }
      
      return 0;
    });
    return sorted;
  }, [filteredAccounts, sortField, sortDirection]);

  // Pagination
  const paginatedAccounts = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return sortedAccounts.slice(start, start + pageSize);
  }, [sortedAccounts, currentPage, pageSize]);

  const totalPages = Math.ceil(sortedAccounts.length / pageSize);

  const handleSort = (field: typeof sortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const getSyncStatusBadge = (status: SyncStatusAccount['syncStatus']) => {
    const styles = {
      fully_synced: 'bg-green-100 text-green-800 border-green-200 hover:bg-green-100',
      partial_sync: 'bg-yellow-100 text-yellow-800 border-yellow-200 hover:bg-yellow-100',
      ad_only: 'bg-blue-100 text-blue-800 border-blue-200 hover:bg-blue-100',
      vpn_only: 'bg-purple-100 text-purple-800 border-purple-200 hover:bg-purple-100',
      request_only: 'bg-orange-100 text-orange-800 border-orange-200 hover:bg-orange-100',
      orphaned: 'bg-red-100 text-red-800 border-red-200 hover:bg-red-100',
    };
    const labels = {
      fully_synced: 'Fully Synced',
      partial_sync: 'Partial Sync',
      ad_only: 'AD Only',
      vpn_only: 'VPN Only',
      request_only: 'Request Only',
      orphaned: 'Orphaned',
    };
    return (
      <Badge variant="outline" className={`${styles[status]} font-normal`}>
        {labels[status]}
      </Badge>
    );
  };

  const exportToCSV = () => {
    const headers = [
      'Identifier',
      'Name',
      'Email',
      'Sync Status',
      'Has AD',
      'AD Username',
      'Has VPN',
      'VPN Username',
      'VPN Portal',
      'Has Request',
      'Request Status',
      'Sync Issues',
      'Last Sync',
    ];
    
    const csvData = sortedAccounts.map(acc => [
      acc.identifier,
      acc.name,
      acc.email || '',
      acc.syncStatus,
      acc.hasAdAccount ? 'Yes' : 'No',
      acc.adUsername || 'N/A',
      acc.hasVpnAccount ? 'Yes' : 'No',
      acc.vpnUsername || 'N/A',
      acc.vpnPortalType || 'N/A',
      acc.hasAccessRequest ? 'Yes' : 'No',
      acc.requestStatus || 'N/A',
      acc.syncIssues.join('; ') || 'None',
      acc.adSyncDate ? new Date(acc.adSyncDate).toLocaleDateString() : 'Never',
    ]);

    const csv = [headers, ...csvData].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `account-sync-status-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('CSV exported successfully', 'success');
  };

  const openDetailModal = (account: SyncStatusAccount) => {
    setSelectedAccount(account);
    setShowDetailModal(true);
  };

  return (
    <div className="space-y-6">
      {localLatestSync && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-lg font-semibold">Latest Sync Information</CardTitle>
            <Badge variant={
              localLatestSync.status === 'completed' ? 'default' :
              localLatestSync.status === 'running' ? 'secondary' :
              'destructive'
            }>
              {localLatestSync.status.charAt(0).toUpperCase() + localLatestSync.status.slice(1)}
            </Badge>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            <div>
              <p className="text-sm text-gray-500">Started</p>
              <p className="text-lg font-semibold text-gray-900">
                {new Date(localLatestSync.createdAt).toLocaleString()}
              </p>
            </div>
            {localLatestSync.completedAt && (
              <div>
                <p className="text-sm text-gray-500">Completed</p>
                <p className="text-lg font-semibold text-gray-900">
                  {new Date(localLatestSync.completedAt).toLocaleString()}
                </p>
              </div>
            )}
            <div>
              <p className="text-sm text-gray-500">AD Accounts</p>
              <p className="text-lg font-semibold text-gray-900">{localLatestSync.totalADAccounts}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">VPN Accounts</p>
              <p className="text-lg font-semibold text-gray-900">{localLatestSync.totalVPNAccounts}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Matched</p>
              <p className="text-lg font-semibold text-green-600">{localLatestSync.matchedAccounts}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Auto-Assigned</p>
              <p className="text-lg font-semibold text-blue-600">{localLatestSync.autoAssigned}</p>
            </div>
          </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-gray-500">Total Accounts</p>
            <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
          </CardContent>
        </Card>
        <Card className="bg-green-50 border-green-200">
          <CardContent className="p-4">
            <p className="text-sm text-green-700">Fully Synced</p>
            <p className="text-2xl font-bold text-green-900">{stats.fullySynced}</p>
          </CardContent>
        </Card>
        <Card className="bg-yellow-50 border-yellow-200">
          <CardContent className="p-4">
            <p className="text-sm text-yellow-700">Partial Sync</p>
            <p className="text-2xl font-bold text-yellow-900">{stats.partialSync}</p>
          </CardContent>
        </Card>
        <Card className="bg-red-50 border-red-200">
          <CardContent className="p-4">
            <p className="text-sm text-red-700">With Issues</p>
            <p className="text-2xl font-bold text-red-900">{stats.withIssues}</p>
          </CardContent>
        </Card>
        <Card className="bg-blue-50 border-blue-200">
          <CardContent className="p-4">
            <p className="text-sm text-blue-700">AD Only</p>
            <p className="text-2xl font-bold text-blue-900">{stats.adOnly}</p>
          </CardContent>
        </Card>
        <Card className="bg-purple-50 border-purple-200">
          <CardContent className="p-4">
            <p className="text-sm text-purple-700">VPN Only</p>
            <p className="text-2xl font-bold text-purple-900">{stats.vpnOnly}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="flex flex-col lg:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-500" />
              <Input
                type="text"
                placeholder="Search by identifier, name, email, username..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8"
              />
            </div>
            <div className="flex gap-2 items-center">
              <div className="flex items-center gap-2 mr-2 bg-gray-50 px-3 py-1.5 rounded-lg border border-gray-200 h-10">
                <div className={`w-2 h-2 rounded-full ${isPolling ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`}></div>
                <span className="text-xs text-gray-500">
                  {isPolling ? 'Live updates' : 'Paused'}
                </span>
                <div className="h-4 w-px bg-gray-300 mx-1"></div>
                <Button
                  variant="link"
                  onClick={() => togglePolling()}
                  className="text-xs font-medium h-auto p-0"
                >
                  {isPolling ? 'Pause' : 'Resume'}
                </Button>
              </div>

              {lastUpdated && (
                <span className="text-xs text-gray-500 hidden xl:inline-block mr-2">
                  Updated: {lastUpdated.toLocaleTimeString()}
                </span>
              )}

              <Button
                variant="default"
                onClick={() => refresh()}
                disabled={isPollingLoading || isLoading}
                className="gap-2"
              >
                <RefreshCw className={`h-4 w-4 ${isPollingLoading || isLoading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
              <Button
                variant="outline"
                onClick={exportToCSV}
                className="gap-2"
              >
                <Download className="h-4 w-4" />
                Export CSV
              </Button>
              <Button
                variant="secondary"
                onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
                className="gap-2"
              >
                <Filter className="h-4 w-4" />
                {showAdvancedFilters ? 'Hide' : 'Show'} Filters
              </Button>
            </div>
          </div>

          {showAdvancedFilters && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-gray-50 rounded-lg">
              <div className="space-y-2">
                <Label>Sync Status</Label>
                <Select
                  value={syncFilter}
                  onValueChange={(value) => setSyncFilter(value as SyncFilter)}
                >
                  <SelectTrigger className="bg-white">
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    <SelectItem value="fully_synced">Fully Synced</SelectItem>
                    <SelectItem value="partial_sync">Partial Sync</SelectItem>
                    <SelectItem value="ad_only">AD Only</SelectItem>
                    <SelectItem value="vpn_only">VPN Only</SelectItem>
                    <SelectItem value="request_only">Request Only</SelectItem>
                    <SelectItem value="orphaned">Orphaned</SelectItem>
                    <SelectItem value="issues">Has Issues</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Data Source</Label>
                <Select
                  value={dataSourceFilter}
                  onValueChange={(value) => setDataSourceFilter(value as DataSourceFilter)}
                >
                  <SelectTrigger className="bg-white">
                    <SelectValue placeholder="Select data source" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Sources</SelectItem>
                    <SelectItem value="has_ad">Has AD Account</SelectItem>
                    <SelectItem value="has_vpn">Has VPN Account</SelectItem>
                    <SelectItem value="has_request">Has Access Request</SelectItem>
                    <SelectItem value="missing_ad">Missing AD</SelectItem>
                    <SelectItem value="missing_vpn">Missing VPN</SelectItem>
                    <SelectItem value="missing_request">Missing Request</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between text-sm text-gray-600 pt-2">
            <span>
              Showing {paginatedAccounts.length} of {sortedAccounts.length} accounts
              {sortedAccounts.length !== stats.total && ` (filtered from ${stats.total} total)`}
            </span>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">Per page:</span>
              <Select
                value={pageSize.toString()}
                onValueChange={(value) => {
                  setPageSize(Number(value));
                  setCurrentPage(1);
                }}
              >
                <SelectTrigger className="w-[70px] h-8">
                  <SelectValue placeholder="25" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">10</SelectItem>
                  <SelectItem value="25">25</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                  <SelectItem value="100">100</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="rounded-md border bg-white">
        <Table>
            <TableHeader className="bg-gray-50">
              <TableRow>
                <TableHead
                  onClick={() => handleSort('identifier')}
                  className="cursor-pointer hover:bg-gray-100 w-[200px]"
                >
                  Identifier {sortField === 'identifier' && (sortDirection === 'asc' ? '↑' : '↓')}
                </TableHead>
                <TableHead
                  onClick={() => handleSort('name')}
                  className="cursor-pointer hover:bg-gray-100"
                >
                  Name {sortField === 'name' && (sortDirection === 'asc' ? '↑' : '↓')}
                </TableHead>
                <TableHead>
                  Email
                </TableHead>
                <TableHead
                  onClick={() => handleSort('syncStatus')}
                  className="cursor-pointer hover:bg-gray-100"
                >
                  Sync Status {sortField === 'syncStatus' && (sortDirection === 'asc' ? '↑' : '↓')}
                </TableHead>
                <TableHead>AD</TableHead>
                <TableHead>VPN</TableHead>
                <TableHead>Request</TableHead>
                <TableHead>Issues</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedAccounts.map((account) => (
                <TableRow key={account.identifier} className="hover:bg-gray-50">
                  <TableCell className="font-medium">
                    <div className="text-sm font-medium text-gray-900">{account.identifier}</div>
                    {account.wasAutoAssigned && (
                      <span className="text-xs text-blue-600">Auto-assigned</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {account.name}
                  </TableCell>
                  <TableCell className="text-gray-500">
                    {account.email || <span className="text-gray-400">—</span>}
                  </TableCell>
                  <TableCell>
                    {getSyncStatusBadge(account.syncStatus)}
                  </TableCell>
                  <TableCell>
                    {account.hasAdAccount ? (
                      <div className="text-sm">
                        <div className="text-green-600 font-medium whitespace-nowrap">✓ {account.adUsername}</div>
                        <div className="text-xs text-gray-500">{account.adDisplayName}</div>
                      </div>
                    ) : (
                      <span className="text-sm text-gray-400">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {account.hasVpnAccount ? (
                      <div className="text-sm">
                        <div className="text-green-600 font-medium whitespace-nowrap">✓ {account.vpnUsername}</div>
                        <div className="text-xs text-gray-500">{account.vpnPortalType}</div>
                      </div>
                    ) : (
                      <span className="text-sm text-gray-400">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {account.hasAccessRequest ? (
                      <div className="text-sm">
                        <div className="text-green-600 font-medium">✓</div>
                        <div className="text-xs text-gray-500">{account.requestStatus}</div>
                      </div>
                    ) : (
                      <span className="text-sm text-gray-400">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {account.syncIssues.length > 0 ? (
                      <div className="text-xs text-red-600">
                        {account.syncIssues.length} issue{account.syncIssues.length > 1 ? 's' : ''}
                      </div>
                    ) : (
                      <span className="text-sm text-gray-400">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="link"
                      onClick={() => openDetailModal(account)}
                      className="text-blue-600 hover:text-blue-800 p-0 h-auto font-medium"
                    >
                      View Details
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
        </Table>

        {totalPages > 1 && (
          <div className="p-4 border-t flex items-center justify-between">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
              disabled={currentPage === 1}
            >
              Previous
            </Button>
            <span className="text-sm text-gray-700">
              Page {currentPage} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage === totalPages}
            >
              Next
            </Button>
          </div>
        )}
      </div>

      <Dialog open={showDetailModal} onOpenChange={setShowDetailModal}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold">Account Sync Details</DialogTitle>
          </DialogHeader>

          {selectedAccount && (
            <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-3">Identity</h3>
                  <div className="bg-gray-50 rounded-lg p-4 space-y-2">
                    <div className="flex justify-between">
                      <span className="text-sm font-medium text-gray-500">Identifier:</span>
                      <span className="text-sm text-gray-900 font-mono">{selectedAccount.identifier}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm font-medium text-gray-500">Name:</span>
                      <span className="text-sm text-gray-900">{selectedAccount.name}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm font-medium text-gray-500">Email:</span>
                      <span className="text-sm text-gray-900">{selectedAccount.email || <span className="text-gray-400">—</span>}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm font-medium text-gray-500">Sync Status:</span>
                      {getSyncStatusBadge(selectedAccount.syncStatus)}
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-3">Active Directory</h3>
                  <div className="bg-gray-50 rounded-lg p-4 space-y-2">
                    {selectedAccount.hasAdAccount ? (
                      <>
                        <div className="flex justify-between">
                          <span className="text-sm font-medium text-gray-500">Status:</span>
                          <span className="text-sm text-green-600 font-medium">✓ Active</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm font-medium text-gray-500">Username:</span>
                          <span className="text-sm text-gray-900 font-mono">{selectedAccount.adUsername}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm font-medium text-gray-500">Display Name:</span>
                          <span className="text-sm text-gray-900">{selectedAccount.adDisplayName}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm font-medium text-gray-500">Email:</span>
                          <span className="text-sm text-gray-900">{selectedAccount.adEmail || <span className="text-gray-400">—</span>}</span>
                        </div>
                        {selectedAccount.adSyncDate && (
                          <div className="flex justify-between">
                            <span className="text-sm font-medium text-gray-500">Last Synced:</span>
                            <span className="text-sm text-gray-900">
                              {new Date(selectedAccount.adSyncDate).toLocaleString()}
                            </span>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="text-sm text-red-600">No AD account found</div>
                    )}
                  </div>
                </div>

                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-3">VPN Access</h3>
                  <div className="bg-gray-50 rounded-lg p-4 space-y-2">
                    {selectedAccount.hasVpnAccount ? (
                      <>
                        <div className="flex justify-between">
                          <span className="text-sm font-medium text-gray-500">Status:</span>
                          <span className="text-sm text-green-600 font-medium">✓ Active</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm font-medium text-gray-500">Username:</span>
                          <span className="text-sm text-gray-900 font-mono">{selectedAccount.vpnUsername}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm font-medium text-gray-500">Portal Type:</span>
                          <span className="text-sm text-gray-900">{selectedAccount.vpnPortalType}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm font-medium text-gray-500">Account Status:</span>
                          <span className="text-sm text-gray-900">{selectedAccount.vpnStatus}</span>
                        </div>
                        {selectedAccount.vpnCreatedAt && (
                          <div className="flex justify-between">
                            <span className="text-sm font-medium text-gray-500">Created:</span>
                            <span className="text-sm text-gray-900">
                              {new Date(selectedAccount.vpnCreatedAt).toLocaleString()}
                            </span>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="text-sm text-red-600">No VPN account found</div>
                    )}
                  </div>
                </div>

                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-3">Access Request</h3>
                  <div className="bg-gray-50 rounded-lg p-4 space-y-2">
                    {selectedAccount.hasAccessRequest ? (
                      <>
                        <div className="flex justify-between">
                          <span className="text-sm font-medium text-gray-500">Status:</span>
                          <span className="text-sm text-green-600 font-medium">✓ Exists</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm font-medium text-gray-500">Request ID:</span>
                          <span className="text-sm text-gray-900 font-mono">{selectedAccount.requestId}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm font-medium text-gray-500">Request Status:</span>
                          <span className="text-sm text-gray-900">{selectedAccount.requestStatus}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm font-medium text-gray-500">Manually Assigned:</span>
                          <span className="text-sm text-gray-900">
                            {selectedAccount.isManuallyAssigned ? 'Yes' : 'No'}
                          </span>
                        </div>
                        {selectedAccount.requestCreatedAt && (
                          <div className="flex justify-between">
                            <span className="text-sm font-medium text-gray-500">Created:</span>
                            <span className="text-sm text-gray-900">
                              {new Date(selectedAccount.requestCreatedAt).toLocaleString()}
                            </span>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="text-sm text-red-600">No access request found</div>
                    )}
                  </div>
                </div>

                {selectedAccount.syncIssues.length > 0 && (
                  <div>
                    <h3 className="text-lg font-semibold text-red-900 mb-3">Sync Issues</h3>
                    <div className="bg-red-50 rounded-lg p-4 border border-red-200">
                      <ul className="list-disc list-inside space-y-1">
                        {selectedAccount.syncIssues.map((issue, index) => (
                          <li key={index} className="text-sm text-red-800">
                            {issue}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}
            </div>
          )}
        </DialogContent>
      </Dialog>

    </div>
  );
}
