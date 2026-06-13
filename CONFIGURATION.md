# MuFiBu Configuration

The backend reads settings from `/etc/mufibu/backend.env` by default.  The
example values are in `backend/.env.example`.

## Required Values

`DATABASE_URL`

PostgreSQL connection string used by SQLAlchemy.

Example:

```sh
DATABASE_URL=postgresql://mufibu:change-this@127.0.0.1:5432/mufibu
```

`JWT_SECRET_KEY`

Long random secret used to sign access and refresh tokens.  Use a unique value
per environment and rotate it deliberately because existing tokens become
invalid after rotation.

Example:

```sh
JWT_SECRET_KEY=replace-with-a-long-random-production-secret
```

`SEED_ADMIN_USERNAME`, `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`

Initial PowerAdmin bootstrap account.  The account is created only when the
users table is empty.  In production, keep the password temporary and rotate it
after the first login.

## Token Settings

```sh
JWT_ACCESS_TOKEN_EXPIRE_MINUTES=60
JWT_REFRESH_TOKEN_EXPIRE_DAYS=7
```

Roles are embedded in JWTs.  Shorter access-token lifetimes reduce the time a
revoked role can remain effective.

## Login Throttling

```sh
LOGIN_MAX_FAILED_ATTEMPTS=5
LOGIN_LOCKOUT_MINUTES=15
```

After `LOGIN_MAX_FAILED_ATTEMPTS` consecutive failed logins, an account is
locked for `LOGIN_LOCKOUT_MINUTES` and `/auth/login` returns `429` with a
`Retry-After` header.  A successful login resets the counter.  See
`SECURITY.md` for details.

## CORS

`CORS_ORIGINS` is parsed as a list by Pydantic settings.

Example:

```sh
CORS_ORIGINS=["http://localhost","https://mufibu.example.com"]
```

Restrict this list to trusted browser origins in production.

## Debug Mode

```sh
DEBUG=false
```

Keep `DEBUG=false` outside local development.  When debug mode is enabled,
some exception responses include internal error details.

## Setup Override File

The installer can load shell-style key/value overrides:

```sh
DB_NAME=mufibu
DB_USER=mufibu
DB_PASS=change-this-database-password
JWT_SECRET_KEY=replace-with-a-long-random-production-secret
SEED_ADMIN_USERNAME=poweradmin
SEED_ADMIN_EMAIL=poweradmin@example.com
SEED_ADMIN_PASSWORD=replace-with-temporary-bootstrap-password
CORS_ORIGINS=["https://mufibu.example.com"]
SHOW_SEED_PASSWORD=0
```

Run setup with:

```sh
./setup.sh -c /root/mufibu-prod.env all
```

The override file may contain secrets.  Store it outside the repository with
root-only permissions.
