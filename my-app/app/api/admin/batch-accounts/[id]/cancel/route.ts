import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { rollbackBatchAccounts } from '@/lib/batch-account-rollback';
import { rollbackBatchVpnAccounts } from '@/lib/batch-vpn-rollback';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { actorHasPermission } from '@/lib/rbac/core';
import { logAuditAction, AuditActions, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';

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
  let claimedBatchId: string | null = null;
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);

    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!actorHasPermission(admin, 'batch.manage')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const resolvedParams = await params;
    const batchId = resolvedParams.id;

    // Fetch the batch with all accounts
    const batch = await prisma.batchAccountCreation.findUnique({
      where: { id: batchId },
      include: {
        accounts: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!batch) {
      return NextResponse.json({ error: 'Batch not found' }, { status: 404 });
    }

    const staleProcessing = batch.status === 'processing'
      && (!batch.processingClaimedUntil || batch.processingClaimedUntil.getTime() <= Date.now());
    const hasAmbiguousExternalMutation = batch.accounts.some(account =>
      account.mutationStage?.endsWith('_started')
    );

    if ((batch.status === 'processing' && !staleProcessing) || batch.status === 'rolling_back') {
      return NextResponse.json(
        { error: 'Wait for active processing to stop before cancelling this batch' },
        { status: 409 }
      );
    }

    if (hasAmbiguousExternalMutation) {
      if (staleProcessing) {
        await prisma.batchAccountCreation.updateMany({
          where: {
            id: batchId,
            status: 'processing',
            OR: [
              { processingClaimedUntil: null },
              { processingClaimedUntil: { lte: new Date() } },
            ],
          },
          data: {
            status: 'reconciliation_required',
            processingClaimId: null,
            processingClaimedUntil: null,
            completedAt: new Date(),
          },
        });
      }
      return NextResponse.json(
        {
          error: 'An external account mutation may still be completing. The batch requires reconciliation before rollback.',
          code: 'BATCH_EXTERNAL_MUTATION_RECONCILIATION_REQUIRED',
        },
        { status: 409 }
      );
    }

    if (batch.totalAccounts > 0 && batch.accounts.length === 0 && !staleProcessing) {
      return NextResponse.json(
        { error: 'Legacy batch has no durable account items and requires manual reconciliation' },
        { status: 409 }
      );
    }

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

    const accountsToRollback = batch.accounts
      .filter(account => account.accountType === 'AD')
      .map(account => {
        // Rows created before immutable request/directory tracking were added
        // retain their narrowly constrained legacy rollback behavior. A new row
        // with any tracking field present must fail closed if evidence is missing.
        if (
          !account.accessRequestId
          && !account.targetDirectoryDn
          && !account.targetDirectoryObjectGuid
        ) {
          return account.ldapUsername;
        }
        return {
          username: account.ldapUsername,
          accessRequestId: account.accessRequestId,
          targetDirectoryDn: account.targetDirectoryDn,
          targetDirectoryObjectGuid: account.targetDirectoryObjectGuid,
        };
      });
    const vpnAccountsToRollback = batch.accounts
      .filter(account => account.accountType === 'VPN')
      .map(account => account.vpnUsername || account.ldapUsername);

    console.log(`[Batch Cancellation] Cancelling batch ${batchId}. Found ${accountsToRollback.length} AD and ${vpnAccountsToRollback.length} VPN accounts to rollback.`);

    // Atomically claim the cancellation so concurrent requests cannot repeat mutations.
    const claim = await prisma.batchAccountCreation.updateMany({
      where: {
        id: batchId,
        OR: [
          { status: { in: ['failed', 'partial', 'reconciliation_required'] } },
          {
            status: 'processing',
            OR: [
              { processingClaimedUntil: null },
              { processingClaimedUntil: { lte: new Date() } },
            ],
          },
        ],
      },
      data: {
        status: 'rolling_back',
        processingClaimId: null,
        processingClaimedUntil: null,
      },
    });

    if (claim.count !== 1) {
      return NextResponse.json(
        { error: 'Batch cancellation is already running or requires reconciliation' },
        { status: 409 }
      );
    }
    claimedBatchId = batchId;

    // Create audit log for cancellation start
    await prisma.batchAuditLog.create({
      data: {
        batchId: batchId,
        action: 'batch_cancellation_started',
        details: `${staleProcessing ? 'Expired processing lease recovery' : 'Batch cancellation'} initiated by ${admin.username}. Rolling back ${accountsToRollback.length} AD and ${vpnAccountsToRollback.length} VPN accounts.`,
        performedBy: admin.username,
        success: true,
      },
    });

    let rollbackResult: {
      successful: string[];
      failed: Array<{ username: string; error: string; outcome: string }>;
      items: Array<{ username: string; outcome: string; resolved: boolean; error?: string }>;
    } = { successful: [], failed: [], items: [] };
    let vpnRollbackResult: Awaited<ReturnType<typeof rollbackBatchVpnAccounts>> = {
      successful: [],
      failed: [],
      items: [],
    };
    
    // Perform rollback if there are accounts to clean up
    if (accountsToRollback.length > 0) {
      rollbackResult = await prisma.$transaction(async tx => {
        const usernames = [...new Set(accountsToRollback.map(target => (
          typeof target === 'string' ? target : target.username
        ).trim().toLowerCase()))].sort();
        for (const username of usernames) {
          await tx.$queryRaw<Array<{ lock_acquired: string }>>`
            SELECT 'locked'::text AS lock_acquired
            FROM pg_advisory_xact_lock(hashtextextended(${username}, 873211))
          `;
        }
        return rollbackBatchAccounts(accountsToRollback, batchId);
      }, { timeout: 15 * 60 * 1000 });

      // Log rollback results
      if (rollbackResult.failed.length > 0) {
        console.error(`[Batch Cancellation] Some accounts could not be rolled back:`, rollbackResult.failed);

        await prisma.batchAuditLog.create({
          data: {
            batchId: batchId,
            action: 'ad_rollback_partial',
            details: `AD rollback partially failed. Resolved: ${rollbackResult.successful.length}. Unresolved: ${rollbackResult.failed.length}.`,
            performedBy: admin.username,
            success: false,
          },
        });
      } else {
        console.log(`[Batch Cancellation] All accounts successfully rolled back.`);

        await prisma.batchAuditLog.create({
          data: {
            batchId: batchId,
            action: 'ad_rollback_completed',
            details: `All ${rollbackResult.successful.length} AD accounts were resolved.`,
            performedBy: admin.username,
            success: true,
          },
        });
      }
    }

    if (vpnAccountsToRollback.length > 0) {
      vpnRollbackResult = await rollbackBatchVpnAccounts(
        vpnAccountsToRollback,
        batchId,
        admin.username
      );
    }

    if (accountsToRollback.length === 0 && vpnAccountsToRollback.length === 0) {
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

    if (rollbackResult.successful.length > 0) {
      const successfulUsernames = new Set(rollbackResult.successful);
      await prisma.batchAccountItem.updateMany({
        where: {
          batchId,
          accountType: 'AD',
          ldapUsername: { in: rollbackResult.successful },
        },
        data: {
          status: 'rolled_back',
          errorMessage: null,
        },
      });
      const resolvedRequestIds = accountsToRollback.flatMap(account => {
        if (
          typeof account === 'string'
          || !account.accessRequestId
          || !successfulUsernames.has(account.username)
        ) {
          return [];
        }
        return [account.accessRequestId];
      });
      if (resolvedRequestIds.length > 0) {
        await prisma.accessRequest.updateMany({
          where: { id: { in: resolvedRequestIds } },
          data: {
            status: 'rejected',
            rejectedAt: new Date(),
            rejectedBy: admin.username,
            rejectionReason: `Rolled back during cancellation of batch ${batchId}`,
            provisioningState: 'batch_rolled_back',
            provisioningCompletedAt: new Date(),
            provisioningError: null,
            adAccountStatus: 'deleted',
          },
        });
      }
    }

    for (const failed of rollbackResult.failed) {
      await prisma.batchAccountItem.updateMany({
        where: { batchId, accountType: 'AD', ldapUsername: failed.username },
        data: {
          status: 'reconciliation_required',
          errorMessage: `${failed.outcome}: ${failed.error}`,
        },
      });
      const unresolvedRequestId = accountsToRollback.find(
        account => typeof account !== 'string' && account.username === failed.username
      );
      const unresolvedTrackedRequestId = typeof unresolvedRequestId === 'string'
        ? null
        : unresolvedRequestId?.accessRequestId;
      if (unresolvedTrackedRequestId) {
        await prisma.accessRequest.updateMany({
          where: { id: unresolvedTrackedRequestId },
          data: {
            provisioningState: 'reconciliation_required',
            provisioningCompletedAt: new Date(),
            provisioningError: `${failed.outcome}: ${failed.error}`,
          },
        });
      }
    }

    if (vpnRollbackResult.successful.length > 0) {
      await prisma.batchAccountItem.updateMany({
        where: {
          batchId,
          accountType: 'VPN',
          vpnUsername: { in: vpnRollbackResult.successful },
        },
        data: { status: 'rolled_back', errorMessage: null },
      });
    }

    for (const failed of vpnRollbackResult.failed) {
      await prisma.batchAccountItem.updateMany({
        where: { batchId, accountType: 'VPN', vpnUsername: failed.username },
        data: {
          status: 'reconciliation_required',
          errorMessage: `${failed.outcome}: ${failed.error}`,
        },
      });
    }

    const cancellationResolved =
      rollbackResult.failed.length === 0 && vpnRollbackResult.failed.length === 0;
    await prisma.batchAuditLog.create({
      data: {
        batchId,
        action: cancellationResolved
          ? 'batch_cancellation_completed'
          : 'batch_cancellation_partial',
        details: cancellationResolved
          ? `All ${rollbackResult.successful.length} AD and ${vpnRollbackResult.successful.length} VPN targets were resolved.`
          : `${rollbackResult.failed.length} AD and ${vpnRollbackResult.failed.length} VPN targets require reconciliation.`,
        performedBy: admin.username,
        success: cancellationResolved,
      },
    });
    const updatedBatch = await prisma.batchAccountCreation.update({
      where: { id: batchId },
      data: {
        status: cancellationResolved ? 'cancelled' : 'reconciliation_required',
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
      action: AuditActions.CANCEL_BATCH,
      category: AuditCategories.BATCH,
      username: admin.username,
      targetId: batchId,
      targetType: 'Batch',
      details: { 
        action: 'cancel',
        accountsRolledBack: rollbackResult.successful.length + vpnRollbackResult.successful.length,
        accountsFailedRollback: rollbackResult.failed.length + vpnRollbackResult.failed.length,
      },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    const redactedBatch = {
      ...updatedBatch,
      accounts: updatedBatch.accounts.map(({ password: _password, ...account }) => account),
    };

    return NextResponse.json({
      success: cancellationResolved,
      partial: !cancellationResolved,
      message: cancellationResolved
        ? 'Batch cancelled successfully'
        : 'Batch cancellation requires manual reconciliation',
      batch: redactedBatch,
      rollback: {
        total: accountsToRollback.length + vpnAccountsToRollback.length,
        successful: rollbackResult.successful.length + vpnRollbackResult.successful.length,
        failed: rollbackResult.failed.length + vpnRollbackResult.failed.length,
        failedAccounts: [
          ...rollbackResult.failed.map(item => ({ ...item, accountType: 'AD' })),
          ...vpnRollbackResult.failed.map(item => ({ ...item, accountType: 'VPN' })),
        ],
        outcomes: [
          ...rollbackResult.items.map(item => ({ ...item, accountType: 'AD' })),
          ...vpnRollbackResult.items.map(item => ({ ...item, accountType: 'VPN' })),
        ],
      },
    }, { status: cancellationResolved ? 200 : 207 });
  } catch (error) {
    console.error('Error cancelling batch:', error);

    if (claimedBatchId) {
      await prisma.batchAccountCreation.updateMany({
        where: { id: claimedBatchId, status: 'rolling_back' },
        data: { status: 'reconciliation_required' },
      }).catch(() => {});
    }
    
    // Log the failure
    const resolvedParams = await params;
    const { admin } = await checkAdminAuthWithRateLimit(request);
    if (admin) {
      await logAuditAction({
        action: AuditActions.CANCEL_BATCH,
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
