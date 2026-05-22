import { prisma } from './prisma';
import { appLogger } from './logger';

export async function cleanupExpiredSessions(): Promise<{
  expiredCount: number;
  revokedCount: number;
  totalCleaned: number;
}> {
  const now = new Date();
  
  try {
    const expiredResult = await prisma.session.deleteMany({
      where: {
        expiresAt: { lte: now }
      }
    });
    
    const revokedResult = await prisma.session.deleteMany({
      where: {
        revokedAt: { not: null }
      }
    });
    
    const totalCleaned = expiredResult.count + revokedResult.count;
    
    appLogger.info('Session cleanup completed', {
      expired: expiredResult.count,
      revoked: revokedResult.count,
      total: totalCleaned
    });
    
    return {
      expiredCount: expiredResult.count,
      revokedCount: revokedResult.count,
      totalCleaned
    };
  } catch (error) {
    appLogger.error('Session cleanup failed', {
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

export async function cleanupOldResetTokens(daysOld: number = 7): Promise<number> {
  const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
  
  try {
    const result = await prisma.passwordResetToken.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: new Date() } },
          { 
            used: true,
            usedAt: { lt: cutoffDate }
          }
        ]
      }
    });
    
    appLogger.info('Password reset token cleanup completed', {
      count: result.count,
      daysOld
    });
    
    return result.count;
  } catch (error) {
    appLogger.error('Password reset token cleanup failed', {
      error: error instanceof Error ? error.message : String(error)
    });
    return 0;
  }
}

export async function runAllCleanupTasks(): Promise<{
  sessions: { expiredCount: number; revokedCount: number; totalCleaned: number };
  resetTokens: number;
}> {
  appLogger.info('Starting all cleanup tasks');
  
  const sessions = await cleanupExpiredSessions();
  const resetTokens = await cleanupOldResetTokens();
  
  appLogger.info('All cleanup tasks completed', {
    sessionsCleaned: sessions.totalCleaned,
    resetTokensCleaned: resetTokens
  });
  
  return {
    sessions,
    resetTokens
  };
}
