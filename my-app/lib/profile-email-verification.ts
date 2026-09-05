import { createHash, randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';

export const PROFILE_EMAIL_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
export const PROFILE_EMAIL_CLAIM_TTL_MS = 5 * 60 * 1000;

export function hashProfileEmailToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createIssuingProfileEmailToken(input: {
  accessRequestId: string;
  rawToken: string;
  desiredEmail: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  return prisma.profileEmailVerificationToken.create({
    data: {
      accessRequestId: input.accessRequestId,
      tokenHash: hashProfileEmailToken(input.rawToken),
      desiredEmail: input.desiredEmail,
      expiresAt: new Date(now.getTime() + PROFILE_EMAIL_TOKEN_TTL_MS),
      status: 'issuing',
    },
  });
}

/**
 * Make a delivered token usable and revoke older links only after SMTP returns.
 * This preserves a previously delivered link when a replacement cannot be sent.
 */
export async function activateDeliveredProfileEmailToken(input: {
  tokenId: string;
  accessRequestId: string;
  desiredEmail: string;
  expectedRequestVersion: number;
}) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw<Array<{ lock_acquired: string }>>`
      SELECT 'locked'::text AS lock_acquired
      FROM pg_advisory_xact_lock(hashtextextended(${input.accessRequestId}, 0))
    `;
    const activeConfirmation = await tx.profileEmailVerificationToken.findFirst({
      where: {
        accessRequestId: input.accessRequestId,
        id: { not: input.tokenId },
        OR: [
          { status: { in: ['directory_applied', 'reconciliation_required'] } },
          { status: 'claimed', claimedUntil: { gt: new Date() } },
        ],
      },
      select: { id: true },
    });
    if (activeConfirmation) {
      throw new Error('A profile email confirmation is already being finalized');
    }
    await tx.profileEmailVerificationToken.updateMany({
      where: {
        accessRequestId: input.accessRequestId,
        id: { not: input.tokenId },
        status: { in: ['issuing', 'pending'] },
      },
      data: {
        status: 'revoked',
        claimId: null,
        claimedUntil: null,
        lastError: 'Superseded by a newer delivered verification link',
      },
    });

    // Activate after superseding older delivered-but-unused links. The
    // partial unique index on desiredEmail makes this a database-backed email
    // reservation across requests; a conflict rolls this transaction back and
    // preserves the previous link.
    const activated = await tx.profileEmailVerificationToken.updateMany({
      where: {
        id: input.tokenId,
        accessRequestId: input.accessRequestId,
        desiredEmail: input.desiredEmail,
        status: 'issuing',
      },
      data: { status: 'pending', lastError: null },
    });
    if (activated.count !== 1) {
      throw new Error('Profile email token delivery state changed before activation');
    }

    const requestUpdated = await tx.accessRequest.updateMany({
      where: { id: input.accessRequestId, version: input.expectedRequestVersion, isVerified: false },
      data: {
        email: input.desiredEmail,
        verificationAttempts: 0,
        verificationToken: null,
        verificationTokenExpiresAt: null,
        status: 'pending_verification',
        provisioningState: null,
        provisioningError: null,
        version: { increment: 1 },
      },
    });
    if (requestUpdated.count !== 1) {
      throw new Error('Profile request changed before token activation');
    }
  });
}

export async function markProfileEmailDeliveryFailed(tokenId: string, error: string): Promise<void> {
  await prisma.profileEmailVerificationToken.updateMany({
    where: { id: tokenId, status: 'issuing' },
    data: { status: 'delivery_failed', lastError: error.slice(0, 500) },
  });
}

export interface ClaimedProfileEmailToken {
  tokenId: string;
  claimId: string;
  desiredEmail: string;
  accessRequest: {
    id: string;
    version: number;
    name: string;
    email: string;
    ldapUsername: string | null;
    vpnUsername: string | null;
    isVerified: boolean;
    isGrandfatheredAccount: boolean;
    status: string;
  };
}

export async function claimProfileEmailToken(input: {
  rawToken: string;
  sessionUsername: string;
  now?: Date;
}): Promise<{ ok: true; claim: ClaimedProfileEmailToken } | { ok: false; reason: string }> {
  const now = input.now ?? new Date();
  const tokenHash = hashProfileEmailToken(input.rawToken);
  const candidate = await prisma.profileEmailVerificationToken.findUnique({
    where: { tokenHash },
    select: { accessRequestId: true },
  });
  if (!candidate) return { ok: false, reason: 'invalid' };

  return prisma.$transaction(async (tx) => {
  await tx.$queryRaw<Array<{ lock_acquired: string }>>`
    SELECT 'locked'::text AS lock_acquired
    FROM pg_advisory_xact_lock(hashtextextended(${candidate.accessRequestId}, 0))
  `;
  const token = await tx.profileEmailVerificationToken.findUnique({
    where: { tokenHash },
    include: {
      accessRequest: {
        select: {
          id: true,
          version: true,
          name: true,
          email: true,
          ldapUsername: true,
          vpnUsername: true,
          isVerified: true,
          isGrandfatheredAccount: true,
          status: true,
        },
      },
    },
  });

  if (!token) return { ok: false, reason: 'invalid' };
  if (token.expiresAt <= now) return { ok: false, reason: 'expired' };
  if (token.accessRequest.isVerified || token.status === 'completed') {
    return { ok: false, reason: 'already_verified' };
  }
  if (!token.accessRequest.isGrandfatheredAccount || !token.accessRequest.ldapUsername) {
    return { ok: false, reason: 'invalid_state' };
  }
  if (token.accessRequest.ldapUsername.toLowerCase() !== input.sessionUsername.toLowerCase()) {
    return { ok: false, reason: 'unauthorized' };
  }
  if (token.status === 'revoked' || token.status === 'delivery_failed' || token.status === 'issuing') {
    return { ok: false, reason: 'invalid' };
  }
  if (token.status === 'reconciliation_required') {
    return { ok: false, reason: 'reconciliation_required' };
  }

  const claimId = randomUUID();
  const claimedUntil = new Date(now.getTime() + PROFILE_EMAIL_CLAIM_TTL_MS);
  const claimed = await tx.profileEmailVerificationToken.updateMany({
    where: {
      id: token.id,
      expiresAt: { gt: now },
      OR: [
        { status: { in: ['pending', 'directory_applied'] } },
        { status: 'claimed', claimedUntil: { lt: now } },
      ],
    },
    data: {
      status: 'claimed',
      claimId,
      claimedUntil,
      attempts: { increment: 1 },
      lastError: null,
    },
  });
  if (claimed.count !== 1) return { ok: false, reason: 'in_progress' };

  return {
    ok: true,
    claim: {
      tokenId: token.id,
      claimId,
      desiredEmail: token.desiredEmail,
      accessRequest: token.accessRequest,
    },
  };
  });
}

export async function releaseProfileEmailClaim(input: {
  tokenId: string;
  claimId: string;
  error: string;
}): Promise<void> {
  await prisma.profileEmailVerificationToken.updateMany({
    where: { id: input.tokenId, claimId: input.claimId, status: 'claimed' },
    data: {
      status: 'pending',
      claimId: null,
      claimedUntil: null,
      lastError: input.error.slice(0, 500),
    },
  });
}

export async function markProfileEmailDirectoryApplied(input: {
  tokenId: string;
  claimId: string;
  observedMail: string | null;
  observedDescription: string | null;
}): Promise<boolean> {
  const result = await prisma.profileEmailVerificationToken.updateMany({
    where: { id: input.tokenId, claimId: input.claimId, status: 'claimed' },
    data: {
      status: 'directory_applied',
      observedMail: input.observedMail,
      observedDescription: input.observedDescription,
      lastError: null,
    },
  });
  return result.count === 1;
}

export async function markProfileEmailReconciliationRequired(input: {
  tokenId: string;
  claimId: string;
  error: string;
  observedMail?: string | null;
  observedDescription?: string | null;
}): Promise<void> {
  await prisma.profileEmailVerificationToken.updateMany({
    where: { id: input.tokenId, claimId: input.claimId },
    data: {
      status: 'reconciliation_required',
      claimId: null,
      claimedUntil: null,
      lastError: input.error.slice(0, 500),
      observedMail: input.observedMail,
      observedDescription: input.observedDescription,
    },
  });
}

export async function completeProfileEmailVerification(input: {
  tokenId: string;
  claimId: string;
  accessRequestId: string;
  expectedRequestVersion: number;
  desiredEmail: string;
  vpnUsername: string;
  displayName: string;
  ldapUsername: string;
}): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const requestUpdate = await tx.accessRequest.updateMany({
      where: {
        id: input.accessRequestId,
        version: input.expectedRequestVersion,
        email: input.desiredEmail,
        isVerified: false,
        isGrandfatheredAccount: true,
        ldapUsername: input.ldapUsername,
      },
      data: {
        isVerified: true,
        verifiedAt: new Date(),
        verificationAttempts: { increment: 1 },
        verificationToken: null,
        verificationTokenExpiresAt: null,
        status: 'approved',
        approvedAt: new Date(),
        approvedBy: 'system_grandfathered',
        version: { increment: 1 },
      },
    });
    if (requestUpdate.count !== 1) return false;

    const existingVpn = await tx.vPNAccount.findUnique({ where: { username: input.vpnUsername } });
    if (!existingVpn) {
      const vpn = await tx.vPNAccount.create({
        data: {
          username: input.vpnUsername,
          name: input.displayName,
          email: input.desiredEmail,
          portalType: 'Limited',
          isInternal: true,
          status: 'active',
          password: '',
          createdBy: 'system_grandfathered',
          createdByFaculty: true,
          facultyCreatedAt: new Date(),
          accessRequestId: input.accessRequestId,
          adUsername: input.ldapUsername,
        },
      });
      await tx.vPNAccountStatusLog.create({
        data: {
          accountId: vpn.id,
          liveAccountId: vpn.id,
          oldStatus: null,
          newStatus: 'active',
          changedBy: 'system_grandfathered',
          reason: 'Grandfathered account email verified via profile',
        },
      });
    }

    const completed = await tx.profileEmailVerificationToken.updateMany({
      where: {
        id: input.tokenId,
        claimId: input.claimId,
        status: 'directory_applied',
      },
      data: {
        status: 'completed',
        usedAt: new Date(),
        claimId: null,
        claimedUntil: null,
        lastError: null,
      },
    });
    if (completed.count !== 1) throw new Error('Profile email claim changed before completion');

    await tx.profileEmailVerificationToken.updateMany({
      where: {
        accessRequestId: input.accessRequestId,
        id: { not: input.tokenId },
        status: { notIn: ['completed', 'revoked'] },
      },
      data: { status: 'revoked', claimId: null, claimedUntil: null },
    });
    return true;
  });
}
