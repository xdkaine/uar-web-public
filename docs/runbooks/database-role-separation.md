# Database role separation

The portal, auth service, and migration runner use separate PostgreSQL login
roles. This prevents either runtime from reading the other application's
credential hashes or client secrets even though both applications currently
share one database and the `public` schema.

| Role | Connection setting | Access |
| --- | --- | --- |
| `uar_portal_runtime` | `PORTAL_DATABASE_URL` | Portal-owned tables, including `LocalAccount` and `Session`; no auth-service tables |
| `uar_auth_runtime` | `AUTH_DATABASE_URL` | Auth-service-owned tables plus read/insert on the shared `AuditLog`; no portal `LocalAccount` or `Session` |
| `uar_migration` | `MIGRATION_DATABASE_URL` | Schema-owner membership for portal-first/auth-second migrations |

Compose temporarily falls back from either empty runtime URL to
`MIGRATION_DATABASE_URL`. That compatibility path exists only for the staged
rollout. A completed production rollout sets all three URLs to distinct login
roles and treats an empty runtime URL as a release-gate failure.

## Provision or rotate the roles

Take and verify the normal deployment backup first. Prepare three independent,
random passwords in the deployment secret store. Use standard libpq variables
to connect as the current database owner or a PostgreSQL administrator, then
run the role tool without shell tracing:

```sh
export PGHOST=postgres
export PGPORT=5432
export PGDATABASE=uar_database
export PGUSER=uar_user
export PGPASSWORD='owner password from secret store'
export PORTAL_DATABASE_PASSWORD='new independent secret'
export AUTH_DATABASE_PASSWORD='new independent secret'
export MIGRATION_DATABASE_PASSWORD='new independent secret'
tools/database-role-separation/apply.sh
```

The script is idempotent. It creates a no-login schema owner, transfers objects
in `public` to it, rotates the three login passwords, removes all runtime table
grants, reapplies the explicit ownership map, and runs the privilege checks.
It does not print connection strings or password values. Do not use `set -x`,
psql query echo, or command-line password arguments.

Store URL-encoded connection strings in the deployment secret system:

```text
PORTAL_DATABASE_URL=postgresql://uar_portal_runtime:<encoded-secret>@postgres:5432/uar_database?sslmode=disable
AUTH_DATABASE_URL=postgresql://uar_auth_runtime:<encoded-secret>@postgres:5432/uar_database?sslmode=disable
MIGRATION_DATABASE_URL=postgresql://uar_migration:<encoded-secret>@postgres:5432/uar_database?sslmode=disable
```

Use the deployment's required verified TLS mode instead of `sslmode=disable`
when PostgreSQL crosses an untrusted network. Never put the rendered URLs in a
release log or attach a rendered Compose configuration to evidence.

## Migration and release order

1. Leave running replicas on their existing connection settings.
2. Apply the portal migrations first and auth-service migrations second with
   `MIGRATION_DATABASE_URL` through the normal migration gate.
3. Run `tools/database-role-separation/apply.sh` again. New tables receive no
   runtime grants until this step intentionally assigns them.
4. Save the three connection URLs and validate Compose without printing its
   rendered configuration.
5. During the authorized release, recreate the auth service with
   `AUTH_DATABASE_URL`, then the portal with `PORTAL_DATABASE_URL`.
6. Prove normal portal and Auth Manager reads/writes, then run
   `tools/database-role-separation/verify.sh` from the owner connection.

Migration, role provisioning, and service recreation are production changes;
perform them only inside an approved deployment window.

## Privilege evidence

The final command in `apply.sh` executes `verify.sql`. It must report `pass`
for every row and end with `database role verification passed`. The checks
prove both positive access and these negative boundaries:

- the portal cannot select the auth recovery password hash or OIDC client
  secret;
- the auth service cannot select portal local-account password hashes;
- the auth service cannot select portal sessions;
- neither runtime role can update the Prisma migration ledger;
- neither runtime role inherits the schema-owner role or can create objects in
  `public`.

If a required migration has not created `AuthAdminLocalAccount`, the check
reports `table_missing` and fails. Preserve that failure as evidence and apply
the checked-in migration through the migration gate; do not create the table
by hand or use `prisma db push`.

For rollback, restore the previous service binaries before changing runtime
URLs. Temporarily clearing a runtime URL re-enables the migration-role fallback
and therefore broadens database authority; use that only as an explicitly
approved recovery action. Keep the role and table ownership changes in place,
repair forward, rotate any exposed credential, and rerun the grant verification.
