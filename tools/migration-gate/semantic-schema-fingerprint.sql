-- Order-independent semantic fingerprint for comparing an upgraded database
-- with a clean install. Column ordinal position and the default public-schema
-- comment are intentionally excluded because neither affects application
-- behavior. Index readiness/validity, constraints, functions, triggers,
-- policies, views, sequences, extensions, defaults, and collations are covered.
WITH relation_inventory AS (
  SELECT md5(coalesce(string_agg(
    c.relname || ':' || c.relkind::text || ':' || c.relpersistence::text || ':' ||
    c.relrowsecurity::text || ':' || c.relforcerowsecurity::text,
    ',' ORDER BY c.relname
  ), '')) AS digest
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'S')
), column_inventory AS (
  SELECT md5(coalesce(string_agg(
    c.relname || ':' || a.attname || ':' ||
    pg_catalog.format_type(a.atttypid, a.atttypmod) || ':' ||
    a.attnotnull::text || ':' || a.attidentity::text || ':' ||
    a.attgenerated::text || ':' ||
    coalesce(coll_ns.nspname || '.' || coll.collname, '') || ':' ||
    coalesce(coll.collprovider::text, '') || ':' ||
    coalesce(coll.collversion, '') || ':' ||
    coalesce(pg_get_expr(d.adbin, d.adrelid), ''),
    ',' ORDER BY c.relname, a.attname
  ), '')) AS digest
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_attribute a ON a.attrelid = c.oid
  LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
  LEFT JOIN pg_collation coll ON coll.oid = a.attcollation AND a.attcollation <> 0
  LEFT JOIN pg_namespace coll_ns ON coll_ns.oid = coll.collnamespace
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p', 'v', 'm')
    AND a.attnum > 0
    AND NOT a.attisdropped
), index_inventory AS (
  SELECT md5(coalesce(string_agg(
    c.relname || ':' || i.relname || ':' ||
    idx.indisunique::text || ':' || idx.indisprimary::text || ':' ||
    idx.indisexclusion::text || ':' || idx.indimmediate::text || ':' ||
    idx.indisvalid::text || ':' || idx.indisready::text || ':' ||
    idx.indislive::text || ':' || pg_get_indexdef(i.oid),
    ',' ORDER BY c.relname, i.relname
  ), '')) AS digest
  FROM pg_index idx
  JOIN pg_class i ON i.oid = idx.indexrelid
  JOIN pg_class c ON c.oid = idx.indrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
), constraint_inventory AS (
  SELECT md5(coalesce(string_agg(
    c.relname || ':' || con.conname || ':' || con.contype::text || ':' ||
    con.convalidated::text || ':' || con.condeferrable::text || ':' ||
    con.condeferred::text || ':' || pg_get_constraintdef(con.oid, true),
    ',' ORDER BY c.relname, con.conname
  ), '')) AS digest
  FROM pg_constraint con
  JOIN pg_class c ON c.oid = con.conrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
), function_inventory AS (
  SELECT md5(coalesce(string_agg(
    p.proname || '(' || pg_get_function_identity_arguments(p.oid) || '):' ||
    pg_get_functiondef(p.oid),
    ',' ORDER BY p.proname, pg_get_function_identity_arguments(p.oid)
  ), '')) AS digest
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
), trigger_inventory AS (
  SELECT md5(coalesce(string_agg(
    c.relname || ':' || t.tgname || ':' || t.tgenabled::text || ':' ||
    pg_get_triggerdef(t.oid, true),
    ',' ORDER BY c.relname, t.tgname
  ), '')) AS digest
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND NOT t.tgisinternal
), policy_inventory AS (
  SELECT md5(coalesce(string_agg(
    c.relname || ':' || pol.polname || ':' || pol.polpermissive::text || ':' ||
    pol.polroles::text || ':' || pol.polcmd::text || ':' ||
    coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') || ':' ||
    coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), ''),
    ',' ORDER BY c.relname, pol.polname
  ), '')) AS digest
  FROM pg_policy pol
  JOIN pg_class c ON c.oid = pol.polrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
), view_inventory AS (
  SELECT md5(coalesce(string_agg(
    c.relname || ':' || pg_get_viewdef(c.oid, true),
    ',' ORDER BY c.relname
  ), '')) AS digest
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm')
), sequence_inventory AS (
  SELECT md5(coalesce(string_agg(
    c.relname || ':' || s.seqtypid::regtype::text || ':' ||
    s.seqstart::text || ':' || s.seqincrement::text || ':' ||
    s.seqmax::text || ':' || s.seqmin::text || ':' ||
    s.seqcache::text || ':' || s.seqcycle::text,
    ',' ORDER BY c.relname
  ), '')) AS digest
  FROM pg_sequence s
  JOIN pg_class c ON c.oid = s.seqrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
), extension_inventory AS (
  SELECT md5(coalesce(string_agg(
    ext.extname || ':' || ext.extversion || ':' || n.nspname,
    ',' ORDER BY ext.extname
  ), '')) AS digest
  FROM pg_extension ext
  JOIN pg_namespace n ON n.oid = ext.extnamespace
  WHERE n.nspname = 'public'
)
SELECT md5(concat_ws('|',
  relation_inventory.digest,
  column_inventory.digest,
  index_inventory.digest,
  constraint_inventory.digest,
  function_inventory.digest,
  trigger_inventory.digest,
  policy_inventory.digest,
  view_inventory.digest,
  sequence_inventory.digest,
  extension_inventory.digest
))
FROM relation_inventory,
     column_inventory,
     index_inventory,
     constraint_inventory,
     function_inventory,
     trigger_inventory,
     policy_inventory,
     view_inventory,
     sequence_inventory,
     extension_inventory;
