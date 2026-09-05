# ADR-0021: Auth-service outage classification and browser return

Status: Superseded in part by ADR-0023 (the outage circuit is retired as an authorization mechanism)

## Context

The earlier guarded outage circuit could temporarily authorize direct Active
Directory and portal local sign-in after repeated internal provider failures.
Although server-controlled, this made provider health part of authorization and
created a second policy source alongside explicit operator configuration.

The portal now has one saved sign-in policy. Availability still needs useful
classification and a browser return path, but an outage must never enable a
method an operator disabled.

## Decision

1. Provider probing may remain bounded and distributed for health
   classification, audit correlation, and operational messaging. Probe state
   does not add, remove, or authorize a sign-in method.
2. When an OIDC start or callback fails on the portal server, the browser
   returns to `/login?error=oidc_unavailable`. The login page reads the current
   portal policy and displays only methods that were already enabled and remain
   usable. Direct API submissions are reauthorized against the same policy.
3. The public auth reverse proxy intercepts upstream 502, 503, and 504 only for
   browser authorization and interaction routes and returns a 303 to the portal
   operational error. Token, JWKS, discovery, logout, Auth Manager, and internal
   API calls keep their protocol-appropriate upstream failures.
4. A DNS or TLS failure at the browser's public auth hostname happens before an
   HTTP request reaches nginx and therefore cannot be redirected automatically.
   Operators must provide DNS/TLS availability or direct users to the portal by
   another operational channel.
5. `AUTH_OIDC_OUTAGE_FALLBACK` remains only as a legacy input while no saved
   `auth.signInPolicy` exists. Once an operator saves the new policy, database
   policy is authoritative and circuit state cannot expose a hidden method.
6. Existing outage-provenance password-change challenges must remain bound to
   their original authority until consumed or invalidated. They may not silently
   convert to a newly enabled direct method.

## Consequences

- Provider status improves error text without changing the authorization
  boundary.
- An outage can reveal an already enabled portal backup but cannot create one.
- Browser return is best-effort for upstream HTTP failure and explicitly cannot
  solve public DNS or TLS failure.
- The Redis circuit implementation can be removed after the legacy-policy
  compatibility window and evidence retention period.

## Rollback

Rollback to a binary where circuit state authorizes methods requires a separate
security review and explicit session/challenge handling. Prefer roll-forward
with the saved portal policy. Do not delete Redis, database, or audit evidence
to force a policy transition.
