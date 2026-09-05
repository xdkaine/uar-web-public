# Release hardening migration recovery

Migration `20260827100000_release_hardening` added durable hashed profile-email verification tokens, lifecycle execution claims, legacy post-commit infrastructure directory-description tasks (stored under the compatibility model name `InfrastructureTaggingTask`), monitoring configuration revisions, faculty-delivery evidence, and workflow version guards. New infrastructure directory-description tasks and retries are now retired; existing rows remain historical reconciliation evidence only. Migration `20260829000000_production_candidate_recovery` adds hashed public-request verification tokens plus durable claims and reconciliation evidence for account updates, workflow timers/actions, offboard enforcement, mass-email delivery, and identity-provider logout.

## Data impact

- The token table is additive. Raw verification tokens are never stored in it.
- If a workflow name has multiple draft rows, the newest version remains a draft and older drafts become disabled historical rows.
- If a workflow name has multiple enabled rows, the newest enabled version remains active and older versions are disabled. Published definitions and their run history are not deleted or rewritten.
- Partial unique indexes then enforce one draft and one enabled version per workflow name.
- Existing lifecycle rows still marked `processing` cannot prove exclusive ownership. The migration moves them to `reconciliation_required`; verify AD and VPN state before choosing an explicit recovery action.
- Infrastructure directory-description task rows are legacy evidence only. Do not replay them or mutate LDAP metadata from them; reconcile portal ownership and record the operator decision instead.
- `MonitoredEndpoint.configVersion` begins at zero and changes only for operator configuration writes; health telemetry does not invalidate configuration edits.
- Existing public verification links are converted to SHA-256 fingerprints during the migration and the plaintext column is cleared. New and resent links store only the fingerprint; confirmation never accepts the raw database column.
- A mass-email recipient that was `sending`, or an offboard recipient that was `enforcement_processing`, is moved to an explicit unknown/reconciliation state during migration. Never bulk-reset these rows.
- Existing workflow timers become `pending`; once the new worker claims a timer, an expired claim requires operator evidence and is never automatically re-armed.
- Provider logout tasks are written in the same database transaction that removes portal sessions. A failed or expired provider claim blocks lifecycle/offboard finalization and remains available in the workflow recovery queue; raw provider session identifiers are never returned by that API.

Review the duplicate-cleanup query results before applying this migration in a production environment. Migration execution requires the repository's normal production authorization and backup gate.

## Migration-less historical databases

`baseline-and-migrate` accepts only two exact no-ledger shapes:

- the 34-table schema from commit `34334d6f05df521a0781aaa43e6509bcca6f414a`; or
- the 40-table production schema from commit `0e8a97ebe9f43013dbee34829691822c7706911f`.

The historical bootstrap migration is immutable and remains byte-for-byte the
original 34-table migration. `baseline-and-migrate` never executes that SQL on
an existing database. Before any ledger entry is resolved, the read-only
`legacy-baseline-preflight-v1.sql` guard must return exactly one marker:
`legacy_baseline_shape=legacy_34334d6` or
`legacy_baseline_shape=production_0e8a97`. No marker means the database is
unknown, partial, fingerprint-mismatched, or already has a Prisma ledger, and
the gate stops without writing.

The 40-table marker verifies exact relation names plus column types,
nullability, defaults, identity/generated flags and collations; complete index
definitions; and PK, unique, check, FK, and exclusion definitions. Only the
`production_0e8a97` marker resolves the six historical migrations present at
that revision before continuing with portal migrations and then auth migrations.
A changed default, same-name non-unique index, or same-name FK with different
actions produces no marker and must fail.

Clone rehearsals additionally require a database name different from the
source, a non-empty per-clone database attestation, clone-only credentials, an
internal network without a published port, and a database-only backup manifest.
Database-only manifests are never accepted for a production migration. Ambient
and env-file disagreements for the database URL, baseline approval, backup age,
clone identity, or auth encryption key fail before a target query.

After migration, run a second deploy and require both Prisma projects to report
no pending migrations. Compare the upgraded database with a clean install using
`tools/migration-gate/semantic-schema-fingerprint.sql`; this comparison ignores
only column ordinal position and the standard `public` schema comment while
covering operational schema semantics.

## Forward recovery

If `baseline-and-migrate` is interrupted after one or more `migrate resolve`
commands, stop the run. Inspect the Prisma ledger and the recorded gate output,
then use a reviewed recovery procedure for that exact ledger state. Do not
blindly retry `baseline-and-migrate`: it admits only a no-ledger shape and a
partial resolved history is neither accepted shape.

If application rollout fails after the database migration, leave the additive tables, columns, and indexes in place while rolling the application back. Hashed verification links should be allowed to expire or be reissued after the hardened application is restored. Do not recreate plaintext tokens; code predating hashed verification is not a compatible rollback target.

If a verification has `directory_applied` or `reconciliation_required` state, compare the recorded desired email with the current directory `mail` value and the AccessRequest version. Resume database finalization when they agree. Never clear a non-empty directory email as rollback.

If workflow cleanup selected the wrong active version, use the audited workflow activation action after the application is restored. Do not edit a published graph definition or delete its run history.

For lifecycle reconciliation, compare the action's related portal request, captured directory DN/object GUID, current AD/VPN state, and action history. Never return an ambiguous post-side-effect action directly to `queued`. Infrastructure-sync LDAP metadata retries are retired; retain old task rows as evidence and reconcile portal ownership without replaying them. Directory extension attributes are not request-binding evidence.

For workflow timers, offboard enforcement, session revocation, and email delivery, use the operator recovery control only after provider/directory evidence establishes the selected outcome. `delivery_unknown` can be retried only when evidence proves non-delivery. Account-update reconciliation must compare both authoritative source identities and every recorded attempted/completed step before any new mutation.

## Rollback limits

A strict schema rollback is normally unnecessary and would remove evidence. If the hardened code will not return, first confirm that no rows in `ProfileEmailVerificationToken`, `AccountLifecycleAction`, `InfrastructureTaggingTask`, `ProviderLogoutTask`, `FlowActionAttempt`, `FlowTimer`, `OffboardCampaignRecipient`, `MassEmailRecipient`, or `AccessRequest` require reconciliation. Only then may an authorized database operator remove additive columns/tables and the two partial workflow indexes using a separately reviewed rollback migration. Dropping claims, attempt records, or provider logout tasks discards recovery evidence and is not a safe automatic rollback. Restoring multiple active or draft workflow versions is also not automatic; activation must be chosen explicitly from the retained published rows.
