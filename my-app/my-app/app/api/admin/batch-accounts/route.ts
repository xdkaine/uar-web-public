import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  searchLDAPUserForProvisioning,
  createLDAPUser,
  setLDAPUserPassword,
  setLDAPUserExpiration,
  deleteLDAPUser,
  disableLDAPUser,
  descriptionMatchesRequestTag,
} from '@/lib/ldap';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { encryptPassword } from '@/lib/encryption';
import { logAuditAction, AuditActions, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';

interface ADAccountInput {
  name: string;
  email?: string;
  ldapUsername: string;
  password: string;
  accountExpiresAt?: string;
  isInternal: boolean;
}

interface VPNAccountInput {
  name: string;
  email?: string;
  vpnUsername: string;
  password: string;
  accountExpiresAt: string;
  isInternal?: boolean;
  portalType?: string; // "Management", "Limited", "External"
}

interface BatchCreationRequest {
  description: string;
  linkedTicketId?: string;
  adAccounts: ADAccountInput[];
  vpnAccounts: VPNAccountInput[];
}

function stripPasswords<T extends { password?: string | null }>(
  records: T[]
): Omit<T, 'password'>[] {
  return records.map(({ password: _password, ...rest }) => rest);
}

/**
 * Rollback batch accounts by cleaning up LDAP accounts created during batch processing.
 * Attempts deletion first, falls back to disable+expire if deletion fails.
 * 
 * @param usernames - Array of usernames to rollback
 * @param batchId - Batch ID for safety verification and logging
 * @returns Object with successful and failed rollback results
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

  console.log(`[Batch Rollback] Starting rollback for batch ${batchId}. Accounts to clean: ${usernames.length}`);

  await Promise.all(
    usernames.map(async (username) => {
      try {
        // Note: Batch accounts use their batch ID as the tracking identifier
        // The deleteLDAPUser function will still verify the standardized UAR description tag
        await deleteLDAPUser(username, undefined, false);
        successful.push(username);
        console.log(`[Batch Rollback] Successfully deleted account: ${username}`);
      } catch (deleteError) {
        console.warn(`[Batch Rollback] Delete failed for ${username}, attempting disable+expire`, deleteError);

        try {
          // Fallback: disable and expire immediately
          await disableLDAPUser(username);
          await setLDAPUserExpiration(username, new Date());
          successful.push(username);
          console.log(`[Batch Rollback] Successfully disabled account: ${username}`);
        } catch (disableError) {
          const errorMsg = disableError instanceof Error ? disableError.message : 'Unknown error';
          failed.push({ username, error: errorMsg });
          console.error(`[Batch Rollback] Failed to rollback account ${username}:`, disableError);
        }
      }
    })
  );

  console.log(`[Batch Rollback] Completed for batch ${batchId}. Successful: ${successful.length}, Failed: ${failed.length}`);

  return { successful, failed };
}

// GET - List all batch operations
export async function GET(request: NextRequest) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);

    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const batches = await prisma.batchAccountCreation.findMany({
      include: {
        accounts: {
          select: {
            id: true,
            name: true,
            ldapUsername: true,
            status: true,
            errorMessage: true,
          },
        },
        linkedTicket: {
          select: {
            id: true,
            subject: true,
            status: true,
          },
        },
        _count: {
          select: {
            accounts: true,
            auditLogs: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return NextResponse.json({ batches });
  } catch (error) {
    console.error('Error fetching batches:', error);
    return NextResponse.json(
      { error: 'Failed to fetch batches' },
      { status: 500 }
    );
  }
}

// POST - Create new batch of accounts
export async function POST(request: NextRequest) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);

    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body: BatchCreationRequest = await request.json();

    // Validate input
    if (!body.description || !body.description.trim()) {
      return NextResponse.json(
        { error: 'Description is required' },
        { status: 400 }
      );
    }

    if (!body.adAccounts || body.adAccounts.length === 0) {
      return NextResponse.json(
        { error: 'At least one AD account must be provided' },
        { status: 400 }
      );
    }

    const totalAccounts = (body.adAccounts?.length || 0) + (body.vpnAccounts?.length || 0);
    if (totalAccounts > 100) {
      return NextResponse.json(
        { error: 'Maximum 100 accounts per batch' },
        { status: 400 }
      );
    }

    // Validate linked ticket if provided
    if (body.linkedTicketId) {
      const linkedTicket = await prisma.supportTicket.findUnique({
        where: { id: body.linkedTicketId },
      });

      if (!linkedTicket) {
        return NextResponse.json(
          { error: 'Linked support ticket not found' },
          { status: 404 }
        );
      }
    }

    // Validate AD accounts
    for (const account of body.adAccounts || []) {
      if (!account.name || !account.ldapUsername || !account.password) {
        return NextResponse.json(
          { error: 'Each AD account must have name, ldapUsername, and password' },
          { status: 400 }
        );
      }

      if (account.ldapUsername.length > 20) {
        return NextResponse.json(
          { error: `AD username "${account.ldapUsername}" exceeds the 20 character limit` },
          { status: 400 }
        );
      }

      if (!account.isInternal && !account.accountExpiresAt) {
        return NextResponse.json(
          { error: 'External AD accounts require an expiration date' },
          { status: 400 }
        );
      }
    }

    // Validate VPN accounts
    for (const account of body.vpnAccounts || []) {
      if (!account.name || !account.vpnUsername || !account.password) {
        return NextResponse.json(
          { error: 'Each VPN account must have name, vpnUsername, and password' },
          { status: 400 }
        );
      }

      if (!account.accountExpiresAt) {
        return NextResponse.json(
          { error: 'VPN accounts require an expiration date' },
          { status: 400 }
        );
      }
    }

    // Create batch record
    const batch = await prisma.batchAccountCreation.create({
      data: {
        createdBy: admin.username,
        description: body.description,
        totalAccounts: totalAccounts,
        linkedTicketId: body.linkedTicketId,
        status: 'processing',
      },
    });

    // Create initial audit log
    await prisma.batchAuditLog.create({
      data: {
        batchId: batch.id,
        action: 'batch_created',
        details: `Batch creation initiated by ${admin.username}. Total accounts: ${totalAccounts} (${body.adAccounts?.length || 0} AD, ${body.vpnAccounts?.length || 0} VPN). Description: ${body.description}`,
        performedBy: admin.username,
        success: true,
      },
    });

    // Process each account
    let successCount = 0;
    let failCount = 0;

    // Track all successfully created LDAP accounts for rollback on failure
    const createdLdapAccounts: string[] = [];

    // Process AD Accounts
    for (const accountInput of body.adAccounts || []) {
      try {
        const encryptedPassword = encryptPassword(accountInput.password);

        // Use transaction to prevent race condition: check for duplicates and create batch item atomically
        const batchItem = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
          // Check for existing batch items with same username within transaction
          const existingItem = await tx.batchAccountItem.findFirst({
            where: {
              ldapUsername: accountInput.ldapUsername,
              status: { in: ['processing', 'completed'] }
            }
          });

          if (existingItem) {
            throw new Error(`Username "${accountInput.ldapUsername}" is already being processed in batch ${existingItem.batchId}`);
          }

          // Create batch item (database enforces uniqueness constraint)
          return await tx.batchAccountItem.create({
            data: {
              batchId: batch.id,
              accountType: 'AD',
              name: accountInput.name,
              email: accountInput.email || null,
              ldapUsername: accountInput.ldapUsername,
              vpnUsername: null,
              password: encryptedPassword,
              accountExpiresAt: accountInput.accountExpiresAt ? new Date(accountInput.accountExpiresAt) : null,
              isInternal: accountInput.isInternal,
              status: 'processing',
            },
          });
        }, {
          isolationLevel: 'Serializable',
          timeout: 10000
        });

        let ldapCreated = false;
        let errorMsg = '';

        // Create AD account (outside transaction to avoid long-running transaction)
        try {
          // IDEMPOTENCY CHECK: Check if LDAP username already exists in Active Directory
          const existingLdapUser = await searchLDAPUserForProvisioning(accountInput.ldapUsername);
          if (existingLdapUser) {
            // Check if this is from a previous failed attempt of THIS batch
            const descAttr = existingLdapUser.attributes.find((attr: { type: string }) => attr.type === 'description');
            const description = descAttr?.values?.[0] || '';

            if (descriptionMatchesRequestTag(description, batch.id)) {
              console.log(`[Batch Retry Safety] Found existing account from previous failed attempt. Cleaning up ${accountInput.ldapUsername}`);

              // Clean up the account from the previous failed attempt
              try {
                await deleteLDAPUser(accountInput.ldapUsername, undefined, false);
                console.log(`[Batch Retry Safety] Successfully cleaned up ${accountInput.ldapUsername} for retry`);
              } catch (cleanupError) {
                console.warn(`[Batch Retry Safety] Could not delete ${accountInput.ldapUsername}, will try to disable`, cleanupError);
                // Try disable as fallback
                await disableLDAPUser(accountInput.ldapUsername);
                await setLDAPUserExpiration(accountInput.ldapUsername, new Date());
                console.log(`[Batch Retry Safety] Successfully disabled ${accountInput.ldapUsername} for retry`);
              }

              // Now proceed with creating the account
            } else {
              // Account exists but not from this batch - error
              throw new Error(`LDAP username "${accountInput.ldapUsername}" already exists in Active Directory`);
            }
          }

          // Create AD user
          await createLDAPUser(
            accountInput.ldapUsername,
            accountInput.email,
            accountInput.name,
            !accountInput.isInternal,
            batch.id,
            accountInput.accountExpiresAt ? new Date(accountInput.accountExpiresAt) : undefined
          );

          // Set password
          await setLDAPUserPassword(
            accountInput.ldapUsername,
            accountInput.password
          );

          // Set expiration for external users
          if (!accountInput.isInternal && accountInput.accountExpiresAt) {
            await setLDAPUserExpiration(
              accountInput.ldapUsername,
              new Date(accountInput.accountExpiresAt)
            );
          }

          ldapCreated = true;

          // Track successfully created account for potential rollback
          createdLdapAccounts.push(accountInput.ldapUsername);

          await prisma.batchAuditLog.create({
            data: {
              batchId: batch.id,
              action: 'ad_account_created',
              details: `AD account "${accountInput.ldapUsername}" created successfully for ${accountInput.name}`,
              performedBy: admin.username,
              accountName: accountInput.ldapUsername,
              success: true,
            },
          });
        } catch (ldapError) {
          const rawLdapErrorMsg = ldapError instanceof Error ? ldapError.message : 'Unknown AD error';
          const ldapErrorMsg = rawLdapErrorMsg.replace(/\x00/g, '');
          errorMsg = `AD creation failed: ${ldapErrorMsg}`;

          await prisma.batchAuditLog.create({
            data: {
              batchId: batch.id,
              action: 'ad_account_failed',
              details: `Failed to create AD account "${accountInput.ldapUsername}" for ${accountInput.name}: ${ldapErrorMsg}`,
              performedBy: admin.username,
              accountName: accountInput.ldapUsername,
              success: false,
            },
          });
        }

        // Update batch item
        await prisma.batchAccountItem.update({
          where: { id: batchItem.id },
          data: {
            status: ldapCreated ? 'completed' : 'failed',
            ldapCreatedAt: ldapCreated ? new Date() : null,
            errorMessage: errorMsg || null,
            completedAt: new Date(),
          },
        });

        if (ldapCreated) {
          successCount++;
        } else {
          failCount++;
        }
      } catch (accountError) {
        failCount++;
        const rawAccountErrorMsg = accountError instanceof Error ? accountError.message : 'Unknown error';
        const accountErrorMsg = rawAccountErrorMsg.replace(/\x00/g, '');

        await prisma.batchAuditLog.create({
          data: {
            batchId: batch.id,
            action: 'account_processing_failed',
            details: `Failed to process AD account for ${accountInput.name}: ${accountErrorMsg}`,
            performedBy: admin.username,
            accountName: accountInput.ldapUsername,
            success: false,
          },
        });

        console.error(`Error processing AD account ${accountInput.ldapUsername}:`, accountError);
      }
    }

    // Process VPN Accounts
    for (const accountInput of body.vpnAccounts || []) {
      try {
        // Determine if the account is internal or external
        const isInternalAccount = accountInput.isInternal ?? false;

        const encryptedPassword = encryptPassword(accountInput.password);

        // Create batch item
        const batchItem = await prisma.batchAccountItem.create({
          data: {
            batchId: batch.id,
            accountType: 'VPN',
            name: accountInput.name,
            email: accountInput.email || null,
            ldapUsername: accountInput.vpnUsername,
            vpnUsername: accountInput.vpnUsername,
            password: encryptedPassword,
            accountExpiresAt: new Date(accountInput.accountExpiresAt),
            isInternal: isInternalAccount,
            status: 'processing',
          },
        });

        let vpnCreated = false;
        let errorMsg = '';

        // Create VPN account entry (pending faculty approval)
        try {
          // Check if VPN username already exists in database
          const existingVpnAccount = await prisma.vPNAccount.findUnique({
            where: { username: accountInput.vpnUsername },
          });

          if (existingVpnAccount) {
            throw new Error(`VPN username "${accountInput.vpnUsername}" already exists`);
          }

          // Create VPN account record with active status (batch imports represent existing users)
          // Determine portal type based on isInternal flag
          const portalType = accountInput.portalType ?? (isInternalAccount ? 'Management' : 'External');

          await prisma.vPNAccount.create({
            data: {
              username: accountInput.vpnUsername,
              name: accountInput.name,
              email: accountInput.email || null,
              portalType: portalType,
              isInternal: isInternalAccount,
              status: 'active',
              expiresAt: new Date(accountInput.accountExpiresAt),
              password: encryptedPassword,
              createdBy: admin.username,
              createdByFaculty: false,
              batchId: batch.id,
              // Note: Batch VPN accounts don't have adUsername since they're standalone
              // Only VPN accounts created from access requests have linked AD accounts
            },
          });

          // Create status log for VPN account
          const vpnAccount = await prisma.vPNAccount.findUnique({
            where: { username: accountInput.vpnUsername },
          });

          if (vpnAccount) {
            await prisma.vPNAccountStatusLog.create({
              data: {
                accountId: vpnAccount.id,
                oldStatus: null,
                newStatus: 'active',
                changedBy: admin.username,
                reason: 'Created via batch account creation',
              },
            });
          }

          vpnCreated = true;

          await prisma.batchAuditLog.create({
            data: {
              batchId: batch.id,
              action: 'vpn_account_created',
              details: `VPN account "${accountInput.vpnUsername}" created successfully for ${accountInput.name} (pending faculty approval)`,
              performedBy: admin.username,
              accountName: accountInput.vpnUsername,
              success: true,
            },
          });
        } catch (vpnError) {
          const rawVpnErrorMsg = vpnError instanceof Error ? vpnError.message : 'Unknown VPN error';
          const vpnErrorMsg = rawVpnErrorMsg.replace(/\x00/g, '');
          errorMsg = `VPN creation failed: ${vpnErrorMsg}`;

          await prisma.batchAuditLog.create({
            data: {
              batchId: batch.id,
              action: 'vpn_account_failed',
              details: `Failed to create VPN account "${accountInput.vpnUsername}" for ${accountInput.name}: ${vpnErrorMsg}`,
              performedBy: admin.username,
              accountName: accountInput.vpnUsername,
              success: false,
            },
          });
        }

        // Update batch item
        await prisma.batchAccountItem.update({
          where: { id: batchItem.id },
          data: {
            status: vpnCreated ? 'completed' : 'failed',
            vpnCreatedAt: vpnCreated ? new Date() : null,
            errorMessage: errorMsg || null,
            completedAt: new Date(),
          },
        });

        if (vpnCreated) {
          successCount++;
        } else {
          failCount++;
        }
      } catch (accountError) {
        failCount++;
        const rawAccountErrorMsg = accountError instanceof Error ? accountError.message : 'Unknown error';
        const accountErrorMsg = rawAccountErrorMsg.replace(/\x00/g, '');

        await prisma.batchAuditLog.create({
          data: {
            batchId: batch.id,
            action: 'account_processing_failed',
            details: `Failed to process VPN account for ${accountInput.name}: ${accountErrorMsg}`,
            performedBy: admin.username,
            accountName: accountInput.vpnUsername,
            success: false,
          },
        });

        console.error(`Error processing VPN account ${accountInput.vpnUsername}:`, accountError);
      }
    }

    // ROLLBACK ON PARTIAL FAILURE: If any accounts failed, rollback all successfully created accounts
    if (failCount > 0 && createdLdapAccounts.length > 0) {
      console.log(`[Batch Rollback] Batch partially failed (${failCount} failures). Rolling back ${createdLdapAccounts.length} successfully created accounts.`);

      // Update batch status to rolling_back
      await prisma.batchAccountCreation.update({
        where: { id: batch.id },
        data: { status: 'rolling_back' },
      });

      await prisma.batchAuditLog.create({
        data: {
          batchId: batch.id,
          action: 'batch_rollback_started',
          details: `Batch partially failed. Rolling back ${createdLdapAccounts.length} successfully created accounts: ${createdLdapAccounts.join(', ')}`,
          performedBy: admin.username,
          success: true,
        },
      });

      // Perform rollback
      const rollbackResult = await rollbackBatchAccounts(createdLdapAccounts, batch.id);

      // Log rollback results
      if (rollbackResult.failed.length > 0) {
        console.error(`[Batch Rollback] Some accounts could not be rolled back:`, rollbackResult.failed);

        // Update successfully rolled back items
        if (rollbackResult.successful.length > 0) {
          await prisma.batchAccountItem.updateMany({
            where: {
              batchId: batch.id,
              ldapUsername: { in: rollbackResult.successful }
            },
            data: {
              status: 'failed',
              errorMessage: 'Account rolled back due to batch failure',
            }
          });
        }

        // Update items that failed to roll back
        for (const failedRollback of rollbackResult.failed) {
          await prisma.batchAccountItem.updateMany({
            where: {
              batchId: batch.id,
              ldapUsername: failedRollback.username
            },
            data: {
              status: 'failed',
              errorMessage: `Failed to rollback after batch failure: ${failedRollback.error}`,
            }
          });
        }

        await prisma.batchAuditLog.create({
          data: {
            batchId: batch.id,
            action: 'batch_rollback_partial',
            details: `⚠️ Rollback partially failed. Successfully rolled back: ${rollbackResult.successful.length}. Failed: ${rollbackResult.failed.length}. Manual cleanup may be required for: ${rollbackResult.failed.map(f => `${f.username} (${f.error})`).join(', ')}`,
            performedBy: admin.username,
            success: false,
          },
        });
      } else {
        console.log(`[Batch Rollback] All accounts successfully rolled back.`);

        // Update all successfully rolled back items to 'failed' since the batch failed
        if (rollbackResult.successful.length > 0) {
          await prisma.batchAccountItem.updateMany({
            where: {
              batchId: batch.id,
              ldapUsername: { in: rollbackResult.successful }
            },
            data: {
              status: 'failed',
              errorMessage: 'Account rolled back due to batch failure',
            }
          });
        }

        await prisma.batchAuditLog.create({
          data: {
            batchId: batch.id,
            action: 'batch_rollback_completed',
            details: `All ${rollbackResult.successful.length} successfully created accounts have been rolled back. Batch can be retried safely.`,
            performedBy: admin.username,
            success: true,
          },
        });
      }

      // Update batch status to failed after rollback
      const updatedBatch = await prisma.batchAccountCreation.update({
        where: { id: batch.id },
        data: {
          successfulAccounts: 0, // All were rolled back
          failedAccounts: totalAccounts,
          status: 'failed',
          completedAt: new Date(),
        },
        include: {
          accounts: true,
          auditLogs: {
            orderBy: { createdAt: 'asc' },
          },
          linkedTicket: {
            select: {
              id: true,
              subject: true,
              status: true,
            },
          },
        },
      });

      return NextResponse.json(
        {
          success: false,
          error: 'Batch partially failed and was rolled back. All successfully created accounts have been removed. You can retry the entire batch.',
          batch: {
            ...updatedBatch,
            accounts: stripPasswords(updatedBatch.accounts),
          },
          rollback: {
            successful: rollbackResult.successful,
            failed: rollbackResult.failed,
          },
          summary: {
            total: totalAccounts,
            successful: 0,
            failed: totalAccounts,
            rolledBack: rollbackResult.successful.length,
          },
        },
        { status: 400 }
      );
    }

    // Update batch with final counts (all succeeded)
    const updatedBatch = await prisma.batchAccountCreation.update({
      where: { id: batch.id },
      data: {
        successfulAccounts: successCount,
        failedAccounts: failCount,
        status: 'completed',
        completedAt: new Date(),
      },
      include: {
        accounts: true,
        auditLogs: {
          orderBy: { createdAt: 'asc' },
        },
        linkedTicket: {
          select: {
            id: true,
            subject: true,
            status: true,
          },
        },
      },
    });

    // Create final audit log
    await prisma.batchAuditLog.create({
      data: {
        batchId: batch.id,
        action: 'batch_completed',
        details: `Batch processing completed successfully. All ${successCount} accounts created without errors.`,
        performedBy: admin.username,
        success: true,
      },
    });

    // Log batch creation to main audit log
    await logAuditAction({
      action: AuditActions.CREATE_BATCH,
      category: AuditCategories.BATCH,
      username: admin.username,
      targetId: batch.id,
      targetType: 'Batch',
      details: {
        totalAccounts,
        successCount,
        failCount,
        hasADAccounts: (body.adAccounts?.length || 0) > 0,
        hasVPNAccounts: (body.vpnAccounts?.length || 0) > 0
      },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    return NextResponse.json({
      success: true,
      message: 'Batch processing completed successfully',
      batch: {
        ...updatedBatch,
        accounts: stripPasswords(updatedBatch.accounts),
      },
      summary: {
        total: totalAccounts,
        successful: successCount,
        failed: failCount,
      },
    });
  } catch (error) {
    console.error('Error creating batch:', error);

    // Log the failure
    const { admin } = await checkAdminAuthWithRateLimit(request);
    if (admin) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      await logAuditAction({
        action: AuditActions.CREATE_BATCH,
        category: AuditCategories.BATCH,
        username: admin.username,
        targetType: 'Batch',
        success: false,
        errorMessage: errorMsg.replace(/\x00/g, ''),
        ipAddress: getIpAddress(request),
        userAgent: getUserAgent(request),
      });
    }

    return NextResponse.json(
      { error: 'Failed to create batch' },
      { status: 500 }
    );
  }
}
