# Security

This document captures the current security model and operational assumptions.

## Authentication

Users authenticate with username or email plus password.  The backend issues a
signed (`JWT_SECRET_KEY`) access token and refresh token and delivers them as
cookies; the response body carries only `{user, roles}`, never the tokens.

Access tokens include:

- user id
- username
- active role claims
- token type
- issued-at and expiry

## Cookie-Based Sessions

Tokens are delivered as cookies so browser JavaScript can never read them, which
removes the XSS token-theft risk of `localStorage`:

- `access_token` - httpOnly, `Path=/api/`, lifetime = access-token expiry.
- `mufibu_refresh` - httpOnly, `Path=/api/v1/auth` (sent only to refresh/logout).
- `csrf_token` - readable by JS (for the CSRF header), lifetime = refresh expiry.

All carry `SameSite=Strict` and the `Secure` flag (`COOKIE_SECURE`, default on).
`Secure` cookies are only sent over HTTPS, so production must terminate TLS;
set `COOKIE_SECURE=false` only for local plain-HTTP development.

The auth dependency reads the access token from the cookie, falling back to an
`Authorization: Bearer` header for non-browser API clients.

## CSRF Protection

Because cookies are attached ambiently, state-changing requests use a
double-submit token: the backend sets the `csrf_token` cookie and the SPA echoes
it in the `X-CSRF-Token` header.  Middleware rejects unsafe methods
(POST/PUT/PATCH/DELETE) under `/api/` whose header does not match the cookie,
for requests authenticated by cookie.  `SameSite=Strict` is the primary defense;
the token is defense-in-depth.  `/auth/login` is exempt (it establishes the
first session), and Bearer-authenticated requests are exempt because they are
not cookie-driven and cannot be forged cross-site.

## Authorization

Authorization has three layers:

1. Frontend route and action guards for usability.
2. Backend route checks for workflow-specific decisions and clear errors.
3. PostgreSQL row-level security for final tenant isolation.

The frontend is not trusted.  Backend checks and RLS are the security boundary.

## Row-Level Security

For authenticated requests, the backend builds an RLS context from JWT role
claims.  SQLAlchemy writes that context into transaction-local PostgreSQL
settings:

- `app.user_id`
- `app.readable_tenant_ids`
- `app.writable_tenant_ids`
- `app.admin_tenant_ids`
- `app.is_auditor`
- `app.is_power_admin`
- `app.bypass_rls`

The RLS policies in `database/migrations/002_rls_officer.sql` consume these
settings.  `SET LOCAL` keeps values scoped to the current transaction.

## Bypass Context

`app.bypass_rls` is reserved for internal seed and migration operations.  It
must not be set from user-controlled request data.

## Audit Log

The audit log records login, logout, role assignment, tenant creation, account
changes, journal workflow changes, and soft deletes.  Database rules and RLS
policies prevent updates and hard deletes on audit rows.

## Request IDs

Each request receives an `X-Request-ID` value.  Clients can provide the header,
or the backend generates a UUID.  The same id is returned in the response and
logged with the request summary.

## Login Brute-Force Throttling

Failed logins are counted per user on the `users` table
(`failed_login_count`, `locked_until`, `last_failed_login_at`).  After
`LOGIN_MAX_FAILED_ATTEMPTS` consecutive failures the account is locked for
`LOGIN_LOCKOUT_MINUTES`; login then returns `429 Too Many Requests` with a
`Retry-After` header until the window elapses.  A successful login resets the
counter.

State lives in the database, not process memory, so the lockout is consistent
across all Gunicorn workers and survives restarts.  When the supplied
identifier matches no user, the password is still verified against a fixed
dummy hash so response timing does not reveal whether an account exists.
Failed attempts and lockouts are written to the backend log with the request
id; the audit log records successful logins.

## Token Revocation

Tokens are stateless, but each one carries an `iat` (issued-at) claim and every
user has a `tokens_valid_after` watermark.  Any access or refresh token issued
before that watermark is rejected (401) by `get_current_user` and `/auth/refresh`.
Advancing the watermark to the current time therefore revokes all of a user's
outstanding tokens at once.  The watermark is bumped by:

- logout (`/auth/logout`) - the caller's own tokens;
- deactivating a user (`PATCH /users/{id}` with `is_active=false`) or
  soft-deleting a user - PowerAdmin only;
- the force-logout endpoint (`POST /users/{id}/revoke-tokens`) - PowerAdmin
  only, for incident response or after revoking a sensitive role.

Because the watermark lives on the `users` row, the users RLS update policy
governs who may set it: a user may revoke their own tokens, and PowerAdmin may
revoke anyone's.  A role assignment revoked by a tenant Admin is not bumped this
way and remains effective until the access token expires; use a shorter
`JWT_ACCESS_TOKEN_EXPIRE_MINUTES`, or have a PowerAdmin force-logout the user,
when rapid revocation of such changes matters.

## Secret Handling

- Keep `/etc/mufibu/backend.env` readable only by root and the `mufibu` group.
- Use a unique `JWT_SECRET_KEY` per environment.
- Rotate the initial PowerAdmin password after first login.
- Store setup override files outside the repository.

## Operational Checks

After deployment, verify:

```sh
curl -sf http://127.0.0.1:8080/api/v1/health
curl -sf http://127.0.0.1:8080/api/v1/health/db
```

Run `make ci` before release and run `make db-smoke` in a database-capable
environment before migration changes.
