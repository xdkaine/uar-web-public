#!/usr/bin/env sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
legacy_sql="$repo_root/my-app/prisma/migrations/20260507000000_legacy_schema_bootstrap/migration.sql"
legacy_preflight="$repo_root/tools/migration-gate/legacy-baseline-preflight-v1.sql"

test -f "$legacy_sql"
test -f "$legacy_preflight"
test "$(sha256sum "$legacy_sql" | awk '{print $1}')" = 'e645a92de9d496f9f8e25bc32666323f71378491d303ef74a19366fce516c6ba'
test "$(git -C "$repo_root" show 34334d6f05df521a0781aaa43e6509bcca6f414a:my-app/prisma/schema.prisma | sha256sum | awk '{print $1}')" = '2954dcec09bce972675aeecdb4e8956e0ebaafad589d84a30f6ab575f5b5d41a'
grep -Fq '34334d6f05df521a0781aaa43e6509bcca6f414a' "$legacy_sql"
grep -Fq '2954dcec09bce972675aeecdb4e8956e0ebaafad589d84a30f6ab575f5b5d41a' "$legacy_sql"
grep -Fq '0e8a97ebe9f43013dbee34829691822c7706911f' "$legacy_preflight"
grep -Fq 'c0443d9db903acb3db05b1abf9479068' "$legacy_preflight"
grep -Fq 'b4babf56d53839743a48a32c6ba7af08' "$legacy_preflight"
grep -Fq '5edd6ab073ec49076a0a910c237b683e' "$legacy_preflight"
grep -Fq "'legacy_baseline_shape='" "$legacy_preflight"
grep -Fq "'production_0e8a97'" "$legacy_preflight"
if grep -Ein '(^|[[:space:]])(create|alter|insert|update|delete|drop|truncate|grant|revoke|copy|call)[[:space:]]' "$legacy_preflight"; then
  printf '%s\n' 'legacy baseline preflight must contain only read-only SQL' >&2
  exit 65
fi
grep -Fq "migration_name = '20260508000000_baseline'" "$legacy_sql"
grep -Fq 'missing_legacy_tables = 0 AND unknown_migrations = 0 AND unresolved_migrations = 0' "$legacy_sql"
test "$(grep -c '^CREATE TABLE IF NOT EXISTS ' "$legacy_sql")" -eq 34
test "$(grep -c '^CREATE .*INDEX IF NOT EXISTS ' "$legacy_sql")" -eq 156
test "$(grep -c '^DO \$fk\$ BEGIN$' "$legacy_sql")" -eq 23
grep -Fq 'DROP TABLE IF EXISTS "AuthBrandingProfile";' "$repo_root/my-app/prisma/migrations/20260825100000_drop_portal_auth_branding_oidc_clients/migration.sql"
test "$(sha256sum "$repo_root/my-app/prisma/migrations/20260825100000_drop_portal_auth_branding_oidc_clients/migration.sql" | awk '{print $1}')" = 'b0e398e4337457c592ff572d7d2bf015b52fb0e6d8688876e46b9a232d8218fb'
grep -Fq 'ALTER TABLE "OidcClient" RENAME TO "__portal_transfer_OidcClient";' "$repo_root/my-app/prisma/migrations/20260825090000_preserve_auth_tables_before_portal_drop/migration.sql"
grep -Fq 'ALTER TABLE "__portal_transfer_OidcClient" RENAME TO "OidcClient";' "$repo_root/my-app/prisma/migrations/20260825110000_restore_auth_tables_after_portal_drop/migration.sql"
grep -Fq 'MIGRATION_GATE_APPROVE_LEGACY_BASELINE' "$repo_root/tools/migration-gate/migration-gate.sh"
grep -Fq '20260612010000_offboard_recipient_tokens' "$repo_root/tools/migration-gate/migration-gate.sh"
grep -Fq 'legacy-baseline-preflight-v1.sql' "$repo_root/tools/migration-gate/migration-gate.sh"
grep -Fq 'legacy baseline requires one exact recognized no-ledger schema marker' "$repo_root/tools/migration-gate/migration-gate.sh"
grep -Fq "('20260829000000_production_candidate_recovery')" "$repo_root/tools/migration-gate/verify.sql"
grep -Fq 'source_database_name_digest=' "$repo_root/tools/migration-gate/backup-manifest.example"
grep -Fq 'target_database_clone_attestation_digest=' "$repo_root/tools/migration-gate/preflight.sql"
grep -Fq 'target_database_clone_attestation_present=' "$repo_root/tools/migration-gate/preflight.sql"
grep -Fq 'database-only-clone' "$repo_root/tools/migration-gate/verify-backup.sh"
grep -Fq 'migration gate refuses conflicting ambient and env-file values' "$repo_root/tools/migration-gate/migration-gate.sh"
grep -Fq 'MIGRATION_GATE_BACKUP_MAX_AGE_SECONDS' "$repo_root/tools/migration-gate/migration-gate.sh"
grep -Fq 'AUTH_CLIENT_SECRET_ENC_KEY' "$repo_root/tools/migration-gate/migration-gate.sh"
if grep -Fq ':/legacy-bootstrap.sql:ro' "$repo_root/tools/migration-gate/docker-compose.yml"; then
  printf '%s\n' 'migration gate must not mount the immutable bootstrap for execution' >&2
  exit 65
fi
sh "$repo_root/tools/migration-gate/clone-safety-test.sh"
sh -n "$repo_root/tools/migration-gate/evolved-baseline-test.sh"
grep -Fq 'idx.indisvalid' "$repo_root/tools/migration-gate/semantic-schema-fingerprint.sql"
printf '%s\n' 'migration gate static checks passed'
