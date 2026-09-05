import type { DataSourceFilter, OwnershipFilter, SortDirection, SyncFilter, SyncSortField, SyncStatusAccount, SyncStatusStats } from './AccountSyncStatusTypes';

function textMatches(value: string | null | undefined, query: string): boolean {
  return (value ?? '').toLowerCase().includes(query);
}

export function matchesSyncStatusSearch(account: SyncStatusAccount, searchQuery: string): boolean {
  const query = searchQuery.trim().toLowerCase();
  if (!query) return true;
  return [account.identifier, account.name, account.email, account.adUsername, account.vpnUsername, account.ownership?.requestId, account.ownership?.batchItemId, account.ownership?.batchRunId]
    .some((value) => textMatches(value, query));
}

export function calculateSyncStatusStats(accounts: SyncStatusAccount[]): SyncStatusStats {
  return {
    total: accounts.length,
    fullySynced: accounts.filter((account) => account.syncStatus === 'fully_synced').length,
    partialSync: accounts.filter((account) => account.syncStatus === 'partial_sync').length,
    adOnly: accounts.filter((account) => account.syncStatus === 'ad_only').length,
    vpnOnly: accounts.filter((account) => account.syncStatus === 'vpn_only').length,
    requestOnly: accounts.filter((account) => account.syncStatus === 'request_only').length,
    offboarded: accounts.filter((account) => account.syncStatus === 'offboarded').length,
    orphaned: accounts.filter((account) => account.syncStatus === 'orphaned').length,
    withIssues: accounts.filter((account) => account.syncIssues.length > 0).length,
    hasAd: accounts.filter((account) => account.hasAdAccount).length,
    hasVpn: accounts.filter((account) => account.hasVpnAccount).length,
    hasRequest: accounts.filter((account) => account.hasAccessRequest).length,
    autoAssigned: accounts.filter((account) => account.wasAutoAssigned).length,
  };
}

export function filterSyncStatusAccounts(accounts: SyncStatusAccount[], searchQuery: string, syncFilter: SyncFilter, dataSourceFilter: DataSourceFilter, ownershipFilter: OwnershipFilter = 'all'): SyncStatusAccount[] {
  return accounts.filter((account) => {
    const statusMatches = syncFilter === 'all'
      || (syncFilter === 'issues' ? account.syncIssues.length > 0 : account.syncStatus === syncFilter);
    const sourceMatches: Record<DataSourceFilter, boolean> = {
      all: true,
      has_ad: account.hasAdAccount,
      has_vpn: account.hasVpnAccount,
      has_request: account.hasAccessRequest,
      missing_ad: !account.hasAdAccount,
      missing_vpn: !account.hasVpnAccount,
      missing_request: !account.hasAccessRequest,
    };
    const ownershipMatches: Record<OwnershipFilter, boolean> = {
      all: true,
      request_owner: account.ownership?.ownerType === 'access_request',
      batch_owner: account.ownership?.ownerType === 'batch_account',
      no_owner: account.ownership?.readiness === 'unowned',
      needs_review: account.ownership?.readiness === 'needs_review',
      ownership_unavailable: account.ownership === undefined || account.ownership === null || account.ownership.readiness === 'unavailable',
    };
    return matchesSyncStatusSearch(account, searchQuery) && statusMatches && sourceMatches[dataSourceFilter] && ownershipMatches[ownershipFilter];
  });
}

export function sortSyncStatusAccounts(accounts: SyncStatusAccount[], sortField: SyncSortField, sortDirection: SortDirection): SyncStatusAccount[] {
  return [...accounts].sort((left, right) => {
    const leftValue = sortField === 'adSyncDate' ? (left.adSyncDate ? new Date(left.adSyncDate).getTime() : 0) : left[sortField];
    const rightValue = sortField === 'adSyncDate' ? (right.adSyncDate ? new Date(right.adSyncDate).getTime() : 0) : right[sortField];
    if (leftValue === null || leftValue === undefined) return 1;
    if (rightValue === null || rightValue === undefined) return -1;
    const comparison = typeof leftValue === 'string' && typeof rightValue === 'string'
      ? leftValue.localeCompare(rightValue)
      : Number(leftValue) - Number(rightValue);
    return sortDirection === 'asc' ? comparison : -comparison;
  });
}

export function buildSyncStatusCsv(accounts: SyncStatusAccount[]): string {
  const headers = ['Identifier', 'Name', 'Email', 'Sync Status', 'Has AD', 'AD Username', 'Has VPN', 'VPN Username', 'VPN Portal', 'Portal Owner', 'Ownership Readiness', 'Request ID', 'Batch Item ID', 'Batch Run ID', 'Request Status', 'Sync Issues', 'Last Sync'];
  const rows = accounts.map((account) => [
    account.identifier, account.name, account.email || '', account.syncStatus,
    account.hasAdAccount ? 'Yes' : 'No', account.adUsername || 'N/A', account.hasVpnAccount ? 'Yes' : 'No',
    account.vpnUsername || 'N/A', account.vpnPortalType || 'N/A', account.ownership?.ownerType || 'N/A', account.ownership?.readiness || 'unavailable', account.ownership?.requestId || '', account.ownership?.batchItemId || '', account.ownership?.batchRunId || '',
    account.requestStatus || 'N/A', account.syncIssues.join('; ') || 'None',
    account.adSyncDate ? new Date(account.adSyncDate).toLocaleDateString() : 'Never',
  ]);
  return [headers, ...rows].map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
}
