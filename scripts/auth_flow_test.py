"""
End-to-end auth-flow checks driving the real FastAPI app via TestClient.

Invoked by scripts/auth_flow_test.sh, which sets the environment (DATABASE_URL,
COOKIE_SECURE=false, JWT_SECRET_KEY, seed credentials) and provisions a
throwaway database.  Exercises the cookie + CSRF auth contract:

- login returns {user, roles} with tokens only in httpOnly cookies;
- the session works via cookie (/me);
- CSRF blocks unsafe cookie-auth requests without/with a wrong token and allows
  valid ones, while Bearer clients bypass CSRF;
- refresh rotates the session;
- logout clears cookies and revokes the token.

Exit code is non-zero if any check fails.
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "backend"))

ADMIN_USER = os.environ.get("SEED_ADMIN_USERNAME", "poweradmin")
ADMIN_PASS = os.environ.get("SEED_ADMIN_PASSWORD", "ChangeMe1!")

from fastapi.testclient import TestClient  # noqa: E402  (after sys.path setup)
from app.main import app  # noqa: E402

failures = []


def check(desc, cond):
    print(("  PASS: " if cond else "  FAIL: ") + desc)
    if not cond:
        failures.append(desc)


with TestClient(app) as c:
    # --- login -------------------------------------------------------------
    r = c.post("/api/v1/auth/login", json={"username": ADMIN_USER, "password": ADMIN_PASS})
    check("login returns 200", r.status_code == 200)
    body = r.json()
    check("login body is {user, roles}", set(body) == {"user", "roles"})
    check("login body contains NO tokens", "access_token" not in body and "refresh_token" not in body)
    check("PowerAdmin role present", any(x.get("role") == "PowerAdmin" for x in body.get("roles", [])))

    set_cookie = r.headers.get("set-cookie", "")
    check("access_token cookie is HttpOnly", "access_token=" in set_cookie and "HttpOnly" in set_cookie)
    check("access_token cookie in jar", c.cookies.get("access_token") is not None)
    check("csrf_token cookie readable from jar", c.cookies.get("csrf_token") is not None)
    csrf = c.cookies.get("csrf_token")

    # --- session via cookie ------------------------------------------------
    r = c.get("/api/v1/auth/me")
    check("/me with cookie returns 200", r.status_code == 200)
    check("/me returns {user, roles}", set(r.json()) == {"user", "roles"})

    # --- CSRF enforcement --------------------------------------------------
    r = c.post("/api/v1/tenants", json={"name": "AuthFlowBlocked"})
    check("POST without X-CSRF-Token is rejected (403)", r.status_code == 403)

    r = c.post("/api/v1/tenants", json={"name": "AuthFlowAllowed"}, headers={"X-CSRF-Token": csrf})
    check("POST with valid X-CSRF-Token succeeds (201)", r.status_code == 201)

    r = c.post("/api/v1/tenants", json={"name": "AuthFlowWrong"}, headers={"X-CSRF-Token": "wrong"})
    check("POST with wrong X-CSRF-Token is rejected (403)", r.status_code == 403)

    # --- Bearer client bypasses CSRF (ambient cookie creds are the risk) ---
    access = c.cookies.get("access_token")
    bearer = TestClient(app)
    r = bearer.post("/api/v1/tenants", json={"name": "AuthFlowBearer"},
                    headers={"Authorization": f"Bearer {access}"})
    check("Bearer client POST without CSRF succeeds (201)", r.status_code == 201)

    # --- refresh rotates the session --------------------------------------
    r = c.post("/api/v1/auth/refresh", headers={"X-CSRF-Token": csrf})
    check("refresh returns 200", r.status_code == 200)
    check("refresh body is {user, roles}, no tokens", set(r.json()) == {"user", "roles"})
    csrf = c.cookies.get("csrf_token")
    check("/me still works after refresh", c.get("/api/v1/auth/me").status_code == 200)

    # --- logout clears cookies + revokes ----------------------------------
    r = c.post("/api/v1/auth/logout", headers={"X-CSRF-Token": csrf})
    check("logout returns 200", r.status_code == 200)
    check("/me after logout is unauthorized (401)", c.get("/api/v1/auth/me").status_code == 401)

print("-----")
if failures:
    print(f"{len(failures)} FAILED")
    sys.exit(1)
print("ALL AUTH FLOW CHECKS PASSED")
