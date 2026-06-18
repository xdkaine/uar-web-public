'use client';

import { useState, useMemo, useCallback } from 'react';
import UserDetailModal from './UserDetailModal';
import { usePolling } from '@/hooks/usePolling';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, Download, Filter, X, RefreshCw, Play, Pause, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";

interface LDAPUser {
  dn: string;
  username: string;
  displayName: string;
  email: string;
  description: string;
  accountEnabled: boolean;
  accountExpires: string | null;
  whenCreated: string;
  memberOf: string[];
  lastVerifiedAt?: string | null;
  lastVerifiedSource?: string | null;
  originalRegistrationAt?: string | null;
}

interface UserManagementTabProps {
  users?: LDAPUser[];
  isLoading?: boolean;
}

function isDirectoryUser(user: LDAPUser): boolean {
  return Boolean(user.dn?.trim());
}

type StatusFilter = 'all' | 'enabled' | 'disabled';
type ExpirationFilter = 'all' | 'active' | 'expired' | 'expiring-soon';

export default function UserManagementTab({ users, isLoading = false }: UserManagementTabProps) {
  const [localUsers, setLocalUsers] = useState<LDAPUser[]>([]);

  const fetchUsers = useCallback(async () => {
    const response = await fetch('/api/admin/users?includeVpnOnly=false');
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      // Handle LDAP size limit errors
      if (errorData.details && (errorData.details.includes('0x4') || errorData.details.includes('0x2c'))) {
        return [];
      }
      throw new Error('Failed to fetch users');
    }
    const data = await response.json();
    return (data.users || []).filter(isDirectoryUser);
  }, []);

  const {
    isLoading: isPollingLoading,
    isPolling,
    togglePolling,
    refresh,
    lastUpdated
  } = usePolling(fetchUsers, {
    interval: 30000,
    onSuccess: (data) => {
      setLocalUsers(data);
    }
  });

  const directoryUsers = useMemo(
    () => (users !== undefined ? users : localUsers).filter(isDirectoryUser),
    [localUsers, users]
  );

  const [selectedUser, setSelectedUser] = useState<LDAPUser | null>(null);
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [selectedOUs, setSelectedOUs] = useState<string[]>([]);
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [expirationFilter, setExpirationFilter] = useState<ExpirationFilter>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sortField, setSortField] = useState<'username' | 'displayName' | 'email' | 'accountEnabled' | 'whenCreated' | 'lastVerifiedAt'>('username');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

  // Export filtered users to CSV
  const exportToCSV = () => {
    const headers = ['Username', 'Display Name', 'Email', 'Description', 'Status', 'Expires', 'Created', 'Last Verified', 'Last Verified Source', 'Groups', 'OU'];
    const csvData = filteredUsers.map(user => {
      const ou = (user.dn || '').split(',').find(part => part.trim().toUpperCase().startsWith('OU='))?.split('=')[1] || '';
      return [
        user.username || '',
        user.displayName || '',
        user.email || '',
        user.description || '',
        user.accountEnabled ? 'Enabled' : 'Disabled',
        user.accountExpires ? new Date(user.accountExpires).toLocaleDateString() : 'Never',
        user.whenCreated ? new Date(user.whenCreated).toLocaleDateString() : '',
        user.lastVerifiedAt ? new Date(user.lastVerifiedAt).toLocaleDateString() : 'N/A',
        formatVerificationSource(user.lastVerifiedSource),
        (user.memberOf || []).length.toString(),
        ou
      ];
    });

    const csvContent = [
      headers.join(','),
      ...csvData.map(row => row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);

    // Create filename with filter info
    const dateStr = new Date().toISOString().split('T')[0];
    const filterParts = [];
    if (selectedOUs.length > 0) filterParts.push(`${selectedOUs.length}OUs`);
    if (selectedGroups.length > 0) filterParts.push(`${selectedGroups.length}Groups`);
    if (statusFilter !== 'all') filterParts.push(statusFilter);
    const filterSuffix = filterParts.length > 0 ? `_${filterParts.join('_')}` : '';
    const filename = `users_export_${dateStr}${filterSuffix}.csv`;

    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Extract unique OUs from users with counts
  const availableOUs = useMemo(() => {
    const ouMap = new Map<string, number>();
    directoryUsers.forEach(user => {
      const dnParts = (user.dn || '').split(',');
      dnParts.forEach(part => {
        if (part.trim().toUpperCase().startsWith('OU=')) {
          const ouName = part.split('=')[1];
          ouMap.set(ouName, (ouMap.get(ouName) || 0) + 1);
        }
      });
    });
    return Array.from(ouMap.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [directoryUsers]);

  // Extract unique groups from users with counts
  const availableGroups = useMemo(() => {
    const groupMap = new Map<string, number>();
    directoryUsers.forEach(user => {
      (user.memberOf || []).forEach(group => {
        const cnMatch = group.match(/CN=([^,]+)/);
        if (cnMatch) {
          const groupName = cnMatch[1];
          groupMap.set(groupName, (groupMap.get(groupName) || 0) + 1);
        }
      });
    });
    return Array.from(groupMap.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [directoryUsers]);

  // Helper function to check if account is expired
  const isExpired = (accountExpires: string | null): boolean => {
    if (!accountExpires) return false;
    return new Date(accountExpires) < new Date();
  };

  // Helper function to check if account is expiring soon (within 30 days)
  const isExpiringSoon = (accountExpires: string | null): boolean => {
    if (!accountExpires) return false;
    const expiryDate = new Date(accountExpires);
    const now = new Date();
    const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    return expiryDate > now && expiryDate <= thirtyDaysFromNow;
  };

  function formatVerificationSource(source: string | null | undefined) {
    switch (source) {
      case 'offboard_campaign':
        return 'Campaign';
      case 'registration_verified':
        return 'Registration verified';
      case 'registration':
        return 'Registration';
      default:
        return 'No record';
    }
  }

  // Filter, sort, and paginate users
  const filteredUsers = directoryUsers.filter(user => {
    // Text search filter
    const searchLower = userSearchQuery.toLowerCase();
    const matchesSearch = !userSearchQuery || (
      (user.username?.toLowerCase() || '').includes(searchLower) ||
      (user.displayName?.toLowerCase() || '').includes(searchLower) ||
      (user.email?.toLowerCase() || '').includes(searchLower) ||
      (user.description?.toLowerCase() || '').includes(searchLower)
    );

    // OU filter - match if ANY selected OU is in the DN
    const matchesOU = selectedOUs.length === 0 || selectedOUs.some(ou =>
      user.dn.toLowerCase().includes(`ou=${ou.toLowerCase()}`)
    );

    // Group filter - match if user is in ANY of the selected groups
    const matchesGroup = selectedGroups.length === 0 || selectedGroups.some(group =>
      (user.memberOf || []).some(memberGroup =>
        memberGroup.toLowerCase().includes(`cn=${group.toLowerCase()}`)
      )
    );

    // Status filter
    const matchesStatus =
      statusFilter === 'all' ||
      (statusFilter === 'enabled' && user.accountEnabled) ||
      (statusFilter === 'disabled' && !user.accountEnabled);

    // Expiration filter
    const matchesExpiration =
      expirationFilter === 'all' ||
      (expirationFilter === 'active' && !isExpired(user.accountExpires)) ||
      (expirationFilter === 'expired' && isExpired(user.accountExpires)) ||
      (expirationFilter === 'expiring-soon' && isExpiringSoon(user.accountExpires));

    return matchesSearch && matchesOU && matchesGroup && matchesStatus && matchesExpiration;
  });

  const sortedUsers = [...filteredUsers].sort((a, b) => {
    let aValue: string | boolean = '';
    let bValue: string | boolean = '';

    switch (sortField) {
      case 'username':
        aValue = (a.username?.toLowerCase() || '');
        bValue = (b.username?.toLowerCase() || '');
        break;
      case 'displayName':
        aValue = (a.displayName?.toLowerCase() || '');
        bValue = (b.displayName?.toLowerCase() || '');
        break;
      case 'email':
        aValue = (a.email?.toLowerCase() || '');
        bValue = (b.email?.toLowerCase() || '');
        break;
      case 'accountEnabled':
        aValue = a.accountEnabled;
        bValue = b.accountEnabled;
        break;
      case 'whenCreated':
        aValue = a.whenCreated;
        bValue = b.whenCreated;
        break;
      case 'lastVerifiedAt':
        aValue = a.lastVerifiedAt || '';
        bValue = b.lastVerifiedAt || '';
        break;
    }

    if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
    if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
    return 0;
  });

  const totalPages = Math.ceil(sortedUsers.length / pageSize);
  const paginatedUsers = sortedUsers.slice(
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

  return (
    <div>
      <div className="mb-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">User Management</h2>
          <p className="text-gray-600 mt-2">View all users within the SDC.CPP Domain</p>
        </div>

        <div className="flex items-center gap-4 bg-white p-2 rounded-lg shadow-sm border border-gray-100">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${isPolling ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`}></div>
            <span className="text-xs text-gray-500 font-medium uppercase tracking-wider">
              {isPolling ? 'Live Updates' : 'Paused'}
            </span>
          </div>

          <div className="h-4 w-px bg-gray-200"></div>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => togglePolling()}
              className={`h-8 w-8 ${isPolling
                ? 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                : 'text-blue-600 bg-blue-50 hover:bg-blue-100'
                }`}
              title={isPolling ? "Pause updates" : "Resume updates"}
            >
              {isPolling ? (
                <Pause className="h-4 w-4" />
              ) : (
                <Play className="h-4 w-4" />
              )}
            </Button>

            <Button
              variant="ghost"
              size="icon"
              onClick={() => refresh()}
              disabled={isPollingLoading}
              className="h-8 w-8 text-gray-500 hover:text-blue-600 hover:bg-blue-50"
              title="Refresh now"
            >
              <RefreshCw className={`h-4 w-4 ${isPollingLoading ? 'animate-spin' : ''}`} />
            </Button>
          </div>

          {lastUpdated && (
            <>
              <div className="h-4 w-px bg-gray-200"></div>
              <span className="text-xs text-gray-400 tabular-nums">
                {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            </>
          )}
        </div>
      </div>

      {(isLoading || isPollingLoading) && !directoryUsers.length ? (
        <div className="text-center py-8 text-gray-600">Loading users...</div>
      ) : directoryUsers.length === 0 ? (
        <div className="bg-white rounded-lg shadow-xl border-2 border-gray-200 p-8 text-center">
          <div className="text-yellow-600 mb-4">
            <svg className="w-12 h-12 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <p className="text-gray-900 font-semibold mb-2">No Users Available</p>
          <p className="text-gray-600 text-sm">This may be due to an LDAP query size limit. The organizational unit may contain more users than can be displayed at once.</p>
          <p className="text-gray-500 text-xs mt-2">Check the browser console for more details.</p>
        </div>
      ) : (
        <div>
          {directoryUsers.length === 1000 && (
            <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 mb-4">
              <div className="flex">
                <div className="shrink-0">
                  <svg className="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="ml-3">
                  <p className="text-sm text-yellow-700">
                    <span className="font-medium">Size limit reached:</span> Displaying {directoryUsers.length} users (maximum). There may be additional users not shown.
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="bg-white rounded-lg shadow-lg border-2 border-gray-200 p-6 mb-4">
            <div className="flex flex-wrap gap-6 text-sm mb-6">
              <div>
                <span className="font-semibold text-gray-700">Total:</span>
                <span className="ml-2 text-gray-900 font-bold">{directoryUsers.length}</span>
              </div>
              <div>
                <span className="font-semibold text-gray-700">Filtered:</span>
                <span className="ml-2 text-blue-600 font-bold">{filteredUsers.length}</span>
              </div>
              <div>
                <span className="font-semibold text-gray-700">Enabled:</span>
                <span className="ml-2 text-green-600 font-bold">{directoryUsers.filter(u => u.accountEnabled).length}</span>
              </div>
              <div>
                <span className="font-semibold text-gray-700">Disabled:</span>
                <span className="ml-2 text-red-600 font-bold">{directoryUsers.filter(u => !u.accountEnabled).length}</span>
              </div>
              <div>
                <span className="font-semibold text-gray-700">Expired:</span>
                <span className="ml-2 text-orange-600 font-bold">{directoryUsers.filter(u => isExpired(u.accountExpires)).length}</span>
              </div>
              <div>
                <span className="font-semibold text-gray-700">Expiring Soon:</span>
                <span className="ml-2 text-yellow-600 font-bold">{directoryUsers.filter(u => isExpiringSoon(u.accountExpires)).length}</span>
              </div>
            </div>

            <div className="flex gap-3 mb-4">
              <div className="flex-1">
                <div className="relative">
                  <Input
                    type="text"
                    placeholder="Search by name, username, email, or description..."
                    value={userSearchQuery}
                    onChange={(e) => {
                      setUserSearchQuery(e.target.value);
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
                title="Export filtered results to CSV"
              >
                <Download className="h-4 w-4" />
                Export
              </Button>
              <Button
                variant={showAdvancedFilters ? "default" : "secondary"}
                onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
                className={showAdvancedFilters ? "" : "bg-gray-200 hover:bg-gray-300 text-gray-700"}
              >
                <Filter className="h-4 w-4 mr-2" />
                {showAdvancedFilters ? 'Hide Filters' : 'Advanced Filters'}
              </Button>
              {(userSearchQuery || selectedOUs.length > 0 || selectedGroups.length > 0 || statusFilter !== 'all' || expirationFilter !== 'all') && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setUserSearchQuery('');
                    setSelectedOUs([]);
                    setSelectedGroups([]);
                    setStatusFilter('all');
                    setExpirationFilter('all');
                    setCurrentPage(1);
                  }}
                  className="bg-red-100 text-red-700 hover:bg-red-200 hover:text-red-800"
                >
                  <X className="h-4 w-4 mr-2" />
                  Clear All
                </Button>
              )}
            </div>

            {showAdvancedFilters && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-gray-200">
                <div>
                  <Label className="block text-sm font-semibold text-gray-700 mb-2">
                    Organizational Units ({selectedOUs.length} selected)
                  </Label>
                  <div className="border border-gray-300 rounded-lg max-h-48 overflow-y-auto bg-white p-2">
                    {availableOUs.map(({ name, count }) => (
                      <div
                        key={name}
                        className="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-50 rounded"
                      >
                        <Checkbox
                          id={`ou-${name}`}
                          checked={selectedOUs.includes(name)}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              setSelectedOUs([...selectedOUs, name]);
                            } else {
                              setSelectedOUs(selectedOUs.filter(ou => ou !== name));
                            }
                            setCurrentPage(1);
                          }}
                        />
                        <Label htmlFor={`ou-${name}`} className="flex-1 flex items-center justify-between cursor-pointer font-normal">
                          <span className="truncate">{name}</span>
                          <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full ml-2">
                            {count}
                          </span>
                        </Label>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <Label className="block text-sm font-semibold text-gray-700 mb-2">
                    Group Membership ({selectedGroups.length} selected)
                  </Label>
                  <div className="border border-gray-300 rounded-lg max-h-48 overflow-y-auto bg-white p-2">
                    {availableGroups.map(({ name, count }) => (
                      <div
                        key={name}
                        className="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-50 rounded"
                      >
                        <Checkbox
                          id={`group-${name}`}
                          checked={selectedGroups.includes(name)}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              setSelectedGroups([...selectedGroups, name]);
                            } else {
                              setSelectedGroups(selectedGroups.filter(group => group !== name));
                            }
                            setCurrentPage(1);
                          }}
                        />
                        <Label htmlFor={`group-${name}`} className="flex-1 flex items-center justify-between cursor-pointer font-normal">
                          <span className="truncate">{name}</span>
                          <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full ml-2">
                            {count}
                          </span>
                        </Label>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <Label className="block text-sm font-semibold text-gray-700 mb-2">
                    Account Status
                  </Label>
                  <Select
                    value={statusFilter}
                    onValueChange={(val) => {
                      setStatusFilter(val as StatusFilter);
                      setCurrentPage(1);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="All Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Status</SelectItem>
                      <SelectItem value="enabled">Enabled Only</SelectItem>
                      <SelectItem value="disabled">Disabled Only</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="block text-sm font-semibold text-gray-700 mb-2">
                    Expiration Status
                  </Label>
                  <Select
                    value={expirationFilter}
                    onValueChange={(val) => {
                      setExpirationFilter(val as ExpirationFilter);
                      setCurrentPage(1);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="All" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      <SelectItem value="active">Active (Not Expired)</SelectItem>
                      <SelectItem value="expired">Expired</SelectItem>
                      <SelectItem value="expiring-soon">Expiring Soon (30 days)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {(selectedOUs.length > 0 || selectedGroups.length > 0 || statusFilter !== 'all' || expirationFilter !== 'all') && (
              <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-gray-200">
                <span className="text-sm font-semibold text-gray-700">Active Filters:</span>
                {selectedOUs.map(ou => (
                  <span key={ou} className="inline-flex items-center gap-1 px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm">
                    OU: {ou}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        setSelectedOUs(selectedOUs.filter(o => o !== ou));
                        setCurrentPage(1);
                      }}
                      className="h-4 w-4 ml-1 hover:bg-transparent hover:text-blue-900"
                      aria-label={`Remove ${ou} filter`}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </span>
                ))}
                {selectedGroups.map(group => (
                  <span key={group} className="inline-flex items-center gap-1 px-3 py-1 bg-purple-100 text-purple-800 rounded-full text-sm">
                    Group: {group}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        setSelectedGroups(selectedGroups.filter(g => g !== group));
                        setCurrentPage(1);
                      }}
                      className="h-4 w-4 ml-1 hover:bg-transparent hover:text-purple-900"
                      aria-label={`Remove ${group} filter`}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </span>
                ))}
                {statusFilter !== 'all' && (
                  <span className="inline-flex items-center gap-1 px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm">
                    Status: {statusFilter}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        setStatusFilter('all');
                        setCurrentPage(1);
                      }}
                      className="h-4 w-4 ml-1 hover:bg-transparent hover:text-green-900"
                      aria-label="Remove status filter"
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </span>
                )}
                {expirationFilter !== 'all' && (
                  <span className="inline-flex items-center gap-1 px-3 py-1 bg-orange-100 text-orange-800 rounded-full text-sm">
                    Expiration: {expirationFilter}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        setExpirationFilter('all');
                        setCurrentPage(1);
                      }}
                      className="h-4 w-4 ml-1 hover:bg-transparent hover:text-orange-900"
                      aria-label="Remove expiration filter"
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="rounded-md border shadow-sm bg-white">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead
                    className="w-[150px] cursor-pointer hover:bg-muted/50 select-none"
                    onClick={() => handleSort('username')}
                  >
                    <div className="flex items-center gap-2">
                      Username
                      {sortField === 'username' && (
                        <span>{sortDirection === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </div>
                  </TableHead>
                  <TableHead
                    className="cursor-pointer hover:bg-muted/50 select-none"
                    onClick={() => handleSort('displayName')}
                  >
                    <div className="flex items-center gap-2">
                      Display Name
                      {sortField === 'displayName' && (
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
                  <TableHead>OU</TableHead>
                  <TableHead
                    className="cursor-pointer hover:bg-muted/50 select-none"
                    onClick={() => handleSort('accountEnabled')}
                  >
                    <div className="flex items-center gap-2">
                      Status
                      {sortField === 'accountEnabled' && (
                        <span>{sortDirection === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </div>
                  </TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead
                    className="cursor-pointer hover:bg-muted/50 select-none"
                    onClick={() => handleSort('whenCreated')}
                  >
                    <div className="flex items-center gap-2">
                      Created
                      {sortField === 'whenCreated' && (
                        <span>{sortDirection === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </div>
                  </TableHead>
                  <TableHead
                    className="cursor-pointer hover:bg-muted/50 select-none"
                    onClick={() => handleSort('lastVerifiedAt')}
                  >
                    <div className="flex items-center gap-2">
                      Last Verified
                      {sortField === 'lastVerifiedAt' && (
                        <span>{sortDirection === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </div>
                  </TableHead>
                  <TableHead>Groups</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedUsers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="h-24 text-center">
                      No users found matching your search.
                    </TableCell>
                  </TableRow>
                ) : (
                  paginatedUsers.map((user) => {
                    const userOU = (user.dn || '').split(',').find(part => part.trim().toUpperCase().startsWith('OU='))?.split('=')[1] || 'Unknown';

                    return (
                      <TableRow
                        key={user.dn}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => setSelectedUser(user)}
                      >
                        <TableCell className="font-medium">
                          {user.username}
                        </TableCell>
                        <TableCell>
                          {user.displayName || <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="break-all text-muted-foreground">
                          {user.email || <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell>
                          <span className="inline-flex items-center rounded-md bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600 ring-1 ring-inset ring-gray-500/10">
                            {userOU}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className={`px-3 py-1 rounded-full text-xs font-semibold ${user.accountEnabled
                            ? 'bg-green-100 text-green-800'
                            : 'bg-red-100 text-red-800'
                            }`}>
                            {user.accountEnabled ? 'Enabled' : 'Disabled'}
                          </span>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {user.accountExpires ? (
                            <div className="flex items-center gap-2">
                              <span
                                className={`font-medium ${isExpired(user.accountExpires)
                                  ? 'text-red-600'
                                  : isExpiringSoon(user.accountExpires)
                                    ? 'text-yellow-600'
                                    : ''
                                  }`}
                                title={new Date(user.accountExpires).toLocaleString()}
                              >
                                {new Date(user.accountExpires).toLocaleDateString()}
                              </span>
                              {isExpired(user.accountExpires) && (
                                <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded text-xs font-semibold">
                                  Expired
                                </span>
                              )}
                              {isExpiringSoon(user.accountExpires) && !isExpired(user.accountExpires) && (
                                <span className="px-2 py-0.5 bg-yellow-100 text-yellow-700 rounded text-xs font-semibold">
                                  Soon
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-muted-foreground">Never</span>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {user.whenCreated ? (
                            new Date(user.whenCreated).toLocaleDateString()
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {user.lastVerifiedAt ? (
                            <div>
                              <div>{new Date(user.lastVerifiedAt).toLocaleDateString()}</div>
                              <div className="text-xs text-muted-foreground">{formatVerificationSource(user.lastVerifiedSource)}</div>
                            </div>
                          ) : (
                            <span className="text-muted-foreground">N/A</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {(user.memberOf || []).length > 0 ? (
                            <span className="text-blue-600 font-medium">
                              {(user.memberOf || []).length} group{(user.memberOf || []).length !== 1 ? 's' : ''}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>

          {totalPages > 1 && (
            <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-700">Show:</span>
                <Select
                  value={pageSize.toString()}
                  onValueChange={(val) => {
                    setPageSize(Number(val));
                    setCurrentPage(1);
                  }}
                >
                  <SelectTrigger className="w-[70px] h-8">
                    <SelectValue placeholder="10" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="10">10</SelectItem>
                    <SelectItem value="25">25</SelectItem>
                    <SelectItem value="50">50</SelectItem>
                    <SelectItem value="100">100</SelectItem>
                  </SelectContent>
                </Select>
                <span className="text-sm text-gray-600 ml-4">
                  Showing {(currentPage - 1) * pageSize + 1} to {Math.min(currentPage * pageSize, sortedUsers.length)} of {sortedUsers.length}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setCurrentPage(1)}
                  disabled={currentPage === 1}
                  className="h-8 w-8"
                >
                  <ChevronsLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setCurrentPage(currentPage - 1)}
                  disabled={currentPage === 1}
                  className="h-8 w-8"
                >
                  <ChevronLeft className="h-4 w-4" />
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
                      className={`h-8 w-8 p-0 ${currentPage !== pageNum ? "hover:bg-gray-50" : ""}`}
                    >
                      {pageNum}
                    </Button>
                  );
                })}

                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setCurrentPage(currentPage + 1)}
                  disabled={currentPage === totalPages}
                  className="h-8 w-8"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setCurrentPage(totalPages)}
                  disabled={currentPage === totalPages}
                  className="h-8 w-8"
                >
                  <ChevronsRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      <UserDetailModal
        user={selectedUser}
        onClose={() => setSelectedUser(null)}
      />
    </div>
  );
}
