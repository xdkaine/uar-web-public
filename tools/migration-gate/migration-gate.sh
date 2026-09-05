#!/usr/bin/env sh
set -eu

command_name=${1:-}
gate_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
compose_file="$gate_dir/docker-compose.yml"
env_file=${MIGRATION_GATE_ENV_FILE:-}

usage() {
  printf '%s\n' 'Usage: tools/migration-gate/migration-gate.sh preflight|baseline-and-migrate|migrate|verify' >&2
  exit 64
}

require_value() {
  name=$1
  eval "value=\${$name:-}"
  if [ -z "$value" ]; then
    printf '%s\n' "migration gate requires $name" >&2
    exit 64
  fi
}

case "$command_name" in
  preflight|baseline-and-migrate|migrate|verify) ;;
  *) usage ;;
esac

load_from_env_file() {
  name=$1
  if [ -z "$env_file" ] || [ ! -r "$env_file" ]; then
    return
  fi
  current=$(eval "printf '%s' \"\${$name:-}\"")
  value=$(sed -n "s/^${name}=//p" "$env_file" | tail -n 1)
  if [ -n "$current" ] && [ -n "$value" ] && [ "$current" != "$value" ]; then
    printf '%s\n' "migration gate refuses conflicting ambient and env-file values for $name" >&2
    exit 65
  fi
  if [ -n "$value" ]; then
    export "$name=$value"
  fi
}

for required_name in \
  MIGRATION_DATABASE_URL \
  MIGRATION_GATE_BACKUP_DECLARATION \
  MIGRATION_GATE_EXPECTED_OIDC_CLIENT_COUNT \
  MIGRATION_GATE_EXPECTED_OIDC_CLIENT_DIGEST \
  MIGRATION_GATE_EXPECTED_SOURCE_STACK_DIGEST \
  MIGRATION_GATE_CLONE_MODE \
  MIGRATION_GATE_EXPECTED_TARGET_DATABASE_NAME_DIGEST \
  MIGRATION_GATE_EXPECTED_TARGET_CLONE_ATTESTATION_DIGEST \
  MIGRATION_GATE_APPROVE_LEGACY_BASELINE \
  MIGRATION_GATE_BACKUP_MAX_AGE_SECONDS \
  AUTH_CLIENT_SECRET_ENC_KEY
do
  load_from_env_file "$required_name"
done

require_value MIGRATION_DATABASE_URL
require_value MIGRATION_GATE_BACKUP_DECLARATION
require_value MIGRATION_GATE_EXPECTED_OIDC_CLIENT_COUNT
require_value MIGRATION_GATE_EXPECTED_OIDC_CLIENT_DIGEST
require_value MIGRATION_GATE_EXPECTED_SOURCE_STACK_DIGEST

clone_mode=${MIGRATION_GATE_CLONE_MODE:-false}
case "$clone_mode" in
  true)
    require_value MIGRATION_GATE_EXPECTED_TARGET_DATABASE_NAME_DIGEST
    require_value MIGRATION_GATE_EXPECTED_TARGET_CLONE_ATTESTATION_DIGEST
    ;;
  false) ;;
  *)
    printf '%s\n' 'MIGRATION_GATE_CLONE_MODE must be true or false' >&2
    exit 64
    ;;
esac

# The declaration is a restricted backup artifact path. It is never printed,
# but it must be readable by this job before a migration can start.
if [ ! -r "$MIGRATION_GATE_BACKUP_DECLARATION" ]; then
  printf '%s\n' 'migration gate backup declaration is not readable' >&2
  exit 65
fi

"$gate_dir/verify-backup.sh" "$MIGRATION_GATE_BACKUP_DECLARATION"

compose() {
  if [ -n "$env_file" ]; then
    docker compose --env-file "$env_file" -f "$compose_file" "$@"
  else
    docker compose -f "$compose_file" "$@"
  fi
}

report() {
  compose run --rm --no-deps migration-gate-db -At -f "/gate/$1"
}

check_inventory() {
  report_output=$1
  actual_count=$(printf '%s\n' "$report_output" | sed -n 's/^oidc_client_count=//p')
  actual_digest=$(printf '%s\n' "$report_output" | sed -n 's/^oidc_client_inventory_digest=//p')
  unresolved_count=$(printf '%s\n' "$report_output" | sed -n 's/^portal_migration_ledger_unresolved_count=//p')
  if [ "$actual_count" != "$MIGRATION_GATE_EXPECTED_OIDC_CLIENT_COUNT" ] || [ "$actual_digest" != "$MIGRATION_GATE_EXPECTED_OIDC_CLIENT_DIGEST" ]; then
    printf '%s\n' 'migration gate OIDC inventory does not match the approved secret-free declaration' >&2
    exit 65
  fi
  if [ "$unresolved_count" != '0' ]; then
    printf '%s\n' 'migration gate found an unfinished or rolled-back Prisma migration' >&2
    exit 65
  fi
}

check_decryptability() {
  table_present=$1
  if [ "$table_present" != 'true' ]; then
    printf '%s\n' 'client_secret_decryptability=not_applicable'
    return
  fi
  compose run --rm --no-deps migration-gate-auth sh -ec '
    node -e "import(\"./dist/oidc-clients.js\").then(async (m) => { try { await m.assertClientSecretsDecryptable(); console.log(\"client_secret_decryptability=ok\"); process.exit(0); } catch { console.error(\"client_secret_decryptability=failed\"); process.exit(1); } }).catch(() => { console.error(\"client_secret_decryptability=failed\"); process.exit(1); })"
  '
}

check_required_migrations() {
  output=$1
  missing=$(printf '%s\n' "$output" | sed -n 's/^required_migrations_missing_count=//p')
  if [ "$missing" != '0' ]; then
    printf '%s\n' 'migration gate required portal/auth migration set is incomplete' >&2
    exit 65
  fi
}

manifest_value() {
  sed -n "s/^$1=//p" "$MIGRATION_GATE_BACKUP_DECLARATION" | tail -n 1
}

check_source_identity() {
  output=$1
  target_database_name_digest=$(printf '%s\n' "$output" | sed -n 's/^target_database_name_digest=//p')
  target_clone_attestation_present=$(printf '%s\n' "$output" | sed -n 's/^target_database_clone_attestation_present=//p')
  target_clone_attestation_digest=$(printf '%s\n' "$output" | sed -n 's/^target_database_clone_attestation_digest=//p')
  source_database_name_digest=$(manifest_value source_database_name_digest)
  source_stack_digest=$(manifest_value source_stack_digest)
  if [ "$clone_mode" = 'true' ]; then
    if [ "$target_clone_attestation_present" != 'true' ]; then
      printf '%s\n' 'clone migration target is missing its required attestation' >&2
      exit 65
    fi
    if [ "$target_database_name_digest" = "$source_database_name_digest" ]; then
      printf '%s\n' 'clone migration target must use a database name distinct from the backup source' >&2
      exit 65
    fi
    if [ "$target_database_name_digest" != "$MIGRATION_GATE_EXPECTED_TARGET_DATABASE_NAME_DIGEST" ]; then
      printf '%s\n' 'clone migration target database identity does not match the approved clone declaration' >&2
      exit 65
    fi
    if [ "$target_clone_attestation_digest" != "$MIGRATION_GATE_EXPECTED_TARGET_CLONE_ATTESTATION_DIGEST" ]; then
      printf '%s\n' 'clone migration target attestation does not match the approved clone declaration' >&2
      exit 65
    fi
  else
    if [ "$target_database_name_digest" != "$source_database_name_digest" ]; then
      printf '%s\n' 'migration target database identity does not match the verified backup source' >&2
      exit 65
    fi
  fi
  if [ "$source_stack_digest" != "$MIGRATION_GATE_EXPECTED_SOURCE_STACK_DIGEST" ]; then
    printf '%s\n' 'backup source stack identity does not match the approved deployment declaration' >&2
    exit 65
  fi
  printf '%s\n' 'backup_target_identity=matched'
}

case "$command_name" in
  preflight)
    output=$(report preflight.sql)
    printf '%s\n' "$output"
    check_inventory "$output"
    check_source_identity "$output"
    check_decryptability "$(printf '%s\n' "$output" | sed -n 's/^oidc_client_table_present=//p')"
    printf '%s\n' 'backup_declaration=accepted'
    ;;
  migrate)
    before=$(report preflight.sql)
    printf '%s\n' "$before"
    check_inventory "$before"
    check_source_identity "$before"
    check_decryptability "$(printf '%s\n' "$before" | sed -n 's/^oidc_client_table_present=//p')"
    printf '%s\n' 'backup_declaration=accepted'
    before_branding_count=$(printf '%s\n' "$before" | sed -n 's/^auth_branding_profile_count=//p')
    before_branding_digest=$(printf '%s\n' "$before" | sed -n 's/^auth_branding_profile_inventory_digest=//p')
    compose run --rm --no-deps migration-gate-portal migrate deploy
    compose run --rm --no-deps migration-gate-auth npx prisma migrate deploy
    after=$(report verify.sql)
    printf '%s\n' "$after"
    check_inventory "$after"
    check_decryptability "$(printf '%s\n' "$after" | sed -n 's/^oidc_client_table_present=//p')"
    check_required_migrations "$after"
    after_branding_count=$(printf '%s\n' "$after" | sed -n 's/^auth_branding_profile_count=//p')
    after_branding_digest=$(printf '%s\n' "$after" | sed -n 's/^auth_branding_profile_inventory_digest=//p')
    if [ "$before_branding_count" != "$after_branding_count" ] || [ "$before_branding_digest" != "$after_branding_digest" ]; then
      printf '%s\n' 'migration gate branding inventory changed during ownership transfer' >&2
      exit 65
    fi
    ;;
  baseline-and-migrate)
    if [ "${MIGRATION_GATE_APPROVE_LEGACY_BASELINE:-}" != '20260507000000_legacy_schema_bootstrap' ]; then
      printf '%s\n' 'legacy baseline requires the exact MIGRATION_GATE_APPROVE_LEGACY_BASELINE approval value' >&2
      exit 65
    fi
    before=$(report preflight.sql)
    printf '%s\n' "$before"
    check_inventory "$before"
    check_source_identity "$before"
    ledger_count=$(printf '%s\n' "$before" | sed -n 's/^portal_migration_ledger_count=//p')
    if [ "$ledger_count" != '0' ]; then
      printf '%s\n' 'legacy baseline is allowed only for a nonempty database with no Prisma ledger; use migrate otherwise' >&2
      exit 65
    fi
    baseline_marker=$(report legacy-baseline-preflight-v1.sql)
    case "$baseline_marker" in
      legacy_baseline_shape=legacy_34334d6)
        baseline_shape=legacy_34334d6
        ;;
      legacy_baseline_shape=production_0e8a97)
        baseline_shape=production_0e8a97
        ;;
      *)
        printf '%s\n' 'legacy baseline requires one exact recognized no-ledger schema marker' >&2
        exit 65
        ;;
    esac
    printf '%s\n' "$baseline_marker"
    check_decryptability "$(printf '%s\n' "$before" | sed -n 's/^oidc_client_table_present=//p')"
    printf '%s\n' 'backup_declaration=accepted'
    before_branding_count=$(printf '%s\n' "$before" | sed -n 's/^auth_branding_profile_count=//p')
    before_branding_digest=$(printf '%s\n' "$before" | sed -n 's/^auth_branding_profile_inventory_digest=//p')
    compose run --rm --no-deps migration-gate-portal migrate resolve --applied 20260507000000_legacy_schema_bootstrap
    if [ "$baseline_shape" = 'production_0e8a97' ]; then
      # This exact no-ledger production shape includes these six migrations.
      # If resolution is interrupted, stop and recover from verified ledger
      # state; do not rerun baseline-and-migrate blindly.
      for historical_migration in \
        20260508000000_baseline \
        20260509000000_add_password_change_challenges \
        20260511130000_audit_action_history \
        20260519000000_add_mass_email \
        20260612000000_offboard_campaign_extensions \
        20260612010000_offboard_recipient_tokens
      do
        compose run --rm --no-deps migration-gate-portal migrate resolve --applied "$historical_migration"
      done
    fi
    compose run --rm --no-deps migration-gate-portal migrate deploy
    compose run --rm --no-deps migration-gate-auth npx prisma migrate deploy
    after=$(report verify.sql)
    printf '%s\n' "$after"
    check_inventory "$after"
    check_source_identity "$after"
    check_decryptability "$(printf '%s\n' "$after" | sed -n 's/^oidc_client_table_present=//p')"
    check_required_migrations "$after"
    after_branding_count=$(printf '%s\n' "$after" | sed -n 's/^auth_branding_profile_count=//p')
    after_branding_digest=$(printf '%s\n' "$after" | sed -n 's/^auth_branding_profile_inventory_digest=//p')
    if [ "$before_branding_count" != "$after_branding_count" ] || [ "$before_branding_digest" != "$after_branding_digest" ]; then
      printf '%s\n' 'migration gate branding inventory changed during ownership transfer' >&2
      exit 65
    fi
    ;;
  verify)
    output=$(report verify.sql)
    printf '%s\n' "$output"
    check_inventory "$output"
    check_source_identity "$output"
    check_decryptability "$(printf '%s\n' "$output" | sed -n 's/^oidc_client_table_present=//p')"
    check_required_migrations "$output"
    ;;
esac
