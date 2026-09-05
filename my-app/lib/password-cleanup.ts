import { prisma } from './prisma';
import { appLogger } from './logger';

export async function clearAccessRequestPassword(requestId: string): Promise<boolean> {
  try {
    await prisma.accessRequest.update({
      where: { id: requestId },
      data: { 
        accountPassword: null,
      }
    });
    
    appLogger.info('Cleared password for access request', { requestId });
    return true;
  } catch (error) {
    appLogger.error('Failed to clear password for access request', { 
      requestId, 
      error: error instanceof Error ? error.message : String(error) 
    });
    throw error;
  }
}

export async function clearBatchAccountPassword(batchItemId: string): Promise<boolean> {
  try {
    await prisma.batchAccountItem.update({
      where: { id: batchItemId },
      data: { 
        password: '',
      }
    });
    
    appLogger.info('Cleared password for batch account', { batchItemId });
    return true;
  } catch (error) {
    appLogger.error('Failed to clear password for batch account', { 
      batchItemId, 
      error: error instanceof Error ? error.message : String(error) 
    });
    throw error;
  }
}

export async function cleanupStaleAccessRequestPasswords(daysOld: number = 7): Promise<number> {
  try {
    const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);

    const pendingResult = await prisma.accessRequest.updateMany({
      where: {
        provisioningState: 'credential_cleanup_pending',
        OR: [
          { provisioningCompletedAt: { lt: cutoffDate } },
          {
            provisioningCompletedAt: null,
            provisioningStartedAt: { lt: cutoffDate },
          },
        ],
      },
      data: {
        accountPassword: null,
        provisioningState: 'completed',
        provisioningError: null,
      },
    });

    const terminalResult = await prisma.accessRequest.updateMany({
      where: {
        accountPassword: { not: null },
        provisioningState: { in: ['ldap_failed', 'delivery_failed', 'completed'] },
        OR: [
          {
            provisioningCompletedAt: {
              lt: cutoffDate
            }
          },
          { provisioningCompletedAt: null, provisioningStartedAt: { lt: cutoffDate } }
        ]
      },
      data: { accountPassword: null }
    });
    
    const count = pendingResult.count + terminalResult.count;
    appLogger.info('Cleaned up stale access request passwords', {
      count,
      cleanupPendingCompleted: pendingResult.count,
      terminalCredentialsCleared: terminalResult.count,
      daysOld 
    });

    return count;
  } catch (error) {
    appLogger.error('Failed to cleanup stale access request passwords', { 
      error: error instanceof Error ? error.message : String(error) 
    });
    throw error;
  }
}

export async function cleanupStaleBatchPasswords(daysOld: number = 7): Promise<number> {
  try {
    const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
    
    const result = await prisma.batchAccountItem.updateMany({
      where: {
        password: { not: '' },
        completedAt: {
          lt: cutoffDate
        },
        status: 'completed'
      },
      data: { password: '' }
    });
    
    appLogger.info('Cleaned up stale batch account passwords', { 
      count: result.count,
      daysOld 
    });
    
    return result.count;
  } catch (error) {
    appLogger.error('Failed to cleanup stale batch passwords', { 
      error: error instanceof Error ? error.message : String(error) 
    });
    throw error;
  }
}

export async function runPasswordCleanup(daysOld: number = 7): Promise<{
  accessRequestsCleared: number;
  batchAccountsCleared: number;
  totalCleared: number;
}> {
  appLogger.info('Starting password cleanup task', { daysOld });
  
  let accessRequestsCleared = 0;
  let batchAccountsCleared = 0;

  try {
    accessRequestsCleared = await cleanupStaleAccessRequestPasswords(daysOld);
    batchAccountsCleared = await cleanupStaleBatchPasswords(daysOld);
  } catch (error) {
    await prisma.auditLog.create({
      data: {
        action: 'scheduled_password_cleanup',
        category: 'settings',
        username: 'password-cleanup-scheduler',
        actorType: 'system',
        targetType: 'EncryptedCredentials',
        eventKind: 'security',
        outcome: 'failure',
        success: false,
        errorMessage: error instanceof Error ? error.message : 'Unknown cleanup error',
        details: JSON.stringify({ accessRequestsCleared, batchAccountsCleared, daysOld }),
      },
    });
    throw error;
  }

  const totalCleared = accessRequestsCleared + batchAccountsCleared;

  await prisma.auditLog.create({
    data: {
      action: 'scheduled_password_cleanup',
      category: 'settings',
      username: 'password-cleanup-scheduler',
      actorType: 'system',
      targetType: 'EncryptedCredentials',
      eventKind: 'security',
      outcome: 'success',
      success: true,
      details: JSON.stringify({ accessRequestsCleared, batchAccountsCleared, totalCleared, daysOld }),
    },
  });
  
  appLogger.info('Password cleanup task completed', {
    accessRequestsCleared,
    batchAccountsCleared,
    totalCleared
  });
  
  return {
    accessRequestsCleared,
    batchAccountsCleared,
    totalCleared
  };
}
