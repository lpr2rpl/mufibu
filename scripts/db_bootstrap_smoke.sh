#!/bin/sh
set -eu

DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-mufibu_smoke}"
DB_USER="${DB_USER:-mufibu}"
DB_PASS="${DB_PASS:-}"
ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"

export PGPASSWORD="$DB_PASS"

dropdb --if-exists -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" "$DB_NAME"
createdb -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" "$DB_NAME"

psql -v ON_ERROR_STOP=1 -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
    -f "$ROOT_DIR/database/schema.sql"
psql -v ON_ERROR_STOP=1 -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
    -f "$ROOT_DIR/database/migrations/002_rls_officer.sql"

psql -v ON_ERROR_STOP=1 -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
    -c "SELECT COUNT(*) FROM roles;"

printf "Database bootstrap smoke test completed for %s\n" "$DB_NAME"
