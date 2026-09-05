# ADR-0005: Operational configuration precedence and environment eviction

Status: Accepted

## Context

Operational connection settings (LDAP URL/bases/bind DN/admin groups/domain/provisioning groups, SMTP host/port/user) live only in environment variables read through `getRequiredEnv`. Operators cannot change them without a deployment, and `.env` in this repository mirrors production values — an unsafe confluence of deployment and organization configuration. The roadmap (§7) requires separating organization policy from bootstrap secrets with precedence `persisted -> legacy env -> safe default`.

## Decision

1. **Typed registry** (`lib/config/registry.ts`): a key exists only if registered, carrying its description, legacy `envFallback` name, validator, parser, and safe default. Initial keys cover LDAP connection metadata and SMTP relay settings.
2. **Resolution** (`lib/config/resolver.ts`): stored `SystemConfigEntry` row → legacy environment → safe default. Every resolution reads the database so authorization and credential changes are visible across app replicas immediately; there is no process-local configuration cache. Environment fallback is used only when the key has no stored row. An unreadable store, invalid stored row, or undecryptable stored secret fails closed instead of silently activating a different environment value.
3. **Operational secrets**: bind and SMTP passwords may be saved only through the encrypted secret configuration path. TLS trust material (`LDAP_CA_CERT_BASE64`) and database/session/CSRF/Turnstile/cron secrets remain deployment-owned and environment-only.
4. **Consumer migration**: directory and email consumers resolve registry keys through the shared resolver. First deployments behave identically because no rows exist and environment values apply. Once operators save values, the UI shows each key's active source (`database` / `environment` / `default`); clearing a stored value deliberately deletes the row and restores environment fallback.
5. **SMTP transport** is built lazily from resolved settings and rebuilt automatically when they change.

## Consequences

- Removing an env var is safe only after its key is saved in System Configuration (the UI's source badge makes this observable).
- Invalid stored values or a configuration-store outage stop the affected operation. This avoids silently using stale deployment values after an operator has established database authority.
- Follow-ups: wire the LDAP modules onto the resolver (requires making `createLDAPClient` async), relax boot validation once keys are migrated, then introduce the secret provider for credentials.

## Alternatives considered

- Moving everything including passwords into DB rows: rejected — plaintext credential storage violates the credential-retention invariant until an encryption-backed secret provider exists.
- Import-time constants from config: rejected — module-load evaluation predates database availability and breaks testability.
