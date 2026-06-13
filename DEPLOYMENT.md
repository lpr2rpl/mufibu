# MuFiBu Deployment

This document describes the production-style deployment artifacts in this
repository.  The target host is Devuan or another SysVInit-compatible Linux
system.

## Runtime Topology

- nginx on port 80 serves the React build from `/var/www/mufibu/frontend`.
- The frontend nginx site proxies `/api/` to the backend nginx listener on
  `127.0.0.1:8080` through the `mufibu_api_proxy` upstream.
- The backend nginx site proxies traffic from port 8080 to Gunicorn/Uvicorn on
  `127.0.0.1:8000` through the `mufibu_app_server` upstream.
- Gunicorn runs the FastAPI app from `/opt/mufibu/backend`.
- PostgreSQL stores application data and enforces row-level security policies.

The upstream names are intentionally separate.  Do not reuse
`mufibu_api_proxy` for the Python application server, and do not reuse
`mufibu_app_server` for the frontend-to-backend hop.

## Setup Script

Run the full installer as root:

```sh
./setup.sh all
```

Preview actions without changing the host:

```sh
./setup.sh -n all
```

Run a single step:

```sh
./setup.sh schema
./setup.sh frontend nginx
```

Use `-c FILE` to load deployment-specific values before running steps:

```sh
./setup.sh -c /root/mufibu-prod.env all
```

## Deployment Steps

The setup script runs these steps in order when `all` is selected:

1. `deps`: install OS packages, PostgreSQL, nginx, Python, and Node.js.
2. `postgres`: create the PostgreSQL database and user.
3. `schema`: apply `database/schema.sql` and migration `002_rls_officer.sql`.
4. `venv`: create `/opt/mufibu/venv` and install backend dependencies.
5. `config`: write `/etc/mufibu/backend.env`.
6. `frontend`: build React and copy output to `/var/www/mufibu/frontend`.
7. `nginx`: install and reload nginx site configuration.
8. `service`: install and start `/etc/init.d/mufibu-backend`.

## Initial Admin

The first backend startup seeds a PowerAdmin account only when the users table
is empty.

If `SEED_ADMIN_PASSWORD` is left at the setup default, `setup.sh` generates a
random temporary password and stores it in `/etc/mufibu/backend.env`.  The
password is not printed in the installer summary unless `SHOW_SEED_PASSWORD=1`
is explicitly set in a private config override file.

Change the initial PowerAdmin password immediately after first login.

## Health Checks

Use these checks after deployment:

```sh
service mufibu-backend status
service nginx status
curl -sf http://127.0.0.1:8080/api/v1/health
curl -sf http://127.0.0.1:8080/api/v1/health/db
```

The public health URL through the frontend nginx site is:

```sh
curl -sf http://127.0.0.1/api/v1/health
```

## Logs

- Backend access log: `/var/log/mufibu/backend-access.log`
- Backend error log: `/var/log/mufibu/backend-error.log`
- Frontend nginx access log: `/var/log/nginx/mufibu-frontend-access.log`
- Frontend nginx error log: `/var/log/nginx/mufibu-frontend-error.log`
- Backend nginx access log: `/var/log/nginx/mufibu-backend-access.log`
- Backend nginx error log: `/var/log/nginx/mufibu-backend-error.log`

## Rollout Notes

- Keep `/etc/mufibu/backend.env` readable only by root and the `mufibu` group.
- Re-run `./setup.sh frontend nginx` after frontend-only changes.
- Re-run `./setup.sh service` after backend code changes.
- Re-run `./setup.sh schema` only after reviewing database changes.
- Back up PostgreSQL before applying schema or migration changes in production.
