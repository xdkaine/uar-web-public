import type { Prisma } from '@prisma/client';
import { prisma } from './prisma';

export const ownershipRequestSelect = {
  id: true, name: true, email: true, status: true, createdAt: true,
  provisioningState: true, adAccountStatus: true,
  adDisabledAt: true, adDisabledBy: true, adDisabledReason: true,
  ldapUsername: true, linkedAdUsername: true, vpnUsername: true, linkedVpnUsername: true,
  isManuallyAssigned: true,
} satisfies Prisma.AccessRequestSelect;

export const ownershipBatchSelect = {
  id: true, batchId: true, batch: { select: { id: true, description: true } },
  accessRequestId: true, lifecycleOwnerKind: true, accountType: true,
  ldapUsername: true, vpnUsername: true, status: true, mutationStage: true,
  adAccountStatus: true, adDisabledAt: true, adDisabledBy: true, adDisabledReason: true,
  targetDirectoryDn: true, targetDirectoryObjectGuid: true,
} satisfies Prisma.BatchAccountItemSelect;

/** No credentials or unrelated request content enter inventory projections. */
export async function loadAccountOwnershipRecords() {
  const [accessRequests, batchItems] = await Promise.all([
    prisma.accessRequest.findMany({ select: ownershipRequestSelect }),
    prisma.batchAccountItem.findMany({
      where: { status: { in: ['processing', 'completed', 'reconciliation_required'] } },
      select: ownershipBatchSelect,
    }),
  ]);
  return { accessRequests, batchItems };
}
