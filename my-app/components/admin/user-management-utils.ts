import type { DirectoryFetchState } from '@/app/api/admin/users/directory-fetch-state';
import type { AccountOwnershipSummary } from '@/lib/account-ownership';

export interface LDAPUser {
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
  /** Omitted by legacy responses; do not infer ownership from directory attributes. */
  ownership?: AccountOwnershipSummary | null;
}

export interface DirectoryUsersResponse {
  users: LDAPUser[];
  directory: DirectoryFetchState;
}

export class DirectoryFetchError extends Error {
  constructor(readonly directory: DirectoryFetchState) {
    super('Directory users could not be loaded');
    this.name = 'DirectoryFetchError';
  }
}

export function isDirectoryFetchState(value: unknown): value is DirectoryFetchState {
  if (!value || typeof value !== 'object' || !('state' in value)) return false;

  const candidate = value as Record<string, unknown>;
  const state = candidate.state;
  return state === 'success'
    || (state === 'result_cap_reached' && typeof candidate.resultCap === 'number')
    || state === 'size_limit_error'
    || state === 'query_error';
}

export function isDirectoryUser(user: LDAPUser): boolean {
  return Boolean(user.dn?.trim());
}

export function isExpired(accountExpires: string | null): boolean {
  return Boolean(accountExpires && new Date(accountExpires) < new Date());
}

export function isExpiringSoon(accountExpires: string | null): boolean {
  if (!accountExpires) return false;
  const expiryDate = new Date(accountExpires);
  const now = new Date();
  const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  return expiryDate > now && expiryDate <= thirtyDaysFromNow;
}

export function formatVerificationSource(source: string | null | undefined): string {
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

export function directoryUserMatchesSearch(user: LDAPUser, query: string): boolean {
  const searchLower = query.trim().toLowerCase();
  if (!searchLower) return true;
  return [
    user.username,
    user.displayName,
    user.email,
    user.description,
    user.ownership?.requestId,
    user.ownership?.batchItemId,
    user.ownership?.batchRunId,
  ].some((value) => value?.toLowerCase().includes(searchLower));
}

export function buildDirectoryUsersCsv(users: LDAPUser[]): string {
  const headers = ['Username', 'Display Name', 'Email', 'Description', 'Status', 'Expires', 'Created', 'Last Verified', 'Last Verified Source', 'Portal Owner', 'Ownership Readiness', 'Request ID', 'Batch Item ID', 'Batch Run ID', 'Groups', 'OU'];
  const csvData = users.map((user) => {
    const ou = (user.dn || '').split(',').find((part) => part.trim().toUpperCase().startsWith('OU='))?.split('=')[1] || '';
    return [
      user.username || '', user.displayName || '', user.email || '', user.description || '',
      user.accountEnabled ? 'Enabled' : 'Disabled',
      user.accountExpires ? new Date(user.accountExpires).toLocaleDateString() : 'Never',
      user.whenCreated ? new Date(user.whenCreated).toLocaleDateString() : '',
      user.lastVerifiedAt ? new Date(user.lastVerifiedAt).toLocaleDateString() : 'N/A',
      formatVerificationSource(user.lastVerifiedSource),
      user.ownership?.ownerType || '', user.ownership?.readiness || 'unavailable',
      user.ownership?.requestId || '', user.ownership?.batchItemId || '', user.ownership?.batchRunId || '',
      (user.memberOf || []).length.toString(), ou,
    ];
  });
  return [headers, ...csvData].map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\n');
}
