#!/bin/sh
# =============================================================================
# Concurrent token-refresh race condition test (opt-in).
# =============================================================================
# Fires two simultaneous POST /auth/refresh requests sharing the same
# refresh-token cookie and asserts that the outcome is safe (no 5xx, at
# least one 200, and the other response is 200 or 401).
#
# Requires the same environment as auth_flow_test.sh.  Uses the same
# throwaway PostgreSQL database mechanism.
#
# Environment:
#   DB_HOST   (default 127.0.0.1)        DB_PORT (default 5432)
#   DB_USER   (default mufibu)           DB_PASS (default empty)
#   TEST_DB   (default mufibu_refresh_race_test)
#   PYTHON    (default python3)          interpreter with backend deps installed
#
# Exit code is non-zero if any check fails.
# =============================================================================
set -eu

DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-mufibu}"
DB_PASS="${DB_PASS:-}"
TEST_DB="${TEST_DB:-mufibu_refresh_race_test}"
PYTHON="${PYTHON:-python3}"
ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"

export PGPASSWORD="$DB_PASS"

if ! "$PYTHON" -c "import fastapi, sqlalchemy, jose, passlib, httpx" >/dev/null 2>&1; then
    echo "[concurrent-refresh] ERROR: backend deps not importable by '$PYTHON'." >&2
    echo "[concurrent-refresh] Install them first:" >&2
    echo "[concurrent-refresh]   pip install -r backend/requirements.txt httpx" >&2
    exit 1
fi

echo "[concurrent-refresh] provisioning throwaway database $TEST_DB ..."
dropdb --if-exists -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" "$TEST_DB"
createdb -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" "$TEST_DB"
trap 'dropdb --if-exists -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" "$TEST_DB" >/dev/null 2>&1 || true' EXIT

export DATABASE_URL="postgresql+psycopg2://${DB_USER}@/${TEST_DB}?host=${DB_HOST}&port=${DB_PORT}"
export COOKIE_SECURE="false"
export JWT_SECRET_KEY="${JWT_SECRET_KEY:-concurrent-refresh-test-secret}"
export SEED_ADMIN_USERNAME="${SEED_ADMIN_USERNAME:-poweradmin}"
export SEED_ADMIN_PASSWORD="${SEED_ADMIN_PASSWORD:-ChangeMe1!}"

echo "[concurrent-refresh] running concurrent-refresh race checks ..."
PYTHONPATH="$ROOT_DIR/backend" "$PYTHON" "$ROOT_DIR/scripts/concurrent_refresh_test.py"
