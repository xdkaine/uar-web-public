import type { Prisma } from '@prisma/client';

export const VPN_OWNERSHIP_LOCK_NAMESPACE = 873212;

/**
 * Serializes ownership decisions for one VPN username. This namespace is kept
 * distinct from the directory fence because a VPN username can differ from its
 * linked AD username.
 */
export async function acquireVpnOwnershipFence(
  tx: Prisma.TransactionClient,
  username: string
): Promise<void> {
  const canonicalUsername = username.trim().toLowerCase();
  if (!canonicalUsername) throw new Error('A VPN username is required for ownership locking');
  await tx.$queryRaw<Array<{ lock_acquired: string }>>`
    SELECT 'locked'::text AS lock_acquired
    FROM pg_advisory_xact_lock(
      hashtextextended(${canonicalUsername}, ${VPN_OWNERSHIP_LOCK_NAMESPACE})
    )
  `;
}
