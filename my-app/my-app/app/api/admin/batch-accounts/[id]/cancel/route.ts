import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { searchLDAPUser, deleteLDAPUser, disableLDAPUser, setLDAPUserExpiration } from '@/lib/ldap';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { logAuditAction, AuditActions, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';

/**
 * Rollback batch accounts by cleaning up LDAP accounts.
 * This is a copy of the function in the main route.ts for use in cancellation.
 */
async function rollbackBatchAccounts(
  usernames: string[],
  batchId: string
): Promise<{
  successful: string[];
  failed: Array<{ username: string; error: string }>;
}> {
  const successful: string[] = [];
  const failed: Array<{ username: string; error: string }> = [];

  console.log(`[Batch Cancellation] Starting rollback for batch ${batchId}. Accounts to clean: ${usernames.length}`);

  await Promise.all(
    usernames.map(async (username) => {
      try {
        await deleteLDAPUser(username, undefined, false);
        successful.push(username);
        console.log(`[Batch Cancellation] Successfully deleted account: ${username}`);
      } catch (deleteError) {
        console.warn(`[Batch Cancellation] Delete failed for ${username}, attempting disable+expire`, deleteError);
        
        try {
          await disableLDAPUser(username);
          await setLDAPUserExpiration(username, new Date());
          successful.push(username);
          console.log(`[Batch Cancellation] Successfully disabled account: ${username}`);
        } catch (disableError) {
          const errorMsg = disableError instanceof Error ? disableError.message : 'Unknown error';
          failed.push({ username, error: errorMsg });
          console.error(`[Batch Cancellation] Failed to rollback account ${username}:`, disableError);
        }
      }
    })
  );

  console.log(`[Batch Cancellation] Completed for batch ${batchId}. Successful: ${successful.length}, Failed: ${failed.length}`);
  
  return { successful, failed };
}

/**
 * DELETE - Cancel a batch and rollback all successfully created accounts
 * 
 * This endpoint allows admins to cancel in-progress or failed batches and
 * clean up any successfully created LDAP accounts, enabling clean retry.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);

    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const resolvedParams = await params;
    const batchId = resolvedParams.id;

    // Fetch the batch with all accounts
    const batch = await prisma.batchAccountCreation.findUnique({
      where: { id: batchId },
      include: {
        accounts: {
          where: {
            status: 'completed',
            ldapCreatedAt: { not: null },
          },
        },
      },
    });

    if (!batch) {
      return NextResponse.json({ error: 'Batch not found' }, { status: 404 });
    }

    // Only allow cancellation of non-completed batches or failed batches
    if (batch.status === 'completed' && batch.failedAccounts === 0) {
      return NextResponse.json(
        { error: 'Cannot cancel a successfully completed batch. All accounts have been created.' },
        { status: 400 }
      );
    }

    if (batch.status === 'cancelled') {
      return NextResponse.json(
        { error: 'Batch has already been cancelled' },
        { status: 400 }
      );
    }

    // Collect usernames of successfully created accounts to rollback
    const accountsToRollback: string[] = [];
    
    for (const account of batch.accounts) {
      // Check if account actually exists in LDAP before attempting rollback
      try {
        const ldapUser = await searchLDAPUser(account.ldapUsername);
        if (ldapUser) {
          accountsToRollback.push(account.ldapUsername);
        }
      } catch (searchError) {
        console.warn(`[Batch Cancellation] Could not verify existence of ${account.ldapUsername}:`, searchError);
        // Include it anyway - rollback function will handle if it doesn't exist
        accountsToRollback.push(account.ldapUsername);
      }
    }

    console.log(`[Batch Cancellation] Cancelling batch ${batchId}. Found ${accountsToRollback.length} accounts to rollback.`);

    // Update batch status to rolling_back
    await prisma.batchAccountCreation.update({
      where: { id: batchId },
      data: { status: 'rolling_back' },
    });

    // Create audit log for cancellation start
    await prisma.batchAuditLog.create({
      data: {
        batchId: batchId,
        action: 'batch_cancellation_started',
        details: `Batch cancellation initiated by ${admin.username}. Rolling back ${accountsToRollback.length} accounts: ${accountsToRollback.join(', ')}`,
        performedBy: admin.username,
        success: true,
      },
    });

    let rollbackResult: {
      successful: string[];
      failed: Array<{ username: string; error: string }>;
    } = { successful: [], failed: [] };
    
    // Perform rollback if there are accounts to clean up
    if (accountsToRollback.length > 0) {
      rollbackResult = await rollbackBatchAccounts(accountsToRollback, batchId);

      // Log rollback results
      if (rollbackResult.failed.length > 0) {
        console.error(`[Batch Cancellation] Some accounts could not be rolled back:`, rollbackResult.failed);

        await prisma.batchAuditLog.create({
          data: {
            batchId: batchId,
            action: 'batch_cancellation_partial',
            details: `⚠️ Cancellation rollback partially failed. Successfully rolled back: ${rollbackResult.successful.length}. Failed: ${rollbackResult.failed.length}. Manual cleanup required for: ${rollbackResult.failed.map(f => `${f.username} (${f.error})`).join(', ')}`,
            performedBy: admin.username,
            success: false,
          },
        });
      } else {
        console.log(`[Batch Cancellation] All accounts successfully rolled back.`);

        await prisma.batchAuditLog.create({
          data: {
            batchId: batchId,
            action: 'batch_cancellation_completed',
            details: `All ${rollbackResult.successful.length} accounts successfully rolled back. Batch cancelled by ${admin.username}.`,
            performedBy: admin.username,
            success: true,
          },
        });
      }
    } else {
      console.log(`[Batch Cancellation] No accounts to rollback.`);
      
      await prisma.batchAuditLog.create({
        data: {
          batchId: batchId,
          action: 'batch_cancellation_completed',
          details: `Batch cancelled by ${admin.username}. No accounts needed rollback.`,
          performedBy: admin.username,
          success: true,
        },
      });
    }

    // Update batch to cancelled status
    const updatedBatch = await prisma.batchAccountCreation.update({
      where: { id: batchId },
      data: {
        status: 'cancelled',
        completedAt: new Date(),
      },
      include: {
        accounts: true,
        auditLogs: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    // Log batch cancellation
    await logAuditAction({
      action: AuditActions.VIEW_BATCH_DETAILS,
      category: AuditCategories.BATCH,
      username: admin.username,
      targetId: batchId,
      targetType: 'Batch',
      details: { 
        action: 'cancel',
        accountsRolledBack: rollbackResult.successful.length,
        accountsFailedRollback: rollbackResult.failed.length
      },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    return NextResponse.json({
      success: true,
      message: 'Batch cancelled successfully',
      batch: updatedBatch,
      rollback: {
        total: accountsToRollback.length,
        successful: rollbackResult.successful.length,
        failed: rollbackResult.failed.length,
        failedAccounts: rollbackResult.failed,
      },
    });
  } catch (error) {
    console.error('Error cancelling batch:', error);
    
    // Log the failure
    const resolvedParams = await params;
    const { admin } = await checkAdminAuthWithRateLimit(request);
    if (admin) {
      await logAuditAction({
        action: AuditActions.VIEW_BATCH_DETAILS,
        category: AuditCategories.BATCH,
        username: admin.username,
        targetId: resolvedParams.id,
        targetType: 'Batch',
        success: false,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        details: { action: 'cancel' },
        ipAddress: getIpAddress(request),
        userAgent: getUserAgent(request),
      });
    }
    
    return NextResponse.json(
      { error: 'Failed to cancel batch' },
      { status: 500 }
    );
  }
}
