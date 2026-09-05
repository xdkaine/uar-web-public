-- Secret-safe preflight report. It deliberately emits only counts and stable
-- digests; never client identifiers, client secrets, URLs, or migration SQL.
\pset tuples_only on
\pset format unaligned

CREATE OR REPLACE FUNCTION pg_temp.migration_gate_relation_digest(
  relation_name TEXT,
  sort_column TEXT
)
RETURNS TABLE(relation_exists BOOLEAN, row_count TEXT, inventory_digest TEXT)
LANGUAGE plpgsql
AS $$
BEGIN
  relation_exists := to_regclass(format('public.%I', relation_name)) IS NOT NULL;
  IF NOT relation_exists THEN
    row_count := '0';
    inventory_digest := md5('');
    RETURN NEXT;
    RETURN;
  END IF;

  EXECUTE format(
    'SELECT count(*)::text, md5(coalesce(string_agg(%1$I::text, '','' ORDER BY %1$I), '''')) FROM %2$I',
    sort_column,
    relation_name
  ) INTO row_count, inventory_digest;
  RETURN NEXT;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.migration_gate_unresolved_migrations()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  unresolved_count TEXT;
BEGIN
  IF to_regclass('public."_prisma_migrations"') IS NULL THEN
    RETURN '0';
  END IF;

  EXECUTE 'SELECT count(*)::text FROM "_prisma_migrations" WHERE "finished_at" IS NULL OR "rolled_back_at" IS NOT NULL'
    INTO unresolved_count;
  RETURN unresolved_count;
END $$;

SELECT 'portal_migration_ledger_count=' || row_count
FROM pg_temp.migration_gate_relation_digest('_prisma_migrations', 'migration_name');
SELECT 'portal_migration_ledger_digest=' || inventory_digest
FROM pg_temp.migration_gate_relation_digest('_prisma_migrations', 'migration_name');
SELECT 'portal_migration_ledger_unresolved_count=' || pg_temp.migration_gate_unresolved_migrations();

SELECT 'public_user_table_count=' || count(*)::text
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relname <> '_prisma_migrations';
SELECT 'target_database_name_digest=' || md5(current_database());
SELECT 'target_database_clone_attestation_present=' ||
  (nullif(current_setting('uar.clone_attestation', true), '') IS NOT NULL)::text;
SELECT 'target_database_clone_attestation_digest=' ||
  md5(coalesce(current_setting('uar.clone_attestation', true), ''));

SELECT 'public_schema_fingerprint=' || md5(coalesce(string_agg(c.relname || ':' || a.column_count, ',' ORDER BY c.relname), ''))
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN LATERAL (
  SELECT count(*)::text AS column_count
  FROM pg_attribute a
  WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
) a ON true
WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> '_prisma_migrations';

SELECT 'oidc_client_table_present=' || relation_exists::text
FROM pg_temp.migration_gate_relation_digest('OidcClient', 'clientId');
SELECT 'auth_branding_profile_table_present=' || (to_regclass('public."AuthBrandingProfile"') IS NOT NULL)::text;
SELECT 'oidc_client_count=' || row_count
FROM pg_temp.migration_gate_relation_digest('OidcClient', 'clientId');
SELECT 'oidc_client_inventory_digest=' || inventory_digest
FROM pg_temp.migration_gate_relation_digest('OidcClient', 'clientId');
SELECT 'auth_branding_profile_count=' || row_count
FROM pg_temp.migration_gate_relation_digest('AuthBrandingProfile', 'id');
SELECT 'auth_branding_profile_inventory_digest=' || inventory_digest
FROM pg_temp.migration_gate_relation_digest('AuthBrandingProfile', 'id');
