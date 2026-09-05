/**
 * Versioned contract for permanent AD deletion.  These values are deliberately
 * shared by plan intake, action intake, processing, and retry so an older
 * confirmation can never start using a newer directory-side method.
 */
export const GOVERNED_DIRECTORY_DELETE_POLICY_VERSION = 'governed-directory-delete-v3';
export const BATCH_GOVERNED_DIRECTORY_DELETE_POLICY_VERSION = 'batch-governed-directory-delete-v2';
export const UNMANAGED_DIRECTORY_DELETE_POLICY_VERSION = 'unmanaged-directory-delete-v2';

export const DIRECTORY_DELETE_METHOD = 'same-connection-final-preflight-immutable-guid-v1';
export const DIRECTORY_DELETE_METHOD_EVIDENCE_KEY = 'directoryDeletionMethod';

export function expectedDirectoryDeletePolicyVersion(operationMode: string): string | null {
  if (operationMode === 'governed') return GOVERNED_DIRECTORY_DELETE_POLICY_VERSION;
  if (operationMode === 'batch_governed') return BATCH_GOVERNED_DIRECTORY_DELETE_POLICY_VERSION;
  if (operationMode === 'directory_override') return UNMANAGED_DIRECTORY_DELETE_POLICY_VERSION;
  return null;
}

export function hasCurrentDirectoryDeleteMethod(evidence: unknown): boolean {
  return Boolean(
    evidence
    && typeof evidence === 'object'
    && !Array.isArray(evidence)
    && (evidence as Record<string, unknown>)[DIRECTORY_DELETE_METHOD_EVIDENCE_KEY] === DIRECTORY_DELETE_METHOD
  );
}

export function planContainsDirectoryDeletion(action: unknown): boolean {
  return action === 'delete_ad' || action === 'delete_both_records';
}
