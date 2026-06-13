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
- [ ] Add brute-force protection on login (rate limiting / lockout / backoff).
      There is currently no throttling on the auth endpoint.
- [ ] Add a DB-level (or service-level) double-entry balance check for split
      bookings.  `journal_entry_lines` has no constraint ensuring debits equal
      credits; unbalanced multi-line entries can be stored.

### P2 - Robustness and Operability

- [ ] Replace the committed `frontend/build/` output with a build step.
      Shipping compiled artifacts in git risks source/build drift (the bundle
      can lag source edits) and bloats the repo.  Build in CI / deploy instead.
- [ ] Reconcile `scripts/ci.sh` with `make ci`.  `make ci` runs
      `backend-syntax` first; `scripts/ci.sh` omits it.  Align them so both
      entry points run the same checks.
- [ ] Introduce Alembic.  `MIGRATIONS.md` notes Alembic is a dependency but no
      environment exists; raw SQL files are authoritative.  Add an Alembic env
      or remove the unused dependency to avoid confusion.
- [ ] Add a token revocation path (denylist or session table) for immediate
      revocation.  Documented as future work in `SECURITY.md`; stateless tokens
      keep a revoked role effective until expiry.
- [ ] Tighten CORS.  `backend/app/main.py` uses `allow_methods=["*"]` and
      `allow_headers=["*"]` with `allow_credentials=True`.  Narrow methods and
      headers to what the client actually uses.

### P3 - Maintainability and Documentation

- [ ] Clarify the misleading `chk_accounts_same_tenant` CHECK constraint comment
      in `database/schema.sql`.  The constraint only enforces
      `main_account_id != contra_account_id`; the same-tenant rule is enforced
      by the `trg_je_account_tenant` trigger.
- [ ] Resolve the "RLS pending alignment" cell for Admin account writes in
      `RBAC.md` so the documented matrix matches the policies in
      `002_rls_officer.sql`.
- [ ] Consider moving JWTs out of `localStorage`.  Documented as a known
      tradeoff; `localStorage` is XSS-exposed.  httpOnly cookies plus CSRF
      defense is the stronger option if/when scope allows.
- [ ] Expand automated coverage with an opt-in integration test that exercises
      RLS against a real PostgreSQL instance (the smoke test only checks role
      seeding).

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
