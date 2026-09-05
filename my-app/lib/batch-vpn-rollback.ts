import { prisma } from '@/lib/prisma';

export type BatchVpnRollbackOutcome =
  | 'revoked'
  | 'already_absent'
  | 'already_revoked'
  | 'ownership_mismatch'
  | 'account_state_unknown'
  | 'lookup_failed'
  | 'revoke_failed';

export interface BatchVpnRollbackItemResult {
  username: string;
  outcome: BatchVpnRollbackOutcome;
  resolved: boolean;
  error?: string;
}

export interface BatchVpnRollbackResult {
  successful: string[];
  failed: Array<{ username: string; error: string; outcome: BatchVpnRollbackOutcome }>;
  items: BatchVpnRollbackItemResult[];
}

export async function rollbackBatchVpnAccounts(
  usernames: string[],
  batchId: string,
  performedBy: string
): Promise<BatchVpnRollbackResult> {
  const items: BatchVpnRollbackItemResult[] = [];

  for (const username of usernames) {
    let account;
    try {
      account = await prisma.vPNAccount.findUnique({
        where: { username },
        select: { id: true, username: true, batchId: true, status: true },
      });
    } catch {
      items.push({
        username,
        outcome: 'lookup_failed',
        resolved: false,
        error: 'VPN account lookup failed; account state is unresolved',
      });
      continue;
    }

    if (!account) {
      items.push({ username, outcome: 'already_absent', resolved: true });
      continue;
    }
    if (account.batchId !== batchId) {
      items.push({
        username,
        outcome: 'ownership_mismatch',
        resolved: false,
        error: 'VPN account is not owned by this batch',
      });
      continue;
    }
    if (account.status === 'revoked') {
      items.push({ username, outcome: 'already_revoked', resolved: true });
      continue;
    }
    if (account.status !== 'active') {
      items.push({
        username,
        outcome: 'account_state_unknown',
        resolved: false,
        error: `VPN account state ${account.status} requires manual reconciliation`,
      });
      continue;
    }

    try {
      const revokedAt = new Date();
      const revoked = await prisma.$transaction(async tx => {
        const claim = await tx.vPNAccount.updateMany({
          where: { id: account.id, username, batchId, status: 'active' },
          data: {
            status: 'revoked',
            revokedAt,
            revokedBy: performedBy,
            revokedReason: `Rolled back batch ${batchId}`,
            canRestore: false,
          },
        });
        if (claim.count !== 1) {
          return false;
        }
        await tx.vPNAccountStatusLog.create({
          data: {
            accountId: account.id,
            liveAccountId: account.id,
            oldStatus: 'active',
            newStatus: 'revoked',
            changedBy: performedBy,
            reason: `Rolled back batch ${batchId}`,
          },
        });
        return true;
      });
      if (!revoked) {
        items.push({
          username,
          outcome: 'revoke_failed',
          resolved: false,
          error: 'VPN account changed during rollback',
        });
        continue;
      }
      items.push({ username, outcome: 'revoked', resolved: true });
    } catch {
      items.push({
        username,
        outcome: 'revoke_failed',
        resolved: false,
        error: 'VPN revocation failed; account state is unresolved',
      });
    }
  }

  return {
    successful: items.filter(item => item.resolved).map(item => item.username),
    failed: items.filter(item => !item.resolved).map(item => ({
      username: item.username,
      error: item.error ?? 'VPN account state is unresolved',
      outcome: item.outcome,
    })),
    items,
  };
}
