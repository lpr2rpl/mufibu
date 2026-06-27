"""
Concurrent token-refresh race condition test.

Fires two simultaneous POST /auth/refresh requests sharing the same
refresh-token cookie and asserts that the outcome is safe:
  - At least one request succeeds (200).
  - No request yields a server error (5xx).
  - A second 401 is acceptable (the first rotation already revoked the token).

Invoked by scripts/concurrent_refresh_test.sh, which sets up the
environment (DATABASE_URL, JWT_SECRET_KEY, seed credentials) the same
way auth_flow_test.sh does.

Exit code is non-zero if any assertion fails.
"""
import os
import sys
import threading

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "backend"))

ADMIN_USER = os.environ.get("SEED_ADMIN_USERNAME", "poweradmin")
ADMIN_PASS = os.environ.get("SEED_ADMIN_PASSWORD", "ChangeMe1!")

from fastapi.testclient import TestClient  # noqa: E402
from app.main import app  # noqa: E402

failures = []


def check(desc, cond):
    print(("  PASS: " if cond else "  FAIL: ") + desc)
    if not cond:
        failures.append(desc)


with TestClient(app) as c:
    # Obtain a valid session so the refresh cookie is set.
    r = c.post("/api/v1/auth/login", json={"username": ADMIN_USER, "password": ADMIN_PASS})
    check("login succeeds before race test", r.status_code == 200)

    csrf = c.cookies.get("csrf_token", "")

    results = [None, None]

    def do_refresh(index):
        resp = c.post("/api/v1/auth/refresh", headers={"X-CSRF-Token": csrf})
        results[index] = resp.status_code

    t1 = threading.Thread(target=do_refresh, args=(0,))
    t2 = threading.Thread(target=do_refresh, args=(1,))
    t1.start()
    t2.start()
    t1.join()
    t2.join()

    s1, s2 = results
    print(f"  INFO: concurrent refresh results: {s1}, {s2}")

    check("no 5xx from either concurrent refresh", s1 < 500 and s2 < 500)
    check("at least one refresh succeeded (200)", s1 == 200 or s2 == 200)
    check(
        "second response is 200 or 401 (not an unexpected status)",
        set(results) <= {200, 401},
    )

if failures:
    print(f"\n{len(failures)} check(s) failed:")
    for f in failures:
        print(f"  - {f}")
    sys.exit(1)

print("\nAll concurrent-refresh checks passed.")
