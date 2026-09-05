-- Run after both Prisma projects migrate. Reports only schema/ledger state and
-- redacted inventory fingerprints; comparison is performed by the gate shell.
\ir preflight.sql

SELECT 'required_migrations_missing_count=' || count(*)::text
FROM (VALUES
  ('20260507000000_legacy_schema_bootstrap'),
  ('20260828223000_managed_page_revision_invariants'),
  ('20260827000000_identity_console_product'),
  ('20260829000000_production_candidate_recovery')
) AS required(migration_name)
LEFT JOIN "_prisma_migrations" applied
  ON applied.migration_name = required.migration_name
  AND applied.finished_at IS NOT NULL
  AND applied.rolled_back_at IS NULL
WHERE applied.migration_name IS NULL;
