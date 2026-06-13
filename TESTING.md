# MuFiBu Testing

This repository provides lightweight CI targets for backend security contracts,
frontend permission contracts, and frontend build validation.

## Commands

Run all default CI checks:

```sh
make ci
```

Run backend tests only:

```sh
make backend-test
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

## Backend Coverage

`backend/tests/test_security_contracts.py` checks the role and RLS context
contracts used by authentication, tenant isolation, role assignment, journal
workflow permissions, and audit visibility roles.

These tests do not require a running database.  They validate the pure Python
permission contracts that feed PostgreSQL row-level security variables.

## Frontend Coverage

`frontend/src/utils/permissions.test.js` checks role-based navigation and
action visibility.  The tests cover tenant isolation, booking read/write
permissions, approval rights, journal posting visibility, account write
visibility, and admin/audit navigation.

## Database Bootstrap Smoke Test

`scripts/db_bootstrap_smoke.sh` creates a temporary database, applies the base
schema and RLS migration, and verifies that roles are present.

The smoke test is intentionally not part of `make ci` because it requires a
PostgreSQL server and a database user with create/drop database privileges.
Use it in an environment prepared for destructive test database operations.
