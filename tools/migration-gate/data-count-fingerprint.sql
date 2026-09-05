-- Secret-free fidelity receipt for a restored clone. The digest covers the
-- row count of every public table, including the Prisma ledger, without
-- reading or emitting any row contents.
\pset tuples_only on
\pset format unaligned

CREATE OR REPLACE FUNCTION pg_temp.table_count_fingerprint()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  relation_row RECORD;
  relation_count BIGINT;
  inventory TEXT := '';
BEGIN
  FOR relation_row IN
    SELECT tablename
    FROM pg_catalog.pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename
  LOOP
    EXECUTE format('SELECT count(*) FROM %I', relation_row.tablename)
      INTO relation_count;
    inventory := inventory || relation_row.tablename || '=' || relation_count::text || '|';
  END LOOP;
  RETURN md5(inventory);
END $$;

SELECT pg_temp.table_count_fingerprint();
