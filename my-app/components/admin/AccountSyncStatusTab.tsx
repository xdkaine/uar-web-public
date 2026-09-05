'use client';

import { useCallback, useMemo, useState } from 'react';
import { useToast } from '@/hooks/useToast';
import { usePolling } from '@/hooks/usePolling';
import { AccountSyncStatusControls } from './AccountSyncStatusControls';
import { AccountSyncStatusDetailDialog } from './AccountSyncStatusDetailDialog';
import { AccountSyncStatusSummary } from './AccountSyncStatusSummary';
import { AccountSyncStatusTable } from './AccountSyncStatusTable';
import { buildSyncStatusCsv, calculateSyncStatusStats, filterSyncStatusAccounts, sortSyncStatusAccounts } from './AccountSyncStatusHelpers';
import type { DataSourceFilter, LatestSyncInfo, OwnershipFilter, SortDirection, SyncFilter, SyncSortField, SyncStatusAccount, SyncStatusTabProps } from './AccountSyncStatusTypes';

interface SyncStatusResponse { accounts?: SyncStatusAccount[]; latestSync?: LatestSyncInfo | null; }
interface PollingSyncStatus {
  accounts?: SyncStatusAccount[];
  latestSync?: LatestSyncInfo | null;
  accountsSource: SyncStatusAccount[] | undefined;
  latestSyncSource: LatestSyncInfo | null;
}

const EMPTY_ACCOUNTS: SyncStatusAccount[] = [];

export default function AccountSyncStatusTab({ accounts, isLoading = false, latestSync = null }: SyncStatusTabProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [syncFilter, setSyncFilter] = useState<SyncFilter>('all');
  const [dataSourceFilter, setDataSourceFilter] = useState<DataSourceFilter>('all');
  const [ownershipFilter, setOwnershipFilter] = useState<OwnershipFilter>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sortField, setSortField] = useState<SyncSortField>('identifier');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<SyncStatusAccount | null>(null);
  const [pollingSyncStatus, setPollingSyncStatus] = useState<PollingSyncStatus | null>(null);
  const { showToast } = useToast();

  const fetchSyncData = useCallback(async (): Promise<SyncStatusResponse> => {
    const response = await fetch('/api/admin/sync-status');
    if (!response.ok) throw new Error('Failed to fetch sync status');
    return response.json() as Promise<SyncStatusResponse>;
  }, []);
  const handlePollSuccess = useCallback((data: SyncStatusResponse) => {
    setPollingSyncStatus((previous) => ({
      accounts: data.accounts ?? (previous && previous.accountsSource === accounts ? previous.accounts : accounts),
      latestSync: data.latestSync ?? (previous && previous.latestSyncSource === latestSync ? previous.latestSync : latestSync),
      accountsSource: accounts,
      latestSyncSource: latestSync,
    }));
  }, [accounts, latestSync]);
  const { isLoading: isPollingLoading, isPolling, togglePolling, refresh, lastUpdated } = usePolling(fetchSyncData, { interval: 30000, onSuccess: handlePollSuccess });

  const displayedAccounts = useMemo(() => {
    if (pollingSyncStatus?.accountsSource === accounts) return pollingSyncStatus?.accounts ?? accounts ?? EMPTY_ACCOUNTS;
    return accounts ?? EMPTY_ACCOUNTS;
  }, [accounts, pollingSyncStatus]);
  const stats = useMemo(() => calculateSyncStatusStats(displayedAccounts), [displayedAccounts]);
  const filteredAccounts = useMemo(() => filterSyncStatusAccounts(displayedAccounts, searchQuery, syncFilter, dataSourceFilter, ownershipFilter), [displayedAccounts, searchQuery, syncFilter, dataSourceFilter, ownershipFilter]);
  const sortedAccounts = useMemo(() => sortSyncStatusAccounts(filteredAccounts, sortField, sortDirection), [filteredAccounts, sortField, sortDirection]);
  const paginatedAccounts = useMemo(() => sortedAccounts.slice((currentPage - 1) * pageSize, currentPage * pageSize), [sortedAccounts, currentPage, pageSize]);
  const totalPages = Math.max(1, Math.ceil(sortedAccounts.length / pageSize));
  const displayedLatestSync = useMemo(() => {
    if (pollingSyncStatus?.latestSyncSource === latestSync) return pollingSyncStatus?.latestSync ?? latestSync;
    return latestSync;
  }, [latestSync, pollingSyncStatus]);

  const handleSort = (field: SyncSortField) => {
    if (sortField === field) setSortDirection((direction) => direction === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDirection('asc'); }
  };
  const exportToCsv = () => {
    const blob = new Blob([buildSyncStatusCsv(sortedAccounts)], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `account-sync-status-${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    showToast('CSV exported successfully', 'success');
  };

  return (
    <div className="space-y-6">
      <AccountSyncStatusSummary latestSync={displayedLatestSync} stats={stats} />
      <AccountSyncStatusControls
        searchQuery={searchQuery}
        syncFilter={syncFilter}
        dataSourceFilter={dataSourceFilter}
        ownershipFilter={ownershipFilter}
        showAdvancedFilters={showAdvancedFilters}
        pageSize={pageSize}
        shownAccounts={paginatedAccounts.length}
        filteredAccounts={sortedAccounts.length}
        totalAccounts={stats.total}
        isLoading={isPollingLoading || isLoading}
        isPolling={isPolling}
        lastUpdated={lastUpdated}
        onSearchChange={(value) => { setSearchQuery(value); setCurrentPage(1); }}
        onSyncFilterChange={(value) => { setSyncFilter(value); setCurrentPage(1); }}
        onDataSourceFilterChange={(value) => { setDataSourceFilter(value); setCurrentPage(1); }}
        onOwnershipFilterChange={(value) => { setOwnershipFilter(value); setCurrentPage(1); }}
        onPageSizeChange={(value) => { setPageSize(value); setCurrentPage(1); }}
        onToggleFilters={() => setShowAdvancedFilters((shown) => !shown)}
        onTogglePolling={togglePolling}
        onRefresh={() => void refresh()}
        onExport={exportToCsv}
      />
      <AccountSyncStatusTable
        accounts={paginatedAccounts}
        currentPage={currentPage}
        totalPages={totalPages}
        sortField={sortField}
        sortDirection={sortDirection}
        onSort={handleSort}
        onPageChange={setCurrentPage}
        onAccountSelect={setSelectedAccount}
      />
      <AccountSyncStatusDetailDialog
        account={selectedAccount}
        open={selectedAccount !== null}
        onOpenChange={(open) => { if (!open) setSelectedAccount(null); }}
      />
    </div>
  );
}
