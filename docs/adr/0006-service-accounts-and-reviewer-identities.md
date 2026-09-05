# ADR-0006: Service-account credentials in System Configuration and distinct reviewer identities

Status: Accepted

## Context

Two gaps remained after ADR-0003/0005:

1. The LDAP bind account and SMTP password still lived only in `.env`, which mirrors production values — operators cannot rotate them without a deployment, and deployment configuration stays conflated with organization configuration.
2. Directors and Faculty were indistinguishable: every admin surface required the live domain-admin check, so mapped reviewer roles could not grant access to anyone who was not already a full domain administrator.

## Decision

### Service-account credentials as managed secrets

- `ldap.bindPassword` and `smtp.password` join System Configuration as **secret-class keys** (`SECRET_CONFIG_REGISTRY`).
- Stored values are **encrypted at rest** (existing AES-256-GCM helper, `enc-v1` envelope) inside `SystemConfigEntry`.
- Read APIs return only `{ configured, source }` — plaintext is available exclusively through `getRequiredSecretValue()` for direct consumer use and must never be logged or echoed.
- Writes are write-only from the UI (blank field = unchanged; clearing removes the stored override so the environment fallback applies).
- Precedence matches ADR-0005: encrypted stored row → legacy environment variable. First deployments keep working unchanged.

### Distinct reviewer identities

- New authorization path `resolveReviewerAuthorization(username)` performs **one live directory lookup** and:
  1. grants `system_administrator` via the legacy fallback when membership matches the configured domain-admin groups (unchanged access for existing admins), and
  2. grants every role whose configured AD group DNs match the same membership set — making Director and Faculty real, separately-mapped identities.
- New route gate `checkReviewAccessWithRateLimit` accepts any authenticated session with at least one resolved reviewer role. It is applied **only to request-review surfaces** (queue list, request detail, acknowledge/approve/reject, faculty-handoff actions, director credential-preparation tools). All other admin APIs keep the strict system-administrator gate, so opening review access cannot leak operational or configuration surfaces.
- Inside review surfaces, per-stage enforcement (`actorCanActOnStage`) remains the authority on who may perform which transition — a Faculty-mapped user without a director mapping cannot action the director stage, and vice versa.
- Login stamps sessions elevated when any reviewer role resolves; responses include the resolved roles. Fail-closed is preserved: directory lookup failures produce zero roles and the same 401 as before.

## Consequences

- Rotating the bind password or SMTP password becomes a UI action with an audit trail, no deployment.
- Directors and Faculty are now visually and functionally separate populations defined entirely in Roles & Access (group DN mappings), with stage labels/requirements configurable per workflow version (ADR-0002).
- Follow-ups: filter admin navigation by resolved roles (reviewers currently see tabs whose APIs will 403), extend permission guards to remaining admin categories before widening the gate further, secret-provider extraction if credentials must leave the database entirely.

## Alternatives considered

- Granting reviewers all admin surfaces and relying on UI hiding: rejected — authorization must be enforced server-side per surface, not by navigation.
- Storing secrets plaintext in config rows: rejected — violates the credential-retention invariant; encryption-at-rest with redacted reads is the minimum acceptable boundary until a dedicated provider exists.
