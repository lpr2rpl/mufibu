# Architecture Analysis and Improvement Checklist

This document records an architecture and artifact review of MuFiBu and tracks
the resulting improvement backlog.  Items are grouped by priority.  Each item is
a checkbox so progress can be tracked over time.

All repository artifacts must be ASCII7 (7-bit US-ASCII).  See "ASCII7 Policy".

## 1. Architecture Summary

MuFiBu is a classic three-tier application:

- Frontend: React 18 SPA, Axios client; JWT auth via httpOnly cookies with
  double-submit CSRF protection (no tokens in browser-readable storage).
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
- [x] Resolve the unused Alembic dependency.  Confirmed `alembic` had no
      environment, ini, or code references; removed it from
      `backend/requirements.txt` and reframed the `MIGRATIONS.md` note around the
      intentional hand-managed SQL-migration approach.
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
      (`Authorization, Content-Type, X-Request-ID, X-CSRF-Token`) the client
      actually uses,
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
- [x] Move JWTs out of `localStorage`.  Access and refresh tokens are now
      delivered as httpOnly, Secure, SameSite=Strict cookies (the SPA never
      reads them), with a double-submit `csrf_token`/`X-CSRF-Token` CSRF defense
      and a Bearer fallback for non-browser clients.  `COOKIE_SECURE` is
      configurable (HTTPS required in production; `false` for local HTTP).
      Validated end to end against a live FastAPI + PostgreSQL instance.  See
      `SECURITY.md` ("Cookie-Based Sessions", "CSRF Protection").  The frontend
      nginx site now terminates TLS on 443 and redirects 80 -> HTTPS, with
      `setup.sh` generating a self-signed cert if none exists (replace with a
      real cert in production); see `DEPLOYMENT.md` ("TLS").
- [x] Expand automated coverage with an opt-in integration test that exercises
      RLS against a real PostgreSQL instance (the smoke test only checks role
      seeding).  Added `scripts/rls_integration_test.sh` (`make rls-test`): it
      provisions a throwaway non-superuser role + database, applies
      `schema.sql` and all migrations, seeds two tenants, and asserts the RLS
      policies by simulating each app-user context via the `app.*` session
      variables (tenant isolation, role read/write scope, cross-tenant write
      blocks, audit visibility, and append-only immutability).  Opt-in like
      `db-smoke`, not part of `make ci`.

### P4 - Traceability and Documentation

- [x] Track all improvement items in this document so the backlog is visible.
      Previous improvements were implemented but not recorded here until now.

## 3. Second Artifact Review (2026-06-27)

A second full-stack review was conducted covering backend, frontend, database,
auth, and test layers.  Items below were identified and implemented in a single
batch.

### Security

- [x] Add Content-Security-Policy response header (migration 1.1).
      `nginx/mufibu-frontend.conf` now adds a CSP header restricting scripts
      to same-origin, permitting inline styles (required for React style props),
      and blocking framing via `frame-ancestors 'none'`.

- [x] API-wide rate limiting (migration 1.2).
      `nginx/mufibu-frontend.conf` adds a `limit_req_zone` (60 req/min per
      IP, burst 20) applied to all `/api/` traffic.  Health endpoints are
      exempted from rate limiting so liveness probes are never throttled.
      Returns HTTP 429 on excess requests.

- [x] Enforce account `is_active` at the DB level (migration 1.3).
      `database/migrations/007_active_account_enforcement.sql` adds trigger
      `trg_je_accounts_active` on `journal_entries`: any INSERT or UPDATE that
      sets an inactive account as `main_account_id` or `contra_account_id` is
      rejected.  The trigger skips the check when neither account column
      changes, so status/approval updates on existing entries are unaffected.
      Service-layer gaps were also closed: `update_entry` now validates
      `is_active` when changing accounts, and split-line account checks in
      `create_entry` now include `is_active`.

- [x] Tighten access token cookie path from `/api/` to `/api/v1/` (fix 1.4).
      `backend/app/auth/cookies.py` `ACCESS_PATH` changed so the access token
      is only sent on routes that actually consume it, reducing the window for
      future `/api/v2/` or similar paths inadvertently receiving it.

### Business Logic Correctness

- [x] Structured approval notes field (fix 2.1).
      `database/migrations/008_approval_notes.sql` adds `approval_notes TEXT`
      to `journal_entries`.  `approve_entry` now writes to this column instead
      of appending a text prefix to `entry.notes`.  The approve action in the
      UI now opens a modal with an optional approval notes textarea.  The
      response schema (`JournalEntryOut`) exposes `approval_notes` and the
      Status column shows it as a hover tooltip.

- [x] Journal entry reversal endpoint (feature 2.2).
      `POST /tenants/{tenant_id}/journal/{entry_id}/reverse` creates a draft
      reversal entry with main/contra accounts swapped and debit/credit on
      split lines swapped.  Requires PowerUser.  The original entry is
      unchanged; the reversal carries the original entry number in `reference`.
      A "Reverse" button is shown on posted entries in the Journal UI.

- [x] Parent account tenant boundary validation (fix 2.3).
      `database/migrations/007_active_account_enforcement.sql` also adds
      trigger `trg_account_parent_tenant` on `accounts`: any account created
      (or updated) with a `parent_account_id` referencing a different tenant
      is rejected.  `create_account` in `routers/accounts.py` adds a
      service-layer check that returns a clean 400 before the trigger fires.

### Testing Coverage

- [x] `can_reverse` unit tests (test 3.3 / 2.2).
      `backend/tests/test_journal_workflow.py` now includes `CanReverseTests`
      covering both the posted-entry pass and all non-posted-state blocks.

- [x] API response schema contract tests (test 3.2).
      `frontend/src/api/contracts.test.js` now includes a
      `response shape contracts` suite covering `JournalEntry`, `Account`,
      `AuthSession` (including `access_expires_at`), and `ReversalResponse`.
      `contracts.js` documents all key response shapes as JSDoc typedefs.
      The `journalReverse` path is also covered in the path-shape suite.

### UX Improvements

- [x] Session timeout indicator (feature 4.1).
      `backend/app/auth/dependencies.py` exposes `token_exp` on `CurrentUser`.
      `AuthSession` response now includes `access_expires_at` (exact timestamp
      from `_issue_session`; from JWT `exp` claim on `/auth/me`).
      `frontend/src/context/AuthContext.jsx` schedules a `setTimeout` 5 minutes
      before expiry and sets `sessionExpiring=true`.
      `frontend/src/components/SessionWarning.jsx` renders a fixed-position
      banner with "Extend" (calls `/auth/refresh`) and "Dismiss" actions.
      The banner is rendered globally from `App.jsx` inside `AuthProvider`.

- [x] Password complexity enforcement (feature 4.2).
      `UserCreate.password_strength` validator in `backend/app/schemas.py` now
      requires min 12 characters, at least one uppercase letter, one digit,
      and one special character (non-alphanumeric).  The user creation form in
      `frontend/src/pages/Users.jsx` displays the requirement as hint text.

## 3. Third Artifact Review (2026-06-27)

### Security and Correctness

- [x] Prevent double-reversals.
      `can_reverse` in `backend/app/journal_workflow.py` now accepts an optional
      `reversed_at` parameter; passing a non-None value returns an error message.
      The router passes `entry.reversed_at` so the check is enforced at request time.
      Two new unit tests cover the already-reversed case.

- [x] Stamp original entry on reversal.
      `reverse_entry` now writes `reversed_at`, `reversed_by`, and `reversal_entry_id`
      back to the original entry and writes a `REVERSE` audit record (new enum value)
      instead of a generic `INSERT`.  Migration 009 adds the three columns and the
      new enum value.

- [x] Include `approval_notes` in journal entry search.
      The `ILIKE` filter in `_entry_list_query` now includes `approval_notes` alongside
      `entry_number`, `description`, `reference`, and `notes`.

- [x] Exempt `/api/v1/health/db` from nginx rate limiting.
      A dedicated `location = /api/v1/health/db` block (no `limit_req` directive) was
      added alongside the existing `/api/v1/health` block so readiness probes are not
      throttled.

### Testing and Documentation

- [x] Concurrent token-refresh race condition integration test.
      `scripts/concurrent_refresh_test.py` fires two simultaneous `POST /auth/refresh`
      requests sharing the same refresh-token cookie via `threading.Thread` and asserts
      no 5xx, at least one 200, and the second response is 200 or 401.
      `scripts/concurrent_refresh_test.sh` provisions a throwaway database and
      invokes the script.  `make concurrent-refresh-test` runs it.

- [x] Response shape contract tests extended.
      `frontend/src/api/contracts.test.js` updated: `JournalEntry` shape now asserts
      the three reversal tracking fields (`reversed_at`, `reversed_by`,
      `reversal_entry_id`).

- [x] Schema: `REVERSE` added to `audit_action` enum.
      Both `database/schema.sql` (for fresh installs) and migration 009 (using
      `ADD VALUE IF NOT EXISTS` for existing installs) carry the new enum value.
      `backend/app/models.py` `AuditLog.action` SAEnum updated to match.

## 4. Fourth Artifact Review (2026-06-27)

### Schema Completeness

- [x] Expose missing provenance fields in `JournalEntryOut`.
      `submitted_at`, `submitted_by`, `rejected_by`, and `posted_by` were present
      on the SQLAlchemy model but absent from the Pydantic response schema.  All
      four are now included in `JournalEntryOut` so API consumers can display the
      full submission and rejection lifecycle without querying the audit log.

### Security and Correctness

- [x] Account deactivation guard.
      `update_account` in `backend/app/routers/accounts.py` now rejects
      `PATCH /accounts/{id}` with `is_active: false` when any non-deleted journal
      entry in `draft`, `pending_approval`, or `approved` status references the
      account.  The error response includes the blocking entry number and status.

### UX

- [x] Reverse button disabled for already-reversed entries.
      The Reverse button in `frontend/src/pages/Journal.jsx` now checks
      `e.reversed_at` in addition to `e.status === 'posted'`.  Entries that have
      already been reversed no longer show the button, preventing a click-through
      to a guaranteed 409 response.

### Documentation

- [x] `MIGRATIONS.md` updated with migrations 007, 008, 009.
      The Files section and Apply Order block now document all migrations through 009.

- [x] `Makefile` `concurrent-refresh-test` target added.
      Runs `scripts/concurrent_refresh_test.sh` consistently with the existing
      `auth-flow-test` and `rls-test` targets.

## 5. Round 5 Review (2026-06-27)

### Hierarchy and Schema

- [x] Circular parent_account_id detection added to `update_account`.
      `_would_create_cycle` walks the ancestor chain from the proposed parent
      upward; if the account being updated appears, a 400 is returned.  The
      `AccountUpdate` schema gained an optional `parent_account_id` field so the
      check is reachable via the PATCH endpoint.

- [x] Migration 010: partial index on `journal_entries.reversed_at`.
      `CREATE INDEX idx_je_reversed ON journal_entries(reversed_at) WHERE
      reversed_at IS NOT NULL` added to both `schema.sql` (fresh installs) and
      `database/migrations/010_reversal_index.sql` (existing installs).

- [x] `MIGRATIONS.md` extended with migrations 007-010.
      Files section and Apply Order block updated to cover all migrations.

- [x] `IMPROVEMENTS.md` Round 3 and Round 4 sections added.
      Both sections document what was done in each respective review cycle.

## 6. Round 6 Review (2026-06-27)

### Correctness and Testability

- [x] `cycle_exists` extracted to `backend/app/account_rules.py` (pure module,
      no DB imports), mirroring `journal_workflow.py`.  `accounts.py` delegates
      via a DB-backed closure.  Seven unit tests added in
      `backend/tests/test_account_rules.py` covering self-parent, 2-node and
      3-node cycles, no-cycle, None parent, off-tree parent, and corrupt-data
      loop guard.

- [x] `AccountOut` completeness: `modified_at` and `modified_by` added to the
      Pydantic response schema so callers can surface last-edit provenance.

- [x] Tenant soft-delete guard added to `create_account` and `create_entry`:
      both return HTTP 404 if the tenant exists but has `deleted_at` set,
      preventing resource creation under a retired tenant.

- [x] `Journal.jsx` reversal cross-reference: the status cell now shows a
      tooltip "Reversed by: <entry_number>" for entries whose `reversal_entry_id`
      is set, letting users identify the reversal without navigating away.

- [x] `IMPROVEMENTS.md` Round 5 section added and ASCII7 Policy renumbered
      from section 5 to section 6 to preserve document ordering.

## 7. Round 7 Review (2026-06-27)

### Correctness

- [x] Soft-delete cascade to journal entry lines.
      `soft_delete_entry` in `backend/app/routers/journal.py` now stamps
      `deleted_at` and `deleted_by` on all active lines when the parent entry is
      soft-deleted, keeping the lines table consistent with the entry lifecycle.

- [x] Duplicate active role assignment guard.
      `assign_role` returns HTTP 409 when the same user already has an active
      assignment for the same role in the same tenant, preventing ghost duplicates
      from accumulating in the `user_role_assignments` table.

### UX

- [x] Accounts.jsx gains a "Last Modified" column.
      The accounts table now renders `modified_at` (formatted as a locale date)
      or an em-dash for accounts that have never been edited.

### Documentation

- [x] `IMPROVEMENTS.md` Round 6 section added and ASCII7 Policy renumbered to
      section 7 to preserve document ordering.

## 8. ASCII7 Policy

All tracked text artifacts must contain only 7-bit US-ASCII bytes (0x00-0x7F).
This keeps diffs, terminals, and toolchains free of encoding ambiguity.

Rendered UI glyphs are preserved without non-ASCII source bytes by using:

- HTML entities in JSX text children (for example `&times;`, `&larr;`,
  `&rarr;`, `&mdash;`).
- `\uXXXX` escapes in JavaScript string literals (for example a check mark
  written as `'\u2713'`).

The guard `scripts/ascii_check.sh` (run by `make ascii-check`, included in
`make ci`) fails the build if any tracked file contains a non-ASCII byte.

## Round 8 (2026-06-28)

### Auth

- [x] Self-service password change endpoint added.
      `POST /auth/change-password` verifies the current password, enforces the
      same 12-character complexity rule as registration, hashes the new password,
      bumps `tokens_valid_after` to invalidate all existing sessions, and clears
      auth cookies.  A `ChangePasswordRequest` Pydantic schema was added.

- [x] Frontend "Change My Password" modal wired up.
      Users tab in the Users page gains a "Change My Password" button that opens
      a two-field modal (current + new password); success toasts and redirects
      the user to log in again.

### Authorization

- [x] Role assignment past-validity guard added.
      `assign_role` now rejects a `valid_until` value that is in the past (HTTP
      422) so expired assignments can never be created accidentally.

- [x] Extend-assignment must-be-later guard added.
      `extend_assignment` requires the new `valid_until` to be both a future date
      and strictly later than the current `valid_until`, preventing accidental
      shortening of an active assignment.

- [x] Pure `role_rules.py` module extracted with 11 unit tests.
      `assignment_valid_until_error` and `extension_valid_until_error` are pure
      functions testable without a database.

### UX

- [x] Accounts.jsx edit modal gains a Parent Account selector.
      Active sibling accounts in the same tenant are listed; choosing one sets
      `parent_account_id` on PATCH; the "None" option clears it.
