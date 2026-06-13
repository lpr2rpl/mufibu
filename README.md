# MuFiBu

MuFiBu is a multi-tenant financial accounting application.  It combines a
FastAPI backend, a PostgreSQL database with row-level security, and a React
single-page frontend.

## Repository Layout

- `backend/`: FastAPI application, SQLAlchemy models, auth helpers, and routers.
- `database/`: base SQL schema and migration files.
- `frontend/`: React application and API client.
- `nginx/`: frontend and backend reverse-proxy configs.
- `init.d/`: SysVInit backend service script.
- `scripts/`: CI and database smoke-test helpers.
- `setup.sh`: Devuan/SysVInit deployment installer.

## Local Checks

Install frontend dependencies first if needed:

```sh
npm --prefix frontend install
```

Run the default checks:

```sh
make ci
```

Run only backend tests:

```sh
make backend-test
```

Run only frontend tests:

```sh
make frontend-test
```

Build the frontend:

```sh
make frontend-build
```

## Deployment

Production-style deployment is described in `DEPLOYMENT.md`.  The installer is:

```sh
./setup.sh all
```

Use a private config override for secrets:

```sh
./setup.sh -c /root/mufibu-prod.env all
```

## Documentation

- `ARCHITECTURE.md`: system boundaries and request flow.
- `RBAC.md`: role matrix and permission model.
- `SECURITY.md`: security model and operational assumptions.
- `MIGRATIONS.md`: schema and migration process.
- `CONFIGURATION.md`: runtime configuration reference.
- `TESTING.md`: test commands and coverage notes.
