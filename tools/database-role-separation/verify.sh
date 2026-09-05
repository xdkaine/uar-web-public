#!/usr/bin/env sh
set -eu

: "${PGHOST:?PGHOST is required}"
: "${PGDATABASE:?PGDATABASE is required}"
: "${PGUSER:?PGUSER is required}"
: "${PGPASSWORD:?PGPASSWORD is required}"

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
psql -X -q -v ON_ERROR_STOP=1 -f "$script_dir/verify.sql"
