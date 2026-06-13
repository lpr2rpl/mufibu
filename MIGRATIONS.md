# Migrations

The database artifacts currently consist of a base schema plus explicit SQL
migration files.

## Files

- `database/schema.sql`: base schema, enum types, tables, indexes, triggers,
  views, seed role catalog, and audit immutability rules.
- `database/migrations/002_rls_officer.sql`: idempotent RLS migration and
  Officer role support.

## Apply Order

Run the base schema first, then migrations in numeric order:

```sh
psql -v ON_ERROR_STOP=1 -f database/schema.sql
psql -v ON_ERROR_STOP=1 -f database/migrations/002_rls_officer.sql
```

The setup script does this in its `schema` step.

## Smoke Test

Use the opt-in smoke test when a PostgreSQL user with create/drop database
privileges is available:

```sh
DB_USER=mufibu DB_PASS=change-this make db-smoke
```

The smoke test creates a temporary database, applies the schema and migration,
and verifies that roles exist.

## Migration Rules

- Prefer idempotent SQL migrations when possible.
- Preserve existing data unless a migration explicitly states otherwise.
- Avoid hidden best-effort execution; schema failures should stop deployment.
- Keep RLS helper function semantics aligned with `backend/app/rls.py`.
- Keep role names aligned with backend and frontend permission helpers.
- Back up production data before applying migrations.

## Known Direction

Alembic is listed as a backend dependency, but this repository does not yet
include an Alembic environment.  Until that exists, SQL files in `database/`
are the authoritative migration artifacts.
