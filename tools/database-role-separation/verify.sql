\set ON_ERROR_STOP on

WITH checks(check_name, role_name, table_name, privilege_name, expected) AS (
  VALUES
    ('portal_reads_portal_local', 'uar_portal_runtime', 'LocalAccount', 'SELECT', true),
    ('portal_updates_portal_local', 'uar_portal_runtime', 'LocalAccount', 'UPDATE', true),
    ('portal_creates_portal_session', 'uar_portal_runtime', 'Session', 'INSERT', true),
    ('portal_cannot_read_auth_recovery_hash', 'uar_portal_runtime', 'AuthAdminLocalAccount', 'SELECT', false),
    ('portal_cannot_read_oidc_client_secret', 'uar_portal_runtime', 'OidcClient', 'SELECT', false),
    ('portal_cannot_update_migration_ledger', 'uar_portal_runtime', '_prisma_migrations', 'UPDATE', false),
    ('auth_reads_auth_recovery', 'uar_auth_runtime', 'AuthAdminLocalAccount', 'SELECT', true),
    ('auth_rotates_auth_recovery', 'uar_auth_runtime', 'AuthAdminLocalAccount', 'UPDATE', true),
    ('auth_reads_oidc_client', 'uar_auth_runtime', 'OidcClient', 'SELECT', true),
    ('auth_updates_oidc_client', 'uar_auth_runtime', 'OidcClient', 'UPDATE', true),
    ('auth_reads_audit', 'uar_auth_runtime', 'AuditLog', 'SELECT', true),
    ('auth_writes_audit', 'uar_auth_runtime', 'AuditLog', 'INSERT', true),
    ('auth_cannot_read_portal_local_hash', 'uar_auth_runtime', 'LocalAccount', 'SELECT', false),
    ('auth_cannot_read_portal_sessions', 'uar_auth_runtime', 'Session', 'SELECT', false),
    ('auth_cannot_update_migration_ledger', 'uar_auth_runtime', '_prisma_migrations', 'UPDATE', false)
), evaluated AS (
  SELECT
    check_name,
    role_name,
    table_name,
    privilege_name,
    expected,
    to_regclass(format('%I.%I', 'public', table_name)) AS relation_oid
  FROM checks
), results AS (
  SELECT
    check_name,
    table_name,
    privilege_name,
    expected,
    CASE
      WHEN relation_oid IS NULL THEN NULL
      ELSE has_table_privilege(role_name, relation_oid, privilege_name)
    END AS actual
  FROM evaluated
)
SELECT
  check_name,
  table_name,
  privilege_name,
  COALESCE(actual::text, 'table_missing') AS actual,
  expected,
  CASE WHEN actual IS NOT NULL AND actual = expected THEN 'pass' ELSE 'fail' END AS result
FROM results
ORDER BY check_name;

WITH checks(role_name, table_name, privilege_name, expected) AS (
  VALUES
    ('uar_portal_runtime', 'LocalAccount', 'SELECT', true),
    ('uar_portal_runtime', 'LocalAccount', 'UPDATE', true),
    ('uar_portal_runtime', 'Session', 'INSERT', true),
    ('uar_portal_runtime', 'AuthAdminLocalAccount', 'SELECT', false),
    ('uar_portal_runtime', 'OidcClient', 'SELECT', false),
    ('uar_portal_runtime', '_prisma_migrations', 'UPDATE', false),
    ('uar_auth_runtime', 'AuthAdminLocalAccount', 'SELECT', true),
    ('uar_auth_runtime', 'AuthAdminLocalAccount', 'UPDATE', true),
    ('uar_auth_runtime', 'OidcClient', 'SELECT', true),
    ('uar_auth_runtime', 'OidcClient', 'UPDATE', true),
    ('uar_auth_runtime', 'AuditLog', 'SELECT', true),
    ('uar_auth_runtime', 'AuditLog', 'INSERT', true),
    ('uar_auth_runtime', 'LocalAccount', 'SELECT', false),
    ('uar_auth_runtime', 'Session', 'SELECT', false),
    ('uar_auth_runtime', '_prisma_migrations', 'UPDATE', false)
), result AS (
  SELECT bool_or(
    relation_oid IS NULL
    OR has_table_privilege(role_name, relation_oid, privilege_name) <> expected
  ) AS verification_failed
  FROM (
    SELECT
      checks.*,
      to_regclass(format('%I.%I', 'public', table_name)) AS relation_oid
    FROM checks
  ) resolved
)
SELECT verification_failed FROM result
\gset

WITH membership_checks(role_name, owner_membership_expected) AS (
  VALUES
    ('uar_migration', true),
    ('uar_portal_runtime', false),
    ('uar_auth_runtime', false)
)
SELECT
  role_name,
  pg_has_role(role_name, 'uar_schema_owner', 'MEMBER') AS owner_member,
  owner_membership_expected AS expected,
  CASE
    WHEN pg_has_role(role_name, 'uar_schema_owner', 'MEMBER') = owner_membership_expected
    THEN 'pass'
    ELSE 'fail'
  END AS result
FROM membership_checks
ORDER BY role_name;

WITH membership_checks(role_name, owner_membership_expected) AS (
  VALUES
    ('uar_migration', true),
    ('uar_portal_runtime', false),
    ('uar_auth_runtime', false)
)
SELECT bool_or(
  pg_has_role(role_name, 'uar_schema_owner', 'MEMBER') <> owner_membership_expected
  OR (
    role_name IN ('uar_portal_runtime', 'uar_auth_runtime')
    AND pg_has_role(role_name, 'uar_migration', 'MEMBER')
  )
) AS membership_verification_failed
FROM membership_checks
\gset

WITH schema_checks(role_name, create_expected) AS (
  VALUES
    ('uar_migration', true),
    ('uar_portal_runtime', false),
    ('uar_auth_runtime', false)
)
SELECT
  role_name,
  has_schema_privilege(role_name, 'public', 'CREATE') AS can_create,
  create_expected AS expected,
  CASE
    WHEN has_schema_privilege(role_name, 'public', 'CREATE') = create_expected
    THEN 'pass'
    ELSE 'fail'
  END AS result
FROM schema_checks
ORDER BY role_name;

WITH schema_checks(role_name, create_expected) AS (
  VALUES
    ('uar_migration', true),
    ('uar_portal_runtime', false),
    ('uar_auth_runtime', false)
)
SELECT bool_or(
  has_schema_privilege(role_name, 'public', 'CREATE') <> create_expected
) AS schema_verification_failed
FROM schema_checks
\gset

\if :verification_failed
  \echo 'database role verification failed'
  \quit 3
\elif :membership_verification_failed
  \echo 'database role membership verification failed'
  \quit 3
\elif :schema_verification_failed
  \echo 'database role schema verification failed'
  \quit 3
\else
  \echo 'database role verification passed'
\endif
