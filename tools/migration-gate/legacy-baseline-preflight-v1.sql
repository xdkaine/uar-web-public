-- Read-only, no-ledger admission guard for historical portal databases.
-- The evolved production shape is the schema at 0e8a97ebe9f43013dbee34829691822c7706911f.
-- It returns one exact marker only when the public schema is a known complete
-- historical shape. Unknown, partial, or ledger-bearing schemas return no rows.
WITH
expected_legacy(name) AS (
  VALUES
    ('AccessRequest'), ('RequestComment'), ('Event'), ('PasswordResetToken'),
    ('AccountActivationToken'), ('SupportTicket'), ('TicketResponse'),
    ('TicketStatusLog'), ('BatchAccountCreation'), ('BatchAccountItem'),
    ('BatchAuditLog'), ('VPNAccount'), ('VPNAccountStatusLog'), ('VPNAccountComment'),
    ('VPNImport'), ('VPNImportRecord'), ('Session'), ('BlockedEmail'), ('SystemSettings'),
    ('NotificationBanner'), ('AuditLog'), ('AccountLifecycleAction'),
    ('OffboardCampaign'), ('OffboardCampaignRecipient'),
    ('OffboardCampaignRecipientToken'), ('OffboardCampaignLog'),
    ('AccountLifecycleBatch'), ('AccountLifecycleHistory'), ('VPNRoleChange'),
    ('ADAccountSync'), ('ADAccountMatch'), ('ADAccountActivityLog'),
    ('VPNAccountActivityLog'), ('ADAccountComment')
),
expected_production(name) AS (
  VALUES
    ('AccessRequest'), ('RequestComment'), ('Event'), ('PasswordResetToken'),
    ('AccountActivationToken'), ('SupportTicket'), ('TicketResponse'),
    ('TicketStatusLog'), ('BatchAccountCreation'), ('BatchAccountItem'),
    ('BatchAuditLog'), ('VPNAccount'), ('VPNAccountStatusLog'), ('VPNAccountComment'),
    ('VPNImport'), ('VPNImportRecord'), ('Session'), ('BlockedEmail'), ('SystemSettings'),
    ('NotificationBanner'), ('AuditLog'), ('AccountLifecycleAction'),
    ('OffboardCampaign'), ('OffboardCampaignRecipient'),
    ('OffboardCampaignRecipientToken'), ('OffboardCampaignLog'),
    ('AccountLifecycleBatch'), ('AccountLifecycleHistory'), ('VPNRoleChange'),
    ('ADAccountSync'), ('ADAccountMatch'), ('ADAccountActivityLog'),
    ('VPNAccountActivityLog'), ('ADAccountComment'), ('PasswordChangeChallenge'),
    ('MassEmailCampaign'), ('MassEmailRecipient'), ('MassEmailLog'),
    ('OffboardCampaignExtension'), ('OffboardCampaignExtensionReminder')
),
relations AS (
  SELECT coalesce(array_agg(c.relname ORDER BY c.relname), ARRAY[]::text[]) AS names,
         count(*)::integer AS relation_count,
         to_regclass('public."_prisma_migrations"') IS NULL AS ledger_absent
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
),
fingerprints AS (
  SELECT
    (
      SELECT md5(string_agg(c.relname || ':' || a.attname, ',' ORDER BY c.relname, a.attname))
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
        AND a.attnum > 0 AND NOT a.attisdropped
    ) AS column_fingerprint,
    (
      SELECT md5(string_agg(c.relname || ':' || a.attname || ':' ||
        pg_catalog.format_type(a.atttypid, a.atttypmod) || ':' ||
        a.attnotnull::text || ':' || a.attidentity::text || ':' ||
        a.attgenerated::text || ':' || coalesce(coll.collname, ''),
        ',' ORDER BY c.relname, a.attname))
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid
      LEFT JOIN pg_collation coll ON coll.oid = a.attcollation AND a.attcollation <> 0
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
        AND a.attnum > 0 AND NOT a.attisdropped
    ) AS column_definition_fingerprint,
    (
      SELECT md5(string_agg(c.relname || ':' || a.attname || ':' ||
        coalesce(pg_get_expr(d.adbin, d.adrelid), ''), ',' ORDER BY c.relname, a.attname))
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid
      LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
        AND a.attnum > 0 AND NOT a.attisdropped
    ) AS column_default_fingerprint,
    (
      SELECT md5(string_agg(c.relname || ':' || a.attname || ':' ||
        pg_catalog.format_type(a.atttypid, a.atttypmod) || ':' ||
        a.attnotnull::text || ':' || a.attidentity::text || ':' ||
        a.attgenerated::text || ':' || coalesce(coll.collname, '') || ':' ||
        coalesce(pg_get_expr(d.adbin, d.adrelid), ''), ',' ORDER BY c.relname, a.attname))
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid
      LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      LEFT JOIN pg_collation coll ON coll.oid = a.attcollation AND a.attcollation <> 0
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
        AND a.attnum > 0 AND NOT a.attisdropped
    ) AS column_semantics_fingerprint,
    (
      SELECT count(*)::integer
      FROM pg_index idx
      JOIN pg_class c ON c.oid = idx.indrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
        AND c.relname <> '_prisma_migrations'
    ) AS index_count,
    (
      SELECT md5(string_agg(i.relname, ',' ORDER BY i.relname))
      FROM pg_index idx
      JOIN pg_class i ON i.oid = idx.indexrelid
      JOIN pg_class c ON c.oid = idx.indrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
        AND c.relname <> '_prisma_migrations'
    ) AS index_fingerprint,
    (
      SELECT md5(string_agg(i.relname || ':' || pg_get_indexdef(i.oid), ',' ORDER BY i.relname))
      FROM pg_index idx
      JOIN pg_class i ON i.oid = idx.indexrelid
      JOIN pg_class c ON c.oid = idx.indrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
        AND c.relname <> '_prisma_migrations'
    ) AS index_definition_fingerprint,
    (
      SELECT NOT EXISTS (
        SELECT 1
        FROM pg_index idx
        JOIN pg_class c ON c.oid = idx.indrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
          AND c.relname <> '_prisma_migrations'
          AND (NOT idx.indisvalid OR NOT idx.indisready OR NOT idx.indislive)
      )
    ) AS indexes_ready,
    (
      SELECT count(*)::integer
      FROM pg_constraint fk
      JOIN pg_class c ON c.oid = fk.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND fk.contype = 'f'
    ) AS foreign_key_count,
    (
      SELECT md5(string_agg(fk.conname, ',' ORDER BY fk.conname))
      FROM pg_constraint fk
      JOIN pg_class c ON c.oid = fk.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND fk.contype = 'f'
    ) AS foreign_key_fingerprint,
    (
      SELECT md5(string_agg(fk.conname || ':' || pg_get_constraintdef(fk.oid, true), ',' ORDER BY fk.conname))
      FROM pg_constraint fk
      JOIN pg_class c ON c.oid = fk.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND fk.contype = 'f'
    ) AS foreign_key_definition_fingerprint,
    (
      SELECT md5(string_agg(c.relname || ':' || fk.conname || ':' || fk.contype::text || ':' ||
        fk.convalidated::text || ':' || fk.condeferrable::text || ':' ||
        fk.condeferred::text || ':' || pg_get_constraintdef(fk.oid, true),
        ',' ORDER BY c.relname, fk.conname))
      FROM pg_constraint fk
      JOIN pg_class c ON c.oid = fk.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND fk.contype IN ('p', 'u', 'c', 'f', 'x')
    ) AS constraint_definition_fingerprint
)
SELECT 'legacy_baseline_shape=' || CASE
  WHEN r.relation_count = 34
    AND r.names = (SELECT array_agg(name ORDER BY name) FROM expected_legacy)
    AND f.column_fingerprint = 'ef721f9d4a829d80806e6a907ebb7718'
    AND f.column_definition_fingerprint = '8d41db765e01b6902c22f7f64308b2cf'
    AND f.index_count = 190
    AND f.index_fingerprint = 'ff5053da02f544c8a2097028ae673661'
    AND f.indexes_ready
    AND f.foreign_key_count = 23
    AND f.foreign_key_fingerprint = 'd630e0002b4bd8496a1d4df14e88e446'
    THEN 'legacy_34334d6'
  WHEN r.relation_count = 40
    AND r.names = (SELECT array_agg(name ORDER BY name) FROM expected_production)
    AND f.column_fingerprint = 'ced7d5e032f2e7d216f3e9215463647b'
    AND f.column_definition_fingerprint = '4ff7027dd4b1c8a968ffcfe1cafe9e71'
    AND f.column_default_fingerprint = 'f75c33d0149a591d25bd06cb7a30f290'
    AND f.column_semantics_fingerprint = 'b4babf56d53839743a48a32c6ba7af08'
    AND f.index_count = 229
    AND f.index_fingerprint = 'a1f6faa6773beb1b2631c12e07056f6e'
    AND f.index_definition_fingerprint = 'c0443d9db903acb3db05b1abf9479068'
    AND f.indexes_ready
    AND f.foreign_key_count = 29
    AND f.foreign_key_fingerprint = '6e176f684e04a0fced7c5ea5a336893a'
    AND f.foreign_key_definition_fingerprint = '5d3bb415f04acbbb3a7cf9326a9be0eb'
    AND f.constraint_definition_fingerprint = '5edd6ab073ec49076a0a910c237b683e'
    THEN 'production_0e8a97'
END
FROM relations r
CROSS JOIN fingerprints f
WHERE r.ledger_absent
  AND (
    (r.relation_count = 34
      AND r.names = (SELECT array_agg(name ORDER BY name) FROM expected_legacy)
      AND f.column_fingerprint = 'ef721f9d4a829d80806e6a907ebb7718'
      AND f.column_definition_fingerprint = '8d41db765e01b6902c22f7f64308b2cf'
      AND f.index_count = 190
      AND f.index_fingerprint = 'ff5053da02f544c8a2097028ae673661'
      AND f.indexes_ready
      AND f.foreign_key_count = 23
      AND f.foreign_key_fingerprint = 'd630e0002b4bd8496a1d4df14e88e446')
    OR
    (r.relation_count = 40
      AND r.names = (SELECT array_agg(name ORDER BY name) FROM expected_production)
      AND f.column_fingerprint = 'ced7d5e032f2e7d216f3e9215463647b'
      AND f.column_definition_fingerprint = '4ff7027dd4b1c8a968ffcfe1cafe9e71'
      AND f.column_default_fingerprint = 'f75c33d0149a591d25bd06cb7a30f290'
      AND f.column_semantics_fingerprint = 'b4babf56d53839743a48a32c6ba7af08'
      AND f.index_count = 229
      AND f.index_fingerprint = 'a1f6faa6773beb1b2631c12e07056f6e'
      AND f.index_definition_fingerprint = 'c0443d9db903acb3db05b1abf9479068'
      AND f.indexes_ready
      AND f.foreign_key_count = 29
      AND f.foreign_key_fingerprint = '6e176f684e04a0fced7c5ea5a336893a'
      AND f.foreign_key_definition_fingerprint = '5d3bb415f04acbbb3a7cf9326a9be0eb'
      AND f.constraint_definition_fingerprint = '5edd6ab073ec49076a0a910c237b683e')
  );
