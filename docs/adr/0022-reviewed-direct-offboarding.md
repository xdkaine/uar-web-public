# ADR-0022: Reviewed direct offboarding without a verification campaign

Status: Accepted

## Context

Offboard campaigns normally ask account holders to verify that they still need access, wait seven days, and enforce only when no verification arrives. That is the correct path for uncertain eligibility. It is the wrong state machine when an authorized operator already has evidence that access must end: manufacturing a zero-day campaign would still create verification tokens and could reactivate access after enforcement.

Direct offboarding crosses Active Directory, VPN, session, portal-request, and SMTP boundaries. Those systems are not transactionally atomic. The workflow therefore needs exact reviewed scope, immutable target evidence, controlled waves, durable authorization, and reconciliation states rather than a shortcut button.

## Decision

1. A New Dry Run has two explicit workflow modes: `verification` and `direct`. Direct mode never creates a verification token, deadline, reminder, extension, or verification-based recovery path.
2. Direct mode requires the default-unmapped `offboard.execute_direct` privilege. Its prerequisites are `offboard.manage`, `lifecycle.manage`, `users.manage`, `vpn.manage`, and `sessions.revoke`.
3. The dry run records a substantive reason and ticket/change reference. Activation requires an unexpired exact preview, a durable policy version, an irreversibility acknowledgement, and the phrase `DIRECT OFFBOARD <N> ACCOUNT(S)` for the executable count.
4. Preview and execution bind each target to the portal request ID/version, directory DN/object GUID, linked VPN record ID/status, account email, and configured exclusions. Any drift prevents execution for that recipient. The AD disable uses an atomic LDAP assertion over the reviewed object GUID, username, and enabled UAC value.
5. Direct work retains canary, wave, pause-after-wave, cancel, and emergency-stop controls. A pause prevents the next claim but cannot interrupt an LDAP, database, session-provider, or SMTP call already in flight.
6. Claiming a recipient first establishes a durable VPN identity fence under the same PostgreSQL advisory-lock namespace used by the database trigger on every live VPN insert, link, or reactivation. The fence blocks the offboarded request and unlinked administrative creation; only a different request bound to the same AD username can create future access. The recipient is then processed in this order: disable AD when it is still enabled, revoke the linked VPN record when it is still active, revoke portal and provider sessions, mark the owning request `offboarded`, then send the completed-offboarding notice. An already-disabled AD account is freshly verified through the exact reviewed DN, object GUID, username, and disabled UAC under the directory execution lock before converging the request's `adAccountStatus`, including during verified-complete reconciliation. This issues no LDAP mutation, preserves historical disable provenance, and records the observation time, actor, and exact directory evidence in a request comment rather than inventing an original disable event. A conflicting `deleted` projection or changed request version remains unresolved. An already-revoked VPN record is likewise a satisfied component. Neither condition skips the remaining access paths. The notice says future access requires a new account request.
7. The final notice is sent only after access removal and request projection are durably recorded. An uncertain SMTP result enters `reconciliation_required`; it never restores access and is not blindly retried.
8. Uncertain or partial AD, VPN, or session outcomes enter enforcement reconciliation. Lifecycle actions retain the exact activation-run ID and stable idempotency keys. Expired recipient or activation-run claims also become reconciliation evidence instead of remaining indefinitely in progress.
9. Direct offboarding does not permanently delete an AD object or VPN record. Those remain separately privileged, single-account manual actions governed by ADR-0019 and ADR-0020 after disabled/revoked evidence is complete.
10. Direct offboarding has no campaign rollback. Restoring access would contradict the reviewed decision and post-action notice; a person who needs access again must submit a new account request. Uncertain effects are resolved through reconciliation, not access restoration.

## Consequences

- Operators can formally skip the seven-day campaign only for reviewed, known offboarding decisions.
- Account holders receive a post-action notice rather than a link that could recover the account.
- Direct campaigns remain observable and stoppable between claims, while in-flight external-call limitations are explicit.
- The migration deliberately fails until duplicate live VPN identities are reconciled, then enforces one live identity and the durable direct-offboarding fence at the database boundary.
- Permanent deletion stays deliberately separated from multi-account campaign execution.
