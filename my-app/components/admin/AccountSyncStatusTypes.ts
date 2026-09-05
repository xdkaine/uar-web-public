import type { AccountOwnershipSummary } from '@/lib/account-ownership';

export interface SyncStatusAccount {
  /** Stable inventory identity. Older responses use identifier as the fallback. */
  accountRef?: string;
  identifier: string;
  name: string;
  email: string | null;
  hasAdAccount: boolean;
  adUsername: string | null;
  adDisplayName: string | null;
  adEmail: string | null;
  adAccountEnabled?: boolean | null;
  adSyncDate: string | null;
  hasVpnAccount: boolean;
  vpnUsername: string | null;
  vpnPortalType: string | null;
  vpnStatus: string | null;
  vpnCreatedAt: string | null;
  hasAccessRequest: boolean;
  requestId: string | null;
  requestStatus: string | null;
  requestCreatedAt: string | null;
  isManuallyAssigned: boolean;
  syncStatus: 'fully_synced' | 'partial_sync' | 'ad_only' | 'vpn_only' | 'request_only' | 'offboarded' | 'orphaned';
  syncIssues: string[];
  lastSyncId: string | null;
  wasAutoAssigned: boolean;
  /** Absent on an older endpoint response; UI must present this as unavailable. */
  ownership?: AccountOwnershipSummary | null;
}

export interface LatestSyncInfo {
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

export interface SyncStatusTabProps {
  accounts?: SyncStatusAccount[];
  isLoading?: boolean;
  latestSync?: LatestSyncInfo | null;
}

export type SyncFilter = 'all' | 'fully_synced' | 'partial_sync' | 'ad_only' | 'vpn_only' | 'request_only' | 'offboarded' | 'orphaned' | 'issues';
export type DataSourceFilter = 'all' | 'has_ad' | 'has_vpn' | 'has_request' | 'missing_ad' | 'missing_vpn' | 'missing_request';
export type OwnershipFilter = 'all' | 'request_owner' | 'batch_owner' | 'no_owner' | 'needs_review' | 'ownership_unavailable';
export type SyncSortField = 'identifier' | 'name' | 'syncStatus' | 'adSyncDate';
export type SortDirection = 'asc' | 'desc';

export interface SyncStatusStats {
  total: number;
  fullySynced: number;
  partialSync: number;
  adOnly: number;
  vpnOnly: number;
  requestOnly: number;
  offboarded: number;
  orphaned: number;
  withIssues: number;
  hasAd: number;
  hasVpn: number;
  hasRequest: number;
  autoAssigned: number;
}
