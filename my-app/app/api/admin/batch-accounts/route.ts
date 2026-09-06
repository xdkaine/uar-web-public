import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/prisma';
import {
  searchLDAPUserForProvisioning,
  createLDAPUser,
  setLDAPUserPassword,
  setLDAPUserExpiration,
} from '@/lib/ldap';
import {
  rollbackBatchAccounts,
  type BatchRollbackTarget,
} from '@/lib/batch-account-rollback';
import { rollbackBatchVpnAccounts } from '@/lib/batch-vpn-rollback';
import { createBatchVpnAccountRecord } from '@/lib/batch-vpn-provisioning';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { actorHasPermission } from '@/lib/rbac/core';
import { encryptPassword } from '@/lib/encryption';
import { logAuditAction, AuditActions, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';
import { isModuleEnabled } from '@/lib/modules/core';
import { ldapAccountIsEnabled } from '@/lib/ldap/account-status';
import { batchSubmissionFingerprint, type BatchCreationRequest } from './batch-submission';

interface ReplayableBatch {
  id: string;
  createdBy: string;
  status: string;
  totalAccounts: number;
  successfulAccounts: number;
  failedAccounts: number;
  submissionFingerprint: string | null;
}

const BATCH_PROCESSING_LEASE_MS = 15 * 60 * 1000;

class BatchProcessingLeaseLostError extends Error {}

function replayBatchResponse(
  existingBatch: ReplayableBatch,
  actor: string,
  submissionFingerprint: string
): NextResponse {
  if (existingBatch.createdBy !== actor || existingBatch.submissionFingerprint !== submissionFingerprint) {
    return NextResponse.json({ error: 'Batch submission key is already in use for different work' }, { status: 409 });
  }
  return NextResponse.json({
    success: existingBatch.status === 'completed',
    replayed: true,
    message: 'This reviewed batch was already submitted. No duplicate work was started.',
    batch: {
      id: existingBatch.id,
      createdBy: existingBatch.createdBy,
      status: existingBatch.status,
      totalAccounts: existingBatch.totalAccounts,
      successfulAccounts: existingBatch.successfulAccounts,
      failedAccounts: existingBatch.failedAccounts,
    },
    summary: {
      total: existingBatch.totalAccounts,
      successful: existingBatch.successfulAccounts,
      failed: existingBatch.failedAccounts,
    },
  }, { status: existingBatch.status === 'processing' ? 202 : 200 });
}

function ldapAttribute(
  user: { attributes: Array<{ type: string; values: string[] }> },
  type: string
): string {
  return user.attributes.find(attribute => attribute.type.toLowerCase() === type.toLowerCase())
    ?.values?.[0] ?? '';
}

async function verifyDirectoryIdentity(
  username: string,
  expectedDn: string,
  expectedObjectGuid: string
): Promise<void> {
  const liveUser = await searchLDAPUserForProvisioning(username);
  const liveUsername = liveUser ? ldapAttribute(liveUser, 'sAMAccountName') : '';
  const liveObjectGuid = liveUser ? ldapAttribute(liveUser, 'objectGUID') : '';
  if (
    !liveUser
    || liveUsername.toLowerCase() !== username.trim().toLowerCase()
    || liveUser.objectName.toLowerCase() !== expectedDn.toLowerCase()
    || liveObjectGuid !== expectedObjectGuid
  ) {
    throw new Error('Directory identity changed before a post-creation mutation');
  }
}

function stripPasswords<T extends { password?: string | null }>(
  records: T[]
): Omit<T, 'password'>[] {
  return records.map(({ password: _password, ...rest }) => rest);
}

// GET - List all batch operations
export async function GET(request: NextRequest) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);

    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!actorHasPermission(admin, 'batch.manage')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
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

    if (!actorHasPermission(admin, 'batch.manage')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body: BatchCreationRequest = await request.json();

    if (typeof body.idempotencyKey !== 'string' || body.idempotencyKey.length < 16 || body.idempotencyKey.length > 128) {
      return NextResponse.json(
        { error: 'A stable batch idempotency key is required' },
        { status: 400 }
      );
    }

    const submissionFingerprint = batchSubmissionFingerprint(body);
    const replayedBatch = await prisma.batchAccountCreation.findUnique({
      where: { submissionKey: body.idempotencyKey },
      select: {
        id: true,
        createdBy: true,
        status: true,
        totalAccounts: true,
        successfulAccounts: true,
        failedAccounts: true,
        submissionFingerprint: true,
      },
    });
    if (replayedBatch) {
      return replayBatchResponse(replayedBatch, admin.username, submissionFingerprint);
    }

    // VPN batch creation requires the VPN module; AD-only batches are unaffected.
    const vpnModuleEnabled = await isModuleEnabled('vpn.management');
    if (!vpnModuleEnabled && (body.vpnAccounts?.length ?? 0) > 0) {
      return NextResponse.json(
        {
          error: 'VPN management is disabled; batches cannot include VPN accounts.',
          code: 'MODULE_DISABLED',
          moduleId: 'vpn.management',
        },
        { status: 409 }
      );
    }

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
      if (!account.name || !account.email || !account.ldapUsername || !account.password) {
        return NextResponse.json(
          { error: 'Each AD account must have a name, email, AD username, and password' },
          { status: 400 }
        );
      }

      const normalizedEmail = account.email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        return NextResponse.json(
          { error: `AD account "${account.ldapUsername}" has an invalid email address` },
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

    const processingClaimId = randomUUID();

    // Create batch record with a renewable lease so an interrupted request can
    // be recovered safely instead of remaining in processing forever.
    let batch;
    try {
      batch = await prisma.batchAccountCreation.create({
        data: {
          submissionKey: body.idempotencyKey,
          submissionFingerprint,
          createdBy: admin.username,
          description: body.description,
          totalAccounts: totalAccounts,
          linkedTicketId: body.linkedTicketId,
          status: 'processing',
          processingClaimId,
          processingClaimedUntil: new Date(Date.now() + BATCH_PROCESSING_LEASE_MS),
        },
      });
    } catch (error) {
      const isSubmissionReplay = typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
      if (!isSubmissionReplay) throw error;
      const existingBatch = await prisma.batchAccountCreation.findUnique({
        where: { submissionKey: body.idempotencyKey },
        select: {
          id: true,
          createdBy: true,
          status: true,
          totalAccounts: true,
          successfulAccounts: true,
          failedAccounts: true,
          submissionFingerprint: true,
        },
      });
      if (!existingBatch) {
        return NextResponse.json({ error: 'Batch submission key is already in use' }, { status: 409 });
      }
      return replayBatchResponse(existingBatch, admin.username, submissionFingerprint);
    }

    const withProcessingLease = async <T>(
      operation: (tx: Prisma.TransactionClient) => Promise<T>,
      options: { isolationLevel?: 'Serializable' } = {}
    ): Promise<T> => prisma.$transaction(async tx => {
      const renewal = await tx.batchAccountCreation.updateMany({
        where: {
          id: batch.id,
          status: 'processing',
          processingClaimId,
        },
        data: {
          processingClaimedUntil: new Date(Date.now() + BATCH_PROCESSING_LEASE_MS),
        },
      });
      if (renewal.count !== 1) {
        throw new BatchProcessingLeaseLostError(`Batch ${batch.id} processing lease was lost`);
      }
      return operation(tx);
    }, { timeout: 10000, ...options });

    const renewProcessingLease = () => withProcessingLease(async () => undefined);

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
    const createdLdapAccounts: BatchRollbackTarget[] = [];
    const createdVpnAccounts: string[] = [];
    let unresolvedDirectoryOutcome = false;

    // Process AD Accounts
    for (const accountInput of body.adAccounts || []) {
      try {
        const encryptedPassword = encryptPassword(accountInput.password);
        const normalizedEmail = accountInput.email!.trim().toLowerCase();
        const canonicalUsername = accountInput.ldapUsername.trim().toLowerCase();

        // The batch item is the portal ownership ledger for a batch-created
        // account. Batch provisioning must not synthesize an AccessRequest.
        const batchItem = await withProcessingLease(async tx => {
          await tx.$queryRaw<Array<{ lock_acquired: string }>>`
            SELECT 'locked'::text AS lock_acquired
            FROM pg_advisory_xact_lock(hashtextextended(${canonicalUsername}, 873211))
          `;
          await tx.$queryRaw<Array<{ lock_acquired: string }>>`
            SELECT 'locked'::text AS lock_acquired
            FROM pg_advisory_xact_lock(hashtextextended(${normalizedEmail}, 873213))
          `;

          // Check for existing batch items with same username within transaction
          const existingItem = await tx.batchAccountItem.findFirst({
            where: {
              ldapUsername: { equals: accountInput.ldapUsername, mode: 'insensitive' },
              status: { in: ['processing', 'completed'] }
            }
          });

          if (existingItem) {
            throw new Error(`Username "${accountInput.ldapUsername}" is already being processed in batch ${existingItem.batchId}`);
          }

          const existingOwner = await tx.accessRequest.findFirst({
            where: {
              status: { not: 'rejected' },
              OR: [
                { ldapUsername: { equals: accountInput.ldapUsername, mode: 'insensitive' } },
                { linkedAdUsername: { equals: accountInput.ldapUsername, mode: 'insensitive' } },
                { email: { equals: normalizedEmail, mode: 'insensitive' } },
              ],
            },
            select: { id: true },
          });
          if (existingOwner) {
            throw new Error(`AD account "${accountInput.ldapUsername}" or email already has an active request (${existingOwner.id})`);
          }

          const batchItem = await tx.batchAccountItem.create({
            data: {
              batchId: batch.id,
              accountType: 'AD',
              name: accountInput.name,
              email: normalizedEmail,
              ldapUsername: accountInput.ldapUsername,
              vpnUsername: null,
              password: encryptedPassword,
              accountExpiresAt: accountInput.accountExpiresAt ? new Date(accountInput.accountExpiresAt) : null,
              isInternal: accountInput.isInternal,
              status: 'processing',
              adAccountStatus: null,
              mutationStage: 'prepared',
            },
          });

          return batchItem;
        }, { isolationLevel: 'Serializable' });

        let ldapCreated = false;
        let createAttempted = false;
        let requiresReconciliation = false;
        let directoryDn: string | null = null;
        let directoryObjectGuid: string | null = null;
        let errorMsg = '';

        // Hold the canonical username fence from the last pre-mutation lookup
        // through the durable terminal item update. Lease renewals and evidence
        // writes use separate short transactions while this lock transaction
        // remains open, so recovery cannot race the directory side effect.
        await prisma.$transaction(async ownershipTx => {
          await ownershipTx.$queryRaw<Array<{ lock_acquired: string }>>`
            SELECT 'locked'::text AS lock_acquired
            FROM pg_advisory_xact_lock(hashtextextended(${canonicalUsername}, 873211))
          `;

        try {
          // IDEMPOTENCY CHECK: Check if the AD username already exists in Active Directory
          const existingLdapUser = await searchLDAPUserForProvisioning(accountInput.ldapUsername);
          if (existingLdapUser) {
            throw new Error(`AD username "${accountInput.ldapUsername}" already exists in Active Directory`);
          }

          // Create AD user
          await renewProcessingLease();
          await prisma.batchAccountItem.update({
            where: { id: batchItem.id },
            data: { mutationStage: 'ldap_create_started' },
          });
          createAttempted = true;
          await createLDAPUser(
            accountInput.ldapUsername,
            accountInput.email,
            accountInput.name,
            !accountInput.isInternal,
            { type: 'batch', id: batch.id },
            accountInput.accountExpiresAt ? new Date(accountInput.accountExpiresAt) : undefined
          );
          await prisma.batchAccountItem.update({
            where: { id: batchItem.id },
            data: { mutationStage: 'ldap_create_returned' },
          });
          await renewProcessingLease();

          const createdDirectoryUser = await searchLDAPUserForProvisioning(accountInput.ldapUsername);
          const liveUsername = createdDirectoryUser
            ? ldapAttribute(createdDirectoryUser, 'sAMAccountName')
            : '';
          directoryDn = createdDirectoryUser?.objectName || null;
          directoryObjectGuid = createdDirectoryUser
            ? ldapAttribute(createdDirectoryUser, 'objectGUID')
            : null;
          const liveUserAccountControl = createdDirectoryUser
            ? ldapAttribute(createdDirectoryUser, 'userAccountControl')
            : '';
          if (
            !createdDirectoryUser
            || liveUsername.toLowerCase() !== canonicalUsername
            || !directoryDn
            || !directoryObjectGuid
            || !/^\d+$/u.test(liveUserAccountControl)
            || ldapAccountIsEnabled(createdDirectoryUser.attributes)
          ) {
            throw new Error('Created AD account could not be bound to disabled immutable directory identity evidence');
          }

          await prisma.batchAccountItem.update({
            where: { id: batchItem.id },
            data: {
              targetDirectoryDn: directoryDn,
              targetDirectoryObjectGuid: directoryObjectGuid,
              mutationStage: 'ldap_identity_confirmed',
            },
          });
          await renewProcessingLease();

          createdLdapAccounts.push({
            username: accountInput.ldapUsername,
            accessRequestId: null,
            targetDirectoryDn: directoryDn,
            targetDirectoryObjectGuid: directoryObjectGuid,
          });

          // Revalidate the immutable target and mutate its verified DN rather than
          // resolving the account from a reusable username.
          await verifyDirectoryIdentity(
            accountInput.ldapUsername,
            directoryDn,
            directoryObjectGuid
          );
          await prisma.batchAccountItem.update({
            where: { id: batchItem.id },
            data: { mutationStage: 'ldap_password_started' },
          });
          await setLDAPUserPassword(
            accountInput.ldapUsername,
            accountInput.password,
            directoryDn
          );
          await prisma.batchAccountItem.update({
            where: { id: batchItem.id },
            data: { mutationStage: 'ldap_password_set' },
          });
          await renewProcessingLease();

          // Set expiration for external users
          if (!accountInput.isInternal && accountInput.accountExpiresAt) {
            await verifyDirectoryIdentity(
              accountInput.ldapUsername,
              directoryDn,
              directoryObjectGuid
            );
            await prisma.batchAccountItem.update({
              where: { id: batchItem.id },
              data: { mutationStage: 'ldap_expiration_started' },
            });
            await setLDAPUserExpiration(
              accountInput.ldapUsername,
              new Date(accountInput.accountExpiresAt),
              directoryDn
            );
            await prisma.batchAccountItem.update({
              where: { id: batchItem.id },
              data: { mutationStage: 'ldap_expiration_set' },
            });
            await renewProcessingLease();
          }

          ldapCreated = true;
          await prisma.batchAccountItem.update({
            where: { id: batchItem.id },
            data: { mutationStage: 'external_mutations_complete' },
          });
          await renewProcessingLease();

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
          if (ldapError instanceof BatchProcessingLeaseLostError) throw ldapError;
          const rawLdapErrorMsg = ldapError instanceof Error ? ldapError.message : 'Unknown AD error';
          let ldapErrorMsg = rawLdapErrorMsg.replace(/\x00/g, '');

          // An LDAP add can succeed remotely and still throw locally. Always try
          // to bind the durable candidate to the live object after an attempted
          // create. Absence or a failed readback is treated as unknown, never as
          // an ordinary retryable failure.
          if (createAttempted && (!directoryDn || !directoryObjectGuid)) {
            try {
              const possibleCreatedUser = await searchLDAPUserForProvisioning(accountInput.ldapUsername);
              const possibleUsername = possibleCreatedUser
                ? ldapAttribute(possibleCreatedUser, 'sAMAccountName')
                : '';
              const possibleGuid = possibleCreatedUser
                ? ldapAttribute(possibleCreatedUser, 'objectGUID')
                : '';
              if (
                possibleCreatedUser
                && possibleUsername.toLowerCase() === canonicalUsername
                && possibleCreatedUser.objectName
                && possibleGuid
              ) {
                directoryDn = possibleCreatedUser.objectName;
                directoryObjectGuid = possibleGuid;
                try {
                  await prisma.batchAccountItem.update({
                    where: { id: batchItem.id },
                    data: {
                      targetDirectoryDn: directoryDn,
                      targetDirectoryObjectGuid: directoryObjectGuid,
                    },
                  });
                } catch (evidenceError) {
                  const message = evidenceError instanceof Error
                    ? evidenceError.message.replace(/\x00/g, '')
                    : 'unknown evidence persistence error';
                  ldapErrorMsg = `${ldapErrorMsg}; directory evidence persistence failed: ${message}`;
                }
              }
            } catch (lookupError) {
              const message = lookupError instanceof Error
                ? lookupError.message.replace(/\x00/g, '')
                : 'unknown lookup error';
              ldapErrorMsg = `${ldapErrorMsg}; post-error directory lookup failed: ${message}`;
            }
          }

          if (createAttempted) {
            requiresReconciliation = true;
            if (directoryDn && directoryObjectGuid) {
              if (!createdLdapAccounts.some(target => target.username.toLowerCase() === canonicalUsername)) {
                createdLdapAccounts.push({
                  username: accountInput.ldapUsername,
                  accessRequestId: null,
                  targetDirectoryDn: directoryDn,
                  targetDirectoryObjectGuid: directoryObjectGuid,
                });
              }
            } else {
              unresolvedDirectoryOutcome = true;
            }
          }
          errorMsg = `AD creation failed: ${ldapErrorMsg}`;

          await renewProcessingLease();

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

        await withProcessingLease(async tx => {
          await tx.batchAccountItem.update({
            where: { id: batchItem.id },
            data: {
              status: ldapCreated
                ? 'completed'
                : requiresReconciliation ? 'reconciliation_required' : 'failed',
              ldapCreatedAt: ldapCreated ? new Date() : null,
              errorMessage: errorMsg || null,
              completedAt: new Date(),
              adAccountStatus: ldapCreated ? 'disabled' : null,
              adDisabledAt: ldapCreated ? new Date() : null,
              adDisabledBy: ldapCreated ? admin.username : null,
              adDisabledReason: ldapCreated ? 'Created disabled by the batch provisioning policy' : null,
            },
          });
        });
        }, { timeout: BATCH_PROCESSING_LEASE_MS });

        if (ldapCreated) {
          successCount++;
        } else {
          failCount++;
        }
      } catch (accountError) {
        if (accountError instanceof BatchProcessingLeaseLostError) throw accountError;
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

    // Process VPN Accounts (only while VPN management is enabled; requests
    // containing VPN accounts are rejected earlier when the module is off)
    for (const accountInput of vpnModuleEnabled ? (body.vpnAccounts || []) : []) {
      try {
        // Determine if the account is internal or external
        const isInternalAccount = accountInput.isInternal ?? false;

        const encryptedPassword = encryptPassword(accountInput.password);

        // Reserve VPN ownership under the same canonical identity fence used by
        // lifecycle operations. A batch item must never become a second owner
        // for a username already governed by an access request or another run.
        const canonicalVpnUsername = accountInput.vpnUsername.trim().toLowerCase();
        const batchItem = await withProcessingLease(async tx => {
          await tx.$queryRaw<Array<{ lock_acquired: string }>>`
            SELECT 'locked'::text AS lock_acquired
            FROM pg_advisory_xact_lock(hashtextextended(${canonicalVpnUsername}, 873212))
          `;
          const existingBatchOwner = await tx.batchAccountItem.findFirst({
            where: {
              accountType: 'VPN',
              status: { in: ['processing', 'completed', 'reconciliation_required'] },
              OR: [
                { ldapUsername: { equals: canonicalVpnUsername, mode: 'insensitive' } },
                { vpnUsername: { equals: canonicalVpnUsername, mode: 'insensitive' } },
              ],
            },
            select: { id: true, batchId: true },
          });
          if (existingBatchOwner) {
            throw new Error(`VPN username "${accountInput.vpnUsername}" is already governed by batch ${existingBatchOwner.batchId}`);
          }
          const existingRequestOwner = await tx.accessRequest.findFirst({
            where: {
              status: { not: 'rejected' },
              OR: [
                { vpnUsername: { equals: canonicalVpnUsername, mode: 'insensitive' } },
                { linkedVpnUsername: { equals: canonicalVpnUsername, mode: 'insensitive' } },
              ],
            },
            select: { id: true },
          });
          if (existingRequestOwner) {
            throw new Error(`VPN username "${accountInput.vpnUsername}" already has an active request (${existingRequestOwner.id})`);
          }

          return tx.batchAccountItem.create({
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
              mutationStage: 'prepared',
            },
          });
        });

        let vpnCreated = false;
        let errorMsg = '';
        // Record the durable candidate before mutation. If the transaction result is
        // ambiguous, rollback will reconcile by exact username and batch ownership.
        createdVpnAccounts.push(accountInput.vpnUsername);

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

          await renewProcessingLease();
          await prisma.batchAccountItem.update({
            where: { id: batchItem.id },
            data: { mutationStage: 'vpn_create_started' },
          });
          await createBatchVpnAccountRecord({
            username: accountInput.vpnUsername,
            name: accountInput.name,
            email: accountInput.email || null,
            portalType,
            isInternal: isInternalAccount,
            expiresAt: new Date(accountInput.accountExpiresAt),
            encryptedPassword,
            createdBy: admin.username,
            batchId: batch.id,
            batchAccountItemId: batchItem.id,
          });
          await prisma.batchAccountItem.update({
            where: { id: batchItem.id },
            data: { mutationStage: 'external_mutations_complete' },
          });
          await renewProcessingLease();

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
          if (vpnError instanceof BatchProcessingLeaseLostError) throw vpnError;
          await renewProcessingLease();
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

        await withProcessingLease(async tx => {
          await tx.batchAccountItem.update({
            where: { id: batchItem.id },
            data: {
              status: vpnCreated ? 'completed' : 'failed',
              vpnCreatedAt: vpnCreated ? new Date() : null,
              errorMessage: errorMsg || null,
              completedAt: new Date(),
            },
          });
        });

        if (vpnCreated) {
          successCount++;
        } else {
          failCount++;
        }
      } catch (accountError) {
        if (accountError instanceof BatchProcessingLeaseLostError) throw accountError;
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
    if (failCount > 0 && (createdLdapAccounts.length > 0 || createdVpnAccounts.length > 0)) {
      console.log(`[Batch Rollback] Batch partially failed (${failCount} failures). Rolling back ${createdLdapAccounts.length} AD and ${createdVpnAccounts.length} VPN accounts.`);

      // Update batch status to rolling_back
      const rollbackClaimId = randomUUID();
      const rollbackClaim = await prisma.batchAccountCreation.updateMany({
        where: { id: batch.id, status: 'processing', processingClaimId },
        data: {
          status: 'rolling_back',
          processingClaimId: rollbackClaimId,
          processingClaimedUntil: new Date(Date.now() + BATCH_PROCESSING_LEASE_MS),
        },
      });
      if (rollbackClaim.count !== 1) {
        throw new BatchProcessingLeaseLostError(`Batch ${batch.id} processing lease was lost`);
      }

      await prisma.batchAuditLog.create({
        data: {
          batchId: batch.id,
          action: 'batch_rollback_started',
          details: `Batch partially failed. Rolling back ${createdLdapAccounts.length} AD and ${createdVpnAccounts.length} VPN accounts.`,
          performedBy: admin.username,
          success: true,
        },
      });

      // Perform rollback
      const rollbackResult = await prisma.$transaction(async tx => {
        const usernames = [...new Set(createdLdapAccounts.map(target => target.username.trim().toLowerCase()))].sort();
        for (const username of usernames) {
          await tx.$queryRaw<Array<{ lock_acquired: string }>>`
            SELECT 'locked'::text AS lock_acquired
            FROM pg_advisory_xact_lock(hashtextextended(${username}, 873211))
          `;
        }
        return rollbackBatchAccounts(createdLdapAccounts, batch.id);
      }, { timeout: BATCH_PROCESSING_LEASE_MS });
      const vpnRollbackResult = await rollbackBatchVpnAccounts(
        createdVpnAccounts,
        batch.id,
        admin.username
      );

      if (rollbackResult.successful.length > 0) {
        await prisma.batchAccountItem.updateMany({
          where: {
            batchId: batch.id,
            accountType: 'AD',
            ldapUsername: { in: rollbackResult.successful },
          },
          data: { status: 'rolled_back', errorMessage: 'Account rolled back due to batch failure' },
        });

        const rolledBackItems = await prisma.batchAccountItem.findMany({
          where: {
            batchId: batch.id,
            accountType: 'AD',
            ldapUsername: { in: rollbackResult.successful },
            accessRequestId: { not: null },
          },
          select: { accessRequestId: true },
        });
        const rolledBackRequestIds = rolledBackItems
          .map(item => item.accessRequestId)
          .filter((id): id is string => Boolean(id));
        if (rolledBackRequestIds.length > 0) {
          await prisma.accessRequest.updateMany({
            where: { id: { in: rolledBackRequestIds } },
            data: {
              status: 'rejected',
              rejectedAt: new Date(),
              rejectedBy: admin.username,
              rejectionReason: `Rolled back with batch ${batch.id}`,
              provisioningState: 'batch_rolled_back',
              provisioningCompletedAt: new Date(),
              provisioningError: 'Directory account was removed because another batch item failed',
              adAccountStatus: 'deleted',
            },
          });
        }
      }
      for (const failedRollback of rollbackResult.failed) {
        await prisma.batchAccountItem.updateMany({
          where: { batchId: batch.id, accountType: 'AD', ldapUsername: failedRollback.username },
          data: {
            status: 'reconciliation_required',
            errorMessage: `${failedRollback.outcome}: ${failedRollback.error}`,
          },
        });

        const unresolvedItem = await prisma.batchAccountItem.findFirst({
          where: {
            batchId: batch.id,
            accountType: 'AD',
            ldapUsername: failedRollback.username,
          },
          select: { accessRequestId: true },
        });
        if (unresolvedItem?.accessRequestId) {
          await prisma.accessRequest.updateMany({
            where: { id: unresolvedItem.accessRequestId },
            data: {
              provisioningState: 'reconciliation_required',
              provisioningCompletedAt: new Date(),
              provisioningError: `${failedRollback.outcome}: ${failedRollback.error}`,
            },
          });
        }
      }
      if (vpnRollbackResult.successful.length > 0) {
        await prisma.batchAccountItem.updateMany({
          where: {
            batchId: batch.id,
            accountType: 'VPN',
            vpnUsername: { in: vpnRollbackResult.successful },
          },
          data: { status: 'rolled_back', errorMessage: 'VPN account revoked due to batch failure' },
        });
      }
      for (const failedRollback of vpnRollbackResult.failed) {
        await prisma.batchAccountItem.updateMany({
          where: { batchId: batch.id, accountType: 'VPN', vpnUsername: failedRollback.username },
          data: {
            status: 'reconciliation_required',
            errorMessage: `${failedRollback.outcome}: ${failedRollback.error}`,
          },
        });
      }

      const rollbackResolved =
        !unresolvedDirectoryOutcome
        && rollbackResult.failed.length === 0
        && vpnRollbackResult.failed.length === 0;
      await prisma.batchAuditLog.create({
        data: {
          batchId: batch.id,
          action: rollbackResolved ? 'batch_rollback_completed' : 'batch_rollback_partial',
          details: rollbackResolved
            ? `All ${rollbackResult.successful.length} AD and ${vpnRollbackResult.successful.length} VPN targets were resolved.`
            : `${rollbackResult.failed.length} AD and ${vpnRollbackResult.failed.length} VPN targets require reconciliation.`,
          performedBy: admin.username,
          success: rollbackResolved,
        },
      });
      const rollbackFinalized = await prisma.batchAccountCreation.updateMany({
        where: { id: batch.id, status: 'rolling_back', processingClaimId: rollbackClaimId },
        data: {
          successfulAccounts: 0, // All were rolled back
          failedAccounts: totalAccounts,
          status: rollbackResolved ? 'failed' : 'reconciliation_required',
          processingClaimId: null,
          processingClaimedUntil: null,
          completedAt: new Date(),
        },
      });
      if (rollbackFinalized.count !== 1) {
        throw new BatchProcessingLeaseLostError(`Batch ${batch.id} rollback lease was lost`);
      }
      const updatedBatch = await prisma.batchAccountCreation.findUnique({
        where: { id: batch.id },
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
      if (!updatedBatch) {
        throw new Error(`Batch ${batch.id} could not be loaded after rollback`);
      }

      return NextResponse.json(
        {
          success: false,
          error: rollbackResolved
            ? 'Batch partially failed. All created accounts were reconciled; the batch may be retried.'
            : 'Batch partially failed and one or more directory accounts require manual reconciliation. Do not retry yet.',
          batch: {
            ...updatedBatch,
            accounts: stripPasswords(updatedBatch.accounts),
          },
          rollback: {
            successful: [
              ...rollbackResult.successful.map(username => ({ username, accountType: 'AD' })),
              ...vpnRollbackResult.successful.map(username => ({ username, accountType: 'VPN' })),
            ],
            failed: [
              ...rollbackResult.failed.map(item => ({ ...item, accountType: 'AD' })),
              ...vpnRollbackResult.failed.map(item => ({ ...item, accountType: 'VPN' })),
            ],
          },
          summary: {
            total: totalAccounts,
            successful: 0,
            failed: totalAccounts,
            rolledBack: rollbackResult.successful.length + vpnRollbackResult.successful.length,
          },
        },
        { status: 400 }
      );
    }

    if (failCount > 0) {
      const failedBatch = await withProcessingLease(tx => tx.batchAccountCreation.update({
          where: { id: batch.id },
          data: {
            successfulAccounts: 0,
            failedAccounts: failCount,
            status: unresolvedDirectoryOutcome ? 'reconciliation_required' : 'failed',
            processingClaimId: null,
            processingClaimedUntil: null,
            completedAt: new Date(),
          },
          include: {
            accounts: true,
            auditLogs: { orderBy: { createdAt: 'asc' } },
            linkedTicket: { select: { id: true, subject: true, status: true } },
          },
        }));
      return NextResponse.json(
        {
          success: false,
          error: unresolvedDirectoryOutcome
            ? 'Batch failed with an unknown directory outcome and requires reconciliation. Do not retry yet.'
            : 'Batch failed before any account was created.',
          batch: { ...failedBatch, accounts: stripPasswords(failedBatch.accounts) },
          summary: { total: totalAccounts, successful: 0, failed: failCount, rolledBack: 0 },
        },
        { status: 400 }
      );
    }

    // Update batch with final counts (all succeeded)
    const updatedBatch = await withProcessingLease(tx => tx.batchAccountCreation.update({
        where: { id: batch.id },
        data: {
          successfulAccounts: successCount,
          failedAccounts: failCount,
          status: 'completed',
          processingClaimId: null,
          processingClaimedUntil: null,
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
      }));

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
