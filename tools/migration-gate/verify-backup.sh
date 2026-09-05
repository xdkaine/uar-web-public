#!/usr/bin/env sh
set -eu

manifest=${1:-}
gate_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
max_age_seconds=${MIGRATION_GATE_BACKUP_MAX_AGE_SECONDS:-86400}
docker_command=${DOCKER_COMMAND:-docker}

if [ -z "$manifest" ] || [ ! -r "$manifest" ]; then
  printf '%s\n' 'backup verification requires a readable manifest' >&2
  exit 65
fi

manifest_value() {
  key=$1
  sed -n "s/^${key}=//p" "$manifest" | tail -n 1
}

database_path=$(manifest_value database_path)
database_sha256=$(manifest_value database_sha256)
created_at_epoch=$(manifest_value created_at_epoch)
source_schema_fingerprint=$(manifest_value source_schema_fingerprint)
source_database_name_digest=$(manifest_value source_database_name_digest)
source_stack_digest=$(manifest_value source_stack_digest)
assets_path=$(manifest_value assets_path)
assets_sha256=$(manifest_value assets_sha256)
backup_scope=$(manifest_value backup_scope)
backup_scope=${backup_scope:-full}

case "$backup_scope" in
  full)
    require_assets=true
    ;;
  database-only-clone)
    if [ "${MIGRATION_GATE_CLONE_MODE:-false}" != 'true' ]; then
      printf '%s\n' 'database-only backup scope is allowed only for an attested clone rehearsal' >&2
      exit 65
    fi
    require_assets=false
    ;;
  *)
    printf '%s\n' 'backup manifest scope must be full or database-only-clone' >&2
    exit 65
    ;;
esac

case "$database_path" in /*) ;; *) printf '%s\n' 'backup database_path must be absolute' >&2; exit 65 ;; esac
if [ "$require_assets" = 'true' ]; then
  case "$assets_path" in /*) ;; *) printf '%s\n' 'backup assets_path must be absolute' >&2; exit 65 ;; esac
fi
case "$database_sha256$source_schema_fingerprint$source_database_name_digest$source_stack_digest" in
  *[!0-9a-f]*) printf '%s\n' 'backup manifest digests must be lowercase hexadecimal' >&2; exit 65 ;;
esac
if [ "${#database_sha256}" -ne 64 ] || [ "${#source_schema_fingerprint}" -ne 32 ] || [ "${#source_database_name_digest}" -ne 32 ] || [ "${#source_stack_digest}" -ne 32 ]; then
  printf '%s\n' 'backup manifest digest length is invalid' >&2
  exit 65
fi
if [ "$require_assets" = 'true' ]; then
  case "$assets_sha256" in *[!0-9a-f]*) printf '%s\n' 'backup manifest asset digest must be lowercase hexadecimal' >&2; exit 65 ;; esac
  if [ "${#assets_sha256}" -ne 64 ]; then
    printf '%s\n' 'backup manifest asset digest length is invalid' >&2
    exit 65
  fi
fi
case "$created_at_epoch" in *[!0-9]*|'') printf '%s\n' 'backup created_at_epoch is invalid' >&2; exit 65 ;; esac

now=$(date +%s)
age=$((now - created_at_epoch))
if [ "$age" -lt 0 ] || [ "$age" -gt "$max_age_seconds" ]; then
  printf '%s\n' 'backup is outside the approved age window' >&2
  exit 65
fi
if [ ! -r "$database_path" ]; then
  printf '%s\n' 'backup database artifact is unreadable' >&2
  exit 65
fi
if [ "$require_assets" = 'true' ] && [ ! -r "$assets_path" ]; then
  printf '%s\n' 'backup asset artifact is unreadable' >&2
  exit 65
fi

actual_database_sha256=$(sha256sum "$database_path" | awk '{print $1}')
if [ "$actual_database_sha256" != "$database_sha256" ]; then
  printf '%s\n' 'backup database checksum mismatch' >&2
  exit 65
fi
if [ "$require_assets" = 'true' ]; then
  actual_assets_sha256=$(sha256sum "$assets_path" | awk '{print $1}')
  if [ "$actual_assets_sha256" != "$assets_sha256" ]; then
    printf '%s\n' 'backup asset checksum mismatch' >&2
    exit 65
  fi
fi

database_dir=$(dirname -- "$database_path")
database_name=$(basename -- "$database_path")
database_mount=$database_dir
gate_mount=$gate_dir
case "$docker_command" in
  *docker.exe)
    if command -v wslpath >/dev/null 2>&1; then
      database_mount=$(wslpath -w "$database_dir")
      gate_mount=$(wslpath -w "$gate_dir")
    fi
    ;;
esac
assets_restore_dir=
container_name="uar-backup-verify-$$"
cleanup() {
  "$docker_command" rm -f "$container_name" >/dev/null 2>&1 || true
  if [ -n "$assets_restore_dir" ]; then
    rm -rf "$assets_restore_dir"
  fi
}
trap cleanup EXIT HUP INT TERM

"$docker_command" run --rm -v "$database_mount:/backup:ro" postgres:16-alpine \
  pg_restore --list "/backup/$database_name" >/dev/null

if [ "$require_assets" = 'true' ]; then
  assets_restore_dir=$(mktemp -d)
  tar -tf "$assets_path" >/dev/null
  tar -xf "$assets_path" -C "$assets_restore_dir"
  if ! find "$assets_restore_dir" -type f -print -quit | grep -q .; then
    printf '%s\n' 'asset backup restored without any files' >&2
    exit 65
  fi
fi

"$docker_command" run -d --name "$container_name" \
  -e POSTGRES_USER=restore_verify \
  -e POSTGRES_PASSWORD=restore-only-password \
  -e POSTGRES_DB=restore_verify \
  -v "$database_mount:/backup:ro" \
  -v "$gate_mount:/gate:ro" \
  postgres:16-alpine >/dev/null

ready=false
attempt=0
while [ "$attempt" -lt 30 ]; do
  # A fresh postgres image briefly accepts connections through the temporary
  # bootstrap server, shuts that server down, and then starts the final server.
  # Waiting on pg_isready alone can therefore race pg_restore against that
  # intentional shutdown.  The second readiness log line belongs to the final
  # server; confirm it and the live probe before restoring.
  ready_count=$(
    "$docker_command" logs "$container_name" 2>&1 \
      | grep -c 'database system is ready to accept connections' \
      || true
  )
  if [ "$ready_count" -ge 2 ] \
    && "$docker_command" exec "$container_name" \
      pg_isready -U restore_verify -d restore_verify >/dev/null 2>&1; then
    ready=true
    break
  fi
  attempt=$((attempt + 1))
  sleep 1
done
if [ "$ready" != true ]; then
  printf '%s\n' 'disposable restore database did not become ready' >&2
  exit 65
fi

"$docker_command" exec "$container_name" pg_restore \
  -U restore_verify -d restore_verify --exit-on-error --no-owner --no-privileges \
  "/backup/$database_name" >/dev/null
restored_fingerprint=$("$docker_command" exec -i "$container_name" \
  psql -X -q -v ON_ERROR_STOP=1 -At -U restore_verify -d restore_verify \
  < "$gate_dir/schema-fingerprint.sql" | tr -d '[:space:]')
if [ "$restored_fingerprint" != "$source_schema_fingerprint" ]; then
  printf '%s\n' 'disposable restore schema fingerprint mismatch' >&2
  exit 65
fi

printf '%s\n' 'backup_checksum=ok'
printf '%s\n' 'backup_age=ok'
printf '%s\n' 'backup_pg_restore_list=ok'
printf '%s\n' 'backup_disposable_restore=ok'
printf '%s\n' 'backup_schema_fingerprint=ok'
printf '%s\n' 'backup_source_identity_metadata=ok'
if [ "$require_assets" = 'true' ]; then
  printf '%s\n' 'backup_assets_restore=ok'
else
  printf '%s\n' 'backup_assets_restore=not_applicable_database_only_clone'
fi
