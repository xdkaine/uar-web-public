# ADR-0024: Reviewed lifecycle deletion plans

Status: Accepted

Date: 2026-09-04

Contexts: identity governance, lifecycle operations

## Context

Batch-created identities share one `BatchAccountCreation` tracking record and use one `BatchAccountItem` per account as lifecycle ownership and state. They do not require synthetic access requests. Historical batch items already linked to individual `AccessRequest` rows remain on that legacy ownership path. Some accounts legitimately have no VPN record. Separately, Active Directory may contain manually created accounts with no request, batch item, email, or VPN record.

Permanent deletion was limited to standalone actions. That forced repetitive confirmations, prevented operators from deleting a recorded batch as one reviewed intent, and offered no safe deletion lane for unowned directory accounts. Treating either case as an offboarding campaign would be misleading: these are explicit record-removal decisions after access has already been disabled or revoked.

## Decision

1. Account Lifecycle may create a server-owned permanent-deletion plan for 1 through 25 selected accounts. The plan stores the confirming actor, reason, ticket/change reference, expiry, idempotency key, policy version, immutable target manifest, selection digest, account count, and record count.
2. Confirmation requires an explicit irreversibility acknowledgement and the exact phrase `DELETE <n> ACCOUNT(S) / <m> RECORD(S)`. The server derives both counts and rejects drift between submitted selection and confirmed manifest.
3. A plan uses exactly one execution lane:
   - `governed`: request-owned records, including historical batch items already linked to requests. Each account retains its own owning request; selected accounts need not share a request, creation batch, or offboarding campaign. Successfully offboarded accounts are eligible once their AD disabled and VPN revoked evidence passes the existing per-record checks. VPN-only plans retain this execution lane for both request-owned and batch-owned records, with ownership verified independently for every target;
   - `batch_governed`: accounts owned directly by completed `BatchAccountItem` rows from any creation batches;
   - `unmanaged_directory`: AD-only targets for which neither a non-rejected `AccessRequest` nor a standalone batch item owns the username.
4. The unmanaged lane requires `lifecycle.delete_unmanaged` in addition to `lifecycle.delete`, `lifecycle.override`, and `users.manage`. The new privilege is default-unmapped. It never creates, updates, or infers an `AccessRequest`, VPN record, email address, or workflow state.
5. Every AD or VPN record becomes its own lifecycle action bound to the plan and target key. The existing execution locks, immutable identity checks, protected-account rules, session settlement, evidence, audit, and reconciliation contracts remain authoritative. Plan confirmation does not weaken execution-time revalidation.
6. A combined account deletion is presentation and planning shorthand, not one cross-system transaction. If a selected account has a revoked VPN record, its VPN child is admitted before its AD child; accounts without VPN legitimately produce only an AD child. The server assigns and enforces a stable child ordinal, and pauses later admission while reconciliation is required. Operations presents a filterable lifecycle-action list with per-action evidence, not a separate reviewed-plan dashboard. The VPN and AD outcomes remain separately visible there. The Accounts tab provides on-demand interrupted-deletion recovery, including plans with no recorded children; unfinished plans are filtered server-side and shown oldest first so completed runs cannot crowd them out. Only the confirming operator may finalize recorded outcomes, and the recovery UI waits for expiry; uncertain actions still require reconciliation in Operations.
7. Known intake or execution failures are retained per child and do not erase successful outcomes. An uncertain LDAP outcome stops remaining child intake and leaves the plan `reconciliation_required`; it is never blindly retried. Plan finalization derives its aggregate state only from the immutable server manifest and persisted child actions; missing manifest slots are counted as not attempted.
8. The Accounts workspace paginates locally with a bounded page size, keeps selection across pages, limits selection to the plan cap, repeats the primary Continue action above and below the table, and keeps the table header visible while scrolling.
9. Campaigns and automations cannot invoke permanent deletion. Standalone governed AD and VPN deletion remain available with the confirmation rules in ADR-0019 and ADR-0020.
10. Expiration or disablement of a batch account does not make it an offboarding subject and does not imply deletion. Operators confirm the live disabled/revoked state, then use Account Lifecycle. Each batch item advances through its own versioned state and uncertain external outcomes require reconciliation rather than blind retry.
11. Directory Users, Sync Status, and lifecycle inventory share an ownership summary: owner type and record ID, real request ID when applicable, batch item/run IDs, readiness, and permission-gated navigation. Batch run IDs never occupy `requestId`. Physical AD/VPN presence remains separate from ownership; an intentionally AD-only batch is not missing a VPN account or request. Missing ownership is informational; conflicting or unavailable evidence requires review.
12. Processing and reconciliation-required standalone batch items remain ownership claims but are not deletion-ready. They must not fall through to unmanaged deletion. A retained batch item whose AD projection is already deleted does not claim a replacement directory object merely because it reuses the username; immutable identity checks still apply to the new target.
13. Sync Status is read-only for ownership. The retired linkage POST remains authenticated and returns a non-mutating `405`, directing operators to Account Lifecycle rather than manufacturing or approving requests.
14. Standalone batch-owned AD and VPN records require separate system-specific deletion plans. VPN batch provenance does not change the existing VPN action mode; each VPN target without request ownership retains its own recorded batch item, and selected targets may come from different batches; combined batch deletion is not introduced by the ownership summary.
15. A completed batch AD binding is ready only when its captured DN/GUID agrees with the current directory inventory. Missing or replaced immutable identity remains an ownership claim requiring review. Divergent nonblank request AD aliases likewise remain claims but cannot authorize governed AD actions at preview, intake, or execution. VPN import must not create a second request ownership ledger for an existing batch claim.
16. Request-owned accounts do not need to share one access request or creation batch to appear in the same reviewed deletion plan. Each record retains its existing system-specific prerequisites: AD requires a lifecycle-ready approved/offboarded request and confirmed disabled state; VPN requires complete revocation evidence and coherent request linkage. Both retain immutable identity and execution-time ownership checks. Request provenance does not require a shared creation batch.

## Consequences

- Operators can review and evidence one deletion intent for a recorded service-account batch without pretending that missing VPN records are errors.
- Operators can remove separately requested accounts together after each account independently reaches deletion-ready state; an unrelated shared-batch requirement does not block cleanup.
- Manually created, unowned AD accounts can be deleted without synthetic governance data, but only through an independently assignable high-risk privilege.
- A plan is an authorization envelope and operator-visible aggregate; each destructive record mutation still has its own claim, immutable evidence, terminal or reconciliation state, and audit history.
- The 25-account cap is an intentional guardrail until permanent deletion gains canary/wave controls comparable to broad offboarding workflows.
- Completed deletion has no portal rollback. Recovery continues to depend on independently operated directory recovery and retained portal evidence.
