# ADR-0018: Directory-only lifecycle overrides

Status: Accepted

Amended by: [ADR-0024](0024-reviewed-lifecycle-deletion-plans.md) for reviewed deletion plans only. Enable and disable overrides remain single-account.

Contexts: identity governance, lifecycle operations

## Context

Account Lifecycle requires every governed AD enable or disable action to resolve
to one lifecycle-ready `AccessRequest` or one completed standalone `BatchAccountItem`.
The portal database is the ownership ledger;
the live directory DN and object GUID establish which AD object may be mutated.
No Active Directory extension attribute is part of that request binding. This safe
default prevents operators from acting on ambiguous or replaced accounts, but it
also prevents recovery of a real directory account that predates the portal or
otherwise has no application record.
The lifecycle page also hid action planning in a modal and exposed direct group
writes outside the lifecycle claim, history, and reconciliation path.

## Decision

1. The page becomes an account-first workspace with visible Accounts, Groups, and
   Operations views. Governed accounts may be selected in a bounded multi-account
   plan; each target remains an independent lifecycle action and outcome.
2. A force action is modeled narrowly as `operationMode = directory_override`.
   It is allowed only for a single live AD account, only for `disable_ad` or
   `enable_ad`, and only when governed request linkage is unavailable.
3. Directory override requires `lifecycle.override`, `lifecycle.manage`, and
   `users.manage`, a ticket/reference, substantive justification, and an exact
   typed username acknowledgement. It never creates or mutates an `AccessRequest`,
   never infers VPN state, and cannot run combined AD/VPN actions.
4. A governed action stores exactly one portal owner ID (request or batch item), target DN and object GUID,
   before/after snapshots, authorization evidence, and policy version. Execution
   re-resolves the unique portal owner and rejects DN, object-GUID, username, or
   enabled-state drift before writing. A directory override stores the same live
   identity evidence plus its binding-failure code. A disable still revokes portal
   and provider sessions. Failure after an external write requires reconciliation.
5. Governed AD and group mutations require `users.manage`; VPN mutations require
   `vpn.manage`. Group writes run through lifecycle processing rather than mutating
   LDAP first and recording history afterward.
6. Override is single-account in this version. Multi-account override requires a
   separate approval design; governed multi-account operations are allowed.
7. Draft intent may be edited in the browser before confirmation. Confirmed,
   queued, completed, failed, and reconciliation records remain immutable; changes
   use cancel-and-create rather than rewriting evidence.
8. Every new group membership action is authored through one lifecycle factory.
   It checks transitive protected-group policy, captures both member and group DN
   plus object GUID, and writes action, initial history, and any workflow artifacts
   atomically. Multi-group workflow targets are all prepared before that transaction,
   so a failed target creates no partial authorization plan.
9. Legacy queued group actions without immutable member and group identity are not
   auto-bound at execution. Before rollout, operators must cancel and recreate those
   queued rows through the Groups workspace or their owning workflow. If one is
   claimed, it fails closed before LDAP mutation with an explicit missing-identity
   error and must be recreated; it must not be retried unchanged.

## Consequences

- Unlinked directory accounts can be recovered without fabricating governance data.
- Account/request ownership remains in PostgreSQL; LDAP descriptions are operational
  metadata, and directory extension attributes are neither written nor trusted as
  governance state.
- Newly batch-created identities do not fabricate `AccessRequest` rows. The
  `BatchAccountCreation` ID is their shared run/reference and each completed
  `BatchAccountItem` is the per-account lifecycle owner and optimistic-lock ledger.
  Historical batch items already linked to requests retain those links as a
  separately versioned legacy ownership path.
- Operators can distinguish application-plus-directory work from directory-only
  exceptions before execution.
- Existing rows remain governed through an additive default and nullable evidence
  columns. Rollback disables or unmaps `lifecycle.override`; evidence is retained.
- Group actions created after this decision are resilient to username/DN reuse and
  group replacement; legacy unbound group work requires explicit recreation.
- A future first-class local model for unmanaged directory accounts remains a
  separate product decision rather than being approximated with synthetic requests.
