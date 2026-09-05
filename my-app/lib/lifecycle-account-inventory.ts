import type { AccountOwnershipSummary } from './account-ownership';
import { isAccessRequestDirectoryIdentityConsistent } from './access-request-directory-identity';

export type LifecycleBindingPosture = 'verified' | 'conflict' | 'missing' | 'not_applicable';

export type LifecycleDirectoryAccount = {
  username: string;
  dn: string;
  enabled: boolean;
};

export type LifecycleVpnAccount = {
  id: string;
  username: string;
  status: string;
  portalType: string;
  canRestore: boolean;
  accessRequestId: string | null;
  relatedAccountCount: number;
};

export type LifecycleGovernance = {
  ownerType: 'access_request' | 'batch_account' | null;
  ownerId: string | null;
  requestId: string | null;
  batchAccountItemId: string | null;
  status: string | null;
  provisioningState: string | null;
  adAccountStatus?: string | null;
  adDisabledAt?: string | null;
  adDisabledBy?: string | null;
  adDisabledReason?: string | null;
  bindingPosture: LifecycleBindingPosture;
};

export type LifecycleAccountInventoryItem = {
  accountRef: string;
  displayName: string;
  email: string;
  directory: LifecycleDirectoryAccount | null;
  vpn: LifecycleVpnAccount | null;
  governance: LifecycleGovernance;
  batchProvenance?: {
    batchId: string;
    description: string;
    accountTypes: string[];
  } | null;
  ownership?: AccountOwnershipSummary;
};

const READY_PROVISIONING_STATES = new Set<string | null>([
  null,
  'succeeded',
  'completed',
  'activation_email_pending',
  'credentials_email_pending',
]);

export function isInventoryGovernanceReady(
  account: LifecycleAccountInventoryItem,
  intent: 'disable' | 'restore' | 'delete'
): boolean {
  if (account.governance.ownerType === 'batch_account') {
    return account.governance.status === 'completed';
  }
  const allowedStatuses = intent === 'disable' ? ['approved'] : ['approved', 'offboarded'];
  return allowedStatuses.includes(account.governance.status ?? '')
    && READY_PROVISIONING_STATES.has(account.governance.provisioningState);
}

export type LifecycleInventoryDirectoryUser = {
  dn: string;
  objectGuid?: string | null;
  username: string;
  displayName: string;
  email: string;
  accountEnabled: boolean;
};

export type LifecycleInventoryVpnAccount = {
  id: string;
  username: string;
  adUsername?: string | null;
  name: string;
  email: string | null;
  status: string;
  portalType: string;
  canRestore?: boolean;
  accessRequestId?: string | null;
  batchAccountItemId?: string | null;
  batchId?: string | null;
};

export type LifecycleInventoryAccessRequest = {
  id: string;
  name: string;
  email: string;
  status: string;
  provisioningState?: string | null;
  adAccountStatus?: string | null;
  adDisabledAt?: Date | null;
  adDisabledBy?: string | null;
  adDisabledReason?: string | null;
  ldapUsername?: string | null;
  linkedAdUsername?: string | null;
  vpnUsername?: string | null;
  linkedVpnUsername?: string | null;
  createdAt: Date;
};

export type LifecycleInventoryBatchItem = {
  id: string;
  batchId: string;
  batch: { id: string; description: string };
  accessRequestId: string | null;
  lifecycleOwnerKind: string;
  accountType: string;
  ldapUsername: string;
  vpnUsername?: string | null;
  status: string;
  mutationStage?: string | null;
  adAccountStatus?: string | null;
  adDisabledAt?: Date | null;
  adDisabledBy?: string | null;
  adDisabledReason?: string | null;
  targetDirectoryDn?: string | null;
  targetDirectoryObjectGuid?: string | null;
};

function key(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized || null;
}

function requestUsernames(request: LifecycleInventoryAccessRequest): string[] {
  return [request.linkedAdUsername, request.ldapUsername]
    .map(key)
    .filter((value): value is string => Boolean(value));
}

function requestVpnUsernames(request: LifecycleInventoryAccessRequest): string[] {
  return [request.linkedVpnUsername, request.vpnUsername]
    .map(key)
    .filter((value): value is string => Boolean(value));
}

function newestRequest(
  current: LifecycleInventoryAccessRequest | undefined,
  candidate: LifecycleInventoryAccessRequest
): LifecycleInventoryAccessRequest {
  if (!current) return candidate;
  const delta = candidate.createdAt.getTime() - current.createdAt.getTime();
  return delta > 0 || (delta === 0 && candidate.id.localeCompare(current.id) > 0) ? candidate : current;
}

const BATCH_OWNERSHIP_STATUSES = new Set(['processing', 'completed', 'reconciliation_required']);

function isStandaloneBatchOwner(item: LifecycleInventoryBatchItem): boolean {
  return item.lifecycleOwnerKind === 'batch_item'
    && !item.accessRequestId
    && BATCH_OWNERSHIP_STATUSES.has(item.status);
}

function isActiveAdBatchOwner(item: LifecycleInventoryBatchItem): boolean {
  return isStandaloneBatchOwner(item)
    && ['AD', 'BOTH'].includes(item.accountType)
    && item.adAccountStatus !== 'deleted';
}

function isActiveVpnBatchOwner(item: LifecycleInventoryBatchItem): boolean {
  return isStandaloneBatchOwner(item) && ['VPN', 'BOTH'].includes(item.accountType);
}

export function buildLifecycleAccountInventory(input: {
  directoryUsers: LifecycleInventoryDirectoryUser[];
  vpnAccounts: LifecycleInventoryVpnAccount[];
  accessRequests: LifecycleInventoryAccessRequest[];
  batchItems?: LifecycleInventoryBatchItem[];
}): LifecycleAccountInventoryItem[] {
  const batchItems = input.batchItems ?? [];
  const batchByRequestId = new Map<string, LifecycleInventoryBatchItem[]>();
  const batchById = new Map<string, LifecycleInventoryBatchItem>();
  const batchByVpnUsername = new Map<string, LifecycleInventoryBatchItem[]>();
  const batchByAdUsername = new Map<string, LifecycleInventoryBatchItem[]>();
  for (const item of batchItems) {
    batchById.set(item.id, item);
    if (item.accessRequestId) {
      const matches = batchByRequestId.get(item.accessRequestId) ?? [];
      matches.push(item);
      batchByRequestId.set(item.accessRequestId, matches);
    }
    const adUsername = key(item.ldapUsername);
    if (adUsername && ['AD', 'BOTH'].includes(item.accountType)) {
      const matches = batchByAdUsername.get(adUsername) ?? [];
      matches.push(item);
      batchByAdUsername.set(adUsername, matches);
    }
    for (const vpnUsername of new Set([key(item.vpnUsername), key(item.ldapUsername)].filter((name): name is string => Boolean(name)))) {
      const matches = batchByVpnUsername.get(vpnUsername) ?? [];
      matches.push(item);
      batchByVpnUsername.set(vpnUsername, matches);
    }
  }
  const batchProvenance = (items: LifecycleInventoryBatchItem[]): LifecycleAccountInventoryItem['batchProvenance'] => {
    const first = items[0];
    if (!first || items.some((item) => item.batchId !== first.batchId)) return null;
    return { batchId: first.batchId, description: first.batch.description, accountTypes: [...new Set(items.map((item) => item.accountType))] };
  };
  const requestsById = new Map(input.accessRequests.map((request) => [request.id, request]));
  const vpnCountByRequestId = new Map<string, number>();
  for (const vpn of input.vpnAccounts) {
    if (vpn.accessRequestId) {
      vpnCountByRequestId.set(vpn.accessRequestId, (vpnCountByRequestId.get(vpn.accessRequestId) ?? 0) + 1);
    }
  }
  const requestsByAdUsername = new Map<string, LifecycleInventoryAccessRequest[]>();
  const eligibleRequestsByAdUsername = new Map<string, LifecycleInventoryAccessRequest[]>();
  const requestsByVpnUsername = new Map<string, LifecycleInventoryAccessRequest>();
  for (const request of input.accessRequests) {
    for (const username of new Set(requestUsernames(request))) {
      const usernameRequests = requestsByAdUsername.get(username) ?? [];
      usernameRequests.push(request);
      requestsByAdUsername.set(username, usernameRequests);
      if (
        ['approved', 'offboarded'].includes(request.status)
        && READY_PROVISIONING_STATES.has(request.provisioningState ?? null)
      ) {
        const eligible = eligibleRequestsByAdUsername.get(username) ?? [];
        eligible.push(request);
        eligibleRequestsByAdUsername.set(username, eligible);
      }
    }
    for (const username of requestVpnUsernames(request)) {
      requestsByVpnUsername.set(username, newestRequest(requestsByVpnUsername.get(username), request));
    }
  }

  const items = new Map<string, LifecycleAccountInventoryItem>();
  const itemByAdUsername = new Map<string, LifecycleAccountInventoryItem>();

  for (const user of input.directoryUsers) {
    const usernameKey = key(user.username);
    if (!usernameKey) continue;
    const usernameRequests = requestsByAdUsername.get(usernameKey) ?? [];
    const activeOwnershipRequests = usernameRequests.filter((request) => !['rejected', 'offboarded'].includes(request.status));
    const restorableOwnershipRequests = usernameRequests.filter((request) => request.status === 'offboarded');
    const ownershipRequests = activeOwnershipRequests.length > 0
      ? activeOwnershipRequests
      : restorableOwnershipRequests;
    const usernameRequest = ownershipRequests.reduce<LifecycleInventoryAccessRequest | undefined>(newestRequest, undefined) ?? null;
    const eligibleUsernameRequests = (eligibleRequestsByAdUsername.get(usernameKey) ?? [])
      .filter((request) => ownershipRequests.some((owner) => owner.id === request.id));
    const request = ownershipRequests.length === 1 && eligibleUsernameRequests.length === 1
      ? eligibleUsernameRequests[0]
      : usernameRequest;
    const standaloneBatchOwners = (batchByAdUsername.get(usernameKey) ?? []).filter(isActiveAdBatchOwner);
    const batchOwner = standaloneBatchOwners.length === 1 ? standaloneBatchOwners[0] : null;
    const hasVerifiedRequestOwner = ownershipRequests.length === 1 && eligibleUsernameRequests.length === 1
      && isAccessRequestDirectoryIdentityConsistent(eligibleUsernameRequests[0]);
    const hasVerifiedBatchOwner = batchOwner?.status === 'completed'
      && Boolean(user.objectGuid && batchOwner.targetDirectoryObjectGuid === user.objectGuid)
      && Boolean(user.dn && key(batchOwner.targetDirectoryDn) === key(user.dn));
    const bindingPosture: LifecycleBindingPosture = ownershipRequests.length > 0 && standaloneBatchOwners.length > 0
      ? 'conflict'
      : hasVerifiedRequestOwner || (ownershipRequests.length === 0 && hasVerifiedBatchOwner)
        ? 'verified'
        : ownershipRequests.length > 0 || standaloneBatchOwners.length > 0
          ? 'conflict'
          : 'missing';
    const batchGoverned = ownershipRequests.length === 0 && Boolean(batchOwner);
    const provenanceItems = batchGoverned && batchOwner
      ? [batchOwner]
      : request?.id
        ? batchByRequestId.get(request.id) ?? []
        : [];
    const item: LifecycleAccountInventoryItem = {
      accountRef: `ad:${usernameKey}`,
      displayName: user.displayName || user.username,
      email: user.email || '',
      directory: {
        username: user.username,
        dn: user.dn,
        enabled: user.accountEnabled,
      },
      vpn: null,
      governance: {
        ownerType: batchGoverned ? 'batch_account' : request ? 'access_request' : null,
        ownerId: batchGoverned ? batchOwner?.id ?? null : request?.id ?? null,
        requestId: request?.id ?? null,
        batchAccountItemId: batchGoverned ? batchOwner?.id ?? null : null,
        status: batchGoverned ? batchOwner?.status ?? null : request?.status ?? null,
        provisioningState: batchGoverned ? batchOwner?.mutationStage ?? null : request?.provisioningState ?? null,
        adAccountStatus: batchGoverned ? batchOwner?.adAccountStatus ?? null : request?.adAccountStatus ?? null,
        adDisabledAt: batchGoverned ? batchOwner?.adDisabledAt?.toISOString() ?? null : request?.adDisabledAt?.toISOString() ?? null,
        adDisabledBy: batchGoverned ? batchOwner?.adDisabledBy ?? null : request?.adDisabledBy ?? null,
        adDisabledReason: batchGoverned ? batchOwner?.adDisabledReason ?? null : request?.adDisabledReason ?? null,
        bindingPosture,
      },
      batchProvenance: batchProvenance(provenanceItems),
    };
    items.set(item.accountRef, item);
    itemByAdUsername.set(usernameKey, item);
  }

  for (const vpn of input.vpnAccounts) {
    const vpnKey = key(vpn.username);
    if (!vpnKey) continue;
    const request = (vpn.accessRequestId ? requestsById.get(vpn.accessRequestId) : null)
      ?? requestsByVpnUsername.get(vpnKey)
      ?? null;
    const explicitAdUsername = key(vpn.adUsername);
    const requestAdUsernames = request ? requestUsernames(request) : [];
    const requestVpnNames = request ? requestVpnUsernames(request) : [];
    const requestAdUsernameSet = new Set(requestAdUsernames);
    const requestVpnNameSet = new Set(requestVpnNames);
    const linkedAdUsername = explicitAdUsername
      ?? (request ? requestUsernames(request)[0] : null)
      ?? vpnKey;
    const existing = itemByAdUsername.get(linkedAdUsername);
    const vpnBatchCandidates = (batchByVpnUsername.get(vpnKey) ?? []).filter(isActiveVpnBatchOwner);
    const explicitBatchItem = vpn.batchAccountItemId ? batchById.get(vpn.batchAccountItemId) ?? null : null;
    const explicitBatchOwnerValid = Boolean(
      explicitBatchItem
      && isActiveVpnBatchOwner(explicitBatchItem)
      && key(explicitBatchItem.vpnUsername) === vpnKey
      && (!vpn.batchId || explicitBatchItem.batchId === vpn.batchId)
    );
    const explicitLegacyBatchValid = Boolean(
      explicitBatchItem && request && vpn.accessRequestId === request.id
      && explicitBatchItem.accessRequestId === request.id
      && explicitBatchItem.lifecycleOwnerKind === 'access_request_legacy'
      && (!explicitBatchItem.vpnUsername || key(explicitBatchItem.vpnUsername) === vpnKey)
      && (!vpn.batchId || explicitBatchItem.batchId === vpn.batchId)
    );
    const legacyBatchCandidates = !vpn.batchAccountItemId && vpn.batchId
      ? vpnBatchCandidates.filter((item) => item.batchId === vpn.batchId && key(item.vpnUsername) === vpnKey)
      : [];
    const batchOwner = vpn.batchAccountItemId
      ? explicitBatchOwnerValid && explicitBatchItem && vpnBatchCandidates.length === 1 && vpnBatchCandidates[0].id === explicitBatchItem.id
        ? explicitBatchItem
        : null
      : legacyBatchCandidates.length === 1 && vpnBatchCandidates.length === 1
        ? legacyBatchCandidates[0]
        : null;
    const batchOwnershipConflict = Boolean(
      (vpn.batchAccountItemId && !batchOwner && !explicitLegacyBatchValid)
      || (!vpn.batchAccountItemId && vpn.batchId && !request && legacyBatchCandidates.length !== 1)
      || vpnBatchCandidates.length > 1
      || (vpnBatchCandidates.length > 0 && !batchOwner)
    );
    const requestIdMatches = Boolean(request && (!vpn.accessRequestId || vpn.accessRequestId === request.id));
    const requestMatchesVpn = Boolean(request && requestIdMatches && (
      (requestVpnNames.length > 0 && requestVpnNames[0] === vpnKey)
      || (requestVpnNames.length === 0
        && vpn.accessRequestId === request.id
        && vpnCountByRequestId.get(request.id) === 1)
    ));
    const requestMatchesAd = Boolean(request && requestAdUsernameSet.has(linkedAdUsername));
    const requestMatchesDirectoryRow = Boolean(request && existing?.governance.requestId === request.id);
    const canAttachToDirectory = Boolean(
      existing
      && Boolean(vpn.accessRequestId)
      && requestMatchesVpn
      && requestMatchesAd
      && requestMatchesDirectoryRow
    );
    const canAttachBatchToDirectory = Boolean(
      existing
      && batchOwner
      && existing.governance.ownerType === 'batch_account'
      && existing.governance.batchAccountItemId === batchOwner.id
    );
    const linkageConflict = Boolean(
      (vpn.accessRequestId && !requestsById.has(vpn.accessRequestId))
      || (!vpn.accessRequestId && request)
      || Boolean(request && vpnBatchCandidates.length > 0)
      || Boolean(batchOwner && batchOwner.status !== 'completed')
      || batchOwnershipConflict
      || (request && (
        !requestIdMatches
        || !requestMatchesVpn
        || (Boolean(explicitAdUsername) && !requestMatchesAd)
      ))
    );
    const vpnAccount: LifecycleVpnAccount = {
      id: vpn.id,
      username: vpn.username,
      status: vpn.status,
      portalType: vpn.portalType,
      canRestore: vpn.canRestore !== false,
      accessRequestId: vpn.accessRequestId ?? null,
      relatedAccountCount: request
        ? input.vpnAccounts.filter((candidate) => (
            candidate.accessRequestId === request.id
            || requestVpnNameSet.has(key(candidate.username) ?? '')
            || requestAdUsernameSet.has(key(candidate.adUsername) ?? '')
          )).length
        : 1,
    };
    if ((canAttachToDirectory || canAttachBatchToDirectory) && !linkageConflict && existing && !existing.vpn) {
      existing.vpn = vpnAccount;
      if (!existing.email && vpn.email) existing.email = vpn.email;
      if (existing.displayName === existing.directory?.username && vpn.name) existing.displayName = vpn.name;
      if (!existing.governance.requestId && request) {
        existing.governance.requestId = request.id;
        existing.governance.status = request.status;
        existing.governance.provisioningState = request.provisioningState ?? null;
        existing.governance.adAccountStatus = request.adAccountStatus ?? null;
        existing.governance.adDisabledAt = request.adDisabledAt?.toISOString() ?? null;
        existing.governance.adDisabledBy = request.adDisabledBy ?? null;
        existing.governance.adDisabledReason = request.adDisabledReason ?? null;
      }
      const provenanceBatchItem = batchOwner
        ?? (request?.id ? (batchByRequestId.get(request.id) ?? [])[0] ?? null : null);
      if (provenanceBatchItem && existing.batchProvenance && existing.batchProvenance.batchId === provenanceBatchItem.batchId) {
        existing.batchProvenance.accountTypes = [...new Set([...existing.batchProvenance.accountTypes, provenanceBatchItem.accountType])];
      }
      continue;
    }

    const provenanceItems = batchOwner
      ? [batchOwner]
      : request?.id
        ? batchByRequestId.get(request.id) ?? []
        : legacyBatchCandidates.length === 1
          ? legacyBatchCandidates
          : [];

    const item: LifecycleAccountInventoryItem = {
      accountRef: `vpn:${vpnKey}`,
      displayName: vpn.name || vpn.username,
      email: vpn.email || '',
      directory: null,
      vpn: vpnAccount,
      governance: {
        ownerType: request ? 'access_request' : batchOwner ? 'batch_account' : null,
        ownerId: request?.id ?? batchOwner?.id ?? null,
        requestId: request?.id ?? null,
        batchAccountItemId: batchOwner?.id ?? null,
        status: request?.status ?? batchOwner?.status ?? null,
        provisioningState: request?.provisioningState ?? batchOwner?.mutationStage ?? null,
        adAccountStatus: request?.adAccountStatus ?? batchOwner?.adAccountStatus ?? null,
        bindingPosture: linkageConflict ? 'conflict' : 'not_applicable',
      },
      batchProvenance: batchProvenance(provenanceItems),
    };
    items.set(item.accountRef, item);
  }

  return [...items.values()].sort((left, right) => (
    left.displayName.localeCompare(right.displayName)
    || left.accountRef.localeCompare(right.accountRef)
  ));
}
