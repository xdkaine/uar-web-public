#!/usr/bin/env sh
set -eu

gate_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
temp_dir=$(mktemp -d)
trap 'rm -rf "$temp_dir"' EXIT HUP INT TERM

mkdir -p "$temp_dir/gate" "$temp_dir/bin"
cp "$gate_dir/migration-gate.sh" "$temp_dir/gate/migration-gate.sh"
cp "$gate_dir/docker-compose.yml" "$temp_dir/gate/docker-compose.yml"

cat >"$temp_dir/gate/verify-backup.sh" <<'STUB'
#!/usr/bin/env sh
exit 0
STUB
chmod +x "$temp_dir/gate/verify-backup.sh"

cat >"$temp_dir/bin/docker" <<'STUB'
#!/usr/bin/env sh
case "$*" in
  *migration-gate-db*legacy-baseline-preflight-v1.sql*) cat "$FAKE_LEGACY_MARKER_FILE" ;;
  *migration-gate-db*verify.sql*) cat "$FAKE_VERIFY_REPORT_FILE" ;;
  *migration-gate-db*) cat "$FAKE_PREFLIGHT_REPORT_FILE" ;;
  *migration-gate-portal*|*migration-gate-auth*) printf '%s\n' "$*" >> "$FAKE_DOCKER_LOG" ;;
  *) printf '%s\n' "unexpected fake docker invocation: $*" >&2; exit 99 ;;
esac
STUB
chmod +x "$temp_dir/bin/docker"

cat >"$temp_dir/manifest" <<'MANIFEST'
source_database_name_digest=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
source_stack_digest=cccccccccccccccccccccccccccccccc
MANIFEST

write_env() {
  attestation_digest=$1
  cat >"$temp_dir/gate.env" <<EOF
MIGRATION_DATABASE_URL=postgresql://clone-only.invalid/clone
MIGRATION_GATE_BACKUP_DECLARATION=$temp_dir/manifest
MIGRATION_GATE_EXPECTED_OIDC_CLIENT_COUNT=0
MIGRATION_GATE_EXPECTED_OIDC_CLIENT_DIGEST=d41d8cd98f00b204e9800998ecf8427e
MIGRATION_GATE_EXPECTED_SOURCE_STACK_DIGEST=cccccccccccccccccccccccccccccccc
MIGRATION_GATE_CLONE_MODE=true
MIGRATION_GATE_EXPECTED_TARGET_DATABASE_NAME_DIGEST=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
MIGRATION_GATE_EXPECTED_TARGET_CLONE_ATTESTATION_DIGEST=$attestation_digest
MIGRATION_GATE_APPROVE_LEGACY_BASELINE=20260507000000_legacy_schema_bootstrap
MIGRATION_GATE_BACKUP_MAX_AGE_SECONDS=86400
EOF
}

write_report() {
  present=$1
  attestation_digest=$2
  cat >"$temp_dir/report" <<EOF
portal_migration_ledger_count=0
portal_migration_ledger_digest=d41d8cd98f00b204e9800998ecf8427e
portal_migration_ledger_unresolved_count=0
public_user_table_count=40
target_database_name_digest=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
target_database_clone_attestation_present=$present
target_database_clone_attestation_digest=$attestation_digest
oidc_client_table_present=false
oidc_client_count=0
oidc_client_inventory_digest=d41d8cd98f00b204e9800998ecf8427e
auth_branding_profile_count=0
auth_branding_profile_inventory_digest=d41d8cd98f00b204e9800998ecf8427e
required_migrations_missing_count=0
EOF
}

run_baseline() {
  env -u MIGRATION_DATABASE_URL \
    PATH="$temp_dir/bin:$PATH" \
    FAKE_PREFLIGHT_REPORT_FILE="$temp_dir/report" \
    FAKE_LEGACY_MARKER_FILE="$temp_dir/legacy-marker" \
    FAKE_VERIFY_REPORT_FILE="$temp_dir/report" \
    FAKE_DOCKER_LOG="$temp_dir/docker.log" \
    MIGRATION_GATE_ENV_FILE="$temp_dir/gate.env" \
    "$temp_dir/gate/migration-gate.sh" baseline-and-migrate
}

expect_marker_rejection() {
  marker=$1
  : >"$temp_dir/legacy-marker"
  if [ -n "$marker" ]; then
    printf '%s\n' "$marker" >"$temp_dir/legacy-marker"
  fi
  : >"$temp_dir/docker.log"
  expect_failure 'legacy baseline requires one exact recognized no-ledger schema marker' run_baseline
  test ! -s "$temp_dir/docker.log"
}

assert_resolved_migrations() {
  expected_file=$1
  grep 'migrate resolve --applied' "$temp_dir/docker.log" | sed 's/.*--applied //' >"$temp_dir/resolved"
  cmp -s "$expected_file" "$temp_dir/resolved"
  grep -Fq 'migration-gate-portal migrate deploy' "$temp_dir/docker.log"
  grep -Fq 'migration-gate-auth npx prisma migrate deploy' "$temp_dir/docker.log"
}

expect_failure() {
  expected=$1
  shift
  if "$@" >"$temp_dir/output" 2>&1; then
    printf '%s\n' "expected failure containing: $expected" >&2
    exit 1
  fi
  grep -Fq "$expected" "$temp_dir/output"
}

write_env d41d8cd98f00b204e9800998ecf8427e
write_report false d41d8cd98f00b204e9800998ecf8427e
expect_failure 'clone migration target is missing its required attestation' \
  env -u MIGRATION_DATABASE_URL \
  PATH="$temp_dir/bin:$PATH" \
  FAKE_PREFLIGHT_REPORT_FILE="$temp_dir/report" \
  FAKE_LEGACY_MARKER_FILE="$temp_dir/legacy-marker" \
  FAKE_VERIFY_REPORT_FILE="$temp_dir/report" \
  FAKE_DOCKER_LOG="$temp_dir/docker.log" \
  MIGRATION_GATE_ENV_FILE="$temp_dir/gate.env" \
  "$temp_dir/gate/migration-gate.sh" preflight

expect_failure 'conflicting ambient and env-file values for MIGRATION_GATE_APPROVE_LEGACY_BASELINE' \
  env -u MIGRATION_DATABASE_URL \
  PATH="$temp_dir/bin:$PATH" \
  FAKE_PREFLIGHT_REPORT_FILE="$temp_dir/report" \
  FAKE_LEGACY_MARKER_FILE="$temp_dir/legacy-marker" \
  FAKE_VERIFY_REPORT_FILE="$temp_dir/report" \
  FAKE_DOCKER_LOG="$temp_dir/docker.log" \
  MIGRATION_GATE_ENV_FILE="$temp_dir/gate.env" \
  MIGRATION_GATE_APPROVE_LEGACY_BASELINE=wrong \
  "$temp_dir/gate/migration-gate.sh" preflight

expect_failure 'conflicting ambient and env-file values for MIGRATION_GATE_BACKUP_MAX_AGE_SECONDS' \
  env -u MIGRATION_DATABASE_URL \
  PATH="$temp_dir/bin:$PATH" \
  FAKE_PREFLIGHT_REPORT_FILE="$temp_dir/report" \
  FAKE_LEGACY_MARKER_FILE="$temp_dir/legacy-marker" \
  FAKE_VERIFY_REPORT_FILE="$temp_dir/report" \
  FAKE_DOCKER_LOG="$temp_dir/docker.log" \
  MIGRATION_GATE_ENV_FILE="$temp_dir/gate.env" \
  MIGRATION_GATE_BACKUP_MAX_AGE_SECONDS=999999 \
  "$temp_dir/gate/migration-gate.sh" preflight

write_env dddddddddddddddddddddddddddddddd
write_report true dddddddddddddddddddddddddddddddd
env -u MIGRATION_DATABASE_URL \
  PATH="$temp_dir/bin:$PATH" \
  FAKE_PREFLIGHT_REPORT_FILE="$temp_dir/report" \
  FAKE_LEGACY_MARKER_FILE="$temp_dir/legacy-marker" \
  FAKE_VERIFY_REPORT_FILE="$temp_dir/report" \
  FAKE_DOCKER_LOG="$temp_dir/docker.log" \
  MIGRATION_GATE_ENV_FILE="$temp_dir/gate.env" \
  "$temp_dir/gate/migration-gate.sh" preflight >"$temp_dir/output" 2>&1
grep -Fq 'backup_target_identity=matched' "$temp_dir/output"

expect_marker_rejection ''
expect_marker_rejection 'legacy_baseline_shape=unknown'
expect_marker_rejection 'legacy_baseline_shape=legacy_34334d6
legacy_baseline_shape=production_0e8a97'

printf '%s\n' 'legacy_baseline_shape=legacy_34334d6' >"$temp_dir/legacy-marker"
: >"$temp_dir/docker.log"
run_baseline >"$temp_dir/output" 2>&1
cat >"$temp_dir/expected-resolves" <<'EOF'
20260507000000_legacy_schema_bootstrap
EOF
assert_resolved_migrations "$temp_dir/expected-resolves"

printf '%s\n' 'legacy_baseline_shape=production_0e8a97' >"$temp_dir/legacy-marker"
: >"$temp_dir/docker.log"
run_baseline >"$temp_dir/output" 2>&1
cat >"$temp_dir/expected-resolves" <<'EOF'
20260507000000_legacy_schema_bootstrap
20260508000000_baseline
20260509000000_add_password_change_challenges
20260511130000_audit_action_history
20260519000000_add_mass_email
20260612000000_offboard_campaign_extensions
20260612010000_offboard_recipient_tokens
EOF
assert_resolved_migrations "$temp_dir/expected-resolves"

printf '%s\n' 'migration gate clone safety tests passed'
