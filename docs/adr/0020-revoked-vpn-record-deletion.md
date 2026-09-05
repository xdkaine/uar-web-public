# ADR-0020: Permanent deletion of revoked VPN records

Status: Accepted

Amended by: [ADR-0024](0024-reviewed-lifecycle-deletion-plans.md), which permits revoked VPN records in bounded reviewed plans. Standalone deletion retains this ADR's single-record policy.

## Context

VPN revocation is a PostgreSQL lifecycle state change; the portal has no external VPN-provider delete call. The live `VPNAccount` row contains an encrypted retained credential, while status logs, comments, activity, request linkage, import records, sync matches, offboarding evidence, and audit records provide operational history. The former `DELETE /api/admin/vpn-accounts/[id]` endpoint did not delete the record: it changed any account to `disabled` and accepted caller-supplied actor text.

## Decision

1. Permanent VPN record deletion is a first-class, single-account lifecycle action named `delete_vpn_record`.
2. The action requires `vpn.delete`, whose prerequisites are `vpn.manage` and `lifecycle.manage`. It is not included in batch, campaign, automation, combined AD/VPN, or directory-override operations.
3. The VPN module must be resolved strictly for deletion: no `ModuleState` row means enabled, but a state-store read failure blocks the action. Module changes and deletion share a transaction advisory fence so disabling the module cannot race a permanent delete.
4. Confirmation requires a ticket/reference, a substantive reason, an irreversibility acknowledgement, and the exact phrase `DELETE VPN RECORD <username>`.
5. Intake and execution require the same immutable VPN record ID and username, exact `revoked` state, non-empty revoke timestamp/actor/reason, latest revoked-status log ID, request ID/version, and active reverse request claimants. Any drift invalidates confirmation. PostgreSQL triggers make every `VPNAccount`/`AccessRequest` VPN-ownership write share the deletion username fence, including imports, sync, batch work, and future callers. Unlinked import or batch records remain allowed only when no active request claims the username.
6. Deletion hard-deletes only the live `VPNAccount` row and its encrypted credential. It does not change AD state or the access-request workflow. A linked request's `vpnAccountStatus` becomes `deleted`, while usernames and revoke provenance remain.
7. `VPNAccountStatusLog` and `VPNAccountComment` retain immutable `accountId`. Their nullable `liveAccountId` relation is cleared on live-record deletion, preserving history and comments. Activity, role, import, sync, offboarding, lifecycle, and audit scalar references remain historical evidence.
8. The final `revoked -> deleted` status log, VPN activity record, request projection with version CAS, deletion audit, live-row delete, lifecycle result, and lifecycle completion history commit in one PostgreSQL transaction. Failure rolls the transaction back and leaves the revoked record intact. An expired claim with a surviving row is objectively failed; an absent row may be reconciled only when retained status, activity, audit, request projection, result, and completion-history evidence all agree.
9. The former direct DELETE route returns 405 and directs operators to Account Lifecycle. Request rejection revokes and retains a linked VPN record; it is not an alternate permanent-deletion path.

## Consequences

- Deleted VPN records disappear from live account inventory and their encrypted credentials are gone.
- Operations and action-history views remain authoritative after the live row is absent and identify it as a deleted record.
- Reusing a username cannot cause a stale lifecycle action to mutate the new record because standalone VPN lifecycle actions resolve by immutable target ID and verify the username.
- Privacy erasure of comments or audit evidence is a separate retention-policy decision and is not implemented by this operation.
