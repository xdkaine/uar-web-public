export const LIFECYCLE_READY_NON_NULL_PROVISIONING_STATES = [
  'succeeded',
  'completed',
  'activation_email_pending',
  'credentials_email_pending',
] as const;

const TERMINAL_PROVISIONING_STATES = new Set<string | null>([
  null,
  ...LIFECYCLE_READY_NON_NULL_PROVISIONING_STATES,
  // Notification recovery is settled with respect to directory mutation; it
  // must not prevent an operator from disabling an exactly bound live account.
]);

/**
 * Lifecycle safety is ultimately established by the live immutable directory
 * binding. These are the portal states that indicate no provisioning or
 * reconciliation workflow is still active. Ordinary approvals intentionally
 * finish at null, account creation finishes at succeeded, and reconciliation
 * finishes at completed. Notification-pending states represent a completed
 * directory change with a separately recoverable delivery failure.
 */
export function isLifecycleProvisioningReady(state: string | null): boolean {
  return TERMINAL_PROVISIONING_STATES.has(state);
}
