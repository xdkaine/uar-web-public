# ADR-0017: Device-risk shadow evidence

Date: 2026-08-27
Status: Accepted
Contexts: identity governance (primary), platform delivery (retention and migration)

## Context

ADR-0014 added coarse first-party device attribution to live IdP sessions and
explicitly prohibited canvas/audio fingerprinting. Operators now need durable
evidence for security triage, while browser-derived identifiers remain
spoofable and unsuitable as authentication factors. The ADR-0014 handoff was
also keyed only by account, allowing simultaneous sign-ins by the same account
to exchange attribution metadata.

## Decision

1. New sign-ins correlate transient Redis context by account **and interaction
   uid**. On `authorization.success`, the provider's interaction entity and
   newly persisted Session JTI are both available, so the context moves to the
   exact session sidecar without an account-level race. The account-only key
   remains a compatibility path for existing callers, not the live interaction
   path.
2. A first-party script may derive a versioned digest from browser signals,
   including high-entropy UA hints and rendering/audio output. Only the digest
   is posted. No third-party tracker is loaded and no raw client signal set is
   persisted. This amends ADR-0014's prohibition for this bounded sign-in-only
   use.
3. Durable identifiers are HMAC-SHA-256 values under a dedicated key. Raw
   device-cookie values and submitted fingerprint digests are not written to
   PostgreSQL. Observations expire after 365 days and require a separate purge
   operation; expiry is not represented as automatic deletion.
4. Evaluation is opt-in with `AUTH_DEVICE_RISK_MODE=shadow` and a dedicated
   `AUTH_DEVICE_EVIDENCE_KEY` of at least 32 characters. Previous keys may be
   supplied in `AUTH_DEVICE_EVIDENCE_PREVIOUS_KEYS` for dual-read rotation;
   every new observation is written with the active key. `off` is the default
   and does not render or accept the browser fingerprint field.
   Shadow scores may populate audit and triage views but never allow, deny,
   step up, revoke, or shorten a session.
5. `enforce` is rejected by configuration in this release. AD-password step-up
   and session binding require a separately reviewed protocol that defines
   challenge state, recovery, false-positive handling, portal/IdP session
   correlation, and calibrated thresholds.

## Consequences

- Operators can distinguish first-seen, returning-cookie, returning-digest,
  browser-family-change, network-change, and break-glass evidence without
  treating a browser fingerprint as proof of identity.
- Browser signals are privacy-sensitive and can be spoofed. They are visible
  only to the restricted administration surface and remain absent from OIDC
  tokens and claims.
- The database migration creates nullable portal binding columns as a forward
  contract, but this release does not read or enforce them.
- Rollback sets the mode to `off`; existing observations remain until the
  independent `auth-device-evidence-maintenance` worker purges them, or an
  operator removes them under an approved process. The bounded worker records
  start and completion/partial audit events and runs independently of sign-in
  traffic and risk mode. Its health check requires a recent successful or
  partial pass; failures and backlogs retry on the shorter maintenance retry
  interval. Recovery procedures live in
  `docs/runbooks/auth-device-evidence-retention.md`.

## Validation

- Auth-service unit tests cover off-mode fail-closed behavior, risk scoring,
  high-entropy digest rendering, and simultaneous-login correlation.
- Production enablement requires a migration, a unique evidence key, a shadow
  pilot, score distribution review, and an explicit later enforcement ADR.
