# Lifecycle Operations Context

## Purpose

This context owns delayed, queued, bulk, and operator-controlled work that may affect many accounts or multiple infrastructure systems. Its design priority is safe repetition and recoverability, not merely successful happy-path execution.

## Primary responsibilities

- Account lifecycle actions, batches, history, processing, cancellation, and retry.
- Batch account creation and cleanup.
- Offboard campaign planning, dry runs, activation, waves, verification, control, export, and rollback.
- Mass-email campaign resolution, activation, processing, cancellation, and delivery logs.
- AD/VPN infrastructure synchronization and reconciliation.
- Scheduled entry points registered in the scheduler registry (`my-app/lib/cron/registry.ts`): the lifecycle-queue drain sidecar (which also carries mass-email delivery waves), offboard campaign processing, the directory probe, ticket-group sync, workflow tick, password expiration reminders, credential cleanup, and mass-email sending.
- Automation-driven email: `send_email` rules deliver direct SMTP sends from rule evaluation, alongside lifecycle-queue group-add actions.
- Operator-visible status, audit, and recovery information for all of the above.

## Required invariants

- Workers and operator retries must be idempotent. Reprocessing the same claimed item must not silently duplicate external mutations or notifications.
- A reviewed account-batch submission has one stable submission key. Replaying that key must return the existing batch and must not create a second batch record or repeat per-account work.
- AD/VPN spreadsheet imports populate the same editable draft and reviewed submission as manual account entry; importing does not start provisioning. Completed-batch exports preserve each item's outcome and distinguish unavailable initial credentials from successful disclosure (`docs/runbooks/batch-account-spreadsheets.md`).
- New batch identities use the creation batch as the shared tracking reference and the completed `BatchAccountItem` as each account's lifecycle owner; batch creation must not fabricate an `AccessRequest`. Historical request-linked batch items remain on their legacy request-governed path.
- Claims, locks, attempt counts, timestamps, and stale-work recovery must make concurrent ownership and retry decisions observable.
- Processing and reconciliation-required standalone batch items remain ownership claims, not deletion-ready or unmanaged accounts. Inventory, deletion preflight, and execution checks must agree. AD/VPN presence is independent of portal ownership; intentionally absent batch systems are not linkage errors. Standalone batch AD and VPN deletion uses separate system-specific plans, retaining existing VPN execution mode and grouping limits (`docs/adr/0024`).
- Dry-run or preview output must be tied to the inputs and state used for activation; detect material drift before destructive or bulk execution.
- Preserve canary, wave, pause, cancellation, emergency-stop, exclusion, and eligibility controls on offboarding or other broad-impact workflows.
- Direct offboarding is a distinct reviewed mode, not a zero-day verification campaign. It requires exact request/directory/VPN identity evidence, default-unmapped execution privilege, typed acknowledgement, wave claims, post-enforcement notice delivery, and reconciliation for uncertain external outcomes. It converges already-safe AD/VPN components while continuing the remaining access-removal work; a freshly verified already-disabled AD object also converges the request's disabled projection under the directory execution lock, including during reconciliation. Historical disable provenance is preserved; confirmation evidence is recorded separately without a redundant LDAP write. Direct offboarding cannot be rolled back; future access requires a new request (`docs/adr/0022`).
- Record per-target outcomes and partial failures. A batch-level success flag must not hide failed LDAP, VPN, SMTP, or database work.
- Rollback must verify current state and avoid overwriting legitimate changes made after the original action. When safe reversal is impossible, prefer explicit reconciliation.
- Governed account actions must use exactly one portal ownership ledger: a lifecycle-ready request, or a completed standalone batch item. They also require a preflight directory DN/object GUID as execution identity. Do not use Active Directory extension attributes or description text as binding state.
- Permanent AD and VPN-record deletion remain manual Account Lifecycle decisions, not campaign or automation primitives. Standalone actions retain their single-account confirmation rules. A reviewed deletion plan binds a server-generated immutable manifest, reason, reference, selection digest, actor, expiry, account count, and record count before any child action is accepted (`docs/adr/0024`).
- Reviewed deletion plans contain at most 25 accounts and use exactly one lane: request-governed records with an independent owning request per account (no shared request, creation batch, or offboarding campaign required), standalone batch-governed records from any creation batches, or AD-only accounts with no portal owner. The unmanaged lane requires `lifecycle.delete_unmanaged`; it never creates or mutates an `AccessRequest` and cannot include VPN deletion.
- Disabled or expired batch accounts are retired through Account Lifecycle, not offboarding. Expiration never implies portal-disabled or deleted state; deletion requires a confirmed live disabled AD object or completely evidenced revoked VPN record plus the matching versioned batch item.
- Every planned AD or VPN record is still a separate lifecycle action with its own immutable target, locks, outcome, history, and reconciliation state. Combined deletion queues VPN first, then AD. Known per-record failures do not hide other outcomes; an uncertain LDAP outcome pauses remaining intake and makes the plan reconciliation-required.
- Permanent AD deletion requires confirmed disabled state, settled sessions, an explicit irreversibility acknowledgement, durable preflight/execution checklists, execution/claim fencing, and domain-wide objective GUID reconciliation; a governed action also retains its versioned disabled-state projection. The final supported AD read and immutable GUID delete share one bound connection, but external AD writers can still change state between them; evidence records this accepted non-atomic gap. New AD deletion confirmations use the current versioned method only, and earlier confirmations or AD-containing reviewed plans must be refreshed and reviewed again before any child can run. It never auto-retries after the LDAP delete begins or after an unexplained disappearance.
- Permanent VPN record deletion requires complete revoked-state evidence, strict module-state resolution, immutable target-ID execution, and one transaction that preserves history while deleting only the live credential-bearing row (`docs/adr/0020`).
- Session revocation, audit history, operator status, and recovery instructions must remain consistent with the actual external-system result.
- Cron routes require their intended authentication and must not become publicly triggerable through convenience changes.
- Automation rules that fire external side effects must not silently duplicate sends or queue entries when the same event is re-evaluated; outcome and failure evidence must be observable per action.

## Important paths

- `my-app/app/api/admin/account-lifecycle/`
- `my-app/app/api/admin/batch-accounts/`
- `my-app/app/api/admin/offboard-campaigns/`
- `my-app/app/api/admin/mass-email/`
- `my-app/app/api/admin/settings/infrastructure-sync/`
- `my-app/app/api/cron/`
- `my-app/lib/cron/registry.ts` (scheduler registry; keep intervals in sync with compose sidecar defaults)
- `my-app/lib/lifecycle-processor.ts`, `offboard-campaign.ts`, `mass-email.ts`, `infrastructure-sync.ts`, and `notification-queue.ts`
- `my-app/lib/automation/email-sender.ts` (automation-driven SMTP sends)
- Lifecycle, offboard, campaign, sync, and audit models in `my-app/prisma/schema.prisma`

## Validation expectations

- Exercise duplicate delivery, retry after partial failure, stale claim, concurrent processor, cancellation, and rollback-conflict scenarios where relevant.
- For batch creation, separately test whole-submission replay and per-account username/email contention; the submission key does not replace the per-account locks or processing lease.
- Verify dry-run/activation parity and operator-visible failure evidence.
- Do not invoke real cron, email, LDAP, VPN, sync, or batch operations as validation without exact authorization.
- Run `lifecycle_operations_reviewer` after implementation and independently verify material findings.
