'use client';

import { useState, useMemo, useCallback } from 'react';
import { renderUserManagementWorkspace } from './UserManagementWorkspace';
import { usePolling } from '@/hooks/usePolling';
import {
  buildDirectoryUsersCsv,
  DirectoryFetchError,
  directoryUserMatchesSearch,
  isDirectoryFetchState,
  isDirectoryUser,
  isExpired,
  isExpiringSoon,
  type DirectoryUsersResponse,
  type LDAPUser,
} from './user-management-utils';
import type { DirectoryFetchState } from '@/app/api/admin/users/directory-fetch-state';

interface UserManagementTabProps {
  users?: LDAPUser[];
  isLoading?: boolean;
}

type StatusFilter = 'all' | 'enabled' | 'disabled';
type ExpirationFilter = 'all' | 'active' | 'expired' | 'expiring-soon';

export default function UserManagementTab({ users, isLoading = false }: UserManagementTabProps) {
  const [localUsers, setLocalUsers] = useState<LDAPUser[]>([]);
  const [directoryFetchState, setDirectoryFetchState] = useState<DirectoryFetchState | null>(
    users === undefined ? null : { state: 'success' },
  );

  const fetchUsers = useCallback(async (): Promise<DirectoryUsersResponse> => {
    const response = await fetch('/api/admin/users?includeVpnOnly=false');
    if (!response.ok) {
      throw new DirectoryFetchError({ state: 'query_error' });
    }

    const payload: unknown = await response.json().catch(() => null);
    const responseBody = payload && typeof payload === 'object'
      ? payload as Record<string, unknown>
      : null;
    const directory = responseBody && isDirectoryFetchState(responseBody.directory)
      ? responseBody.directory
      : { state: 'query_error' } satisfies DirectoryFetchState;

    if (directory.state === 'size_limit_error' || directory.state === 'query_error') {
      throw new DirectoryFetchError(directory);
    }

    if (!responseBody || !Array.isArray(responseBody.users)) {
      throw new DirectoryFetchError({ state: 'query_error' });
    }

    return {
      users: responseBody.users.filter(isDirectoryUser),
      directory,
    };
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
      setLocalUsers(data.users);
      setDirectoryFetchState(data.directory);
    },
    onError: (error) => {
      setDirectoryFetchState(error instanceof DirectoryFetchError
        ? error.directory
        : { state: 'query_error' });
    },
  });

  const directoryUsers = useMemo(
    () => (users !== undefined ? users : localUsers).filter(isDirectoryUser),
    [localUsers, users]
  );
  const directoryFetchFailure = directoryFetchState
    && (directoryFetchState.state === 'size_limit_error' || directoryFetchState.state === 'query_error')
    ? directoryFetchState
    : null;

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
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(true);
  const activeFilterCount = selectedOUs.length + selectedGroups.length
    + (statusFilter === 'all' ? 0 : 1)
    + (expirationFilter === 'all' ? 0 : 1);

  // Export filtered users to CSV
  const exportToCSV = () => {
    const csvContent = buildDirectoryUsersCsv(filteredUsers);

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
    try {
      link.click();
    } finally {
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 0);
    }
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

  const selectedOUSet = useMemo(() => new Set(selectedOUs), [selectedOUs]);
  const selectedGroupSet = useMemo(() => new Set(selectedGroups), [selectedGroups]);

  // Filter, sort, and paginate users
  const filteredUsers = directoryUsers.filter(user => {
    // Text search filter
    const matchesSearch = directoryUserMatchesSearch(user, userSearchQuery);

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

  return renderUserManagementWorkspace({
    isLoading, isPolling, togglePolling, refresh, isPollingLoading, lastUpdated, directoryFetchFailure,
    directoryFetchState, directoryUsers, filteredUsers, userSearchQuery, setUserSearchQuery, exportToCSV, showAdvancedFilters,
    setShowAdvancedFilters, selectedOUs, setSelectedOUs, availableOUs, selectedOUSet,
    selectedGroups, setSelectedGroups, availableGroups, selectedGroupSet, statusFilter,
    setStatusFilter, expirationFilter, setExpirationFilter, activeFilterCount, setCurrentPage,
    paginatedUsers, setSelectedUser, handleSort, sortField, sortDirection, totalPages,
    pageSize, setPageSize, currentPage, sortedUsers, selectedUser,
  });
}
