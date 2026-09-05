import type { Prisma } from '@prisma/client';

export const DIRECTORY_OWNERSHIP_LOCK_NAMESPACE = 873211;

type DirectoryUser = {
  objectName: string;
  attributes: Array<{ type: string; values: string[] }>;
};

export type DirectoryObjectIdentity = {
  dn: string;
  objectGuid: string;
};

export type BatchDirectoryAccountType = 'AD' | 'VPN';

export type BatchDirectoryOwnershipClaim = {
  id: string;
  batchId: string;
  accountType: string;
  status: string;
};

export async function acquireDirectoryOwnershipFence(
  tx: Prisma.TransactionClient,
  username: string
): Promise<void> {
  const canonicalUsername = username.trim().toLowerCase();
  if (!canonicalUsername) throw new Error('A directory username is required for ownership locking');
  await tx.$queryRaw<Array<{ lock_acquired: string }>>`
    SELECT 'locked'::text AS lock_acquired
    FROM pg_advisory_xact_lock(
      hashtextextended(${canonicalUsername}, ${DIRECTORY_OWNERSHIP_LOCK_NAMESPACE})
    )
  `;
}

/**
 * Returns live batch-owned claims for a directory username. Callers must hold
 * the matching directory ownership fence before using this to make an
 * ownership decision.
 */
export async function findBatchDirectoryOwnershipClaims(
  tx: Prisma.TransactionClient,
  username: string,
  accountType: BatchDirectoryAccountType
): Promise<BatchDirectoryOwnershipClaim[]> {
  const canonicalUsername = username.trim().toLowerCase();
  if (!canonicalUsername) return [];

  return tx.batchAccountItem.findMany({
    where: {
      accountType: { in: accountType === 'AD' ? ['AD', 'BOTH'] : ['VPN', 'BOTH'] },
      lifecycleOwnerKind: 'batch_item',
      accessRequestId: null,
      status: { in: ['processing', 'completed', 'reconciliation_required'] },
      ...(accountType === 'AD'
        ? {
            ldapUsername: { equals: canonicalUsername, mode: 'insensitive' as const },
            OR: [{ adAccountStatus: null }, { adAccountStatus: { not: 'deleted' } }],
          }
        : {
            OR: [
              { ldapUsername: { equals: canonicalUsername, mode: 'insensitive' as const } },
              { vpnUsername: { equals: canonicalUsername, mode: 'insensitive' as const } },
            ],
          }),
    },
    select: { id: true, batchId: true, accountType: true, status: true },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 2,
  });
}

export function directoryObjectIdentity(user: DirectoryUser | null): DirectoryObjectIdentity | null {
  if (!user?.objectName) return null;
  const objectGuid = user.attributes.find(
    (attribute) => attribute.type.toLowerCase() === 'objectguid'
  )?.values[0]?.trim();
  if (!objectGuid) return null;
  return { dn: user.objectName, objectGuid };
}

export function directoryObjectIdentityMatches(
  expected: DirectoryObjectIdentity,
  current: DirectoryUser | null
): boolean {
  const actual = directoryObjectIdentity(current);
  return Boolean(
    actual
    && actual.dn.toLowerCase() === expected.dn.toLowerCase()
    && actual.objectGuid === expected.objectGuid
  );
}
