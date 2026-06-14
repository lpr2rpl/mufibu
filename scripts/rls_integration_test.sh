#!/bin/sh
# =============================================================================
# Row-Level Security integration test (opt-in; requires a PostgreSQL server).
# =============================================================================
# Exercises the actual RLS policies in database/schema.sql + migrations against
# a real database by simulating each app-user context through the session
# variables the backend sets (app.user_id, app.readable_tenant_ids, ...).
#
# RLS only applies to NON-superuser roles, so the test provisions a dedicated
# NOSUPERUSER/NOBYPASSRLS role that owns the schema and runs every assertion as
# that role.  Provisioning (create role/db, install extensions) needs an admin
# connection.
#
# Environment:
#   DB_HOST        (default 127.0.0.1)
#   DB_PORT        (default 5432)
#   DB_ADMIN_USER  admin/superuser for provisioning   (default postgres)
#   RLS_APP_ROLE   throwaway non-superuser app role    (default mufibu_rls_app)
#   RLS_APP_PASS   password for that role              (default rls_test_pw)
#   RLS_TEST_DB    throwaway database name             (default mufibu_rls_test)
#   PGPASSWORD     password for DB_ADMIN_USER, if required
#
# Exit code is non-zero if any assertion fails.
# =============================================================================
set -eu

DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-5432}"
ADMIN_USER="${DB_ADMIN_USER:-postgres}"
APP_ROLE="${RLS_APP_ROLE:-mufibu_rls_app}"
APP_PASS="${RLS_APP_PASS:-rls_test_pw}"
TEST_DB="${RLS_TEST_DB:-mufibu_rls_test}"
ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"

ADMIN="psql -v ON_ERROR_STOP=1 -h $DB_HOST -p $DB_PORT -U $ADMIN_USER"
APP="env PGPASSWORD=$APP_PASS psql -v ON_ERROR_STOP=1 -h $DB_HOST -p $DB_PORT -U $APP_ROLE -d $TEST_DB"

cleanup() {
    $ADMIN -d postgres -q -c "DROP DATABASE IF EXISTS $TEST_DB;" 2>/dev/null || true
    $ADMIN -d postgres -q -c "DROP ROLE IF EXISTS $APP_ROLE;"   2>/dev/null || true
}
trap cleanup EXIT

# -- Test data identifiers ----------------------------------------------------
TA=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa   # tenant A
TB=bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb   # tenant B
U1=11111111-1111-1111-1111-111111111111   # author of seed rows
U2=22222222-2222-2222-2222-222222222222   # acting user (owns no audit rows)
A1=a1a1a1a1-0000-0000-0000-000000000001   # tenant A accounts
A2=a2a2a2a2-0000-0000-0000-000000000002
B1=b1b1b1b1-0000-0000-0000-000000000001   # tenant B accounts
B2=b2b2b2b2-0000-0000-0000-000000000002

echo "[rls-test] provisioning role and database via $ADMIN_USER ..."
$ADMIN -d postgres -q -c "DROP DATABASE IF EXISTS $TEST_DB;"
$ADMIN -d postgres -q -c "DROP ROLE IF EXISTS $APP_ROLE;"
$ADMIN -d postgres -q -c "CREATE ROLE $APP_ROLE LOGIN PASSWORD '$APP_PASS' NOSUPERUSER NOBYPASSRLS;"
$ADMIN -d postgres -q -c "CREATE DATABASE $TEST_DB OWNER $APP_ROLE;"
$ADMIN -d "$TEST_DB" -q -c "ALTER SCHEMA public OWNER TO $APP_ROLE;"
# Extensions require admin; schema.sql then runs CREATE EXTENSION IF NOT EXISTS
# (a no-op once present).
$ADMIN -d "$TEST_DB" -q -c "CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\"; CREATE EXTENSION IF NOT EXISTS pgcrypto;"

# Guard: the app role must be subject to RLS, else the test proves nothing.
super=$($APP -tAc "SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user;")
if [ "$super" != "f" ]; then
    echo "[rls-test] ERROR: app role bypasses RLS (superuser/bypassrls); cannot test." >&2
    exit 1
fi

echo "[rls-test] applying schema.sql + migrations as $APP_ROLE ..."
$APP -q -f "$ROOT_DIR/database/schema.sql"
for mig in "$ROOT_DIR"/database/migrations/*.sql; do
    $APP -q -f "$mig"
done

echo "[rls-test] seeding fixtures (under bypass context) ..."
$APP -q -c "
SET app.bypass_rls = 'true';
INSERT INTO tenants (id, name) VALUES ('$TA', 'TenantA'), ('$TB', 'TenantB');
INSERT INTO users (id, username, email, password_hash)
    VALUES ('$U1', 'u1', 'u1@example.test', 'x');
INSERT INTO accounts (id, tenant_id, account_number, name, account_type, created_by) VALUES
    ('$A1', '$TA', '1000', 'Cash A', 'asset',   '$U1'),
    ('$A2', '$TA', '2000', 'Rev A',  'revenue', '$U1'),
    ('$B1', '$TB', '1000', 'Cash B', 'asset',   '$U1'),
    ('$B2', '$TB', '2000', 'Rev B',  'revenue', '$U1');
INSERT INTO journal_entries
    (tenant_id, entry_number, entry_date, description, main_account_id, contra_account_id, amount, created_by) VALUES
    ('$TA', '2026A1', '2026-01-01', 'JA', '$A1', '$A2', 100, '$U1'),
    ('$TB', '2026B1', '2026-01-01', 'JB', '$B1', '$B2', 200, '$U1');
INSERT INTO audit_log (user_id, tenant_id, action, table_name) VALUES
    ('$U1', '$TA',  'INSERT', 'accounts'),
    ('$U1', '$TB',  'INSERT', 'accounts'),
    ('$U1', NULL,   'LOGIN',  NULL);
"

# -- Context builder: emit the SET statements for one simulated app user ------
# args: user readable writable admin is_auditor is_power_admin
setctx() {
    printf "SET app.user_id='%s'; SET app.readable_tenant_ids='%s'; SET app.writable_tenant_ids='%s'; SET app.admin_tenant_ids='%s'; SET app.is_auditor='%s'; SET app.is_power_admin='%s'; SET app.bypass_rls='false';" \
        "$1" "$2" "$3" "$4" "$5" "$6"
}

ANON=""
READER_A="$(setctx   $U2 $TA ''  ''  false false)"
WRITER_A="$(setctx   $U2 $TA $TA ''  false false)"
OFFICER_A="$(setctx  $U2 $TA ''  ''  false false)"   # Officer maps to readable
ADMIN_A="$(setctx    $U2 ''  ''  $TA false false)"
AUDITOR="$(setctx    $U2 ''  ''  ''  true  false)"
POWERADMIN="$(setctx $U2 ''  ''  ''  false true)"

# -- Assertion helpers --------------------------------------------------------
set +e
PASS=0
FAIL=0
ok()   { PASS=$((PASS+1)); echo "  PASS: $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL: $1" >&2; }

# expect_count "desc" "<ctx+query>" expected
# -q suppresses command tags (SET/UPDATE/...) so only the final query result is read.
expect_count() {
    got=$($APP -qtAc "$2" 2>/tmp/rls_err.$$ | tr -d '[:space:]')
    if [ "$got" = "$3" ]; then ok "$1 (=$got)"; else bad "$1 (expected $3, got '${got}'; $(tr -d '\n' </tmp/rls_err.$$))"; fi
}
# expect_allowed "desc" "<ctx+dml>"   (wrapped in BEGIN/ROLLBACK so it never persists)
expect_allowed() {
    if $APP -q -c "$2" >/dev/null 2>/tmp/rls_err.$$; then ok "$1 (allowed)"; else bad "$1 (unexpected denial: $(tr -d '\n' </tmp/rls_err.$$))"; fi
}
# expect_denied "desc" "<ctx+dml>"
expect_denied() {
    if $APP -q -c "$2" >/dev/null 2>/tmp/rls_err.$$; then bad "$1 (was allowed but should be denied)"; else ok "$1 (denied)"; fi
}

echo "[rls-test] tenant isolation + role read/write ..."
expect_count "anonymous context sees no accounts (deny-all default)" "$ANON SELECT count(*) FROM accounts;" 0
expect_count "Reader A sees only tenant A accounts"                  "$READER_A SELECT count(*) FROM accounts;" 2
expect_count "Reader A cannot see tenant B accounts"                 "$READER_A SELECT count(*) FROM accounts WHERE tenant_id='$TB';" 0
expect_count "Reader A sees only tenant A journal entries"           "$READER_A SELECT count(*) FROM journal_entries;" 1
expect_denied "Reader A cannot insert an account" \
    "$READER_A BEGIN; INSERT INTO accounts (tenant_id,account_number,name,account_type,created_by) VALUES ('$TA','9000','x','asset','$U1'); ROLLBACK;"

expect_allowed "Writer A can insert an account in tenant A" \
    "$WRITER_A BEGIN; INSERT INTO accounts (tenant_id,account_number,name,account_type,created_by) VALUES ('$TA','9001','w','asset','$U1'); ROLLBACK;"
expect_denied "Writer A cannot insert an account in tenant B (cross-tenant write)" \
    "$WRITER_A BEGIN; INSERT INTO accounts (tenant_id,account_number,name,account_type,created_by) VALUES ('$TB','9002','w','asset','$U1'); ROLLBACK;"

echo "[rls-test] Officer (read-only) ..."
expect_count  "Officer A sees tenant A journal entries"             "$OFFICER_A SELECT count(*) FROM journal_entries;" 1
expect_denied "Officer A cannot insert a journal entry" \
    "$OFFICER_A BEGIN; INSERT INTO journal_entries (tenant_id,entry_number,entry_date,description,main_account_id,contra_account_id,amount,created_by) VALUES ('$TA','Z1','2026-02-02','x','$A1','$A2',5,'$U1'); ROLLBACK;"

echo "[rls-test] Admin (role mgmt only) ..."
expect_count  "Admin A can read accounts (role-management UI needs the list)" "$ADMIN_A SELECT count(*) FROM accounts;" 2
expect_count  "Admin A cannot read journal entries"                          "$ADMIN_A SELECT count(*) FROM journal_entries;" 0
expect_denied "Admin A cannot write accounts" \
    "$ADMIN_A BEGIN; INSERT INTO accounts (tenant_id,account_number,name,account_type,created_by) VALUES ('$TA','9003','x','asset','$U1'); ROLLBACK;"

echo "[rls-test] Auditor (global read-only) ..."
expect_count  "Auditor sees all accounts"         "$AUDITOR SELECT count(*) FROM accounts;" 4
expect_count  "Auditor sees all journal entries"  "$AUDITOR SELECT count(*) FROM journal_entries;" 2
expect_denied "Auditor cannot write accounts" \
    "$AUDITOR BEGIN; INSERT INTO accounts (tenant_id,account_number,name,account_type,created_by) VALUES ('$TA','9004','x','asset','$U1'); ROLLBACK;"

echo "[rls-test] PowerAdmin (tenants, no bookings) ..."
expect_count   "PowerAdmin sees all tenants"        "$POWERADMIN SELECT count(*) FROM tenants;" 2
expect_count   "PowerAdmin has no journal access"   "$POWERADMIN SELECT count(*) FROM journal_entries;" 0
expect_allowed "PowerAdmin can create a tenant" \
    "$POWERADMIN BEGIN; INSERT INTO tenants (name) VALUES ('TZ'); ROLLBACK;"

echo "[rls-test] audit log visibility + immutability ..."
expect_count "Reader A sees only tenant A audit rows" "$READER_A SELECT count(*) FROM audit_log;" 1
expect_count "Auditor sees all audit rows"            "$AUDITOR SELECT count(*) FROM audit_log;" 3
# Append-only: UPDATE/DELETE are no-ops (schema rules + RLS), so nothing changes.
expect_count "audit_log UPDATE does not modify rows" \
    "$AUDITOR UPDATE audit_log SET notes='HACK'; SELECT count(*) FROM audit_log WHERE notes='HACK';" 0
expect_count "audit_log DELETE does not remove rows" \
    "$AUDITOR DELETE FROM audit_log; SELECT count(*) FROM audit_log;" 3

rm -f /tmp/rls_err.$$
echo "[rls-test] ---------------------------------------------"
echo "[rls-test] $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || exit 1
echo "[rls-test] RLS integration test PASSED"
