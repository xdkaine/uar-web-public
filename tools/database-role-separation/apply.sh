#!/usr/bin/env sh
set -eu

: "${PGHOST:?PGHOST is required}"
: "${PGDATABASE:?PGDATABASE is required}"
: "${PGUSER:?PGUSER is required}"
: "${PGPASSWORD:?PGPASSWORD is required}"
: "${PORTAL_DATABASE_PASSWORD:?PORTAL_DATABASE_PASSWORD is required}"
: "${AUTH_DATABASE_PASSWORD:?AUTH_DATABASE_PASSWORD is required}"
: "${MIGRATION_DATABASE_PASSWORD:?MIGRATION_DATABASE_PASSWORD is required}"

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

# Passwords stay in the environment/psql variable space. Do not run this
# script with shell tracing or psql query echo enabled.
psql -X -q -v ON_ERROR_STOP=1 -f "$script_dir/provision.sql"
psql -X -q -v ON_ERROR_STOP=1 -f "$script_dir/verify.sql"
