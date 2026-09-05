import { summarizeAccountOwnership, type AccountOwnershipSummary, type OwnershipLinkAccess } from './account-ownership';
import {
  buildLifecycleAccountInventory, type LifecycleAccountInventoryItem,
  type LifecycleInventoryAccessRequest, type LifecycleInventoryBatchItem,
  type LifecycleInventoryDirectoryUser, type LifecycleInventoryVpnAccount,
} from './lifecycle-account-inventory';
import { deriveAccountSyncPosture } from './sync-status';

type SyncRequest = LifecycleInventoryAccessRequest & { isManuallyAssigned?: boolean };
type SyncVpn = LifecycleInventoryVpnAccount & { createdAt: Date };
const key = (value: string | null | undefined) => value?.trim().toLowerCase() ?? '';

export function projectSyncStatusAccounts(input: {
  directoryUsers: LifecycleInventoryDirectoryUser[];
  vpnAccounts: SyncVpn[];
  accessRequests: SyncRequest[];
  batchItems: LifecycleInventoryBatchItem[];
  vpnModuleEnabled: boolean;
  linkAccess: OwnershipLinkAccess;
}) {
  const inventory = buildLifecycleAccountInventory(input);
  const requestsById = new Map(input.accessRequests.map((request) => [request.id, request]));
  const vpnsById = new Map(input.vpnAccounts.map((vpn) => [vpn.id, vpn]));
  const directoryByUsername = new Map(input.directoryUsers.map((user) => [key(user.username), user]));
  const seenRequests = new Set<string>();

  const project = (item: LifecycleAccountInventoryItem, requestOnly?: SyncRequest) => {
    const user = directoryByUsername.get(key(item.directory?.username));
    const vpn = item.vpn ? vpnsById.get(item.vpn.id) : null;
    const request = requestOnly ?? (item.governance.requestId ? requestsById.get(item.governance.requestId) : null);
    const history = input.accessRequests.filter((candidate) => candidate.id === request?.id
      || Boolean(item.directory && [candidate.ldapUsername, candidate.linkedAdUsername].some((name) => key(name) === key(item.directory?.username)))
      || Boolean(item.vpn && [candidate.vpnUsername, candidate.linkedVpnUsername].some((name) => key(name) === key(item.vpn?.username))));
    for (const candidate of history) seenRequests.add(candidate.id);
    const ownership: AccountOwnershipSummary = summarizeAccountOwnership(item, input.linkAccess);
    const account = {
      accountRef: item.accountRef,
      identifier: item.directory?.username ?? item.vpn?.username ?? request?.email ?? item.accountRef,
      name: item.displayName, email: item.email || null,
      hasAdAccount: Boolean(item.directory), adUsername: item.directory?.username ?? null,
      adDisplayName: user?.displayName ?? null, adEmail: user?.email ?? null,
      adAccountEnabled: item.directory?.enabled ?? null,
      adSyncDate: null as string | null,
      hasVpnAccount: Boolean(vpn), vpnUsername: vpn?.username ?? null,
      vpnPortalType: vpn?.portalType ?? null, vpnStatus: vpn?.status ?? null,
      vpnCreatedAt: vpn?.createdAt.toISOString() ?? null,
      hasAccessRequest: Boolean(request), requestId: request?.id ?? null,
      requestStatus: request?.status ?? null, requestCreatedAt: request?.createdAt.toISOString() ?? null,
      requestHistory: (input.linkAccess.requests ? history : []).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
        .map((candidate) => ({ id: candidate.id, status: candidate.status, createdAt: candidate.createdAt.toISOString() })),
      isManuallyAssigned: request?.isManuallyAssigned ?? false,
      lastSyncId: null as string | null, wasAutoAssigned: false,
      resolutionKind: null, ownership,
    };
    const posture = deriveAccountSyncPosture(account, input.vpnModuleEnabled);
    return { ...account, syncStatus: posture.status, syncIssues: posture.issues };
  };
  const accounts = inventory.map((item) => project(item));
  // A request with no recorded directory/VPN identity remains a request-only row;
  // an email resemblance is not a portal ownership claim.
  for (const request of input.accessRequests) {
    if (seenRequests.has(request.id)) continue;
    accounts.push(project({
      accountRef: `request:${request.id}`, displayName: request.name, email: request.email,
      directory: null, vpn: null,
      governance: {
        ownerType: 'access_request', ownerId: request.id, requestId: request.id,
        batchAccountItemId: null, status: request.status, provisioningState: request.provisioningState ?? null,
        bindingPosture: ['approved', 'offboarded'].includes(request.status) ? 'verified' : 'conflict',
      },
    }, request));
  }
  return accounts.sort((a, b) => a.identifier.localeCompare(b.identifier) || a.accountRef.localeCompare(b.accountRef));
}
