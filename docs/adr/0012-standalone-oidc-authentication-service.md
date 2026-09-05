# ADR-0012: Standalone OIDC authentication service

Status: Accepted (amended by ADR-0021 and ADR-0023)

## Context

The portal uses a standalone service as its OpenID Provider so credentials,
provider sessions, signing keys, and future factors can evolve independently.
Earlier revisions let that service read the portal's `LocalAccount` table and
issue OIDC tokens after an Active Directory transport failure. That coupled the
applications' emergency accounts, retried one credential against multiple
authorities, and made an OIDC claim insufficient proof of directory authority.

The portal also has legitimate direct Active Directory and local break-glass
sign-in methods. Those methods belong to portal policy and portal sessions; they
must not be hidden inside the provider's credential-resolution order.

## Decision

**The auth service is an AD-only OpenID Provider. The portal owns the choice of
portal sign-in method and every portal session.**

1. OIDC authorization-code interactions authenticate end users only against
   Active Directory over the hardened LDAPS path. An LDAP connection failure
   ends that interaction. The auth service never looks up a portal local account
   and never issues an OIDC token for a local recovery identity.
2. Successful authentication evidence is bound to the exact provider
   interaction and provider session. Issued ID tokens include the canonical
   subject, `amr` containing `ad`, the provider `sid`, and the signed
   `provider_session_expires_at` taken from the persisted provider Session
   referenced by the exact authorization code. Additional method references such as MFA may accompany `ad`;
   no account-scoped cache supplies claims for another simultaneous interaction.
3. The portal callback requires the expected issuer/audience/nonce/code checks,
   a nonempty `sid`, and `amr` with unambiguous AD authority. It rejects missing,
   contradictory, authority-less, expired, or `local_break_glass` evidence
   before creating a portal session. The portal session expires at the earlier
   of the signed provider-session expiry and `AUTH_OIDC_SESSION_MAX_AGE`; native
   AD and local break-glass retain their shorter portal idle policy.
4. The auth service owns an `AuthAdminLocalAccount` table for Auth Manager
   recovery only. Such an account can authenticate only `/admin/login`, creates
   only an Auth Manager session, and cannot enter an OIDC interaction. Auth
   Manager sessions carry `ad` or `local_recovery` provenance. Every protected
   request rechecks the AD administrator's current authorization or the local
   account's active state and credential version.
5. AD-authenticated Auth Manager administrators manage the recovery roster. A
   local recovery administrator may rotate only its own password; it cannot
   create, enable, disable, or rotate another recovery account. Rotation or
   disablement invalidates all matching Auth Manager sessions.
6. Data ownership is enforced in Prisma and PostgreSQL. The portal alone owns
   `LocalAccount` and `Session`; the auth service does not declare or access
   them. The auth service owns its registry, branding, evidence, console, and
   recovery-account tables. It receives bounded read/insert access to the
   portal-owned shared `AuditLog`. Distinct runtime roles are provisioned by
   `tools/database-role-separation/`; only the migration role may run DDL.
   The immutable 20260101000000 auth-service baseline predates this boundary
   and contains additive `LocalAccount` creation for already deployed shared
   databases. Do not edit its applied checksum or run it as an auth-only
   bootstrap. New environments apply portal migrations first; current auth
   Prisma schema and runtime grants contain no `LocalAccount` access.
7. `AUTH_JWKS` is required in production. Generation, overlap rotation, restart
   continuity proof, and rollback follow `docs/runbooks/auth-signing-keys.md`.
   Ephemeral keys remain available only outside production.
8. The public issuer in `AUTH_ISSUER` is the canonical issuer. Internal service
   routing may change transport authority for server-to-server calls but never
   token `iss`, authorization-response `iss`, discovery metadata, or browser
   redirects.

The portal retains CSRF, Turnstile, rate limiting, session expiration, live role
resolution, administrative re-verification, logout, and audit controls at its
boundary. The auth service retains its own Turnstile, rate/account limits,
provider-session control, LDAP policy handling, and audit controls.

## Rollout

1. Apply the auth-service recovery-account migration and provision stable
   `AUTH_JWKS`.
2. Deploy the auth service's AD-only OIDC and interaction-bound evidence.
3. Deploy portal claim enforcement and the database-backed sign-in policy.
4. During a controlled sign-in block, inventory and revoke legacy portal
   sessions whose provider evidence is `local_break_glass`, then remove the
   cross-service fallback code.
5. Apply the separated runtime database roles and prove the negative privilege
   checks before completing the compatibility-window removal.
6. Correct proxy `Location` handling and prove the public issuer survives the
   round trip unchanged. Restore RFC 9207 response-issuer validation in a
   separately reversible release.

Migration execution, role changes, session revocation, and service deployment
remain operator-authorized production actions.

## Consequences

- An OIDC portal session is evidence of Active Directory authority, with a
  provider session identifier available for logout and audit correlation. Its
  portal lifetime cannot outlast the signed provider session.
- Portal local accounts and Auth Manager recovery accounts have different
  schemas, sessions, permissions, and failure domains.
- An auth-service outage does not create new authorization. The portal can offer
  only direct methods already enabled in its own policy.
- Runtime database credentials provide an enforceable boundary even if an
  application query is accidentally broadened.

## Alternatives considered

- Retry the same password against AD and a local store: rejected because it
  crosses credential authorities implicitly and makes audit provenance
  ambiguous.
- Share one local-account table between portal and auth service: rejected
  because compromise or configuration of one application would control the
  other's recovery path.
- Let Auth Manager recovery accounts issue OIDC tokens: rejected because a
  management-console recovery credential is not directory authentication.
