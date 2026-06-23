# MuFiBu Testing

This repository provides lightweight CI targets for backend security contracts,
frontend permission/API contracts, and frontend build validation.

## Commands

Run all default CI checks:

```sh
make ci
```

Run backend tests only:

```sh
make backend-test
```

Run backend syntax checks only:

```sh
make backend-syntax
```

Run frontend tests only:

```sh
make frontend-test
```

Run the frontend production build:

```sh
make frontend-build
```

Run the opt-in database bootstrap smoke test:

```sh
DB_USER=mufibu DB_PASS=change-this make db-smoke
```

Run the opt-in RLS integration test:

```sh
DB_ADMIN_USER=postgres make rls-test
```

Run the opt-in auth-flow integration test (needs backend deps installed):

```sh
DB_USER=mufibu DB_PASS=change-this make auth-flow-test
```

## Backend Coverage

`backend/tests/test_security_contracts.py` checks the role and RLS context
contracts used by authentication, tenant isolation, role assignment, journal
workflow permissions, and audit visibility roles.

These tests do not require a running database.  They validate the pure Python
permission contracts that feed PostgreSQL row-level security variables.

## Frontend Coverage

`frontend/src/utils/permissions.test.js` checks role-based navigation and
action visibility.  The tests cover tenant isolation, booking read/write
permissions, approval rights, journal posting visibility, account visibility,
and admin/audit navigation.

`frontend/src/api/contracts.test.js` checks the frontend API path constants
against the backend route shape used by routers.

The contract tests include the paged list endpoints, whose response envelope is
`total`, `skip`, `limit`, and `items`.

## Database Bootstrap Smoke Test

`scripts/db_bootstrap_smoke.sh` creates a temporary database, applies the base
schema and RLS migration, and verifies that roles are present.

The smoke test is intentionally not part of `make ci` because it requires a
PostgreSQL server and a database user with create/drop database privileges.
Use it in an environment prepared for destructive test database operations.

## RLS Integration Test

`scripts/rls_integration_test.sh` (target `make rls-test`) exercises the actual
row-level security policies against a real PostgreSQL server.  It provisions a
throwaway database and a dedicated non-superuser role (RLS does not apply to
superusers), applies `schema.sql` and all migrations as that role, seeds two
tenants with accounts, journal entries, and audit rows, then asserts policy
behavior by simulating each app-user context through the `app.*` session
variables the backend sets:

- tenant isolation and the anonymous deny-all default;
- Reader/Writer/Officer read scope and write restrictions (including blocked
  cross-tenant writes);
- Admin reads accounts but cannot write them or read journal entries;
- Auditor global read with no write;
- PowerAdmin tenant access with no booking access;
- audit-log visibility scoping and append-only immutability.

It provisions and drops its own role and database, so it needs an admin
connection (`DB_ADMIN_USER`, default `postgres`) with privileges to create and
drop roles and databases.  Like `db-smoke`, it is intentionally excluded from
`make ci`.

## Auth-Flow Integration Test

`scripts/auth_flow_test.sh` (target `make auth-flow-test`) drives the real
FastAPI app through `scripts/auth_flow_test.py` (FastAPI `TestClient`) against a
throwaway database, exercising the cookie + CSRF auth contract end to end:

- login returns `{user, roles}` with tokens only in httpOnly cookies (none in
  the body);
- the session works via the cookie (`/me`);
- CSRF blocks unsafe cookie-authenticated requests with a missing or wrong
  token and allows a valid one, while `Authorization: Bearer` clients bypass
  CSRF;
- refresh rotates the session and logout clears the cookies and revokes the
  token (`/me` then returns 401).

Unlike the pure-Python unit tests, this needs the backend dependencies
installed (`backend/requirements.txt`, plus `httpx` for `TestClient`) and a
PostgreSQL server with create/drop database privileges.  Set `PYTHON` to an
interpreter that has the deps (for example a virtualenv).  It is excluded from
`make ci` for the same reason as the other database-backed tests.
