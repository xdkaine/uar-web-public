import { prisma } from './prisma';
import { appLogger } from './logger';

export type CredentialFinalizationState =
  | 'completed'
  | 'credential_cleanup_pending'
  | 'reconciliation_required';

export async function finalizeDeliveredCredential(
  requestId: string,
  expectedCiphertext: string,
  expectedProvisioningState: string
): Promise<CredentialFinalizationState> {
  try {
    const cleared = await prisma.accessRequest.updateMany({
      where: {
        id: requestId,
        accountPassword: expectedCiphertext,
        provisioningState: expectedProvisioningState,
      },
      data: {
        accountPassword: null,
        provisioningState: 'completed',
        provisioningCompletedAt: new Date(),
        provisioningError: null,
      },
    });
    if (cleared.count === 1) {
      return 'completed';
    }
  } catch (error) {
    appLogger.error('Credential clear returned an ambiguous result', {
      requestId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }

  try {
    const current = await prisma.accessRequest.findUnique({
      where: { id: requestId },
      select: { accountPassword: true, provisioningState: true },
    });

    if (!current) {
      return 'reconciliation_required';
    }

    if (current.accountPassword === null && current.provisioningState === 'completed') {
      const completed = await prisma.accessRequest.updateMany({
        where: {
          id: requestId,
          accountPassword: null,
          provisioningState: 'completed',
        },
        data: {
          provisioningState: 'completed',
          provisioningCompletedAt: new Date(),
          provisioningError: null,
        },
      });
      return completed.count === 1 ? 'completed' : 'reconciliation_required';
    }

    if (
      current.accountPassword !== expectedCiphertext ||
      current.provisioningState !== expectedProvisioningState
    ) {
      return 'reconciliation_required';
    }

    const pending = await prisma.accessRequest.updateMany({
      where: {
        id: requestId,
        accountPassword: expectedCiphertext,
        provisioningState: expectedProvisioningState,
      },
      data: {
        provisioningState: 'credential_cleanup_pending',
        provisioningCompletedAt: new Date(),
        provisioningError: 'Credential delivery succeeded; encrypted credential cleanup is pending',
      },
    });
    return pending.count === 1
      ? 'credential_cleanup_pending'
      : 'reconciliation_required';
  } catch (error) {
    appLogger.error('Credential finalization reconciliation failed', {
      requestId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return 'reconciliation_required';
  }
}
