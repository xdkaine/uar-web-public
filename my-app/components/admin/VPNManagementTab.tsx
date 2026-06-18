'use client';

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useToast } from '@/hooks/useToast';
import { fetchWithCsrf } from '@/lib/csrf';
import { usePolling } from '@/hooks/usePolling';
import VPNImportModal from './VPNImportModal';
import VPNADMatchModal from './VPNADMatchModal';
import VPNAccountDetailModal from './VPNAccountDetailModal';
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Search, Download, Filter, RefreshCw, Plus, Trash2, X, ArrowUpDown, ChevronDown, ChevronUp, Check, AlertTriangle, UserPlus } from "lucide-react";

interface VPNAccount {
  id: string;
  username: string;
  name: string;
  email: string | null;
  portalType: string;
  isInternal: boolean;
  status: string;
  expiresAt?: string;
  createdAt: string;
  createdBy: string;
  createdByFaculty: boolean;
  facultyCreatedAt?: string;
  disabledAt?: string;
  disabledBy?: string;
  disabledReason?: string;
  revokedAt?: string;
  revokedBy?: string;
  revokedReason?: string;
  restoredAt?: string;
  restoredBy?: string;
  canRestore?: boolean;
  notes?: string | null;
  adUsername?: string | null; // Linked AD account username
}

export type StatusFilter = 'all' | 'active' | 'pending_faculty' | 'disabled' | 'revoked';
export type PortalFilter = 'all' | 'Management' | 'Limited' | 'External';
export type FacultyFilter = 'all' | 'approved' | 'pending';

interface VPNManagementTabProps {
  accounts?: VPNAccount[];
  isLoading?: boolean;
}

interface VPNImportSummary {
  id: string;
  fileName: string;
  userType: string;
  portalType?: string | null;
  importedBy: string;
  createdAt: string;
  totalRecords?: number | null;
  matchedRecords?: number | null;
  unmatchedRecords?: number | null;
  createdAccounts?: number | null;
  status?: string | null;
}

function searchText(value: string | null | undefined): string {
  return value?.toLowerCase() || '';
}

function displayText(value: string | null | undefined, fallback = '-'): string {
  return value?.trim() || fallback;
}

export default function VPNManagementTab({ accounts: initialAccounts, isLoading: initialLoading = true }: VPNManagementTabProps) {
  const [accounts, setAccounts] = useState<VPNAccount[]>(initialAccounts ?? []);
  const [isLoading, setIsLoading] = useState(initialLoading);

  useEffect(() => {
    if (initialAccounts !== undefined) {
      setAccounts(initialAccounts);
    }
  }, [initialAccounts]);

  useEffect(() => {
    setIsLoading(initialLoading);
  }, [initialLoading]);

  const fetchAccounts = useCallback(async () => {
    const response = await fetchWithCsrf('/api/admin/vpn-accounts');
    if (!response.ok) throw new Error('Failed to fetch VPN accounts');
    return await response.json();
  }, []);

  const { 
    isPolling, 
    togglePolling, 
    refresh,
    lastUpdated 
  } = usePolling(fetchAccounts, {
    onSuccess: (data) => {
      setAccounts(data.accounts || []);
      setIsLoading(false);
    },
    onError: (error) => {
      console.error('Error fetching VPN accounts:', error);
      setIsLoading(false);
    } 
  });
  
  const onRefresh = refresh;
  const [selectedAccount, setSelectedAccount] = useState<VPNAccount | null>(null);
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [newStatus, setNewStatus] = useState('');
  const [statusReason, setStatusReason] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<StatusFilter>('all');
  const [filterPortal, setFilterPortal] = useState<PortalFilter>('all');
  const [filterFaculty, setFilterFaculty] = useState<FacultyFilter>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sortField, setSortField] = useState<'username' | 'name' | 'email' | 'createdAt' | 'expiresAt'>('createdAt');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [viewMode, setViewMode] = useState<'unified' | 'split'>('unified');
  const [showImportModal, setShowImportModal] = useState(false);
  const [importUserType, setImportUserType] = useState<'Internal' | 'External'>('Internal');
  const [importPortalType, setImportPortalType] = useState<'Management' | 'Limited'>('Management');
  const [showImportQueueModal, setShowImportQueueModal] = useState(false);
  const [imports, setImports] = useState<VPNImportSummary[]>([]);
  const [selectedImportId, setSelectedImportId] = useState<string | null>(null);
  const [showMatchModal, setShowMatchModal] = useState(false);
  const [isProcessingImport, setIsProcessingImport] = useState(false);
  const [selectedAccountIds, setSelectedAccountIds] = useState<Set<string>>(new Set());
  const [showBulkEditModal, setShowBulkEditModal] = useState(false);
  const [bulkNewStatus, setBulkNewStatus] = useState('active');
  const [bulkReason, setBulkReason] = useState('');
  const [bulkFacultyApproval, setBulkFacultyApproval] = useState(true);
  const [showClearQueueConfirm, setShowClearQueueConfirm] = useState(false);
  const { showToast } = useToast();

  // Statistics
  const stats = useMemo(() => ({
    total: accounts.length,
    active: accounts.filter((a: VPNAccount) => a.status === 'active').length,
    pendingFaculty: accounts.filter((a: VPNAccount) => a.status === 'pending_faculty').length,
    disabled: accounts.filter((a: VPNAccount) => a.status === 'disabled').length,
    revoked: accounts.filter((a: VPNAccount) => a.status === 'revoked').length,
    management: accounts.filter((a: VPNAccount) => a.portalType === 'Management').length,
    limited: accounts.filter((a: VPNAccount) => a.portalType === 'Limited').length,
    external: accounts.filter((a: VPNAccount) => a.portalType === 'External').length,
    facultyApproved: accounts.filter((a: VPNAccount) => a.createdByFaculty).length,
  }), [accounts]);

  // Export filtered accounts to CSV
  const exportToCSV = () => {
    const headers = ['Username', 'Name', 'Email', 'Portal Type', 'Status', 'Created', 'Created By', 'Expires', 'Faculty Approved'];
    const csvData = filteredAndSortedAccounts.map((acc: VPNAccount) => [
      acc.username,
      acc.name,
      acc.email || '',
      acc.portalType,
      acc.status,
      new Date(acc.createdAt).toLocaleDateString(),
      acc.createdBy,
      acc.expiresAt ? new Date(acc.expiresAt).toLocaleDateString() : 'N/A',
      acc.createdByFaculty ? 'Yes' : 'No'
    ]);

    const csvContent = [
      headers.join(','),
      ...csvData.map((row: string[]) => row.map((cell: string) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `vpn_accounts_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Filter accounts based on all criteria
  const filteredAccounts = useMemo(() => {
    return accounts.filter((account: VPNAccount) => {
      // Text search filter
      const searchLower = searchQuery.trim().toLowerCase();
      const matchesSearch = !searchLower || (
        searchText(account.username).includes(searchLower) ||
        searchText(account.name).includes(searchLower) ||
        searchText(account.email).includes(searchLower) ||
        searchText(account.createdBy).includes(searchLower) ||
        searchText(account.notes).includes(searchLower) ||
        searchText(account.adUsername).includes(searchLower)
      );

      // Status filter
      const matchesStatus = filterStatus === 'all' || account.status === filterStatus;

      // Portal filter
      const matchesPortal = filterPortal === 'all' || account.portalType === filterPortal;

      // Faculty filter
      const matchesFaculty = 
        filterFaculty === 'all' ||
        (filterFaculty === 'approved' && account.createdByFaculty) ||
        (filterFaculty === 'pending' && !account.createdByFaculty);

      return matchesSearch && matchesStatus && matchesPortal && matchesFaculty;
    });
  }, [accounts, searchQuery, filterStatus, filterPortal, filterFaculty]);

  // Sort accounts
  const filteredAndSortedAccounts = useMemo(() => {
    return [...filteredAccounts].sort((a: VPNAccount, b: VPNAccount) => {
      let aValue: string | number = '';
      let bValue: string | number = '';

      switch (sortField) {
        case 'username':
          aValue = searchText(a.username);
          bValue = searchText(b.username);
          break;
        case 'name':
          aValue = searchText(a.name);
          bValue = searchText(b.name);
          break;
        case 'email':
          aValue = searchText(a.email);
          bValue = searchText(b.email);
          break;
        case 'createdAt':
          aValue = new Date(a.createdAt).getTime();
          bValue = new Date(b.createdAt).getTime();
          break;
        case 'expiresAt':
          aValue = a.expiresAt ? new Date(a.expiresAt).getTime() : 0;
          bValue = b.expiresAt ? new Date(b.expiresAt).getTime() : 0;
          break;
      }

      if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filteredAccounts, sortField, sortDirection]);

  // Paginate accounts
  const totalPages = Math.ceil(filteredAndSortedAccounts.length / pageSize);
  const paginatedAccounts = filteredAndSortedAccounts.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  // Split paginated accounts by portal type for split view
  const splitAccounts = useMemo(() => ({
    management: paginatedAccounts.filter((a: VPNAccount) => a.portalType === 'Management'),
    limited: paginatedAccounts.filter((a: VPNAccount) => a.portalType === 'Limited'),
    external: paginatedAccounts.filter((a: VPNAccount) => a.portalType === 'External'),
  }), [paginatedAccounts]);

  const handleSort = (field: typeof sortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const getStatusBadge = (status: string) => {
    const styles = {
      active: 'bg-green-100 text-green-800 border-green-300 hover:bg-green-100',
      pending_faculty: 'bg-yellow-100 text-yellow-800 border-yellow-300 hover:bg-yellow-100',
      disabled: 'bg-red-100 text-red-800 border-red-300 hover:bg-red-100',
      revoked: 'bg-purple-100 text-purple-800 border-purple-300 hover:bg-purple-100',
    };

    const labels = {
      active: 'Active',
      pending_faculty: 'Pending Faculty',
      disabled: 'Disabled',
      revoked: 'Revoked',
    };

    return (
      <Badge variant="outline" className={styles[status as keyof typeof styles] || 'bg-gray-100 text-gray-800 border-gray-300'}>
        {labels[status as keyof typeof labels] || status}
      </Badge>
    );
  };

  const getPortalBadge = (portalType: string) => {
    const styles = {
      Management: 'bg-blue-100 text-blue-800 border-blue-300 hover:bg-blue-100',
      Limited: 'bg-purple-100 text-purple-800 border-purple-300 hover:bg-purple-100',
      External: 'bg-orange-100 text-orange-800 border-orange-300 hover:bg-orange-100',
    };

    return (
      <Badge variant="outline" className={styles[portalType as keyof typeof styles] || 'bg-gray-100 text-gray-800 border-gray-300'}>
        {portalType}
      </Badge>
    );
  };

  const handleStatusChange = async () => {
    if (!selectedAccount || !newStatus) {
      showToast('Please select a status', 'error');
      return;
    }

    try {
      const response = await fetchWithCsrf(`/api/admin/vpn-accounts/${selectedAccount.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: newStatus,
          reason: statusReason,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to update status');
      }

      showToast('Account status updated successfully', 'success');
      setShowStatusModal(false);
      setSelectedAccount(null);
      setNewStatus('');
      setStatusReason('');
      onRefresh();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Failed to update status', 'error');
    }
  };

  const handleBulkStatusChange = async () => {
    if (selectedAccountIds.size === 0) {
      showToast('Please select at least one account', 'error');
      return;
    }

    if (!bulkNewStatus) {
      showToast('Please select a status', 'error');
      return;
    }

    try {
      const response = await fetchWithCsrf('/api/admin/vpn-accounts/bulk-status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountIds: Array.from(selectedAccountIds),
          newStatus: bulkNewStatus,
          reason: bulkReason,
          createdByFaculty: bulkFacultyApproval,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update statuses');
      }

      const result = await response.json();
      showToast(
        `Successfully updated ${result.updatedCount} account(s)${result.skippedCount > 0 ? ` (${result.skippedCount} skipped)` : ''}`,
        'success'
      );
      
      setShowBulkEditModal(false);
      setSelectedAccountIds(new Set());
      setBulkNewStatus('active');
      setBulkReason('');
      setBulkFacultyApproval(true);
      onRefresh();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Failed to bulk update statuses', 'error');
    }
  };

  const toggleAccountSelection = (accountId: string) => {
    const newSelection = new Set(selectedAccountIds);
    if (newSelection.has(accountId)) {
      newSelection.delete(accountId);
    } else {
      newSelection.add(accountId);
    }
    setSelectedAccountIds(newSelection);
  };

  const toggleAllAccountsSelection = () => {
    if (selectedAccountIds.size === paginatedAccounts.length && paginatedAccounts.length > 0) {
      setSelectedAccountIds(new Set());
    } else {
      setSelectedAccountIds(new Set(paginatedAccounts.map((a: VPNAccount) => a.id)));
    }
  };

  const selectAllPendingFaculty = () => {
    const pendingAccounts = filteredAndSortedAccounts
      .filter((a: VPNAccount) => a.status === 'pending_faculty')
      .map((a: VPNAccount) => a.id);
    setSelectedAccountIds(new Set(pendingAccounts));
    showToast(`Selected ${pendingAccounts.length} pending faculty account(s)`, 'info');
  };

  const SortIcon = ({ field }: { field: typeof sortField }) => {
    if (sortField !== field) {
      return <span className="text-gray-400">↕</span>;
    }
    return <span>{sortDirection === 'asc' ? '↑' : '↓'}</span>;
  };

  const renderAccountsTable = (accountsList: VPNAccount[], title?: string, color?: string) => {
    if (accountsList.length === 0) {
      return (
        <div className="text-center text-gray-600 py-8">
          {title ? `No ${title.toLowerCase()} accounts` : 'No accounts found'}
        </div>
      );
    }

    return (
      <div className={title ? "mb-8" : ""}>
        {title && <h3 className={`text-lg font-bold mb-4 ${color}`}>{title} ({accountsList.length})</h3>}
        <div className="rounded-md border bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[50px]">
                  <Checkbox
                    checked={accountsList.every((a: VPNAccount) => selectedAccountIds.has(a.id))}
                    onCheckedChange={(checked) => {
                      const newSelection = new Set(selectedAccountIds);
                      if (checked) {
                        accountsList.forEach((a: VPNAccount) => newSelection.add(a.id));
                      } else {
                        accountsList.forEach((a: VPNAccount) => newSelection.delete(a.id));
                      }
                      setSelectedAccountIds(newSelection);
                    }}
                    aria-label="Select all"
                  />
                </TableHead>
                <TableHead 
                  className="cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('username')}
                >
                  <div className="flex items-center gap-1">
                    Username <SortIcon field="username" />
                  </div>
                </TableHead>
                <TableHead 
                  className="cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('name')}
                >
                  <div className="flex items-center gap-1">
                    Name <SortIcon field="name" />
                  </div>
                </TableHead>
                <TableHead 
                  className="cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('email')}
                >
                  <div className="flex items-center gap-1">
                    Email <SortIcon field="email" />
                  </div>
                </TableHead>
                {!title && <TableHead>Portal</TableHead>}
                <TableHead>Status</TableHead>
                <TableHead 
                  className="cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('createdAt')}
                >
                  <div className="flex items-center gap-1">
                    Created <SortIcon field="createdAt" />
                  </div>
                </TableHead>
                <TableHead 
                  className="cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('expiresAt')}
                >
                  <div className="flex items-center gap-1">
                    Expires <SortIcon field="expiresAt" />
                  </div>
                </TableHead>
                <TableHead>Faculty</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accountsList.map((account) => (
                <TableRow 
                  key={account.id} 
                  className={selectedAccountIds.has(account.id) ? 'bg-blue-50 hover:bg-blue-100' : ''}
                >
                  <TableCell>
                    <Checkbox
                      checked={selectedAccountIds.has(account.id)}
                      onCheckedChange={(checked) => {
                         // checked is boolean | 'indeterminate'
                         toggleAccountSelection(account.id);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`Select ${account.username}`}
                    />
                  </TableCell>
                  <TableCell 
                    className="font-semibold font-mono cursor-pointer"
                    onClick={() => {
                      setSelectedAccountId(account.id);
                      setShowDetailModal(true);
                    }}
                  >
                    {account.username}
                  </TableCell>
                  <TableCell 
                    className="cursor-pointer"
                    onClick={() => {
                      setSelectedAccountId(account.id);
                      setShowDetailModal(true);
                    }}
                  >
                    {account.name}
                  </TableCell>
                  <TableCell 
                    className="cursor-pointer"
                    onClick={() => {
                      setSelectedAccountId(account.id);
                      setShowDetailModal(true);
                    }}
                  >
                    {displayText(account.email)}
                  </TableCell>
                  {!title && (
                    <TableCell 
                      className="cursor-pointer"
                      onClick={() => {
                        setSelectedAccountId(account.id);
                        setShowDetailModal(true);
                      }}
                    >
                      {getPortalBadge(account.portalType)}
                    </TableCell>
                  )}
                  <TableCell 
                    className="cursor-pointer"
                    onClick={() => {
                      setSelectedAccountId(account.id);
                      setShowDetailModal(true);
                    }}
                  >
                    {getStatusBadge(account.status)}
                  </TableCell>
                  <TableCell 
                    className="cursor-pointer"
                    onClick={() => {
                      setSelectedAccountId(account.id);
                      setShowDetailModal(true);
                    }}
                  >
                    <div>{new Date(account.createdAt).toLocaleDateString()}</div>
                    <div className="text-xs text-gray-500">by {account.createdBy}</div>
                  </TableCell>
                  <TableCell 
                    className="cursor-pointer"
                    onClick={() => {
                      setSelectedAccountId(account.id);
                      setShowDetailModal(true);
                    }}
                  >
                    {account.expiresAt ? new Date(account.expiresAt).toLocaleDateString() : 'N/A'}
                  </TableCell>
                  <TableCell 
                    className="cursor-pointer"
                    onClick={() => {
                      setSelectedAccountId(account.id);
                      setShowDetailModal(true);
                    }}
                  >
                    {account.createdByFaculty ? (
                      <span className="text-green-600 font-semibold flex items-center gap-1">
                        <Check className="w-4 h-4" /> Approved
                      </span>
                    ) : (
                      <span className="text-yellow-600 flex items-center gap-1">
                        <AlertTriangle className="w-4 h-4" /> Pending
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="link"
                      className="h-auto p-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedAccount(account);
                        setNewStatus(account.status);
                        setShowStatusModal(true);
                      }}
                    >
                      Manage
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-600">Loading VPN accounts...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h2 className="text-2xl font-bold">VPN Account Management</h2>
        
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-sm text-gray-500 mr-2">
            {lastUpdated && (
              <span>Updated: {lastUpdated.toLocaleTimeString()}</span>
            )}
          </div>
          
          <Button
            variant={isPolling ? "default" : "outline"}
            onClick={togglePolling}
            className={`gap-2 ${isPolling ? 'bg-green-100 text-green-700 hover:bg-green-200 border-green-200' : ''}`}
            size="sm"
          >
            <div className={`w-2 h-2 rounded-full ${isPolling ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
            {isPolling ? 'Live' : 'Off'}
          </Button>

          {selectedAccountIds.size > 0 && (
            <Button
              variant="default"
              onClick={() => setShowBulkEditModal(true)}
              className="bg-blue-600 hover:bg-blue-700 gap-2"
              size="sm"
            >
              <Filter className="w-4 h-4" />
              Bulk ({selectedAccountIds.size})
            </Button>
          )}

          <Button
            variant="default"
            onClick={() => refresh()}
            className="bg-black hover:bg-gray-800 gap-2"
            size="sm"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 sm:gap-4">
        <Card>
          <CardContent className="p-4 sm:p-6">
            <div className="text-gray-600 text-xs sm:text-sm font-medium">Total Accounts</div>
            <div className="text-2xl sm:text-3xl font-bold text-gray-900 mt-2">{stats.total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 sm:p-6">
            <div className="text-gray-600 text-xs sm:text-sm font-medium">Active</div>
            <div className="text-2xl sm:text-3xl font-bold text-green-600 mt-2">{stats.active}</div>
          </CardContent>
        </Card>
        <Card 
          className="cursor-pointer hover:bg-yellow-50 transition-colors border-yellow-300"
          onClick={selectAllPendingFaculty}
          title="Click to select all pending faculty accounts for bulk editing"
        >
          <CardContent className="p-4 sm:p-6">
            <div className="text-gray-600 text-xs sm:text-sm font-medium flex items-center gap-1">
              Pending Faculty
              <AlertTriangle className="w-4 h-4 text-yellow-600" />
            </div>
            <div className="text-2xl sm:text-3xl font-bold text-yellow-500 mt-2">{stats.pendingFaculty}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 sm:p-6">
            <div className="text-gray-600 text-xs sm:text-sm font-medium">Disabled</div>
            <div className="text-2xl sm:text-3xl font-bold text-red-500 mt-2">{stats.disabled}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 sm:p-6">
            <div className="text-gray-600 text-xs sm:text-sm font-medium">Revoked</div>
            <div className="text-2xl sm:text-3xl font-bold text-purple-600 mt-2">{stats.revoked}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-6">
          <div className="flex flex-wrap gap-6 text-sm mb-6">
            <div>
              <span className="font-semibold text-gray-700">Total:</span>
              <span className="ml-2 text-gray-900 font-bold">{accounts.length}</span>
            </div>
            <div>
              <span className="font-semibold text-gray-700">Filtered:</span>
              <span className="ml-2 text-blue-600 font-bold">{filteredAndSortedAccounts.length}</span>
            </div>
            <div>
              <span className="font-semibold text-gray-700">Management:</span>
              <span className="ml-2 text-blue-600 font-bold">{stats.management}</span>
            </div>
            <div>
              <span className="font-semibold text-gray-700">Limited:</span>
              <span className="ml-2 text-purple-600 font-bold">{stats.limited}</span>
            </div>
            <div>
              <span className="font-semibold text-gray-700">External:</span>
              <span className="ml-2 text-orange-600 font-bold">{stats.external}</span>
            </div>
            <div>
              <span className="font-semibold text-gray-700">Faculty Approved:</span>
              <span className="ml-2 text-green-600 font-bold">{stats.facultyApproved}</span>
            </div>
          </div>

          <div className="flex gap-3 mb-4">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-500" />
                <Input
                  type="text"
                  placeholder="Search by username, name, email, or created by..."
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="pl-8"
                />
              </div>
            </div>
            <Button
              variant="default"
              onClick={exportToCSV}
              className="gap-2"
              title="Export filtered results to CSV"
            >
              <Download className="w-4 h-4" />
              Export
            </Button>
            <Button
              variant={showAdvancedFilters ? "secondary" : "outline"}
              onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
            >
              <Filter className="w-4 h-4 mr-2" />
              {showAdvancedFilters ? 'Hide Filters' : 'Advanced Filters'}
            </Button>
            {(searchQuery || filterStatus !== 'all' || filterPortal !== 'all' || filterFaculty !== 'all') && (
              <Button
                variant="destructive"
                onClick={() => {
                  setSearchQuery('');
                  setFilterStatus('all');
                  setFilterPortal('all');
                  setFilterFaculty('all');
                  setCurrentPage(1);
                }}
              >
                Clear All
              </Button>
            )}
          </div>

          {showAdvancedFilters && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 border-t border-gray-200">
              <div className="space-y-2">
                <Label>Status</Label>
                <Select
                  value={filterStatus}
                  onValueChange={(value) => {
                    setFilterStatus(value as StatusFilter);
                    setCurrentPage(1);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="All Statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="pending_faculty">Pending Faculty</SelectItem>
                    <SelectItem value="disabled">Disabled</SelectItem>
                    <SelectItem value="revoked">Revoked</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Portal Type</Label>
                <Select
                  value={filterPortal}
                  onValueChange={(value) => {
                    setFilterPortal(value as PortalFilter);
                    setCurrentPage(1);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="All Portals" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Portals</SelectItem>
                    <SelectItem value="Management">Internal - Management</SelectItem>
                    <SelectItem value="Limited">Internal - Limited</SelectItem>
                    <SelectItem value="External">External</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Faculty Approval</Label>
                <Select
                  value={filterFaculty}
                  onValueChange={(value) => {
                    setFilterFaculty(value as FacultyFilter);
                    setCurrentPage(1);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="All" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="approved">Faculty Approved</SelectItem>
                    <SelectItem value="pending">Pending Approval</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          <div className="flex gap-3 mt-4 pt-4 border-t border-gray-200">
            <span className="text-sm font-semibold text-gray-700">View Mode:</span>
            <Button
              variant={viewMode === 'unified' ? "default" : "outline"}
              onClick={() => setViewMode('unified')}
              size="sm"
            >
              Unified List
            </Button>
            <Button
               variant={viewMode === 'split' ? "default" : "outline"}
              onClick={() => setViewMode('split')}
              size="sm"
            >
              Split by Portal
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-purple-50 border-purple-200">
        <CardContent className="p-6">
          <h3 className="text-lg font-bold text-purple-900 mb-3">Import VPN Users from Spreadsheet</h3>
          <p className="text-sm text-purple-800 mb-4">
            Import existing VPN users from a spreadsheet to manually match them with Active Directory accounts (for Internal users) 
            or directly create accounts (for External users). This helps identify who is on your infrastructure.
          </p>
          
          <div className="space-y-3">
            <div className="relative inline-block">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button className="bg-purple-600 hover:bg-purple-700 text-white gap-2">
                    <Plus className="w-5 h-5" />
                    Import VPN Users
                    <ChevronDown className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-64" align="start">
                  <DropdownMenuLabel className="text-xs font-bold text-gray-500 uppercase">Internal Users</DropdownMenuLabel>
                  <DropdownMenuItem
                    onClick={() => {
                      setImportUserType('Internal');
                      setImportPortalType('Management');
                      setShowImportModal(true);
                    }}
                    className="cursor-pointer"
                  >
                    <span className="w-3 h-3 bg-blue-600 rounded-full mr-2"></span>
                    Management Portal
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => {
                      setImportUserType('Internal');
                      setImportPortalType('Limited');
                      setShowImportModal(true);
                    }}
                    className="cursor-pointer"
                  >
                    <span className="w-3 h-3 bg-purple-600 rounded-full mr-2"></span>
                    Limited Portal
                  </DropdownMenuItem>
                  
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-xs font-bold text-gray-500 uppercase">External Users</DropdownMenuLabel>
                  <DropdownMenuItem
                    onClick={() => {
                      setImportUserType('External');
                      setImportPortalType(undefined as unknown as 'Management' | 'Limited');
                      setShowImportModal(true);
                    }}
                    className="cursor-pointer"
                  >
                    <span className="w-3 h-3 bg-orange-600 rounded-full mr-2"></span>
                    External Users
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div className="flex justify-between items-center pt-2 border-t border-purple-300">
              <Button
                variant="destructive"
                onClick={() => setShowClearQueueConfirm(true)}
                className="gap-2"
              >
                <Trash2 className="w-5 h-5" />
                Clear Queue
              </Button>
              <Button
                variant="default"
                onClick={async () => {
                  try {
                    const response = await fetchWithCsrf('/api/admin/vpn-import');
                    if (!response.ok) throw new Error('Failed to fetch imports');
                    const result = await response.json();
                    setImports(result.data || []);
                    setShowImportQueueModal(true);
                  } catch (error) {
                    console.error('Failed to load imports:', error);
                    showToast('Failed to load import queue', 'error');
                  }
                }}
                className="bg-gray-700 hover:bg-gray-800 gap-2"
              >
                <UserPlus className="w-5 h-5" />
                View Import Queue
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {viewMode === 'unified' ? (
        <div className="space-y-4">
          {renderAccountsTable(paginatedAccounts)}
          
          {totalPages > 1 && (
            <Card className="p-4">
              <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-700 font-medium">Show:</span>
                  <Select
                    value={pageSize.toString()}
                    onValueChange={(value) => {
                      setPageSize(Number(value));
                      setCurrentPage(1);
                    }}
                  >
                    <SelectTrigger className="w-[70px] h-8">
                      <SelectValue placeholder={pageSize} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="10">10</SelectItem>
                      <SelectItem value="25">25</SelectItem>
                      <SelectItem value="50">50</SelectItem>
                      <SelectItem value="100">100</SelectItem>
                    </SelectContent>
                  </Select>
                  <span className="text-sm text-gray-700">
                    of {filteredAndSortedAccounts.length} accounts
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(1)}
                    disabled={currentPage === 1}
                  >
                    First
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(currentPage - 1)}
                    disabled={currentPage === 1}
                  >
                    Previous
                  </Button>
                  <span className="px-4 py-1 text-sm font-medium text-gray-700">
                    Page {currentPage} of {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(currentPage + 1)}
                    disabled={currentPage === totalPages}
                  >
                    Next
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(totalPages)}
                    disabled={currentPage === totalPages}
                  >
                    Last
                  </Button>
                </div>

                <div className="text-sm text-gray-700">
                  Showing {((currentPage - 1) * pageSize) + 1} to {Math.min(currentPage * pageSize, filteredAndSortedAccounts.length)}
                </div>
              </div>
            </Card>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          <div className="bg-blue-50 p-4 rounded-lg border-2 border-blue-200">
            <h2 className="text-xl font-bold mb-4 text-blue-900">Internal VPN Accounts</h2>
            {renderAccountsTable(
              splitAccounts.management,
              'Management Portal',
              'text-blue-700'
            )}
            {renderAccountsTable(
              splitAccounts.limited,
              'Limited Portal',
              'text-purple-700'
            )}
            {(splitAccounts.management.length === 0 && splitAccounts.limited.length === 0) && (
              <div className="text-center text-gray-600 py-8">No internal VPN accounts in current page</div>
            )}
          </div>

          <div className="bg-orange-50 p-4 rounded-lg border-2 border-orange-200">
            <h2 className="text-xl font-bold mb-4 text-orange-900">External VPN Accounts</h2>
            {renderAccountsTable(
              splitAccounts.external,
              'External Portal',
              'text-orange-700'
            )}
            {splitAccounts.external.length === 0 && (
              <div className="text-center text-gray-600 py-8">No external VPN accounts in current page</div>
            )}
          </div>

          {totalPages > 1 && (
            <Card className="p-4">
              <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-700 font-medium">Show:</span>
                  <Select
                    value={pageSize.toString()}
                    onValueChange={(value) => {
                      setPageSize(Number(value));
                      setCurrentPage(1);
                    }}
                  >
                    <SelectTrigger className="w-[70px] h-8">
                      <SelectValue placeholder={pageSize} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="10">10</SelectItem>
                      <SelectItem value="25">25</SelectItem>
                      <SelectItem value="50">50</SelectItem>
                      <SelectItem value="100">100</SelectItem>
                    </SelectContent>
                  </Select>
                  <span className="text-sm text-gray-700">
                    of {filteredAndSortedAccounts.length} accounts
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(1)}
                    disabled={currentPage === 1}
                  >
                    First
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(currentPage - 1)}
                    disabled={currentPage === 1}
                  >
                    Previous
                  </Button>
                  <span className="px-4 py-1 text-sm font-medium text-gray-700">
                    Page {currentPage} of {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(currentPage + 1)}
                    disabled={currentPage === totalPages}
                  >
                    Next
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(totalPages)}
                    disabled={currentPage === totalPages}
                  >
                    Last
                  </Button>
                </div>

                <div className="text-sm text-gray-700">
                  Showing {((currentPage - 1) * pageSize) + 1} to {Math.min(currentPage * pageSize, filteredAndSortedAccounts.length)}
                </div>
              </div>
            </Card>
          )}
        </div>
      )}

      {selectedAccount && (
        <Dialog 
          open={showStatusModal} 
          onOpenChange={(open) => {
            if (!open) {
              setShowStatusModal(false);
              setSelectedAccount(null);
              setNewStatus('');
              setStatusReason('');
            }
          }}
        >
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Manage VPN Account</DialogTitle>
            </DialogHeader>

            <div className="space-y-6">
              <div>
                <h4 className="text-lg font-semibold text-gray-900 mb-3">Account Information</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-gray-600">Username</Label>
                    <p className="text-gray-900 font-medium font-mono">{selectedAccount.username}</p>
                  </div>
                  <div>
                    <Label className="text-gray-600">Name</Label>
                    <p className="text-gray-900">{selectedAccount.name}</p>
                  </div>
                  {selectedAccount.adUsername && (
                    <div className="col-span-2">
                      <Label className="text-gray-600">Linked AD Account</Label>
                      <p className="text-gray-900 font-medium font-mono">{selectedAccount.adUsername}</p>
                    </div>
                  )}
                  <div className="col-span-2">
                    <Label className="text-gray-600">Email</Label>
                    <p className="text-gray-900">{selectedAccount.email}</p>
                  </div>
                  <div>
                    <Label className="text-gray-600">Portal Type</Label>
                    <div className="mt-1">{getPortalBadge(selectedAccount.portalType)}</div>
                  </div>
                  <div>
                    <Label className="text-gray-600">Current Status</Label>
                    <div className="mt-1">{getStatusBadge(selectedAccount.status)}</div>
                  </div>
                </div>
              </div>

              <div>
                <h4 className="text-lg font-semibold text-gray-900 mb-3">Account Details</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-gray-600">Created</Label>
                    <p className="text-gray-900">
                      {new Date(selectedAccount.createdAt).toLocaleDateString()}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">by {selectedAccount.createdBy}</p>
                  </div>
                  {selectedAccount.expiresAt && (
                    <div>
                      <Label className="text-gray-600">Expires</Label>
                      <p className="text-gray-900">
                        {new Date(selectedAccount.expiresAt).toLocaleDateString()}
                      </p>
                    </div>
                  )}
                  <div>
                    <Label className="text-gray-600">Faculty Approval</Label>
                    <div className="mt-1">
                      {selectedAccount.createdByFaculty ? (
                        <span className="inline-flex items-center gap-1 text-sm font-semibold text-green-700">
                          <Check className="w-4 h-4" />
                          Approved
                        </span>
                      ) : (
                        <span className="text-sm font-semibold text-yellow-700">Pending</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {selectedAccount.notes && (
                <div>
                  <h4 className="text-lg font-semibold text-gray-900 mb-3">Notes</h4>
                  <div className="bg-gray-50 p-4 rounded-lg text-sm">
                    <p className="text-gray-800">{selectedAccount.notes}</p>
                  </div>
                </div>
              )}

              {selectedAccount.disabledAt && (
                <div>
                  <h4 className="text-lg font-semibold text-gray-900 mb-3">Disabled Information</h4>
                  <div className="bg-red-50 p-4 rounded-lg border border-red-200 text-sm">
                    <div className="text-gray-800 space-y-2">
                      <div>
                        <span className="font-medium">Disabled on:</span>{' '}
                        {new Date(selectedAccount.disabledAt).toLocaleString()}
                      </div>
                      {selectedAccount.disabledBy && (
                        <div>
                          <span className="font-medium">Disabled by:</span> {selectedAccount.disabledBy}
                        </div>
                      )}
                      {selectedAccount.disabledReason && (
                        <div className="pt-2 border-t border-red-200">
                          <span className="font-medium">Reason:</span> {selectedAccount.disabledReason}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {selectedAccount.revokedAt && (
                <div>
                  <h4 className="text-lg font-semibold text-gray-900 mb-3">Revoked Information</h4>
                  <div className="bg-purple-50 p-4 rounded-lg border border-purple-200 text-sm">
                    <div className="text-gray-800 space-y-2">
                      <div>
                        <span className="font-medium">Revoked on:</span>{' '}
                        {new Date(selectedAccount.revokedAt).toLocaleString()}
                      </div>
                      {selectedAccount.revokedBy && (
                        <div>
                          <span className="font-medium">Revoked by:</span> {selectedAccount.revokedBy}
                        </div>
                      )}
                      {selectedAccount.revokedReason && (
                        <div className="pt-2 border-t border-purple-200">
                          <span className="font-medium">Reason:</span> {selectedAccount.revokedReason}
                        </div>
                      )}
                      {selectedAccount.restoredAt && (
                        <>
                          <div className="pt-2 border-t border-purple-200">
                            <span className="font-medium">Previously Restored on:</span>{' '}
                            {new Date(selectedAccount.restoredAt).toLocaleString()}
                          </div>
                          {selectedAccount.restoredBy && (
                            <div>
                              <span className="font-medium">Restored by:</span> {selectedAccount.restoredBy}
                            </div>
                          )}
                        </>
                      )}
                      {selectedAccount.canRestore === false && (
                        <div className="pt-2 border-t border-purple-200">
                          <Badge variant="destructive">Cannot be restored</Badge>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              <div className="border-t-2 border-gray-200 pt-6">
                <h4 className="text-lg font-semibold text-gray-900 mb-4">Update Status</h4>
                <div className="space-y-4">
                  <div>
                    <Label className="mb-2 block">New Status</Label>
                    <Select
                      value={newStatus}
                      onValueChange={setNewStatus}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select status..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="pending_faculty">Pending Faculty</SelectItem>
                        <SelectItem value="disabled">Disabled</SelectItem>
                        <SelectItem value="revoked">Revoked</SelectItem>
                      </SelectContent>
                    </Select>
                    {newStatus === 'revoked' && selectedAccount.status === 'revoked' && (
                      <p className="mt-2 text-sm text-purple-600">
                        Note: This account is already revoked. Use &quot;Active&quot; to restore it.
                      </p>
                    )}
                    {newStatus === 'active' && selectedAccount.status === 'revoked' && selectedAccount.canRestore !== false && (
                      <p className="mt-2 text-sm text-green-600">
                        ✓ This will restore the revoked VPN account.
                      </p>
                    )}
                    {selectedAccount.canRestore === false && newStatus === 'active' && selectedAccount.status === 'revoked' && (
                      <p className="mt-2 text-sm text-red-600">
                        ⚠ This account cannot be restored automatically. It may need manual intervention.
                      </p>
                    )}
                  </div>

                  <div>
                    <Label className="mb-2 block">
                      Reason for Change <span className="text-gray-500 font-normal">(Optional)</span>
                    </Label>
                    <textarea
                      value={statusReason}
                      onChange={(e) => setStatusReason(e.target.value)}
                      className="flex min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                      rows={4}
                      placeholder="Enter a reason for this status change..."
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
              <Button
                variant="outline"
                onClick={() => {
                  setShowStatusModal(false);
                  setSelectedAccount(null);
                  setNewStatus('');
                  setStatusReason('');
                }}
              >
                Cancel
              </Button>
              <Button
                variant="default"
                onClick={handleStatusChange}
                disabled={!newStatus}
                className="bg-black hover:bg-gray-800"
              >
                Update Status
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {showImportModal && (
        <VPNImportModal
          userType={importUserType}
          portalType={importPortalType}
          onClose={() => setShowImportModal(false)}
          onImportComplete={() => {
            setShowImportModal(false);
            onRefresh();
          }}
        />
      )}

      <Dialog 
        open={showImportQueueModal} 
        onOpenChange={setShowImportQueueModal}
      >
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>VPN Import Queue</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {imports.length === 0 ? (
              <div className="text-center text-gray-600 py-8">No imports in queue</div>
            ) : (
              <div className="space-y-4">
                {imports.map((imp: VPNImportSummary) => (
                  <Card key={imp.id}>
                    <CardContent className="p-4">
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-gray-900">{imp.fileName}</span>
                            <Badge variant={imp.userType === 'Internal' ? 'default' : 'secondary'} className={imp.userType === 'Internal' ? 'bg-blue-100 text-blue-800 hover:bg-blue-100' : 'bg-orange-100 text-orange-800 hover:bg-orange-100'}>
                              {imp.userType}
                            </Badge>
                          </div>
                          <div className="text-sm text-gray-600 mt-1">
                            {imp.portalType && <span className="font-medium">{imp.portalType} Portal</span>}
                            {imp.portalType && ' · '}
                            Imported by {imp.importedBy}
                            {' · '}
                            {new Date(imp.createdAt).toLocaleDateString()}
                          </div>
                          <div className="flex gap-4 mt-2 text-sm">
                            <span>Total: <span className="font-semibold">{imp.totalRecords || 0}</span></span>
                            <span className="text-green-600">
                              Matched: <span className="font-semibold">{imp.matchedRecords || 0}</span>
                            </span>
                            <span className="text-yellow-600">
                              Unmatched: <span className="font-semibold">{imp.unmatchedRecords || 0}</span>
                            </span>
                            <span className="text-purple-600">
                              Created: <span className="font-semibold">{imp.createdAccounts || 0}</span>
                            </span>
                          </div>
                          {imp.status && (
                            <div className="mt-2">
                              <Badge variant="outline" className={`
                                ${imp.status === 'completed' ? 'bg-green-100 text-green-800 border-green-200' : ''}
                                ${imp.status === 'processing' ? 'bg-blue-100 text-blue-800 border-blue-200' : ''}
                                ${imp.status === 'failed' ? 'bg-red-100 text-red-800 border-red-200' : ''}
                                ${!['completed', 'processing', 'failed'].includes(imp.status) ? 'bg-yellow-100 text-yellow-800 border-yellow-200' : ''}
                              `}>
                                {imp.status}
                              </Badge>
                            </div>
                          )}
                        </div>
                        <div className="flex gap-2">
                          {imp.userType === 'Internal' && (
                            <Button
                              variant="default"
                              size="sm"
                              onClick={() => {
                                setSelectedImportId(imp.id);
                                setShowMatchModal(true);
                                setShowImportQueueModal(false);
                              }}
                              className="bg-blue-600 hover:bg-blue-700"
                            >
                              Match Users
                            </Button>
                          )}
                          {(imp.matchedRecords ?? 0) > 0 && (imp.createdAccounts ?? 0) < (imp.matchedRecords ?? 0) && (
                            <Button
                              variant="default"
                              size="sm"
                              onClick={async () => {
                                setIsProcessingImport(true);
                                try {
                                  const response = await fetchWithCsrf('/api/admin/vpn-import/process', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ importId: imp.id }),
                                  });

                                  if (!response.ok) {
                                    throw new Error('Failed to process import');
                                  }

                                  const result = await response.json();
                                  showToast(`Created ${result.data.createdCount} VPN accounts`, 'success');
                                  
                                  // Refresh imports
                                  const refreshResponse = await fetchWithCsrf('/api/admin/vpn-import');
                                  if (refreshResponse.ok) {
                                    const refreshResult = await refreshResponse.json();
                                    setImports(refreshResult.data || []);
                                  }
                                  onRefresh();
                                } catch (error) {
                                  showToast('Failed to process import', 'error');
                                } finally {
                                  setIsProcessingImport(false);
                                }
                              }}
                              disabled={isProcessingImport}
                              className="bg-green-600 hover:bg-green-700"
                            >
                              {isProcessingImport ? 'Processing...' : 'Create Accounts'}
                            </Button>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
            
            <div className="flex justify-between pt-4 border-t border-gray-200">
              <Button
                variant="destructive"
                onClick={async () => {
                  try {
                    const response = await fetchWithCsrf('/api/admin/vpn-import/cleanup', {
                      method: 'DELETE',
                    });

                    if (!response.ok) throw new Error('Failed to cleanup');

                    const result = await response.json();
                    showToast(result.data.message, 'success');
                    
                    // Refresh imports
                    const refreshResponse = await fetchWithCsrf('/api/admin/vpn-import');
                    if (refreshResponse.ok) {
                      const refreshResult = await refreshResponse.json();
                      setImports(refreshResult.data || []);
                    }
                  } catch {
                    showToast('Failed to cleanup expired imports', 'error');
                  }
                }}
              >
                Cleanup Expired
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowImportQueueModal(false)}
              >
                Close
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {showMatchModal && selectedImportId && (
        <VPNADMatchModal
          importId={selectedImportId}
          onClose={() => {
            setShowMatchModal(false);
            setSelectedImportId(null);
          }}
          onComplete={() => {
            setShowMatchModal(false);
            setSelectedImportId(null);
            onRefresh();
          }}
        />
      )}

      {showDetailModal && selectedAccountId && (
        <VPNAccountDetailModal
          accountId={selectedAccountId}
          onClose={() => {
            setShowDetailModal(false);
            setSelectedAccountId(null);
          }}
          onRefresh={onRefresh}
        />
      )}

      <Dialog 
        open={showBulkEditModal} 
        onOpenChange={(open) => {
          if (!open) {
            setShowBulkEditModal(false);
            setBulkNewStatus('active');
            setBulkReason('');
            setBulkFacultyApproval(true);
          }
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Bulk Edit Status</DialogTitle>
          </DialogHeader>

          <div className="space-y-6">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="flex items-center gap-2 text-blue-800 mb-2">
                <Check className="w-5 h-5" />
                <span className="font-semibold">Bulk Update Information</span>
              </div>
              <p className="text-sm text-blue-700">
                You are about to update <span className="font-bold">{selectedAccountIds.size}</span> account(s).
                This action will update all selected accounts to the chosen status.
              </p>
            </div>

            <div>
              <Label className="mb-2 block">New Status *</Label>
              <Select
                value={bulkNewStatus}
                onValueChange={setBulkNewStatus}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select status..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="pending_faculty">Pending Faculty</SelectItem>
                  <SelectItem value="disabled">Disabled</SelectItem>
                </SelectContent>
              </Select>
              <p className="mt-2 text-xs text-gray-600">
                {bulkNewStatus === 'active' && 'Will mark accounts as active'}
                {bulkNewStatus === 'pending_faculty' && 'Will set accounts to pending faculty approval status'}
                {bulkNewStatus === 'disabled' && 'Will disable the accounts'}
              </p>
            </div>

            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <Checkbox
                  id="bulkFacultyApproval"
                  checked={bulkFacultyApproval}
                  onCheckedChange={(checked) => setBulkFacultyApproval(checked as boolean)}
                  className="mt-1"
                />
                <div className="flex-1">
                  <Label
                    htmlFor="bulkFacultyApproval"
                    className="text-sm font-semibold text-gray-900 cursor-pointer flex items-center gap-2"
                  >
                    Mark as Faculty Approved
                    <Check className="w-4 h-4 text-green-600" />
                  </Label>
                  <p className="text-xs text-gray-600 mt-1">
                    {bulkFacultyApproval ? (
                      <span className="text-green-700">
                        <strong>Enabled:</strong> Accounts will be marked as created/approved by faculty. 
                        This indicates the VPN accounts have been properly provisioned.
                      </span>
                    ) : (
                      <span className="text-yellow-700">
                        <strong>Disabled:</strong> Accounts will be marked as not yet faculty approved. 
                        Use this if accounts need further review.
                      </span>
                    )}
                  </p>
                </div>
              </div>
            </div>

            <div>
              <Label className="mb-2 block">Reason (Optional)</Label>
              <textarea
                value={bulkReason}
                onChange={(e) => setBulkReason(e.target.value)}
                className="flex min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                rows={4}
                placeholder="Enter a reason for this bulk status change..."
              />
            </div>

            <div>
              <div className="flex justify-between items-center mb-2">
                <Label>
                  Selected Accounts ({selectedAccountIds.size})
                </Label>
                <Button
                  variant="link"
                  className="text-red-600 hover:text-red-800 p-0 h-auto font-medium text-xs"
                  onClick={() => setSelectedAccountIds(new Set())}
                >
                  Clear Selection
                </Button>
              </div>
              <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-lg p-3 bg-gray-50">
                <div className="space-y-1">
                  {Array.from(selectedAccountIds).map(id => {
                    const account = accounts.find(a => a.id === id);
                    return account ? (
                      <div key={id} className="text-sm text-gray-700 flex items-center justify-between py-1">
                        <span className="flex items-center gap-2">
                          <span className="font-mono font-semibold">{account.username}</span>
                          <span className="text-gray-400">-</span>
                          <span>{account.name}</span>
                          <span className="text-gray-400">-</span>
                          <span className="text-xs">{getStatusBadge(account.status)}</span>
                          <span className="text-gray-400">-</span>
                          {account.createdByFaculty ? (
                            <span className="text-xs text-green-600 font-semibold">✓ Faculty</span>
                          ) : (
                            <span className="text-xs text-yellow-600">⧗ Pending</span>
                          )}
                        </span>
                        <Button
                          variant="ghost"
                          className="text-red-600 hover:text-red-800 h-6 px-2 text-xs"
                          onClick={() => toggleAccountSelection(id)}
                        >
                          Remove
                        </Button>
                      </div>
                    ) : null;
                  })}
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
            <Button
              variant="outline"
              onClick={() => {
                setShowBulkEditModal(false);
                setBulkNewStatus('active');
                setBulkReason('');
                setBulkFacultyApproval(true);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="default"
              onClick={handleBulkStatusChange}
              disabled={selectedAccountIds.size === 0}
              className="bg-blue-600 hover:bg-blue-700"
            >
              Update {selectedAccountIds.size} Account(s)
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <AlertDialog open={showClearQueueConfirm} onOpenChange={setShowClearQueueConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear Import Queue?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to clear all imports from the queue? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={async () => {
                try {
                  const response = await fetchWithCsrf('/api/admin/vpn-import/clear', {
                    method: 'DELETE',
                  });

                  if (!response.ok) throw new Error('Failed to clear queue');

                  const result = await response.json();
                  showToast(result.data.message, 'success');
                  
                  // Refresh imports if modal is open
                  if (showImportQueueModal) {
                    setImports([]);
                  }
                } catch (error) {
                  console.error('Failed to clear import queue:', error);
                  showToast('Failed to clear import queue', 'error');
                } finally {
                  setShowClearQueueConfirm(false);
                }
              }}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              Clear Queue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
