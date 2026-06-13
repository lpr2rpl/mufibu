# Security

This document captures the current security model and operational assumptions.

## Authentication

Users authenticate with username or email plus password.  The backend returns
an access token and refresh token.  Tokens are signed with `JWT_SECRET_KEY`.

Access tokens include:

- user id
- username
- active role claims
- token type
- expiry

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

## Token Revocation

Tokens are stateless.  A role revoked in the database can remain effective
until the access token expires.  Use shorter access-token lifetimes when rapid
revocation matters.  A future token denylist or session table would provide
immediate revocation.

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
