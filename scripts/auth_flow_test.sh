#!/bin/sh
# =============================================================================
# Auth-flow integration test (opt-in).
# =============================================================================
# Drives the real FastAPI app (cookie + CSRF auth) via TestClient against a
# throwaway PostgreSQL database.  Unlike the pure-Python unit tests, this needs
# the backend dependencies installed (backend/requirements.txt) and a running
# PostgreSQL server with create/drop database privileges.
#
# Environment:
#   DB_HOST   (default 127.0.0.1)        DB_PORT (default 5432)
#   DB_USER   (default mufibu)           DB_PASS (default empty)
#   TEST_DB   (default mufibu_auth_test)
#   PYTHON    (default python3)          interpreter with backend deps installed
#
# Exit code is non-zero if any check fails.
# =============================================================================
set -eu

DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-mufibu}"
DB_PASS="${DB_PASS:-}"
TEST_DB="${TEST_DB:-mufibu_auth_test}"
PYTHON="${PYTHON:-python3}"
ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"

export PGPASSWORD="$DB_PASS"

# Preflight: backend deps must be importable.
if ! "$PYTHON" -c "import fastapi, sqlalchemy, jose, passlib, httpx" >/dev/null 2>&1; then
    echo "[auth-flow] ERROR: backend deps not importable by '$PYTHON'." >&2
    echo "[auth-flow] Install them first, e.g.:" >&2
    echo "[auth-flow]   pip install -r backend/requirements.txt httpx" >&2
    exit 1
fi

echo "[auth-flow] provisioning throwaway database $TEST_DB ..."
dropdb --if-exists -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" "$TEST_DB"
createdb -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" "$TEST_DB"
trap 'dropdb --if-exists -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" "$TEST_DB" >/dev/null 2>&1 || true' EXIT

# The app's lifespan creates tables (create_all) and seeds the PowerAdmin.
export DATABASE_URL="postgresql+psycopg2://${DB_USER}@/${TEST_DB}?host=${DB_HOST}&port=${DB_PORT}"
export COOKIE_SECURE="false"          # TestClient speaks plain http
export JWT_SECRET_KEY="${JWT_SECRET_KEY:-auth-flow-test-secret}"
export SEED_ADMIN_USERNAME="${SEED_ADMIN_USERNAME:-poweradmin}"
export SEED_ADMIN_PASSWORD="${SEED_ADMIN_PASSWORD:-ChangeMe1!}"

echo "[auth-flow] running auth-flow checks ..."
PYTHONPATH="$ROOT_DIR/backend" "$PYTHON" "$ROOT_DIR/scripts/auth_flow_test.py"
