# Identity Governance Context

## Purpose

This context owns how people request access, prove identity, authenticate, receive authorization, obtain or recover accounts, and have identity-sensitive actions audited. PostgreSQL stores portal workflow state; LDAP/Active Directory remains the source of truth for directory authentication and group membership.

## Primary responsibilities

- Public internal and external access-request intake and email verification.
- Student-director and faculty review paths, approval, rejection, and provisioning. Review stages are configurable per versioned workflow (`docs/adr/0002`), including per-stage notification recipient lists; stage actions require the configured reviewer role or system-administrator access (`docs/adr/0003`).
- Portal-owned sign-in policy for three exact methods: AD-only OIDC through the standalone provider, direct Active Directory, and portal-owned local break-glass accounts. Each method has an independent readiness gate and session provenance (ADR-0012/ADR-0023).
- LDAP live admin-group verification, account creation, group membership, and password operations.
- VPN account linkage and identity-related status changes. VPN is a capability module (`vpn.management`) that can be disabled without deleting history; gated side effects skip explicitly (`docs/adr/0001`).
- Sessions, activation tokens, password-reset tokens, password-change challenges, credential retention/reveal/cleanup, and identity audit history. The standalone OIDC provider additionally owns IdP-session visibility and forced sign-out (per-user/per-application), first-party device attribution (`docs/adr/0014`), and opt-in evidence-only device risk observations (`docs/adr/0017`).
- The auth service owns the curated public application directory, OIDC client registration metadata, sign-in appearance revisions, Auth Manager local recovery accounts, and security-oriented audit export surface. Recovery accounts authenticate only Auth Manager and never receive OIDC tokens. Publishing a directory entry never registers an OIDC client implicitly.
- CSRF, Turnstile, rate limiting, cookie policy, enumeration resistance, and security logging on identity flows.

## Required invariants

- A portal session alone is insufficient for protected admin API access; preserve the current live LDAP admin-membership check wherever that boundary applies.
- Public request, verification, login, activation, and recovery responses must not disclose whether a person, account, request, or token target exists beyond the intended workflow state.
- Reset, activation, verification, challenge, and session tokens must use the approved hashing, expiry, replay-prevention, and transactional-consumption patterns for their flow.
- Credentials retained by the portal must use the approved encryption helper, remain redacted from logs and ordinary responses, have an auditable reveal path, and follow cleanup requirements. Never introduce plaintext credential persistence.
- A batch creator with `batch.manage` may explicitly export retained initial passwords for completed standalone batch-owned items. The export requires CSRF, current authorization, system completion evidence, and a durable disclosure audit before returning a no-store attachment. It respects configured retention with a seven-day maximum and never bypasses legacy request credential rules or recovers cleared passwords from a live VPN record (`docs/runbooks/batch-account-spreadsheets.md`).
- CSRF, Turnstile, rate limiting, secure cookie settings, TLS verification, and audit logging are security boundaries, not optional availability features.
- Auth-service probing classifies availability and supplies operational messaging; it never authorizes a portal sign-in method. A saved `auth.signInPolicy` is the only authority for OIDC, direct AD, and portal local methods. Upstream browser failures may return to the portal, where only already-enabled usable methods appear (ADR-0021/ADR-0023).
- Every credential submission names one authority and is sent only there. OIDC interactions authenticate only through AD and produce interaction-bound `amr` containing `ad` plus provider `sid`; direct AD uses only LDAPS; portal local uses only the portal `LocalAccount` store; Auth Manager recovery uses only `AuthAdminLocalAccount` and cannot produce OIDC or portal sessions.
- Portal local rotation and disablement share the username lock used by session minting, revoke matching sessions in the fenced transaction, and preserve provider logout work for legacy OIDC-local sessions. Auth Manager recovery rotation or disablement invalidates every matching Auth Manager session by active-state and credential-version recheck.
- Database transactions do not make LDAP, VPN, Redis, or SMTP mutations atomic. Every cross-system mutation must define ordering, partial-failure recording, retry safety, and compensation or reconciliation.
- Direct offboarding cannot issue or accept verification tokens. Once its reviewed access-removal sequence completes, the account holder receives a post-action notice directing them to submit a new account request. When the exact reviewed AD object is already disabled, the workflow freshly rechecks its identity and disabled state under the directory execution lock before updating the owning request's AD projection, including during reconciliation. It preserves original disable provenance and records confirmation evidence separately without issuing another LDAP write. The direct campaign cannot restore access; reconciliation certifies uncertain effects without bypassing that new-request requirement (`docs/adr/0022`).
- Portal ownership is recorded in PostgreSQL, not copied into an Active Directory extension attribute. Ordinary accounts resolve to one lifecycle-ready request; newly created batch identities resolve to one completed standalone batch item and use the creation batch as their shared tracking reference. Governed directory mutations must capture the live directory DN and object GUID before mutation and reject ownership or identity drift.
- State-changing routes must verify the actor, validate the current state, allow only an explicit transition, and record the resulting security-relevant action without secrets or unnecessary PII.
- Directory Users, Sync Status, and lifecycle inventory share recorded ownership evidence and permission-gated request/batch navigation. Batch tracking never substitutes for a real `requestId`; matching email is not ownership. Unowned accounts are informational, while conflicting or unavailable ownership requires review. Sync Status cannot create or approve requests: its retired linkage POST authenticates and returns a non-mutating `405` (`docs/adr/0024`).
- Permanent VPN record deletion is separately privileged and available only after complete revoked-state evidence. A standalone deletion retains its single-record confirmation; a bounded reviewed plan may include it alongside the same governed account's AD record or other independently eligible request-owned or batch-owned VPN records, including records from different creation batches. It removes the live credential-bearing row while preserving status logs, comments, request linkage, lifecycle history, and audit evidence (`docs/adr/0020`, `docs/adr/0024`).
- Permanent directory deletion is separately privileged. Standalone deletion remains limited to one governed, confirmed-disabled AD object. A server-owned reviewed deletion plan may include up to 25 request-governed accounts, up to 25 standalone batch-governed accounts from any creation batches, or up to 25 unowned directory accounts in a separate unmanaged lane. Unmanaged deletion additionally requires the default-unmapped `lifecycle.delete_unmanaged` privilege and never creates an `AccessRequest`. Every path requires explicit irreversibility acknowledgement, count-bound typed confirmation, and durable preflight/execution evidence. It holds the directory and session fences, revalidates immutable DN/object GUID evidence and protected-account policy in a final supported AD read on the same bound connection, then deletes the immutable GUID target and reads it back domain-wide. AD cannot atomically bind that final read to delete, so the retained evidence records the accepted external-writer gap and any uncertain outcome enters reconciliation. The live AD object is deleted while requests, batch items, comments, activity, lifecycle history, and audit evidence remain (`docs/adr/0019`, `docs/adr/0024`).
- Any flow that creates or changes portal ownership of an existing AD username shares the lifecycle-deletion username fence and rechecks the live directory object after acquiring it.
- Conflicting nonblank request AD aliases cannot authorize lifecycle AD mutations, even when either alias matches the live username. Batch AD readiness requires captured DN/GUID to match the live object; missing immutable evidence is review-required, never unmanaged. VPN import checks batch claims under ownership fences before creating request or VPN records.
- Group membership removal must collect operation-specific evidence at confirmation time; an unrelated add-member form field must not silently disable removal.
- Browser fingerprints are untrusted, spoofable evidence. They must not enter tokens or claims and cannot authorize, deny, or step up a session while device risk remains in shadow mode.

## Important paths

- `my-app/middleware.ts`
- `my-app/app/api/request/`, `verify/`, `auth/`, `account/`, and `profile/`
- `my-app/app/api/admin/requests/`, `users/`, `groups/`, `sessions/`, and `vpn-accounts/`
- `my-app/lib/adminAuth.ts`, `session.ts`, `csrf.ts`, `turnstile.ts`, `ratelimit.ts`, `encryption.ts`, `password*.ts`, and `audit-log.ts`
- `my-app/lib/ldap/`
- `services/auth-service/src/` (provider, interaction, `session-store.ts` control plane, `admin-api.ts`)
- `my-app/prisma/schema.prisma`

## Validation expectations

- Trace success, denial, expiry, replay, duplicate, partial-external-failure, and retry paths.
- Add focused negative authorization and token tests for changed behavior.
- Confirm secrets, credentials, and tokens are absent from logs and unintended JSON responses.
- Run `identity_governance_reviewer` after implementation and independently verify material findings.
