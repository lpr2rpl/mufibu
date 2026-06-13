# Architecture

MuFiBu is a classic three-tier web application with database-enforced tenant
isolation.

## Components

Frontend:

- React 18 single-page application.
- React Router owns browser routes.
- Axios client calls `/api/v1`.
- JWT tokens are stored in browser local storage.
- Frontend permission helpers control navigation and action visibility.

Backend:

- FastAPI application in `backend/app/main.py`.
- Routers are mounted below `/api/v1`.
- SQLAlchemy ORM models describe tables.
- Pydantic schemas describe request and response bodies.
- JWT auth resolves a `CurrentUser` for protected endpoints.

Database:

- PostgreSQL stores all tenant and accounting data.
- Base schema lives in `database/schema.sql`.
- RLS policies live in `database/migrations/002_rls_officer.sql`.
- Tables use soft-delete columns where deletes are supported.
- Audit records are append-only by database rule and RLS policy.

Deployment:

- nginx serves the frontend on port 80.
- nginx proxies `/api/` to backend nginx on port 8080.
- backend nginx proxies to Gunicorn/Uvicorn on `127.0.0.1:8000`.
- SysVInit manages the backend service.

## Request Flow

1. A browser route renders the React app.
2. API calls go through `frontend/src/api/client.js`.
3. Axios attaches the access token as a bearer token.
4. FastAPI decodes the token and builds a `CurrentUser`.
5. `get_current_user` builds an RLS context from JWT role claims.
6. SQLAlchemy injects RLS session variables at transaction start.
7. PostgreSQL RLS policies filter readable and writable rows.
8. Routers still perform application-level permission checks for clearer
   errors and workflow-specific rules.

## Important Boundaries

The frontend is not a security boundary.  It hides unavailable actions for
usability, but backend route checks and PostgreSQL RLS are the enforcing layers.

The JWT is the short-term permission cache.  Role changes made in the database
are reflected after token refresh or a new login.

The database is responsible for tenant isolation.  Router checks should mirror
the database policies, but RLS is the final guard.

## Core Domains

Tenants:

- Top-level isolation boundary.
- Created and managed by PowerAdmin.

Users and roles:

- Users are global.
- Role assignments can be global or tenant-scoped.
- Assignments are phase-based through `valid_from` and `valid_until`.

Accounts:

- Chart of accounts per tenant.
- Account numbers are unique within a tenant.

Journal entries:

- Double-entry booking record with main and contra accounts.
- Optional split lines are supported by `journal_entry_lines`.
- Entries move through draft, pending approval, approved, rejected, and posted
  states.

Audit log:

- Records security and business actions.
- Designed as append-only data.
