# ADR-0023: Portal-owned sign-in policy

Status: Accepted (supersedes environment-only alternate sign-in and the ADR-0021 outage authorization circuit)

## Context

The portal can create a session through three distinct authorities: a configured
OIDC auth service, direct Active Directory, or a portal-owned local account.
Earlier behavior split that decision across `AUTH_MODE`, healthy-state alternate
environment flags, and an outage circuit. The login page then described the
OIDC service with hard-coded product copy and could imply that outage state
made a backup method authorized.

## Decision

The portal stores one audited `auth.signInPolicy`, managed through a dedicated
**Sign-in** settings section under `settings.manage`.

The versioned policy independently enables and orders:

- `oidc`: the configured auth service;
- `native_ad`: direct Active Directory;
- `local_break_glass`: portal local accounts.

At least one method must be enabled and usable. Saving rejects an enabled OIDC
method unless issuer, client, redirect, and callback readiness checks pass;
rejects direct AD unless the LDAP configuration is ready; and rejects local
sign-in unless at least one active portal local account exists. Readiness is
separate from method selection so a database setting cannot advertise a route
that runtime code refuses because an unrelated legacy mode differs.

OIDC display name and description are portal-owned plain text. Name length is
1-80 characters and description length is 0-200 characters. Control characters
are rejected and the UI renders no operator-supplied HTML. `Active Directory`
and `Local break-glass` remain fixed security terms; bypass and emergency
explanations appear on their credential forms.

`GET /api/auth/mode` returns ordered method objects with `id`, `displayName`, and
`description`, while retaining legacy fields for a bounded compatibility
window. Multiple usable methods produce a compact chooser; one usable method
continues immediately. Disabled or newly unusable methods are hidden and are
also rejected when posted directly, during password-change continuation, and
before session minting.

The generic directory/email configuration API cannot read or write
`auth.signInPolicy`. A dedicated protected API validates the complete document,
applies optimistic revision control, and records actor, old/new policy summary,
and outcome without credentials or secrets.

Provider boundaries are exact:

- direct AD submits only to LDAPS and creates an AD-provenance portal session;
- portal local submits only to the portal `LocalAccount` store and creates a
  portal-local session;
- auth-service OIDC submits only to AD and must return AD `amr`, provider `sid`,
  and an unexpired signed `provider_session_expires_at` claim;
- Auth Manager local recovery is outside portal policy and cannot create OIDC
  or portal sessions.

Portal local password rotation and disablement take the same username advisory
lock used by local session minting. The transaction updates the account,
invalidates matching sessions by credential version/provenance, and preserves
provider logout tasks for any legacy OIDC-local session that carried a provider
`sid`.

`AUTH_MODE`, `AUTH_OIDC_ALTERNATE_SIGNIN`, and
`AUTH_OIDC_OUTAGE_FALLBACK` are legacy inputs only when no saved policy exists.
Saving the policy makes it authoritative on every replica without requiring an
environment change.

## Experience

The login page uses the portal's existing theme, typography, focus treatment,
and dark-mode tokens. It renders a compact list of identity sources without
promotional cards, icons, rankings, or `Recommended`, `Direct`, and `Emergency`
pills. The configured auth-service text appears exactly as saved; its hostname
may appear separately as quiet verification metadata.

An auth-service failure returns an operational error and the methods still
enabled by portal policy. Health probes classify that failure but never broaden
the list.

## Consequences

- Operators can express every supported combination through one audited source.
- Custom provider copy reflects the actual configured service without changing
  fixed security terminology.
- A hidden method is denied at the API boundary as well as the browser.
- Direct AD remains an explicit acceptance that IdP-side factors do not govern
  that path.
- Policy activation depends on current readiness; readiness loss later makes a
  method unavailable but does not silently rewrite the saved policy.

## Rollout and rollback

Deploy auth-service AD-only evidence before enabling strict portal claim
validation. Deploy the new portal policy in compatibility mode, save an explicit
policy, and validate every enabled-method combination. During a controlled
sign-in block, revoke legacy `local_break_glass` provider sessions before
removing cross-service fallback code.

Rollback preserves the policy record and additive migrations. Before running a
binary that does not understand new provenance, block sign-in, drain attempts,
invalidate incompatible password-change challenges, and decide explicitly
which sessions to revoke. Do not restore environment-only outage authorization
while a saved policy exists.
