import { prisma } from './prisma';
import { sendAdminNotification } from './email';
import { appLogger } from './logger';

/**
 * Mark notification as pending in database
 */
export async function markNotificationPending(requestId: string): Promise<void> {
  await prisma.accessRequest.update({
    where: { id: requestId },
    data: {
      provisioningState: 'notification_pending',
    },
  });
  
  appLogger.info('Notification marked as pending', { requestId });
}

/**
 * Manually retry a notification (for admin use)
 */
export async function retryNotification(requestId: string): Promise<boolean> {
  const request = await prisma.accessRequest.findUnique({
    where: { id: requestId },
  });
  
  if (!request) {
    appLogger.error('Request not found for notification retry', { requestId });
    return false;
  }
  
  try {
    await sendAdminNotification(
      request.id,
      request.name,
      request.email,
      request.isInternal,
      request.needsDomainAccount,
      request.eventReason || undefined
    );
    
    // Update status if not already updated
    if (!request.isVerified) {
      await prisma.accessRequest.update({
        where: { id: requestId },
        data: {
          isVerified: true,
          verifiedAt: new Date(),
          status: 'pending_student_directors',
          provisioningState: null, // Clear pending state
        },
      });
    } else {
      // Just clear the pending state
      await prisma.accessRequest.update({
        where: { id: requestId },
        data: {
          provisioningState: null,
        },
      });
    }
    
    appLogger.info('Notification sent successfully on manual retry', { requestId });
    return true;
  } catch (error) {
    appLogger.error('Manual notification retry failed', {
      requestId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return false;
  }
}

