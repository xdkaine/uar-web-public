import { NextRequest, NextResponse } from 'next/server';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { logAuditAction, AuditActions, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';
import { prisma } from '@/lib/prisma';
import { secureJsonResponse } from '@/lib/apiResponse';

/**
 * PATCH /api/admin/vpn-accounts/bulk-status
 * Bulk update VPN account statuses
 * Useful for mass approving pending_faculty accounts or other bulk operations
 */
export async function PATCH(request: NextRequest) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { accountIds, newStatus, reason, createdByFaculty } = body;

    // Validate input
    if (!accountIds || !Array.isArray(accountIds) || accountIds.length === 0) {
      return NextResponse.json(
        { error: 'accountIds array is required and must not be empty' },
        { status: 400 }
      );
    }

    if (!newStatus) {
      return NextResponse.json(
        { error: 'newStatus is required' },
        { status: 400 }
      );
    }

    const validStatuses = ['active', 'pending_faculty', 'disabled'];
    if (!validStatuses.includes(newStatus)) {
      return NextResponse.json(
        { error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` },
        { status: 400 }
      );
    }

    // Fetch all accounts to validate they exist and check current status
    const accounts = await prisma.vPNAccount.findMany({
      where: {
        id: { in: accountIds },
      },
    });

    if (accounts.length !== accountIds.length) {
      return NextResponse.json(
        { error: 'Some account IDs were not found' },
        { status: 404 }
      );
    }

    // Perform bulk update in a transaction
    const result = await prisma.$transaction(async (tx: any) => {
      const updates = [];
      const logs = [];
      
      for (const account of accounts) {
        const oldStatus = account.status;

        // Special case: updating faculty approval without changing status
        if (oldStatus === newStatus && typeof createdByFaculty === 'boolean' && account.createdByFaculty !== createdByFaculty) {
          const updateData: any = {
            createdByFaculty,
          };
          
          if (createdByFaculty && !account.facultyCreatedAt) {
            updateData.facultyCreatedAt = new Date();
          }
          
          const updated = await tx.vPNAccount.update({
            where: { id: account.id },
            data: updateData,
          });
          updates.push(updated);

          // Create status log for faculty approval change
          await tx.vPNAccountStatusLog.create({
            data: {
              accountId: account.id,
              oldStatus,
              newStatus,
              changedBy: admin.username,
              reason: reason || `Bulk faculty approval ${createdByFaculty ? 'granted' : 'revoked'} by admin`,
            },
          });

          logs.push({
            accountId: account.id,
            username: account.username,
            oldStatus,
            newStatus,
            facultyApproved: createdByFaculty,
          });
          continue;
        }

        // Skip if already at target status and no faculty change needed
        if (oldStatus === newStatus) {
          continue;
        }

        // Validate state transitions
        if (newStatus === 'active' && oldStatus === 'pending_faculty') {
          // Approving pending faculty accounts
          const updateData: any = {
            status: 'active',
          };
          
          // Update faculty approval if provided
          if (typeof createdByFaculty === 'boolean') {
            updateData.createdByFaculty = createdByFaculty;
            if (createdByFaculty && !account.facultyCreatedAt) {
              updateData.facultyCreatedAt = new Date();
            }
          }
          
          const updated = await tx.vPNAccount.update({
            where: { id: account.id },
            data: updateData,
          });
          updates.push(updated);

          // Create status log
          await tx.vPNAccountStatusLog.create({
            data: {
              accountId: account.id,
              oldStatus,
              newStatus: 'active',
              changedBy: admin.username,
              reason: reason || 'Bulk approval by admin',
            },
          });

          logs.push({
            accountId: account.id,
            username: account.username,
            oldStatus,
            newStatus: 'active',
            facultyApproved: updateData.createdByFaculty,
          });
        } else if (newStatus === 'disabled' || newStatus === 'pending_faculty') {
          // Other status changes
          const updateData: any = { status: newStatus };
          
          if (newStatus === 'disabled') {
            updateData.disabledAt = new Date();
            updateData.disabledBy = admin.username;
            updateData.disabledReason = reason || 'Bulk disabled by admin';
          }
          
          // Update faculty approval if provided
          if (typeof createdByFaculty === 'boolean') {
            updateData.createdByFaculty = createdByFaculty;
            if (createdByFaculty && !account.facultyCreatedAt) {
              updateData.facultyCreatedAt = new Date();
            }
          }

          const updated = await tx.vPNAccount.update({
            where: { id: account.id },
            data: updateData,
          });
          updates.push(updated);

          // Create status log
          await tx.vPNAccountStatusLog.create({
            data: {
              accountId: account.id,
              oldStatus,
              newStatus,
              changedBy: admin.username,
              reason: reason || 'Bulk status change by admin',
            },
          });

          logs.push({
            accountId: account.id,
            username: account.username,
            oldStatus,
            newStatus,
            facultyApproved: updateData.createdByFaculty,
          });
        } else if (newStatus === 'active') {
          // Handle active status from other states
          const updateData: any = { status: 'active' };
          
          // Update faculty approval if provided
          if (typeof createdByFaculty === 'boolean') {
            updateData.createdByFaculty = createdByFaculty;
            if (createdByFaculty && !account.facultyCreatedAt) {
              updateData.facultyCreatedAt = new Date();
            }
          }

          const updated = await tx.vPNAccount.update({
            where: { id: account.id },
            data: updateData,
          });
          updates.push(updated);

          // Create status log
          await tx.vPNAccountStatusLog.create({
            data: {
              accountId: account.id,
              oldStatus,
              newStatus: 'active',
              changedBy: admin.username,
              reason: reason || 'Bulk activation by admin',
            },
          });

          logs.push({
            accountId: account.id,
            username: account.username,
            oldStatus,
            newStatus: 'active',
            facultyApproved: updateData.createdByFaculty,
          });
        } else {
          // Invalid state transition
          throw new Error(
            `Invalid status transition for ${account.username}: ${oldStatus} -> ${newStatus}`
          );
        }
      }

      return { updates, logs };
    });

    // Log audit action
    await logAuditAction({
      action: AuditActions.UPDATE_VPN_ACCOUNT,
      category: AuditCategories.USER,
      username: admin.username,
      targetType: 'VPNAccount',
      success: true,
      details: {
        bulkUpdate: true,
        accountCount: result.updates.length,
        newStatus,
        reason,
        accounts: result.logs,
      },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    return secureJsonResponse({
      success: true,
      message: `Successfully updated ${result.updates.length} account(s)`,
      updatedCount: result.updates.length,
      skippedCount: accounts.length - result.updates.length,
      accounts: result.logs,
    });
  } catch (error) {
    console.error('Error bulk updating VPN account statuses:', error);

    const { admin } = await checkAdminAuthWithRateLimit(request);
    if (admin) {
      await logAuditAction({
        action: AuditActions.UPDATE_VPN_ACCOUNT,
        category: AuditCategories.USER,
        username: admin.username,
        targetType: 'VPNAccount',
        success: false,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        ipAddress: getIpAddress(request),
        userAgent: getUserAgent(request),
      });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to bulk update account statuses' },
      { status: 500 }
    );
  }
}
