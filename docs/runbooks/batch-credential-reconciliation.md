# Batch Credential Reconciliation

Batch account results include the access-request ID, LDAP username, and provisioning state. Never paste encrypted or plaintext credentials into tickets, logs, or CSV notes.

- `ldap_failed`: do not rerun the CSV row. The LDAP create helper attempts rollback, but the final directory state may be ambiguous. Perform a read-only lookup for the username and confirm the exact `UAR | Request ID: <request-id>` ownership tag. Escalate an existing or ambiguously tagged account for identity review before any mutation.
- `delivery_failed`: the LDAP account exists and no SMTP delivery was attempted successfully. After confirming the recipient address, an authenticated live-LDAP administrator may call `POST /api/admin/requests/<request-id>/resend-batch-credentials`. The endpoint claims the retry atomically, decrypts only in memory, and clears the ciphertext after confirmed delivery.
- `delivery_sending` or `delivery_retrying`: an active five-minute delivery lease. Do not resend. If a worker crashed, calling the resend endpoint after the lease expires atomically moves the request to `delivery_reconciliation_required` without sending another email.
- `delivery_reconciliation_required`: SMTP may have accepted the credential email. Confirm receipt with the intended recipient out of band. Then call the same endpoint with JSON `{ "reconciliationOutcome": "delivered" }` to clear the ciphertext, or `{ "reconciliationOutcome": "not_delivered" }` to return it to the retryable `delivery_failed` state. Never choose `not_delivered` unless non-delivery has been confirmed.
- `credential_cleanup_pending`: delivery succeeded. Do not resend credentials. The guarded cleanup scheduler reconciles the row to `completed` and clears the ciphertext after the configured retention period.
- `reconciliation_required`: inspect the request and durable audit history. Do not report the batch complete or rerun it until the database state is resolved.

The cleanup worker is disabled by default. When enabled, it requires `CRON_SECRET`, runs every six hours by default, retains terminal ciphertext for seven days by default, and writes a durable success or partial-failure audit record.
