#!/usr/bin/env sh
set -eu

container=${CLONE_TEST_CONTAINER:-}
database_user=${CLONE_TEST_USER:-}
source_dump=${CLONE_TEST_SOURCE_DUMP:-}
preflight_sql=${CLONE_TEST_PREFLIGHT_SQL:-}

for required in container database_user source_dump preflight_sql; do
  eval "value=\${$required:-}"
  if [ -z "$value" ]; then
    printf '%s\n' "evolved baseline test requires $required" >&2
    exit 64
  fi
done

case "$source_dump" in /*) ;; *) printf '%s\n' 'source dump path must be absolute' >&2; exit 64 ;; esac
case "$preflight_sql" in /*) ;; *) printf '%s\n' 'preflight SQL path must be absolute' >&2; exit 64 ;; esac
test -r "$source_dump"
test -r "$preflight_sql"

project=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$container")
service=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.service"}}' "$container")
case "$project" in uar-prod-clone-*) ;; *) printf '%s\n' 'test target is not an isolated production-clone project' >&2; exit 65 ;; esac
if [ "$service" != 'clone-postgres' ]; then
  printf '%s\n' 'test target is not the isolated clone database service' >&2
  exit 65
fi

test_prefix="uar_gate_shape_$$"
temp_dir=$(mktemp -d)
created_databases=
cleanup() {
  for database in $created_databases; do
    docker exec "$container" dropdb --if-exists --force -U "$database_user" "$database" >/dev/null 2>&1 || true
  done
  rm -rf "$temp_dir"
}
trap cleanup EXIT HUP INT TERM

restore_database() {
  database=$1
  docker exec "$container" createdb -U "$database_user" "$database"
  created_databases="$created_databases $database"
  docker exec -i "$container" pg_restore -U "$database_user" -d "$database" \
    --exit-on-error --no-owner --no-privileges < "$source_dump" >/dev/null
}

run_preflight() {
  database=$1
  docker exec -i "$container" psql -X -q -v ON_ERROR_STOP=1 \
    -At -U "$database_user" -d "$database" < "$preflight_sql"
}

expect_preflight_rejection() {
  database=$1
  label=$2
  output=$(run_preflight "$database")
  if [ -n "$output" ]; then
    printf '%s\n' "evolved baseline preflight unexpectedly accepted the $label mutation: $output" >&2
    exit 1
  fi
}

positive_db="${test_prefix}_positive"
restore_database "$positive_db"
test "$(run_preflight "$positive_db")" = 'legacy_baseline_shape=production_0e8a97'

default_db="${test_prefix}_default"
restore_database "$default_db"
docker exec "$container" psql -X -q -v ON_ERROR_STOP=1 -U "$database_user" -d "$default_db" \
  -c 'ALTER TABLE "MassEmailCampaign" ALTER COLUMN "status" SET DEFAULT '\''active'\''' >/dev/null
expect_preflight_rejection "$default_db" default

index_db="${test_prefix}_index"
restore_database "$index_db"
docker exec "$container" psql -X -q -v ON_ERROR_STOP=1 -U "$database_user" -d "$index_db" \
  -c 'DROP INDEX "MassEmailRecipient_campaignId_email_key"; CREATE INDEX "MassEmailRecipient_campaignId_email_key" ON "MassEmailRecipient" ("campaignId", "email")' >/dev/null
expect_preflight_rejection "$index_db" index

foreign_key_db="${test_prefix}_foreign_key"
restore_database "$foreign_key_db"
docker exec "$container" psql -X -q -v ON_ERROR_STOP=1 -U "$database_user" -d "$foreign_key_db" \
  -c 'ALTER TABLE "MassEmailRecipient" DROP CONSTRAINT "MassEmailRecipient_campaignId_fkey"; ALTER TABLE "MassEmailRecipient" ADD CONSTRAINT "MassEmailRecipient_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "MassEmailCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE' >/dev/null
expect_preflight_rejection "$foreign_key_db" foreign_key

printf '%s\n' 'evolved production preflight positive and semantic-negative tests passed'
