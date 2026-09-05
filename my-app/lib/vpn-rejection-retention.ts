import { prisma } from '@/lib/prisma';

const REJECTION_IN_PROGRESS = 'rejection_in_progress';
const REJECTION_REVOKE_REASON = 'Request rejected before account was activated';

export class VpnRejectionConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VpnRejectionConflictError';
  }
}

export interface RejectedRequestVpnResult {
  username: string;
  status: string;
}

/**
 * Revoke and retain a request-owned VPN account while projecting the exact
 * revoke provenance onto the AccessRequest in the same transaction.
 */
export async function revokeLinkedVpnForRejection(input: {
  requestId: string;
  requestVersion: number;
  actor: string;
}): Promise<RejectedRequestVpnResult | null> {
  const candidate = await prisma.vPNAccount.findFirst({
    where: { accessRequestId: input.requestId },
  });
  if (!candidate) return null;

  return prisma.$transaction(async (tx) => {
    const canonicalUsername = candidate.username.trim().toLowerCase();
    await tx.$queryRaw<Array<{ lock_acquired: string }>>`
      SELECT 'locked'::text AS lock_acquired
      FROM pg_advisory_xact_lock(hashtextextended(${canonicalUsername}, 904771))
    `;
    const lockedRows = await tx.$queryRaw<Array<{ locked_id: string }>>`
      SELECT "id"::text AS locked_id
      FROM "VPNAccount"
      WHERE "id" = ${candidate.id}
      FOR UPDATE
    `;
    if (lockedRows.length !== 1) {
      throw new VpnRejectionConflictError('The linked VPN record changed during rejection. Refresh and try again.');
    }
    const current = await tx.vPNAccount.findUnique({ where: { id: candidate.id } });
    if (!current || current.accessRequestId !== input.requestId) {
      throw new VpnRejectionConflictError('VPN request linkage changed during rejection. Refresh and try again.');
    }
    const latestStatus = await tx.vPNAccountStatusLog.findFirst({
      where: { accountId: current.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    const revokedAt = current.status === 'revoked' && current.revokedAt
      ? current.revokedAt
      : new Date();
    const revokedBy = current.status === 'revoked' && current.revokedBy?.trim()
      ? current.revokedBy
      : input.actor;
    const revokedReason = current.status === 'revoked' && current.revokedReason?.trim()
      ? current.revokedReason
      : REJECTION_REVOKE_REASON;

    if (
      current.status !== 'revoked'
      || !current.revokedAt
      || !current.revokedBy?.trim()
      || !current.revokedReason?.trim()
      || current.canRestore
    ) {
      await tx.vPNAccount.update({
        where: { id: current.id },
        data: {
          status: 'revoked',
          revokedAt,
          revokedBy,
          revokedReason,
          canRestore: false,
        },
      });
    }
    if (current.status !== 'revoked' || latestStatus?.newStatus !== 'revoked') {
      await tx.vPNAccountStatusLog.create({
        data: {
          accountId: current.id,
          liveAccountId: current.id,
          oldStatus: current.status,
          newStatus: 'revoked',
          changedBy: input.actor,
          reason: current.status === 'revoked'
            ? 'Request rejection confirmed revoked state and repaired missing or inconsistent status evidence'
            : REJECTION_REVOKE_REASON,
        },
      });
    }

    const requestProjection = await tx.accessRequest.updateMany({
      where: {
        id: input.requestId,
        version: input.requestVersion,
        status: { notIn: ['approved', 'rejected'] },
        provisioningState: REJECTION_IN_PROGRESS,
      },
      data: {
        vpnAccountStatus: 'revoked',
        vpnRevokedAt: revokedAt,
        vpnRevokedBy: revokedBy,
        vpnRevokedReason: revokedReason,
      },
    });
    if (requestProjection.count !== 1) {
      throw new VpnRejectionConflictError('The request changed while its VPN account was being revoked. Refresh and try again.');
    }

    return { username: current.username, status: current.status };
  }, { maxWait: 30_000, timeout: 60_000 });
}
