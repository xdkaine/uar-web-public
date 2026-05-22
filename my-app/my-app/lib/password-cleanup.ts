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
    return false;
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
    return false;
  }
}

export async function cleanupStaleAccessRequestPasswords(daysOld: number = 7): Promise<number> {
  try {
    const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
    
    const result = await prisma.accessRequest.updateMany({
      where: {
        accountPassword: { not: null },
        provisioningCompletedAt: {
          lt: cutoffDate
        }
      },
      data: { accountPassword: null }
    });
    
    appLogger.info('Cleaned up stale access request passwords', { 
      count: result.count,
      daysOld 
    });
    
    return result.count;
  } catch (error) {
    appLogger.error('Failed to cleanup stale access request passwords', { 
      error: error instanceof Error ? error.message : String(error) 
    });
    return 0;
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
    return 0;
  }
}

export async function runPasswordCleanup(daysOld: number = 7): Promise<{
  accessRequestsCleared: number;
  batchAccountsCleared: number;
  totalCleared: number;
}> {
  appLogger.info('Starting password cleanup task', { daysOld });
  
  const accessRequestsCleared = await cleanupStaleAccessRequestPasswords(daysOld);
  const batchAccountsCleared = await cleanupStaleBatchPasswords(daysOld);
  const totalCleared = accessRequestsCleared + batchAccountsCleared;
  
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
