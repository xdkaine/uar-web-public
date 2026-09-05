import type { AccountOwnershipSummary } from './account-ownership';

export type AccountSyncPosture =
  | 'fully_synced'
  | 'partial_sync'
  | 'ad_only'
  | 'vpn_only'
  | 'request_only'
  | 'offboarded'
  | 'orphaned';

export interface SyncPostureInput {
  ownership?: AccountOwnershipSummary;
  hasAdAccount: boolean;
  adAccountEnabled: boolean | null;
  adEmail: string | null;
  adUsername: string | null;
  hasVpnAccount: boolean;
  vpnUsername: string | null;
  vpnPortalType: string | null;
  vpnStatus: string | null;
  hasAccessRequest: boolean;
  requestStatus: string | null;
}

export interface SyncRequestCandidate {
  id: string;
  status: string;
  createdAt: Date | string;
}

/**
 * Username reuse after offboarding is valid. Choose the newest request
 * deterministically and retain older rows as history instead of depending on
 * unspecified database iteration order.
 */
export function isNewerSyncRequest(
  candidate: SyncRequestCandidate,
  current: SyncRequestCandidate | null
): boolean {
  if (!current) return true;
  const timeDifference = new Date(candidate.createdAt).getTime() - new Date(current.createdAt).getTime();
  if (timeDifference !== 0) return timeDifference > 0;
  return candidate.id.localeCompare(current.id) > 0;
}

export function deriveAccountSyncPosture(
  account: SyncPostureInput,
  vpnModuleEnabled: boolean
): { status: AccountSyncPosture; issues: string[] } {
  const ownershipIssues = account.ownership?.readiness === 'needs_review'
    ? ['Portal ownership needs review']
    : account.ownership?.readiness === 'unavailable' ? ['Portal ownership could not be verified'] : [];
  if (account.requestStatus === 'offboarded') {
    const issues: string[] = [...ownershipIssues];
    if (account.hasAdAccount && account.adAccountEnabled === true) {
      issues.push('Offboarded request but AD account is enabled');
    }
    if (vpnModuleEnabled && account.hasVpnAccount && !['disabled', 'revoked'].includes(account.vpnStatus || '')) {
      issues.push(`Offboarded request but VPN status is ${account.vpnStatus || 'unknown'}`);
    }
    return { status: 'offboarded', issues };
  }

  const sourceCount = [account.hasAdAccount, account.hasVpnAccount, account.hasAccessRequest]
    .filter(Boolean).length;
  let status: AccountSyncPosture = 'orphaned';
  if (sourceCount === 3) status = 'fully_synced';
  else if (sourceCount === 2) status = 'partial_sync';
  else if (account.hasAdAccount) status = 'ad_only';
  else if (account.hasVpnAccount) status = 'vpn_only';
  else if (account.hasAccessRequest) status = 'request_only';

  const issues: string[] = [...ownershipIssues];
  if (account.hasAccessRequest && account.requestStatus !== 'rejected') {
    if (!account.hasAdAccount) issues.push('Access request exists but no AD account found');
    if (vpnModuleEnabled && !account.hasVpnAccount) issues.push('Access request exists but no VPN account found');
  }
  if (account.ownership?.ownerType === 'batch_account' && account.ownership.readiness === 'ready') {
    if (account.ownership.expectedSystems?.includes('AD') && !account.hasAdAccount) {
      issues.push('Batch account expects an AD account but none was found');
    }
    if (vpnModuleEnabled && account.ownership.expectedSystems?.includes('VPN') && !account.hasVpnAccount) {
      issues.push('Batch account expects a VPN record but none was found');
    }
  }
  if (account.hasVpnAccount && account.hasAccessRequest && account.vpnPortalType === 'Limited' && !account.hasAdAccount) {
    issues.push('VPN Limited account exists but no AD account found');
  }
  if (account.hasAdAccount && account.hasVpnAccount) {
    const ad = account.adUsername?.toLowerCase() || '';
    const vpn = account.vpnUsername?.toLowerCase() || '';
    if (ad !== vpn && !ad.includes(vpn) && !vpn.includes(ad)) {
      issues.push(`Different usernames: AD="${account.adUsername}", VPN="${account.vpnUsername}"`);
    }
  }
  if (vpnModuleEnabled && account.hasAccessRequest && account.requestStatus === 'approved') {
    if (account.hasVpnAccount && account.vpnStatus !== 'active') {
      issues.push(`Approved request but VPN status is ${account.vpnStatus}`);
    }
    if (account.hasAdAccount && !account.hasVpnAccount
      && !issues.some((issue) => issue.includes('VPN account'))) {
      issues.push('Approved request has AD account but missing VPN access');
    }
  }

  return { status, issues: Array.from(new Set(issues)) };
}
