import type { AccessRequest, AccountLifecycleAction, AccountLifecycleBatch, OffboardCampaign, Prisma, VPNAccount } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { disableLDAPUser, enableLDAPUser, appendADDescription } from '@/lib/ldap';
import { appLogger } from '@/lib/logger';
import { logActionHistoryEvent } from '@/lib/action-history';
import { AuditActions, AuditCategories } from '@/lib/audit-log';

export interface ProcessResult {
  success: boolean;
  actionId: string;
  error?: string;
  adCompleted?: boolean;
  vpnCompleted?: boolean;
}

type VpnOperation = 'revoke' | 'restore';

interface CombinedVpnResult {
  username: string | null;
  skippedReason?: string;
}

type LifecycleAction = AccountLifecycleAction & {
  batch?: AccountLifecycleBatch | null;
  offboardCampaign?: OffboardCampaign | null;
};

type LdapErrorLike = {
  code?: number | string;
};

const INACTIVE_VPN_STATUSES = new Set(['revoked', 'disabled']);

function auditActionForLifecycleType(actionType: string): string {
  switch (actionType) {
    case 'disable_ad':
    case 'disable_both':
      return AuditActions.DISABLE_AD_ACCOUNT;
    case 'enable_ad':
    case 'enable_both':
      return AuditActions.ENABLE_AD_ACCOUNT;
    case 'revoke_vpn':
      return AuditActions.REVOKE_VPN_ACCESS;
    case 'restore_vpn':
      return AuditActions.RESTORE_VPN_ACCESS;
    case 'promote_vpn_role':
      return AuditActions.PROMOTE_VPN_ROLE;
    case 'demote_vpn_role':
      return AuditActions.DEMOTE_VPN_ROLE;
    default:
      return AuditActions.PROCESS_LIFECYCLE_ACTION;
  }
}

async function logLifecycleActionHistory(
  action: LifecycleAction,
  lifecycleEvent: 'processing' | 'completed' | 'failed',
  outcome: 'pending' | 'success' | 'failure',
  details: Record<string, unknown>,
  errorMessage?: string
) {
  await logActionHistoryEvent({
    action: auditActionForLifecycleType(action.actionType),
    category: AuditCategories.LIFECYCLE,
    username: 'system',
    actorType: 'system',
    targetId: action.id,
    targetType: 'AccountLifecycleAction',
    subjectUsername: action.targetUsername,
    relatedRequestId: action.relatedRequestId,
    relatedVpnAccountId: action.targetAccountType === 'VPN' ? action.targetUserId : null,
    relatedLifecycleActionId: action.id,
    eventKind: 'lifecycle',
    outcome,
    success: outcome !== 'failure',
    errorMessage,
    details: {
      lifecycleEvent,
      actionType: action.actionType,
      targetAccountType: action.targetAccountType,
      requestedBy: action.requestedBy,
      reason: action.reason,
      batchId: action.batchId,
      offboardCampaignId: action.offboardCampaignId,
      ...details,
    },
    correlationId: `lifecycle:${action.id}`,
  });
}

export async function processLifecycleAction(actionId: string): Promise<ProcessResult> {
  let action = await prisma.accountLifecycleAction.findUnique({
    where: { id: actionId },
    include: { batch: true, offboardCampaign: true },
  });

  if (!action) {
    throw new Error(`Action ${actionId} not found`);
  }

  if (action.status === 'queued') {
    const claimed = await prisma.accountLifecycleAction.updateMany({
      where: { id: actionId, status: 'queued' },
      data: {
        status: 'processing',
        processedAt: new Date(),
        processedBy: 'system',
      },
    });

    if (claimed.count !== 1) {
      throw new Error(`Action ${actionId} could not be claimed for processing`);
    }

    action = await prisma.accountLifecycleAction.findUnique({
      where: { id: actionId },
      include: { batch: true, offboardCampaign: true },
    });

    if (!action) {
      throw new Error(`Action ${actionId} not found after queue claim`);
    }
  }

  if (action.status !== 'processing') {
    throw new Error(`Action ${actionId} is not in processing state: ${action.status}`);
  }

  const originalStatus = action.status;
  let adCompleted = false;
  let vpnCompleted = false;
  let completionDetails: Record<string, unknown> = {};
  let errorMessage: string | undefined;

  try {
    ensureOffboardLifecycleActionAllowed(action);

    await prisma.accountLifecycleHistory.create({
      data: {
        actionId,
        event: 'processing',
        performedBy: 'system',
        previousStatus: originalStatus,
        newStatus: 'processing',
      },
    });

    await logLifecycleActionHistory(action, 'processing', 'pending', { previousStatus: originalStatus });

    switch (action.actionType) {
      case 'disable_ad':
        await disableADAccount(action);
        adCompleted = true;
        completionDetails = {
          ...completionDetails,
          sessionCleanup: await cleanupManualDisabledAdSessions(action),
        };
        break;

      case 'disable_both': {
        const accessRequest = await disableADAccount(action);
        adCompleted = true;

        const vpnResult = await revokeLinkedVPNForCombinedAction(action, accessRequest);
        vpnCompleted = Boolean(vpnResult.username && !vpnResult.skippedReason);

        completionDetails = {
          ...completionDetails,
          linkedVpnUsername: vpnResult.username,
          linkedVpnSkippedReason: vpnResult.skippedReason,
          manualOffboard: await markManualAccessRequestOffboarded(action, accessRequest),
          sessionCleanup: await cleanupManualDisabledAdSessions(action),
        };
        break;
      }

      case 'enable_ad':
        await enableADAccount(action);
        adCompleted = true;
        break;

      case 'enable_both': {
        const accessRequest = await enableADAccount(action);
        adCompleted = true;

        const vpnResult = await restoreLinkedVPNForCombinedAction(action, accessRequest);
        vpnCompleted = Boolean(vpnResult.username && !vpnResult.skippedReason);

        completionDetails = {
          ...completionDetails,
          linkedVpnUsername: vpnResult.username,
          linkedVpnSkippedReason: vpnResult.skippedReason,
        };
        break;
      }

      case 'revoke_vpn':
        await revokeVPNAccess(action);
        vpnCompleted = true;
        break;

      case 'restore_vpn':
        await restoreVPNAccess(action);
        vpnCompleted = true;
        break;

      case 'promote_vpn_role':
        await promoteVPNRole(action);
        vpnCompleted = true;
        break;

      case 'demote_vpn_role':
        await demoteVPNRole(action);
        vpnCompleted = true;
        break;

      default:
        throw new Error(`Unknown action type: ${action.actionType}`);
    }

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.accountLifecycleAction.update({
        where: { id: actionId },
        data: {
          status: 'completed',
          completedAt: new Date(),
          adDisabled: adCompleted,
          vpnDisabled: vpnCompleted,
        },
      });

      await tx.accountLifecycleHistory.create({
        data: {
          actionId,
          event: 'completed',
          performedBy: 'system',
          previousStatus: 'processing',
          newStatus: 'completed',
          details: JSON.stringify({ adCompleted, vpnCompleted, ...completionDetails }),
        },
      });

      if (action.batchId) {
        const batch = await tx.accountLifecycleBatch.findUnique({
          where: { id: action.batchId },
        });
        
        if (batch) {
          await tx.accountLifecycleBatch.update({
            where: { id: action.batchId },
            data: {
              completedActions: { increment: 1 },
              status: batch.completedActions + 1 >= batch.totalActions ? 'completed' : 'processing',
              completedAt: batch.completedActions + 1 >= batch.totalActions ? new Date() : null,
            },
          });
        }
      }
    });

    appLogger.info('Lifecycle action completed', {
      actionId,
      actionType: action.actionType,
      targetUsername: action.targetUsername,
    });

    await logLifecycleActionHistory(action, 'completed', 'success', { adCompleted, vpnCompleted, ...completionDetails });

    return { success: true, actionId, adCompleted, vpnCompleted };
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : 'Unknown error';

    // PostgreSQL rejects some control characters in error text, so strip them before persisting.
    errorMessage = errorMessage
      .replace(/\0/g, '')
      .replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '')
      .substring(0, 5000);
    
    try {
      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.accountLifecycleAction.update({
          where: { id: actionId },
          data: {
            status: 'failed',
            errorMessage,
            completedAt: new Date(),
            adDisabled: adCompleted,
            vpnDisabled: vpnCompleted,
          },
        });

        await tx.accountLifecycleHistory.create({
          data: {
            actionId,
            event: 'failed',
            performedBy: 'system',
            previousStatus: 'processing',
            newStatus: 'failed',
            details: JSON.stringify({ error: errorMessage, adCompleted, vpnCompleted }),
          },
        });

        if (action.batchId) {
          await tx.accountLifecycleBatch.update({
            where: { id: action.batchId },
            data: {
              failedActions: { increment: 1 },
              completedActions: { increment: 1 },
            },
          });
        }
      });
    } catch (txError) {
      appLogger.error('Failed to record action failure in database', {
        actionId,
        originalError: errorMessage,
        transactionError: txError instanceof Error ? txError.message : 'Unknown',
      });
      
      try {
        await prisma.accountLifecycleAction.update({
          where: { id: actionId },
          data: {
            status: originalStatus,
            processedAt: null,
            processedBy: null,
          },
        });
      } catch (rollbackError) {
        appLogger.error('Failed to rollback action state', {
          actionId,
          error: rollbackError instanceof Error ? rollbackError.message : 'Unknown',
        });
      }
    }

    appLogger.error('Lifecycle action failed', {
      actionId,
      actionType: action.actionType,
      targetUsername: action.targetUsername,
      error: errorMessage,
    });

    await logLifecycleActionHistory(action, 'failed', 'failure', { adCompleted, vpnCompleted }, errorMessage);

    return { success: false, actionId, error: errorMessage, adCompleted, vpnCompleted };
  }
}

function ensureOffboardLifecycleActionAllowed(action: LifecycleAction): void {
  const campaign = action.offboardCampaign;
  if (!campaign) {
    return;
  }

  const rollbackActions = new Set(['enable_ad', 'enable_both', 'restore_vpn']);
  if (rollbackActions.has(action.actionType)) {
    return;
  }

  if (campaign.cancelledAt || campaign.status === 'cancelled') {
    throw new Error(`Campaign-linked lifecycle action blocked because campaign ${campaign.id} is cancelled`);
  }

  if (campaign.emergencyStoppedAt) {
    throw new Error(`Campaign-linked lifecycle action blocked because campaign ${campaign.id} is emergency-stopped`);
  }

  const enforcementActions = new Set(['disable_ad', 'disable_both', 'revoke_vpn']);
  if (campaign.enforcementPaused && enforcementActions.has(action.actionType)) {
    throw new Error(`Campaign-linked enforcement action blocked because campaign ${campaign.id} enforcement is paused`);
  }
}

async function findAccessRequestForADAction(action: LifecycleAction, includeOffboarded = false): Promise<AccessRequest | null> {
  if (action.relatedRequestId) {
    return await prisma.accessRequest.findUnique({
      where: { id: action.relatedRequestId },
    });
  }

  return await prisma.accessRequest.findFirst({
    where: {
      OR: [
        { ldapUsername: action.targetUsername },
        { linkedAdUsername: action.targetUsername },
      ],
      status: includeOffboarded ? { not: 'rejected' } : { notIn: ['rejected', 'offboarded'] },
    },
    orderBy: { createdAt: 'desc' },
  });
}

async function findLinkedVPNAccountForADAction(
  action: LifecycleAction,
  accessRequest: AccessRequest | null,
  operation: VpnOperation
): Promise<VPNAccount | null> {
  const candidateUsernames = Array.from(new Set([
    accessRequest?.linkedVpnUsername,
    accessRequest?.vpnUsername,
    action.targetUsername,
  ].filter((value): value is string => typeof value === 'string' && value.length > 0)));

  for (const username of candidateUsernames) {
    const vpnAccount = await prisma.vPNAccount.findUnique({
      where: { username },
    });

    if (vpnAccount) {
      return vpnAccount;
    }
  }

  const linkedWhere: Prisma.VPNAccountWhereInput[] = [];
  if (accessRequest?.id) {
    linkedWhere.push({ accessRequestId: accessRequest.id });
  }
  linkedWhere.push({ adUsername: action.targetUsername });

  if (linkedWhere.length === 0) {
    return null;
  }

  const linkedAccounts = await prisma.vPNAccount.findMany({
    where: { OR: linkedWhere },
    orderBy: { updatedAt: 'desc' },
    take: 10,
  });

  const preferred = linkedAccounts.find((vpnAccount: VPNAccount) => {
    if (operation === 'revoke') {
      return !INACTIVE_VPN_STATUSES.has(vpnAccount.status);
    }
    return vpnAccount.status === 'revoked';
  });

  return preferred || linkedAccounts[0] || null;
}

async function revokeLinkedVPNForCombinedAction(action: LifecycleAction, accessRequest: AccessRequest | null): Promise<CombinedVpnResult> {
  const vpnAccount = await findLinkedVPNAccountForADAction(action, accessRequest, 'revoke');
  if (!vpnAccount) {
    return { username: null, skippedReason: 'no_linked_vpn_account' };
  }

  if (INACTIVE_VPN_STATUSES.has(vpnAccount.status)) {
    return { username: vpnAccount.username, skippedReason: `vpn_already_${vpnAccount.status}` };
  }

  await revokeVPNAccess(action, vpnAccount.username, accessRequest?.id || null);
  return { username: vpnAccount.username };
}

async function restoreLinkedVPNForCombinedAction(action: LifecycleAction, accessRequest: AccessRequest | null): Promise<CombinedVpnResult> {
  const vpnAccount = await findLinkedVPNAccountForADAction(action, accessRequest, 'restore');
  if (!vpnAccount) {
    return { username: null, skippedReason: 'no_linked_vpn_account' };
  }

  if (vpnAccount.status !== 'revoked') {
    return { username: vpnAccount.username, skippedReason: `vpn_not_revoked_${vpnAccount.status}` };
  }

  await restoreVPNAccess(action, vpnAccount.username, accessRequest?.id || null);
  return { username: vpnAccount.username };
}

function isManualAction(action: LifecycleAction): boolean {
  return !action.offboardCampaignId;
}

async function cleanupManualDisabledAdSessions(action: LifecycleAction): Promise<Record<string, unknown> | null> {
  if (!isManualAction(action) || !['disable_ad', 'disable_both'].includes(action.actionType)) {
    return null;
  }

  try {
    const result = await prisma.session.deleteMany({
      where: { username: action.targetUsername },
    });
    return { deletedSessions: result.count };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown session cleanup failure';
    appLogger.warn('Manual lifecycle session cleanup failed', {
      actionId: action.id,
      username: action.targetUsername,
      error: message,
    });
    return { error: message };
  }
}

async function markManualAccessRequestOffboarded(action: LifecycleAction, accessRequest: AccessRequest | null): Promise<Record<string, unknown> | null> {
  if (!isManualAction(action) || action.actionType !== 'disable_both') {
    return null;
  }

  if (!accessRequest?.id) {
    return { requestMarkedOffboarded: false, skippedReason: 'no_access_request' };
  }

  const offboardedAt = new Date();
  const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const update = await tx.accessRequest.updateMany({
      where: {
        id: accessRequest.id,
        status: 'approved',
      },
      data: {
        status: 'offboarded',
        accountExpiresAt: offboardedAt,
        version: { increment: 1 },
      },
    });

    if (update.count !== 1) {
      return false;
    }

    await tx.requestComment.create({
      data: {
        requestId: accessRequest.id,
        author: action.requestedBy,
        type: 'manual_offboard',
        comment: `Manual account lifecycle offboard completed for ${action.targetUsername}. Access was disabled/revoked, but this does not block future re-enrollment unless the email is on the block list.`,
      },
    });

    return true;
  });

  return {
    requestMarkedOffboarded: result,
    accessRequestId: accessRequest.id,
    skippedReason: result ? undefined : `request_status_${accessRequest.status || 'unknown'}`,
  };
}

async function disableADAccount(action: LifecycleAction): Promise<AccessRequest> {
  const username = action.targetUsername;
  
  const accessRequest = await findAccessRequestForADAction(action);

  if (!accessRequest) {
    throw new Error(`No AccessRequest found for AD username: ${username}`);
  }

  let ldapSuccess = false;
  let ldapErrorMsg: string | undefined;

  try {
    await disableLDAPUser(username);
    
    const noteDetails = [];
    if (action.relatedTicketId) {
      noteDetails.push(`Ticket #${action.relatedTicketId}`);
    }
    if (action.relatedRequestId) {
      noteDetails.push(`Request ${action.relatedRequestId}`);
    }
    const ticketInfo = noteDetails.length > 0 ? ` - ${noteDetails.join(', ')}` : '';
    await appendADDescription(username, `Disabled by UAR${ticketInfo}`);
    
    ldapSuccess = true;
    appLogger.info('Successfully disabled AD account in LDAP', { username });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const ldapError = error as LdapErrorLike;
    const isNotFoundError = 
      errorMessage.includes('not found in directory') ||
      errorMessage.includes('NO_OBJECT') ||
      errorMessage.includes('problem 2001') ||
      ldapError?.code === 32 ||
      ldapError?.code === '32';
    
    if (isNotFoundError) {
      appLogger.warn('AD account not found in LDAP, updating database status only', { 
        username, 
        error: errorMessage 
      });
      ldapErrorMsg = errorMessage;
    } else {
      throw error;
    }
  }

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.accessRequest.update({
      where: { id: accessRequest.id },
      data: {
        adAccountStatus: 'disabled',
        adDisabledAt: new Date(),
        adDisabledBy: action.requestedBy,
        adDisabledReason: action.reason,
      },
    });

    await tx.aDAccountActivityLog.create({
      data: {
        accountId: accessRequest.id,
        accountUsername: username,
        accountName: accessRequest.name,
        accountEmail: accessRequest.email,
        actionType: 'disabled',
        performedBy: action.requestedBy,
        reason: action.reason,
        lifecycleActionId: action.id,
        notes: action.notes,
        ldapSuccess,
        ldapError: ldapErrorMsg,
      },
    });
  });

  appLogger.info('AD account disabled', { username, reason: action.reason });
  return accessRequest;
}

async function enableADAccount(action: LifecycleAction): Promise<AccessRequest> {
  const username = action.targetUsername;
  
  const accessRequest = await findAccessRequestForADAction(action, true);

  if (!accessRequest) {
    throw new Error(`No AccessRequest found for AD username: ${username}`);
  }

  if (accessRequest.adAccountStatus !== 'disabled') {
    // Keep going so a stale DB flag does not block recovery of the live directory account.
    appLogger.warn('Account not in disabled state in database, attempting enable anyway', { 
      username, 
      currentStatus: accessRequest.adAccountStatus 
    });
  }

  let ldapSuccess = false;
  let ldapErrorMsg: string | undefined;

  try {
    await enableLDAPUser(username);
    
    const noteDetails = [];
    if (action.relatedTicketId) {
      noteDetails.push(`Ticket #${action.relatedTicketId}`);
    }
    if (action.relatedRequestId) {
      noteDetails.push(`Request ${action.relatedRequestId}`);
    }
    const ticketInfo = noteDetails.length > 0 ? ` - ${noteDetails.join(', ')}` : '';
    await appendADDescription(username, `Enabled by UAR${ticketInfo}`);
    
    ldapSuccess = true;
    appLogger.info('Successfully enabled AD account in LDAP', { username });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const ldapError = error as LdapErrorLike;
    const isNotFoundError = 
      errorMessage.includes('not found in directory') ||
      errorMessage.includes('NO_OBJECT') ||
      errorMessage.includes('problem 2001') ||
      ldapError?.code === 32 ||
      ldapError?.code === '32';
    
    if (isNotFoundError) {
      ldapErrorMsg = `Cannot enable account - AD user '${username}' does not exist in LDAP directory (NO_OBJECT error)`;
      throw new Error(ldapErrorMsg);
    }
    throw error;
  }

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.accessRequest.update({
      where: { id: accessRequest.id },
      data: {
        adAccountStatus: 'active',
        adEnabledAt: new Date(),
        adEnabledBy: action.requestedBy,
      },
    });

    await tx.aDAccountActivityLog.create({
      data: {
        accountId: accessRequest.id,
        accountUsername: username,
        accountName: accessRequest.name,
        accountEmail: accessRequest.email,
        actionType: 'enabled',
        performedBy: action.requestedBy,
        reason: action.reason,
        lifecycleActionId: action.id,
        notes: action.notes,
        ldapSuccess,
        ldapError: ldapErrorMsg,
      },
    });
  });

  appLogger.info('AD account enabled', { username });
  return accessRequest;
}

async function revokeVPNAccess(action: LifecycleAction, usernameOverride?: string | null, accessRequestIdOverride?: string | null): Promise<void> {
  const username = usernameOverride || action.targetUsername;
  const relatedRequestId = accessRequestIdOverride || action.relatedRequestId || null;
  
  const vpnAccount = await prisma.vPNAccount.findUnique({
    where: { username },
  });

  if (!vpnAccount) {
    throw new Error(`No VPN account found for username: ${username}`);
  }

  if (vpnAccount.status === 'revoked') {
    throw new Error(`VPN account ${username} is already revoked`);
  }

  const noteDetails = [];
  if (action.relatedTicketId) {
    noteDetails.push(`Ticket #${action.relatedTicketId}`);
  }
  if (relatedRequestId) {
    noteDetails.push(`Request ${relatedRequestId}`);
  }
  const ticketInfo = noteDetails.length > 0 ? ` - ${noteDetails.join(', ')}` : '';
  const detailedReason = `${action.reason}${ticketInfo}`;

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.vPNAccount.update({
      where: { username },
      data: {
        status: 'revoked',
        revokedAt: new Date(),
        revokedBy: action.requestedBy,
        revokedReason: detailedReason,
        canRestore: action.canRestore ?? true,
      },
    });

    await tx.vPNAccountStatusLog.create({
      data: {
        accountId: vpnAccount.id,
        oldStatus: vpnAccount.status,
        newStatus: 'revoked',
        changedBy: action.requestedBy,
        reason: detailedReason,
      },
    });

    await tx.vPNAccountActivityLog.create({
      data: {
        accountId: vpnAccount.id,
        accountUsername: username,
        accountName: vpnAccount.name,
        accountEmail: vpnAccount.email,
        actionType: 'revoked',
        performedBy: action.requestedBy,
        reason: action.reason,
        lifecycleActionId: action.id,
        notes: action.notes,
      },
    });

    const accessRequestId = vpnAccount.accessRequestId || relatedRequestId;
    if (accessRequestId) {
      await tx.accessRequest.update({
        where: { id: accessRequestId },
        data: {
          vpnAccountStatus: 'revoked',
          vpnRevokedAt: new Date(),
          vpnRevokedBy: action.requestedBy,
          vpnRevokedReason: detailedReason,
        },
      });
    }
  });

  appLogger.info('VPN access revoked', { username, reason: detailedReason });
}

async function restoreVPNAccess(action: LifecycleAction, usernameOverride?: string | null, accessRequestIdOverride?: string | null): Promise<void> {
  const username = usernameOverride || action.targetUsername;
  const relatedRequestId = accessRequestIdOverride || action.relatedRequestId || null;
  
  const vpnAccount = await prisma.vPNAccount.findUnique({
    where: { username },
  });

  if (!vpnAccount) {
    throw new Error(`No VPN account found for username: ${username}`);
  }

  if (vpnAccount.status !== 'revoked') {
    throw new Error(`VPN account ${username} is not in revoked state, current status: ${vpnAccount.status}`);
  }

  if (!vpnAccount.canRestore) {
    throw new Error(`VPN account ${username} cannot be restored`);
  }

  const noteDetails = [];
  if (action.relatedTicketId) {
    noteDetails.push(`Ticket #${action.relatedTicketId}`);
  }
  if (relatedRequestId) {
    noteDetails.push(`Request ${relatedRequestId}`);
  }
  const ticketInfo = noteDetails.length > 0 ? ` - ${noteDetails.join(', ')}` : '';
  const detailedReason = `Restored: ${action.reason}${ticketInfo}`;

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.vPNAccount.update({
      where: { username },
      data: {
        status: 'active',
        restoredAt: new Date(),
        restoredBy: action.requestedBy,
      },
    });

    await tx.vPNAccountStatusLog.create({
      data: {
        accountId: vpnAccount.id,
        oldStatus: 'revoked',
        newStatus: 'active',
        changedBy: action.requestedBy,
        reason: detailedReason,
      },
    });

    await tx.vPNAccountActivityLog.create({
      data: {
        accountId: vpnAccount.id,
        accountUsername: username,
        accountName: vpnAccount.name,
        accountEmail: vpnAccount.email,
        actionType: 'restored',
        performedBy: action.requestedBy,
        reason: action.reason,
        lifecycleActionId: action.id,
        notes: action.notes,
      },
    });

    const accessRequestId = vpnAccount.accessRequestId || relatedRequestId;
    if (accessRequestId) {
      await tx.accessRequest.update({
        where: { id: accessRequestId },
        data: {
          vpnAccountStatus: 'active',
          vpnRestoredAt: new Date(),
          vpnRestoredBy: action.requestedBy,
        },
      });
    }
  });

  appLogger.info('VPN access restored', { username });
}

async function promoteVPNRole(action: LifecycleAction): Promise<void> {
  const username = action.targetUsername;
  
  const vpnAccount = await prisma.vPNAccount.findUnique({
    where: { username },
  });

  if (!vpnAccount) {
    throw new Error(`No VPN account found for username: ${username}`);
  }

  if (vpnAccount.portalType === 'Management') {
    throw new Error(`VPN account ${username} is already in Management portal`);
  }

  if (vpnAccount.portalType === 'External') {
    throw new Error(`Cannot promote External portal accounts to Management`);
  }

  const previousRole = vpnAccount.portalType;

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.vPNAccount.update({
      where: { username },
      data: {
        portalType: 'Management',
        expiresAt: null,
      },
    });

    await tx.vPNRoleChange.create({
      data: {
        vpnAccountId: vpnAccount.id,
        username,
        previousRole,
        newRole: 'Management',
        changedBy: action.requestedBy,
        reason: action.reason,
        relatedActionId: action.id,
        notes: action.notes,
      },
    });

    await tx.vPNAccountStatusLog.create({
      data: {
        accountId: vpnAccount.id,
        oldStatus: vpnAccount.status,
        newStatus: vpnAccount.status,
        changedBy: action.requestedBy,
        reason: `Role promoted: ${previousRole} -> Management. ${action.reason}`,
      },
    });

    await tx.vPNAccountActivityLog.create({
      data: {
        accountId: vpnAccount.id,
        accountUsername: username,
        accountName: vpnAccount.name,
        accountEmail: vpnAccount.email,
        actionType: 'role_promoted',
        performedBy: action.requestedBy,
        reason: action.reason,
        lifecycleActionId: action.id,
        oldPortalType: previousRole,
        newPortalType: 'Management',
        notes: action.notes,
      },
    });
  });

  appLogger.info('VPN role promoted', { username, from: previousRole, to: 'Management' });
}

async function demoteVPNRole(action: LifecycleAction): Promise<void> {
  const username = action.targetUsername;
  
  const vpnAccount = await prisma.vPNAccount.findUnique({
    where: { username },
  });

  if (!vpnAccount) {
    throw new Error(`No VPN account found for username: ${username}`);
  }

  if (vpnAccount.portalType !== 'Management') {
    throw new Error(`VPN account ${username} is not in Management portal, current: ${vpnAccount.portalType}`);
  }

  const previousRole = vpnAccount.portalType;

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.vPNAccount.update({
      where: { username },
      data: {
        portalType: 'Limited',
      },
    });

    await tx.vPNRoleChange.create({
      data: {
        vpnAccountId: vpnAccount.id,
        username,
        previousRole,
        newRole: 'Limited',
        changedBy: action.requestedBy,
        reason: action.reason,
        relatedActionId: action.id,
        notes: action.notes,
      },
    });

    await tx.vPNAccountStatusLog.create({
      data: {
        accountId: vpnAccount.id,
        oldStatus: vpnAccount.status,
        newStatus: vpnAccount.status,
        changedBy: action.requestedBy,
        reason: `Role demoted: ${previousRole} -> Limited. ${action.reason}`,
      },
    });

    await tx.vPNAccountActivityLog.create({
      data: {
        accountId: vpnAccount.id,
        accountUsername: username,
        accountName: vpnAccount.name,
        accountEmail: vpnAccount.email,
        actionType: 'role_demoted',
        performedBy: action.requestedBy,
        reason: action.reason,
        lifecycleActionId: action.id,
        oldPortalType: previousRole,
        newPortalType: 'Limited',
        notes: action.notes,
      },
    });
  });

  appLogger.info('VPN role demoted', { username, from: previousRole, to: 'Limited' });
}

export async function processNextQueuedAction(): Promise<ProcessResult | null> {
  const nextAction = await prisma.accountLifecycleAction.findFirst({
    where: {
      status: 'queued',
      OR: [
        { scheduledFor: null },
        { scheduledFor: { lte: new Date() } },
      ],
    },
    orderBy: [
      { createdAt: 'asc' },
    ],
  });

  if (!nextAction) {
    return null;
  }

  return await processLifecycleAction(nextAction.id);
}

export async function processAllQueuedActions(): Promise<ProcessResult[]> {
  const results: ProcessResult[] = [];
  
  let nextResult = await processNextQueuedAction();
  while (nextResult) {
    results.push(nextResult);
    
    await new Promise(resolve => setTimeout(resolve, 500));
    
    nextResult = await processNextQueuedAction();
  }

  return results;
}

export async function retryFailedAction(actionId: string): Promise<boolean> {
  try {
    const action = await prisma.accountLifecycleAction.findUnique({
      where: { id: actionId },
    });

    if (!action) {
      throw new Error(`Action ${actionId} not found`);
    }

    if (action.status !== 'failed') {
      throw new Error(`Action ${actionId} is not in failed state (current: ${action.status})`);
    }

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.accountLifecycleAction.update({
        where: { id: actionId },
        data: {
          status: 'queued',
          errorMessage: null,
          processedAt: null,
          processedBy: null,
          completedAt: null,
        },
      });

      await tx.accountLifecycleHistory.create({
        data: {
          actionId,
          event: 'retry',
          performedBy: 'system',
          previousStatus: 'failed',
          newStatus: 'queued',
          details: JSON.stringify({ retryReason: 'Manual retry requested' }),
        },
      });
    });

    appLogger.info('Lifecycle action reset for retry', { actionId });
    return true;
  } catch (error) {
    appLogger.error('Failed to retry action', {
      actionId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return false;
  }
}

export async function cancelLifecycleAction(actionId: string, cancelledBy: string): Promise<boolean> {
  try {
    const action = await prisma.accountLifecycleAction.findUnique({
      where: { id: actionId },
    });

    if (!action) {
      throw new Error(`Action ${actionId} not found`);
    }

    if (action.status !== 'pending' && action.status !== 'queued') {
      throw new Error(`Action ${actionId} cannot be cancelled (current: ${action.status})`);
    }

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.accountLifecycleAction.update({
        where: { id: actionId },
        data: {
          status: 'cancelled',
          completedAt: new Date(),
          notes: `${action.notes || ''}\n[Cancelled by ${cancelledBy}]`.trim(),
        },
      });

      await tx.accountLifecycleHistory.create({
        data: {
          actionId,
          event: 'cancelled',
          performedBy: cancelledBy,
          previousStatus: action.status,
          newStatus: 'cancelled',
        },
      });
    });

    appLogger.info('Lifecycle action cancelled', { actionId, cancelledBy });
    return true;
  } catch (error) {
    appLogger.error('Failed to cancel action', {
      actionId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return false;
  }
}

