# ADR-0019: Governed deletion of disabled directory accounts

Status: Accepted

Amended by: [ADR-0024](0024-reviewed-lifecycle-deletion-plans.md), which adds bounded reviewed plans and a separately privileged unmanaged-directory lane. Standalone deletion retains this ADR's single-account governed policy.

Date: 2026-08-31

Contexts: identity governance, lifecycle operations

## Context

Account Lifecycle could disable and re-enable Active Directory accounts but had
no governed way to remove an account that was already disabled. The existing
`deleteLDAPUser` helper is intentionally limited to recent creation rollback: it
uses creation correlation and a seven-day age limit, so it is not an appropriate
operator lifecycle control.

Directory deletion is irreversible from the portal. A timeout or persistence
failure after LDAP deletion may leave the external result known only through
reconciliation, and a username may later be reused by a different directory
object.

## Decision

1. `delete_ad` is a first-class lifecycle action. It is processed through the
   existing queue, claim, immutable history, and reconciliation path.
2. The first version is deliberately narrow: one governed AD account at a time;
   no directory override, legacy batch intake, combined VPN mutation, campaign,
   or automation entry point.
3. The actor requires the separately mapped `lifecycle.delete` privilege, which
   implies `lifecycle.manage` and `users.manage`. Existing directory-management
   privilege does not silently grant permanent deletion.
4. Confirmation requires a substantive reason, ticket/change reference, an
   explicit irreversibility acknowledgement, and the exact phrase
   `DELETE <username>`. It also requires one lifecycle-ready owning request,
   portal status `disabled`, and a live disabled directory object with readable
   username, DN, and object GUID. Protected administrative identities remain blocked.
5. No cooling interval is imposed beyond confirmed disabled state. This matches
   the operator requirement; a future retention policy requires a new versioned
   decision rather than an implicit timer.
6. Every AD lifecycle worker holds the same canonical-username PostgreSQL
   execution fence through its directory side effect. Deletion also holds the
   session-creation fence and the governing Access Request row lock, revalidates
   its unexpired worker claim after acquiring the locks, and uses a
   disabled-state/request-version compare-and-set for the portal projection.
   Public re-enrollment, profile linking, manual assignment, saved credentials,
   Sync Status reconciliation, VPN import, Infrastructure Sync, and batch
   creation share the canonical-username fence. Paths that claim an existing
   directory object re-read it after acquiring the fence. Stale-claim recovery
   never revokes a worker while that fence is held.
7. Execution rechecks request ownership, readiness, protected-account policy,
   DN, object GUID, username, and disabled UAC. Portal sessions and provider
   logout work are queried case-insensitively and must be settled. A login that
   was authenticated before deletion is blocked from creating a later portal
   session when the governed request now records disabled or deleted AD state.
8. LDAP deletion uses a dedicated helper on one bound connection. It performs a
   final supported AD base search addressed by the immutable GUID, filtering
   username, disabled UAC, and protected-account predicates and verifying the
   exact returned DN and identity, then deletes that immutable GUID target. It then
   confirms the captured object GUID is absent using the domain naming context
   from RootDSE, not the narrower configured user OU. AD does not support the
   attempted atomic assertion-delete control, so an external AD writer can still
   change the object after that final read and before delete. The portal locks,
   immutable identity target, readback, audit trail, and reconciliation record
   narrow and expose that accepted non-atomic gap. The rollback helper's age and
   description policy is unchanged.
9. A failure after deletion begins, or discovery that the captured object
   disappeared before the portal delete call, becomes `reconciliation_required` and is not
   automatically replayed. Reconciliation must objectively resolve the captured
   GUID as absent for completed, or present at the same DN/username and disabled
   for not completed. The action snapshot records whether portal preflight passed,
   execution entered the LDAP deletion boundary after final directory preflight
   and immutable-GUID delete-target preparation with an unknown outcome, or objective
   reconciliation later confirmed absence/presence.
10. The versioned `governed-directory-delete-v3` evidence record captures the
    confirmation, operator, reference, disabled-state provenance, immutable
    identity, privilege result, and passed preflight checklist. Execution records
    a second checklist covering ownership, portal/directory state, protection,
    sessions, final directory preflight, immutable GUID target, accepted external
    writer race, and GUID-absence readback. Confirmed deletion sets
    `AccessRequest.adAccountStatus` to `deleted` and adds lifecycle history, AD
    activity, request-comment, and unified audit evidence. The Access Request and
    any Batch Account Item remain as immutable provenance.
11. Intake, manual retry, and execution all use the same username fence and reject
    another queued, processing, or reconciliation-required delete for the captured
    object GUID. A retry cannot bypass an unresolved or newer deletion.
12. AD-only deletion does not change VPN access or the overall request workflow
    status. Operators must use explicit VPN/offboarding actions when those
    systems should also change.

## Consequences

- Disabled governed accounts can be permanently removed without abusing the
  creation-rollback code path.
- The account disappears from live directory inventory after success, while its
  request and operational evidence remain inspectable.
- Deletion removes only the live AD object. It retains the Access Request or
  Batch Account Item, lifecycle history, comments, activity logs, and audit
  records as immutable operational evidence. VPN-record deletion follows the
  same retention rule for its status and audit records while removing only the
  live credential-bearing VPN row.
- `lifecycle.delete` is default-unmapped for non-system administrators and must
  be assigned intentionally.
- A completed deletion has no application rollback. Recovery depends on an
  independently operated and tested Active Directory recovery mechanism.
- Unlinked or conflicting directory accounts must first have governance linkage
  resolved; directory override cannot permanently delete them in this version.
