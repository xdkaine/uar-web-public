import { prisma } from '@/lib/prisma';

interface BatchVpnProvisioningInput {
  username: string;
  name: string;
  email: string | null;
  portalType: string;
  isInternal: boolean;
  expiresAt: Date;
  encryptedPassword: string;
  createdBy: string;
  batchId: string;
  batchAccountItemId: string;
}

export async function createBatchVpnAccountRecord(input: BatchVpnProvisioningInput) {
  return prisma.$transaction(async tx => {
    const vpnAccount = await tx.vPNAccount.create({
      data: {
        username: input.username,
        name: input.name,
        email: input.email,
        portalType: input.portalType,
        isInternal: input.isInternal,
        status: 'active',
        expiresAt: input.expiresAt,
        password: input.encryptedPassword,
        createdBy: input.createdBy,
        createdByFaculty: false,
        batchId: input.batchId,
        batchAccountItemId: input.batchAccountItemId,
      },
    });
    await tx.vPNAccountStatusLog.create({
      data: {
        accountId: vpnAccount.id,
        liveAccountId: vpnAccount.id,
        oldStatus: null,
        newStatus: 'active',
        changedBy: input.createdBy,
        reason: 'Created via batch account creation',
      },
    });
    return vpnAccount;
  });
}
