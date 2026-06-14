# Migrations

The database artifacts currently consist of a base schema plus explicit SQL
migration files.

## Files

- `database/schema.sql`: base schema, enum types, tables, indexes, triggers,
  views, seed role catalog, and audit immutability rules.
- `database/migrations/002_rls_officer.sql`: idempotent RLS migration and
  Officer role support.
- `database/migrations/003_login_throttle.sql`: idempotent migration adding
  per-user login brute-force throttle columns.
- `database/migrations/004_journal_balance.sql`: idempotent migration adding a
  deferred constraint trigger that enforces double-entry balance on split
  journal lines.
- `database/migrations/005_ura_scope_trigger.sql`: idempotent migration adding a
  trigger that enforces role scope / tenant_id consistency (replacing a CHECK
  constraint that could not use a subquery).
- `database/migrations/006_token_revocation.sql`: idempotent migration adding the
  per-user `tokens_valid_after` token revocation watermark column.

## Apply Order

Run the base schema first, then migrations in numeric order:

```sh
psql -v ON_ERROR_STOP=1 -f database/schema.sql
psql -v ON_ERROR_STOP=1 -f database/migrations/002_rls_officer.sql
psql -v ON_ERROR_STOP=1 -f database/migrations/003_login_throttle.sql
psql -v ON_ERROR_STOP=1 -f database/migrations/004_journal_balance.sql
psql -v ON_ERROR_STOP=1 -f database/migrations/005_ura_scope_trigger.sql
psql -v ON_ERROR_STOP=1 -f database/migrations/006_token_revocation.sql
```

The setup script and the smoke test apply every file in
`database/migrations` in numeric order, so new migrations are picked up
automatically.

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

## Approach

Plain, idempotent SQL files in `database/` are the authoritative migration
artifacts, applied in numeric order by `setup.sh` and `make db-smoke`.  A
migration framework (such as Alembic) is intentionally not used; the unused
`alembic` dependency was removed to avoid implying an environment that does not
exist.  Revisit this if migrations outgrow hand-managed ordering.
