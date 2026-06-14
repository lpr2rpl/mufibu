# Architecture Analysis and Improvement Checklist

This document records an architecture and artifact review of MuFiBu and tracks
the resulting improvement backlog.  Items are grouped by priority.  Each item is
a checkbox so progress can be tracked over time.

All repository artifacts must be ASCII7 (7-bit US-ASCII).  See "ASCII7 Policy".

## 1. Architecture Summary

MuFiBu is a classic three-tier application:

- Frontend: React 18 SPA, Axios client, JWT in browser local storage.
- Backend: FastAPI, SQLAlchemy ORM, Pydantic schemas, JWT auth.
- Database: PostgreSQL with forced row-level security (RLS).

Authorization is layered: frontend guards (usability only), backend route
checks (clear errors, workflow rules), and PostgreSQL RLS (the enforcing
boundary).  The RLS context is derived from JWT role claims and injected into
each transaction via `SET LOCAL` session variables (`backend/app/database.py`
`after_begin` event), consumed by the policies in
`database/migrations/002_rls_officer.sql`.

Strengths observed:

- RLS is `FORCE`d, so even the table owner is subject to policies.
- Security context is transaction-scoped via `set_config(..., is_local => true)`,
  so pooled connections do not leak one request's context into the next.
- Audit rows are immutable at two layers (rules in `schema.sql` and RLS
  policies).
- Permission semantics are mirrored across backend helpers, RLS helpers, and
  frontend helpers, with contract tests guarding the Python and JS sides.
- Request correlation via `X-Request-ID` is implemented end to end.

## 2. Findings and Improvement Backlog

### P1 - Correctness and Security

- [x] Enforce ASCII7 across all repository artifacts.  Eight frontend files
      held raw Unicode glyphs (box, multiplication sign, arrows, em dash,
      check/cross); replaced with ASCII-source equivalents and guarded by
      `scripts/ascii_check.sh` in `make ci`.  See "ASCII7 Policy".
- [x] Capture `ip_address`, `user_agent`, and `session_id` for all audit
      writes, not just login/logout.  A `before_flush` event in
      `backend/app/database.py` now stamps these onto every `AuditLog` row from
      the request context populated by the HTTP middleware; `session_id` holds
      the per-request correlation id (X-Request-ID) since tokens are stateless.
- [x] Make journal entry numbering concurrency-safe.  `_next_entry_number`
      (`backend/app/routers/journal.py`) now takes a transaction-scoped
      `pg_advisory_xact_lock` keyed on the tenant, serializing the
      read-then-insert window so concurrent creates cannot collide.
- [x] Re-examine `post_entry` allowing `draft` to be posted directly
      (`backend/app/routers/journal.py`).  Posting is now gated by
      `app/journal_workflow.py:postable_error`: entries that require approval
      must reach `approved` first (four-eyes cannot be skipped), while entries
      that do not require approval may still post from `draft`.
- [x] Add brute-force protection on login (rate limiting / lockout / backoff).
      Per-user lockout persisted on the `users` table
      (`app/auth/login_throttle.py`, migration 003): after
      `LOGIN_MAX_FAILED_ATTEMPTS` failures the account locks for
      `LOGIN_LOCKOUT_MINUTES` and `/auth/login` returns 429 with `Retry-After`.
      DB-backed so it holds across workers; timing equalized for unknown users.
- [x] Add a double-entry balance check for split bookings.  Enforced at the
      service layer by `app/journal_workflow.py:lines_balance_error` (called in
      `create_entry`): when split `lines` are present, total debits must equal
      total credits or the request is rejected with 400.  Header-only entries
      are balanced by construction.
- [x] Defense-in-depth: DB-level deferred constraint trigger on
      `journal_entry_lines` mirroring `lines_balance_error`, so the invariant
      holds even for writes that bypass the service layer
      (`database/migrations/004_journal_balance.sql`).  Validated against a live
      PostgreSQL 17 instance, including the FORCE ROW LEVEL SECURITY case with a
      non-superuser owner and a SECURITY DEFINER trigger function: the writer's
      per-transaction RLS context keeps the entry's lines visible to the
      trigger's SUM, so balanced entries commit and unbalanced ones abort at
      COMMIT with correct totals.

### P2 - Robustness and Operability

- [x] Replace the committed `frontend/build/` output with a build step.
      Re-verified: `frontend/build/` was never tracked in git history and is
      already covered by `.gitignore`; no compiled artifacts are tracked
      anywhere.  The bundle is produced fresh by CI (`make frontend-build`) and
      by deploy (`setup.sh` runs `npm install && npm run build`).  The original
      finding was a false positive - the local build directory was observed on
      disk and assumed committed.  No source/build drift risk exists.
- [x] Reconcile `scripts/ci.sh` with `make ci`.  `scripts/ci.sh` now `exec`s
      `make ci`, so the check list lives in one place and the two entry points
      cannot drift.
- [ ] Introduce Alembic.  `MIGRATIONS.md` notes Alembic is a dependency but no
      environment exists; raw SQL files are authoritative.  Add an Alembic env
      or remove the unused dependency to avoid confusion.
- [x] Add a token revocation path for immediate revocation.  Implemented a
      per-user `tokens_valid_after` watermark (migration 006,
      `app/auth/token_revocation.py`): tokens carry `iat` and any token issued
      before the watermark is rejected by `get_current_user` and `/auth/refresh`.
      Logout, user deactivation/soft-delete, and a PowerAdmin force-logout
      endpoint (`POST /users/{id}/revoke-tokens`) bump it.  RLS on `users`
      governs who can revoke whom (self / PowerAdmin); verified by the RLS
      integration test.  Tenant-Admin role revokes remain TTL-bounded (noted in
      `SECURITY.md`/`RBAC.md`).
- [x] Tighten CORS.  `backend/app/main.py` previously used
      `allow_methods=["*"]` and `allow_headers=["*"]` with
      `allow_credentials=True`.  Now restricted to the methods
      (`GET, POST, PATCH, DELETE, OPTIONS`) and headers
      (`Authorization, Content-Type, X-Request-ID`) the client actually uses,
      and exposes `X-Request-ID`.  Wildcards are also not honored by browsers
      for credentialed requests, so the explicit allowlist is more correct.

### P3 - Maintainability and Documentation

- [x] Fix the invalid `chk_scope_tenant` CHECK constraint in
      `database/schema.sql`.  It used a subquery into `roles`, which PostgreSQL
      rejects, so `schema.sql` was not a valid standalone artifact and the
      invariant was unenforced (tables come from `create_all`).  Replaced with a
      `trg_ura_scope_tenant` trigger in `schema.sql` and idempotent migration
      `005_ura_scope_trigger.sql`.  Validated on a live PostgreSQL 17 instance:
      the full `schema.sql` + migrations chain now applies under
      `ON_ERROR_STOP=1`, and the trigger accepts/rejects the scope-vs-tenant_id
      matrix correctly.
- [x] Clarify the misleading `chk_accounts_same_tenant` CHECK constraint in
      `database/schema.sql`.  Renamed to `chk_accounts_distinct` (it only
      enforces `main_account_id != contra_account_id`) with an accurate comment
      noting the same-tenant rule is enforced by the `trg_je_account_tenant`
      trigger.
- [x] Resolve the "RLS pending alignment" cell for Admin account writes.  The
      app layer allowed Admin to write accounts but RLS did not, so an Admin
      write hit an RLS failure instead of a clean 403.  Aligned to RLS (and the
      role definition): `require_account_write` no longer allows Admin, the
      `RBAC.md` matrix cell is now "no", and the accounts router and
      `002_rls_officer.sql` comments were corrected.
- [ ] Consider moving JWTs out of `localStorage`.  Documented as a known
      tradeoff; `localStorage` is XSS-exposed.  httpOnly cookies plus CSRF
      defense is the stronger option if/when scope allows.
- [x] Expand automated coverage with an opt-in integration test that exercises
      RLS against a real PostgreSQL instance (the smoke test only checks role
      seeding).  Added `scripts/rls_integration_test.sh` (`make rls-test`): it
      provisions a throwaway non-superuser role + database, applies
      `schema.sql` and all migrations, seeds two tenants, and asserts the RLS
      policies by simulating each app-user context via the `app.*` session
      variables (tenant isolation, role read/write scope, cross-tenant write
      blocks, audit visibility, and append-only immutability).  Opt-in like
      `db-smoke`, not part of `make ci`.

## 3. ASCII7 Policy

All tracked text artifacts must contain only 7-bit US-ASCII bytes (0x00-0x7F).
This keeps diffs, terminals, and toolchains free of encoding ambiguity.

Rendered UI glyphs are preserved without non-ASCII source bytes by using:

- HTML entities in JSX text children (for example `&times;`, `&larr;`,
  `&rarr;`, `&mdash;`).
- `\uXXXX` escapes in JavaScript string literals (for example a check mark
  written as `'\u2713'`).

The guard `scripts/ascii_check.sh` (run by `make ascii-check`, included in
`make ci`) fails the build if any tracked file contains a non-ASCII byte.
