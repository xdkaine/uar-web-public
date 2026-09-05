# Manual Login Lock Recovery

Use this break-glass procedure only when `manualOverride=true` prevents normal administrative recovery. It intentionally keeps `loginDisabled=true` until a separate authenticated administrator re-enables logins.

## Required approval

Record an incident or change ticket before starting. Two different people are required:

- the recovery operator who runs the command;
- the approver who reviews the target environment, ticket, and intended recovery.

Do not run this against an unconfirmed database. Back up the current `SystemSettings` row and record its ID, `loginDisabled`, `manualOverride`, `lastModifiedBy`, and `updatedAt` values in the ticket.

## Recovery

1. Confirm the selected row has both `loginDisabled=true` and `manualOverride=true`.
2. Set `LOGIN_LOCK_RECOVERY_ACTION=unlock`, `LOGIN_LOCK_RECOVERY_OPERATOR`, `LOGIN_LOCK_RECOVERY_APPROVER`, `LOGIN_LOCK_RECOVERY_TICKET`, `LOGIN_LOCK_RECOVERY_SETTINGS_ID`, and `LOGIN_LOCK_RECOVERY_EXPECTED_UPDATED_AT` in the command environment. The ID and ISO timestamp must exactly match the approved row snapshot, and operator and approver must differ.
3. Run `docker compose --profile manual-recovery run --rm login-lock-recovery`. This one-shot service uses the builder stage because the production runner intentionally does not contain maintenance scripts.
4. Verify the approved row now has `manualOverride=false`, `loginDisabled=true`, and `lastModifiedBy=break-glass:<operator>:<ticket>`.
5. Verify an `AuditLog` entry named `break_glass_clear_manual_login_override` records the operator, approver, ticket, timestamp, and pending authenticated re-enable step.
6. A different authenticated administrator must use the settings page to set `loginDisabled=false`; the API rejects the recovery operator. Verify the normal settings audit entry and a successful test login with a non-privileged test account.

The script must not be used to bypass the authenticated re-enable step, and it must not create a missing settings row.

## Forward recovery and rollback

If verification fails before logins are re-enabled, capture the row's new `updatedAt`, set `LOGIN_LOCK_RECOVERY_ACTION=restore` with the same ticket and approved row ID plus that timestamp, and rerun the one-shot recovery service. It restores both `manualOverride=true` and `loginDisabled=true` in the same transaction as a rollback audit entry. Verify both values and preserve all audit entries.

If logins were already re-enabled, treat re-locking as a new security operation: use the authenticated settings page when available, verify active sessions and login behavior, and record the outcome in the ticket.
