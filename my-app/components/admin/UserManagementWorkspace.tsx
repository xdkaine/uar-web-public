'use client';

import UserDetailModal from './UserDetailModal';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { AccountOwnershipDetails } from './AccountOwnershipDetails';
import {
  formatVerificationSource,
  isExpired,
  isExpiringSoon,
  type LDAPUser,
} from './user-management-utils';
import type { DirectoryFetchState } from '@/app/api/admin/users/directory-fetch-state';
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

type StatusFilter = 'all' | 'enabled' | 'disabled';
type ExpirationFilter = 'all' | 'active' | 'expired' | 'expiring-soon';

interface UserManagementWorkspaceView {
  isLoading: boolean;
  isPolling: boolean;
  togglePolling: () => void;
  refresh: () => Promise<unknown>;
  isPollingLoading: boolean;
  lastUpdated: Date | null;
  directoryFetchFailure: Extract<DirectoryFetchState, { state: 'size_limit_error' | 'query_error' }> | null;
  directoryFetchState: DirectoryFetchState | null;
  directoryUsers: LDAPUser[];
  filteredUsers: LDAPUser[];
  userSearchQuery: string;
  setUserSearchQuery: (value: string) => void;
  exportToCSV: () => void;
  showAdvancedFilters: boolean;
  setShowAdvancedFilters: (value: boolean) => void;
  selectedOUs: string[];
  setSelectedOUs: (value: string[]) => void;
  availableOUs: Array<{ name: string; count: number }>;
  selectedOUSet: Set<string>;
  selectedGroups: string[];
  setSelectedGroups: (value: string[]) => void;
  availableGroups: Array<{ name: string; count: number }>;
  selectedGroupSet: Set<string>;
  statusFilter: StatusFilter;
  setStatusFilter: (value: StatusFilter) => void;
  expirationFilter: ExpirationFilter;
  setExpirationFilter: (value: ExpirationFilter) => void;
  activeFilterCount: number;
  setCurrentPage: (value: number) => void;
  paginatedUsers: LDAPUser[];
  setSelectedUser: (user: LDAPUser | null) => void;
  handleSort: (field: 'username' | 'displayName' | 'email' | 'accountEnabled' | 'whenCreated' | 'lastVerifiedAt') => void;
  sortField: 'username' | 'displayName' | 'email' | 'accountEnabled' | 'whenCreated' | 'lastVerifiedAt';
  sortDirection: 'asc' | 'desc';
  totalPages: number;
  pageSize: number;
  setPageSize: (value: number) => void;
  currentPage: number;
  sortedUsers: LDAPUser[];
  selectedUser: LDAPUser | null;
}

export function renderUserManagementWorkspace(view: UserManagementWorkspaceView) {
  const {
    isLoading, isPolling, togglePolling, refresh, isPollingLoading, lastUpdated, directoryFetchFailure,
    directoryFetchState, directoryUsers, filteredUsers, userSearchQuery, setUserSearchQuery, exportToCSV, showAdvancedFilters,
    setShowAdvancedFilters, selectedOUs, setSelectedOUs, availableOUs, selectedOUSet,
    selectedGroups, setSelectedGroups, availableGroups, selectedGroupSet, statusFilter,
    setStatusFilter, expirationFilter, setExpirationFilter, activeFilterCount, setCurrentPage,
    paginatedUsers, setSelectedUser, handleSort, sortField, sortDirection, totalPages,
    pageSize, setPageSize, currentPage, sortedUsers, selectedUser,
  } = view;

  return (
    <div>
      <div className="mb-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground">User Management</h2>
          <p className="text-muted-foreground mt-2">View all users within the SDC.CPP Domain</p>
        </div>

        <div className="flex items-center gap-4 bg-card p-2 rounded-lg shadow-sm border border-border">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${isPolling ? 'bg-green-500 animate-pulse' : 'bg-muted-foreground'}`}></div>
            <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
              {isPolling ? 'Live Updates' : 'Paused'}
            </span>
          </div>

          <div className="h-4 w-px bg-muted"></div>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => togglePolling()}
              className={`h-8 w-8 ${isPolling
                ? 'text-muted-foreground hover:text-muted-foreground hover:bg-muted'
                : 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 hover:bg-blue-100'
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
              className="h-8 w-8 text-muted-foreground hover:text-blue-600 dark:hover:text-blue-400 dark:text-blue-400 hover:bg-blue-50 dark:bg-blue-950/40"
              title="Refresh now"
            >
              <RefreshCw className={`h-4 w-4 ${isPollingLoading ? 'animate-spin' : ''}`} />
            </Button>
          </div>

          {lastUpdated && (
            <>
              <div className="h-4 w-px bg-muted"></div>
              <span className="text-xs text-muted-foreground tabular-nums">
                {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            </>
          )}
        </div>
      </div>

      {(isLoading || isPollingLoading) && !directoryUsers.length && !directoryFetchFailure ? (
        <div className="text-center py-8 text-muted-foreground">Loading users...</div>
      ) : directoryFetchFailure ? (
        <div className="rounded-lg border-2 border-destructive/40 bg-card p-8 text-center">
          <p className="mb-2 font-semibold text-foreground">
            {directoryFetchFailure.state === 'size_limit_error'
              ? 'Active Directory result limit reached'
              : 'Active Directory query unavailable'}
          </p>
          <p className="mx-auto max-w-xl text-sm text-muted-foreground">
            {directoryFetchFailure.state === 'size_limit_error'
              ? 'The directory returned more results than this query can safely display. Refine the directory query or contact an administrator to adjust the server-side limit.'
              : 'The directory query could not be completed. Retry after confirming the directory service is available.'}
          </p>
          {directoryFetchFailure.diagnosticReference && (
            <p className="mt-2 text-xs text-muted-foreground">
              Diagnostic reference: <code>{directoryFetchFailure.diagnosticReference}</code>
            </p>
          )}
          <Button
            className="mt-5 gap-2"
            onClick={() => refresh()}
            disabled={isPollingLoading}
          >
            <RefreshCw className={`h-4 w-4 ${isPollingLoading ? 'animate-spin' : ''}`} />
            Retry directory query
          </Button>
        </div>
      ) : directoryUsers.length === 0 ? (
        <div className="bg-card rounded-lg shadow-xl border-2 border-border p-8 text-center">
          <p className="text-foreground font-semibold mb-2">No Active Directory accounts found</p>
          <p className="text-muted-foreground text-sm">The directory query completed successfully and did not return any accounts.</p>
        </div>
      ) : (
        <div>
          {directoryFetchState?.state === 'result_cap_reached' && (
            <div className="bg-yellow-50 dark:bg-yellow-950/40 border-l-4 border-yellow-400 p-4 mb-4">
              <div className="flex">
                <div className="shrink-0">
                  <svg className="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="ml-3">
                  <p className="text-sm text-yellow-700 dark:text-yellow-200">
                    <span className="font-medium">Directory result cap reached:</span> Displaying {directoryUsers.length} of up to {directoryFetchState.resultCap} returned accounts. Additional Active Directory accounts may not be shown.
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="mb-4 overflow-hidden rounded-xl border border-border bg-card">
            <div className="grid grid-cols-2 divide-x divide-y divide-border border-b border-border sm:grid-cols-3 lg:grid-cols-6 lg:divide-y-0">
              {[
                ['Directory', directoryUsers.length, 'text-foreground'],
                ['Matching', filteredUsers.length, 'text-blue-600 dark:text-blue-400'],
                ['Enabled', directoryUsers.filter(u => u.accountEnabled).length, 'text-green-600 dark:text-green-400'],
                ['Disabled', directoryUsers.filter(u => !u.accountEnabled).length, 'text-red-600 dark:text-red-400'],
                ['Expired', directoryUsers.filter(u => isExpired(u.accountExpires)).length, 'text-orange-600 dark:text-orange-400'],
                ['Expiring soon', directoryUsers.filter(u => isExpiringSoon(u.accountExpires)).length, 'text-yellow-600 dark:text-yellow-400'],
              ].map(([label, value, tone]) => (
                <div key={String(label)} className="px-4 py-3">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
                  <p className={`mt-1 text-xl font-semibold tabular-nums ${tone}`}>{value}</p>
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-3 p-4 lg:flex-row">
              <div className="flex-1">
                <div className="relative">
                  <Input
                    type="text"
                    placeholder="Search names, usernames, email, request, batch item, or batch run IDs..."
                    value={userSearchQuery}
                    onChange={(e) => {
                      setUserSearchQuery(e.target.value);
                      setCurrentPage(1);
                    }}
                    className="pl-10"
                  />
                  <Search className="absolute left-3 top-2.5 h-5 w-5 text-muted-foreground" />
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
                variant={showAdvancedFilters ? "secondary" : "outline"}
                onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
                aria-expanded={showAdvancedFilters}
              >
                <Filter className="h-4 w-4 mr-2" />
                Filters {activeFilterCount > 0 ? `(${activeFilterCount})` : ''}
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
                  className="text-red-700 dark:text-red-300"
                >
                  <X className="h-4 w-4 mr-2" />
                  Clear All
                </Button>
              )}
            </div>

            {showAdvancedFilters && (
              <div className="grid grid-cols-1 gap-4 border-t border-border bg-muted/25 p-4 md:grid-cols-2 xl:grid-cols-4">
                <div>
                  <p className="block text-sm font-semibold text-muted-foreground mb-2">
                    Organizational Units ({selectedOUs.length} selected)
                  </p>
                  <div className="max-h-48 overflow-y-auto rounded-lg border border-border bg-card p-2">
                    {availableOUs.map(({ name, count }) => (
                      <div
                        key={name}
                        className="flex items-center gap-2 px-2 py-1.5 hover:bg-muted/50 rounded"
                      >
                        <Checkbox
                          id={`ou-${name}`}
                          checked={selectedOUSet.has(name)}
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
                          <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full ml-2">
                            {count}
                          </span>
                        </Label>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="block text-sm font-semibold text-muted-foreground mb-2">
                    Group Membership ({selectedGroups.length} selected)
                  </p>
                  <div className="max-h-48 overflow-y-auto rounded-lg border border-border bg-card p-2">
                    {availableGroups.map(({ name, count }) => (
                      <div
                        key={name}
                        className="flex items-center gap-2 px-2 py-1.5 hover:bg-muted/50 rounded"
                      >
                        <Checkbox
                          id={`group-${name}`}
                          checked={selectedGroupSet.has(name)}
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
                          <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full ml-2">
                            {count}
                          </span>
                        </Label>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-muted-foreground mb-2" htmlFor="directory-status-filter">
                    Account Status
                  </label>
                  <Select
                    value={statusFilter}
                    onValueChange={(val) => {
                      setStatusFilter(val as StatusFilter);
                      setCurrentPage(1);
                    }}
                  >
                    <SelectTrigger id="directory-status-filter">
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
                  <label className="block text-sm font-semibold text-muted-foreground mb-2" htmlFor="directory-expiration-filter">
                    Expiration Status
                  </label>
                  <Select
                    value={expirationFilter}
                    onValueChange={(val) => {
                      setExpirationFilter(val as ExpirationFilter);
                      setCurrentPage(1);
                    }}
                  >
                    <SelectTrigger id="directory-expiration-filter">
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
              <div className="flex flex-wrap gap-2 border-t border-border px-4 py-3">
                <span className="text-sm font-semibold text-muted-foreground">Active Filters:</span>
                {selectedOUs.map(ou => (
                  <span key={ou} className="inline-flex items-center gap-1 px-3 py-1 bg-blue-100 dark:bg-blue-950/60 text-blue-800 rounded-full text-sm">
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
                  <span key={group} className="inline-flex items-center gap-1 px-3 py-1 bg-purple-100 dark:bg-purple-950/60 text-purple-800 rounded-full text-sm">
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
                  <span className="inline-flex items-center gap-1 px-3 py-1 bg-green-100 dark:bg-green-950/60 text-green-800 rounded-full text-sm">
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
                  <span className="inline-flex items-center gap-1 px-3 py-1 bg-orange-100 dark:bg-orange-950/60 text-orange-800 rounded-full text-sm">
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

          <div className="rounded-md border shadow-sm bg-card">
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
                  <TableHead>Portal owner</TableHead>
                  <TableHead>Groups</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedUsers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="h-24 text-center">
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
                          <span className="inline-flex items-center rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground ring-1 ring-inset ring-border">
                            {userOU}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className={`px-3 py-1 rounded-full text-xs font-semibold ${user.accountEnabled
                            ? 'bg-green-100 dark:bg-green-950/60 text-green-800'
                            : 'bg-red-100 dark:bg-red-950/60 text-red-800'
                            }`}>
                            {user.accountEnabled ? 'Enabled' : 'Disabled'}
                          </span>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {user.accountExpires ? (
                            <div className="flex items-center gap-2">
                              <span
                                className={`font-medium ${isExpired(user.accountExpires)
                                  ? 'text-red-600 dark:text-red-400'
                                  : isExpiringSoon(user.accountExpires)
                                    ? 'text-yellow-600 dark:text-yellow-400'
                                    : ''
                                  }`}
                                title={new Date(user.accountExpires).toLocaleString()}
                              >
                                {new Date(user.accountExpires).toLocaleDateString()}
                              </span>
                              {isExpired(user.accountExpires) && (
                                <span className="px-2 py-0.5 bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-200 rounded text-xs font-semibold">
                                  Expired
                                </span>
                              )}
                              {isExpiringSoon(user.accountExpires) && !isExpired(user.accountExpires) && (
                                <span className="px-2 py-0.5 bg-yellow-100 dark:bg-yellow-950/60 text-yellow-700 dark:text-yellow-200 rounded text-xs font-semibold">
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
                        <TableCell className="min-w-[12rem]">
                          <AccountOwnershipDetails ownership={user.ownership} compact />
                        </TableCell>
                        <TableCell>
                          {(user.memberOf || []).length > 0 ? (
                            <span className="text-blue-600 dark:text-blue-400 font-medium">
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
            <div className="px-6 py-4 border-t border-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Show:</span>
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
                <span className="text-sm text-muted-foreground ml-4">
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
                  aria-label="Go to first page"
                >
                  <ChevronsLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setCurrentPage(currentPage - 1)}
                  disabled={currentPage === 1}
                  className="h-8 w-8"
                  aria-label="Go to previous page"
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
                      className={`h-8 w-8 p-0 ${currentPage !== pageNum ? "hover:bg-muted/50" : ""}`}
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
                  aria-label="Go to next page"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setCurrentPage(totalPages)}
                  disabled={currentPage === totalPages}
                  className="h-8 w-8"
                  aria-label="Go to last page"
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
