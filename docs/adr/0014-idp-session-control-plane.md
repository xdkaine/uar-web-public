# ADR-0014: IdP Session Control Plane

Date: 2026-08-26
Status: Accepted
Contexts: identity governance (primary), platform delivery (migration ownership)

## Context

The standalone OIDC provider (`services/auth-service/`, ADR-0012) is becoming the
enterprise IdP control plane. Operators had no way to answer "who is signed in via
this service right now, from where, using which application" and no way to force
sign-out beyond a single relying party's own backchannel logout. Additionally:

- Per-application session lifetimes were env-var-only (`AUTH_SESSION_TTL_*`) while
  the client registry existed in Postgres — the documented "registry will replace
  the env lookup later" seam.
- The portal's admin kill-session only revoked the portal row; the provider
  session survived, so killed users silently SSO'd straight back in.
- The portal de-merge (portal migration `20260825100000_drop_portal_auth_branding_oidc_clients`)
  removed the shared `OidcClient` table without any migration recreating it for
  new deployments, leaving registry code pointing at a table that no longer exists.

## Decision

1. **Sign-in context capture.** Successful sign-ins (AD, break-glass,
   forced-password-change) capture `{ clientId, ip, userAgent, deviceId,
   deviceCookieId }`. oidc-provider whitelists serialized session fields
   (`Session.IN_PAYLOAD`), so this cannot ride on the session payload. Instead the
   interaction handler stashes it under `authsvc:lastlogin:<account>` and the Redis
   adapter copies it into a sidecar record `authsvc:sessmeta:<jti>` on the session's
   first save after login, consuming the stash exactly once (600 s freshness window;
   later saves of an SSO-reused session never overwrite original attribution).
2. **Device identification is first-party and transparent.** The sign-in form
   submits a coarse FNV-1a digest over standard platform attributes plus a
   server-set `authsvc_did` UUID cookie (HttpOnly, SameSite=Lax, Secure on HTTPS
   issuers, 180 days). No canvas/audio fingerprinting, no third-party trackers, no
   evercookies. This data is an operational attribution aid, not an authentication
   factor, and never enters tokens or consented claims.
3. **Enumeration and forced logout** live behind the AD-authenticated `/admin`
   console (`GET /admin/api/sessions`, `POST /admin/api/sessions/destroy` with
   scope `sid|user|client`), same-origin-checked like all console mutations. There
   is deliberately **no** new Basic-auth `/internal/*` surface: management stays in
   the IdP console per the de-merge direction. Every forced logout writes a
   `SESSION_FORCE_LOGOUT` audit row (actor, scope, target, destroyed count).
   Durable sign-in history rides on the existing shared `AuditLog`
   (`LOGIN_SUCCESS`, `LOGOUT`, `SESSION_FORCE_LOGOUT`) rather than a new table.
4. **Per-app session TTL moves into the registry.** `OidcClient.sessionTtlSeconds`
   (nullable, clamped 5 min – 30 days) is mirrored into an in-process cache at boot
   and on every mutation because oidc-provider invokes `ttl.Session` synchronously.
   Resolution order: registry → legacy env override → 8 h default.
5. **Portal full-logout parity.** `revokeSessionById` returns the deleted row's
   `providerSid`; admin kill-session and admin logout fire the existing
   backchannel-logout so force-killed users cannot SSO back in.
6. **Migration ownership and transfer.** The auth service owns `OidcClient`
   going forward (migration `20260826000000_auth_service_owns_oidc_client_registry`,
   idempotent, includes `sessionTtlSeconds`). The immutable portal DROP migration
   remains unchanged, but portal migrations immediately before and after it rename
   `OidcClient` and `AuthBrandingProfile` through reserved transfer relation names.
   PostgreSQL renames preserve rows, indexes, constraints, and encrypted secret
   envelopes exactly. Deployments that already completed the historical DROP are
   left untouched; lost rows require a verified pre-drop restore or client rotation
   and re-registration.

## Consequences

- Operators can enumerate live IdP sessions with app/IP/device attribution and
  force sign-out at session, user, or application granularity from one console.
- Attribution is best-effort: sessions predating this change have no sidecar and
  render as `-`; a same-account simultaneous-login race resolves to latest-write.
- The console JS was refactored to share helpers across view modules, fixing a
  latent ReferenceError that broke the Applications view toggle.
- Rollback: revert the code; sidecar/stash keys simply expire. Dropping
  `sessionTtlSeconds` is optional and non-breaking (column is nullable).
- Release migrations are portal-first then auth-service through the Docker-backed
  migration gate. Before execution it verifies a restricted backup declaration,
  Prisma ledgers, schema/inventory fingerprints, and decryptability of encrypted
  client secrets without emitting secret material. The legacy bootstrap accepts
  only an empty schema or the exact recognized pre-migration shape.

## Validation

- `services/auth-service`: `npm test` (68 tests incl. new enumeration/destruction/
  TTL suites), `npm run build`.
- Portal: focused eslint clean on changed files; full Vitest suite green.

## Amendment (2026-08-26): push-based back-channel logout

Decision 3 above stated there is deliberately no new Basic-auth `/internal/*`
surface; that remains true — no management API was added. Force-logout
propagation is now push-based instead: on every destroy scope (`sid`, `user`,
`client`), the auth service mints an OIDC Back-Channel Logout token (RS256 under
the provider's own JWKS; claims `iss`, `aud` = target clientId, `iat`, `jti`,
the backchannel-logout event, `sid`; no `nonce`) and POSTs it to each affected
relying party's registered `backchannel_logout_uri`.

This creates a new trust direction that decision 3 did not anticipate: relying
parties must accept **unauthenticated but cryptographically signed** requests
originating from the IdP (the portal's receiver validates the signature against
the published JWKS plus issuer/audience/timing/event checks and is deliberately
exempted from CSRF because it carries no browser credentials). The IdP holds the
RP callback URLs as registry configuration. Delivery outcomes are recorded
per-RP in the `SESSION_FORCE_LOGOUT` audit row and surfaced in the console;
v1 records failures honestly without a retry queue (manual re-kill re-pushes).
