-- Deterministic, secret-free fingerprint of the public schema. This excludes
-- row data and object ownership so a dump/restore comparison is portable.
\pset tuples_only on
\pset format unaligned

WITH schema_objects(definition) AS (
  SELECT concat_ws('|',
    'column', table_name, column_name, ordinal_position::text,
    data_type, udt_schema, udt_name, is_nullable,
    coalesce(column_default, ''),
    coalesce(character_maximum_length::text, ''),
    coalesce(numeric_precision::text, ''),
    coalesce(numeric_scale::text, '')
  )
  FROM information_schema.columns
  WHERE table_schema = 'public'

  UNION ALL

  SELECT concat_ws('|',
    'constraint', relation.relname, constraint_row.conname,
    pg_get_constraintdef(constraint_row.oid, true)
  )
  FROM pg_constraint constraint_row
  JOIN pg_class relation ON relation.oid = constraint_row.conrelid
  JOIN pg_namespace namespace_row ON namespace_row.oid = relation.relnamespace
  WHERE namespace_row.nspname = 'public'

  UNION ALL

  SELECT concat_ws('|',
    'index', table_row.relname, index_row.relname,
    pg_get_indexdef(index_row.oid)
  )
  FROM pg_index index_membership
  JOIN pg_class table_row ON table_row.oid = index_membership.indrelid
  JOIN pg_class index_row ON index_row.oid = index_membership.indexrelid
  JOIN pg_namespace namespace_row ON namespace_row.oid = table_row.relnamespace
  WHERE namespace_row.nspname = 'public'
)
SELECT md5(coalesce(string_agg(definition, E'\n' ORDER BY definition), ''))
FROM schema_objects;
