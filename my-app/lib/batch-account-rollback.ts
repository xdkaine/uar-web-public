import { deleteLDAPUser, searchLDAPUser } from '@/lib/ldap';
import { formatRequestDescription } from '@/lib/ldap/utils';

export type BatchRollbackOutcome =
  | 'deleted'
  | 'already_absent'
  | 'ownership_mismatch'
  | 'account_enabled'
  | 'account_state_unknown'
  | 'lookup_failed'
  | 'delete_failed';

export interface BatchRollbackItemResult {
  username: string;
  outcome: BatchRollbackOutcome;
  resolved: boolean;
  error?: string;
}

export interface BatchRollbackResult {
  successful: string[];
  failed: Array<{ username: string; error: string; outcome: BatchRollbackOutcome }>;
  items: BatchRollbackItemResult[];
}

export interface BatchRollbackTarget {
  username: string;
  accessRequestId?: string | null;
  targetDirectoryDn?: string | null;
  targetDirectoryObjectGuid?: string | null;
}

function getAttribute(
  user: { attributes: Array<{ type: string; values: string[] }> },
  type: string
): string {
  return user.attributes.find(attribute => attribute.type === type)?.values[0] ?? '';
}

function accountEnabledState(userAccountControl: string): boolean | null {
  const value = Number.parseInt(userAccountControl, 10);
  return Number.isFinite(value) ? (value & 2) === 0 : null;
}

export async function rollbackBatchAccounts(
  targets: Array<string | BatchRollbackTarget>,
  batchId: string
): Promise<BatchRollbackResult> {
  const items = await Promise.all(targets.map(async (target): Promise<BatchRollbackItemResult> => {
    const rollbackTarget: BatchRollbackTarget = typeof target === 'string'
      ? { username: target }
      : target;
    const username = rollbackTarget.username;
    let user;
    try {
      user = await searchLDAPUser(username);
    } catch {
      return {
        username,
        outcome: 'lookup_failed',
        resolved: false,
        error: 'Directory lookup failed; account state is unresolved',
      };
    }

    if (!user) {
      return { username, outcome: 'already_absent', resolved: true };
    }

    const hasImmutableEvidence = Boolean(
      rollbackTarget.targetDirectoryDn && rollbackTarget.targetDirectoryObjectGuid
    );
    if (hasImmutableEvidence) {
      const objectGuid = getAttribute(user, 'objectGUID');
      if (
        user.objectName.toLowerCase() !== rollbackTarget.targetDirectoryDn!.toLowerCase()
        || objectGuid !== rollbackTarget.targetDirectoryObjectGuid
      ) {
        return {
          username,
          outcome: 'ownership_mismatch',
          resolved: false,
          error: 'Live directory identity does not match the batch creation evidence',
        };
      }
    } else if (typeof target !== 'string') {
      return {
        username,
        outcome: 'ownership_mismatch',
        resolved: false,
        error: 'Batch item has no immutable directory identity evidence',
      };
    } else if (getAttribute(user, 'description').trim() !== formatRequestDescription(batchId)) {
      return {
        username,
        outcome: 'ownership_mismatch',
        resolved: false,
        error: 'Legacy account does not have the exact batch creation correlation',
      };
    }

    const accountEnabled = accountEnabledState(getAttribute(user, 'userAccountControl'));
    if (accountEnabled === null) {
      return {
        username,
        outcome: 'account_state_unknown',
        resolved: false,
        error: 'Account enabled state is missing or invalid',
      };
    }

    if (accountEnabled) {
      return {
        username,
        outcome: 'account_enabled',
        resolved: false,
        error: 'Account is enabled and requires manual reconciliation',
      };
    }

    try {
      if (hasImmutableEvidence) {
        await deleteLDAPUser(
          username,
          rollbackTarget.accessRequestId || undefined,
          false,
          {
            dn: rollbackTarget.targetDirectoryDn!,
            objectGuid: rollbackTarget.targetDirectoryObjectGuid!,
          }
        );
      } else {
        await deleteLDAPUser(username, batchId, false);
      }
      return { username, outcome: 'deleted', resolved: true };
    } catch {
      return {
        username,
        outcome: 'delete_failed',
        resolved: false,
        error: 'Directory deletion failed; account state is unresolved',
      };
    }
  }));

  return {
    successful: items.filter(item => item.resolved).map(item => item.username),
    failed: items
      .filter(item => !item.resolved)
      .map(item => ({
        username: item.username,
        error: item.error ?? 'Account state is unresolved',
        outcome: item.outcome,
      })),
    items,
  };
}
