"""
HTTP cookie helpers for cookie-based JWT auth.

Access and refresh tokens are delivered as httpOnly cookies so browser
JavaScript can never read them (XSS cannot exfiltrate a token).  A separate,
JS-readable csrf_token cookie powers the double-submit CSRF defense in
app/auth/csrf.py.  Cookie paths are scoped so each token is sent only where it
is needed; SameSite=Strict blocks cross-site sending.

Token extraction also accepts an Authorization: Bearer header (see
app/auth/dependencies.py) for non-browser API clients.
"""
from fastapi import Response

from app.config import get_settings

settings = get_settings()

ACCESS_COOKIE = "access_token"
REFRESH_COOKIE = "mufibu_refresh"
CSRF_COOKIE = "csrf_token"

# Scope the access cookie to the whole API and the refresh cookie to the auth
# routes only, so the long-lived refresh token is sent on as few requests as
# possible.  The CSRF cookie must be readable everywhere the SPA runs.
ACCESS_PATH = "/api/v1/"
REFRESH_PATH = "/api/v1/auth"
CSRF_PATH = "/"


def _shared() -> dict:
    return {
        "secure": settings.COOKIE_SECURE,
        "samesite": settings.COOKIE_SAMESITE,
        "domain": settings.COOKIE_DOMAIN,
    }


def set_auth_cookies(
    response: Response,
    access_token: str,
    refresh_token: str,
    csrf_token: str,
) -> None:
    access_max_age = settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES * 60
    refresh_max_age = settings.JWT_REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60

    response.set_cookie(
        ACCESS_COOKIE, access_token,
        max_age=access_max_age, httponly=True, path=ACCESS_PATH, **_shared(),
    )
    response.set_cookie(
        REFRESH_COOKIE, refresh_token,
        max_age=refresh_max_age, httponly=True, path=REFRESH_PATH, **_shared(),
    )
    # csrf_token is intentionally NOT httpOnly: the SPA reads it to echo in the
    # X-CSRF-Token header.  It is not a secret on its own.
    response.set_cookie(
        CSRF_COOKIE, csrf_token,
        max_age=refresh_max_age, httponly=False, path=CSRF_PATH, **_shared(),
    )


def clear_auth_cookies(response: Response) -> None:
    domain = settings.COOKIE_DOMAIN
    response.delete_cookie(ACCESS_COOKIE, path=ACCESS_PATH, domain=domain)
    response.delete_cookie(REFRESH_COOKIE, path=REFRESH_PATH, domain=domain)
    response.delete_cookie(CSRF_COOKIE, path=CSRF_PATH, domain=domain)
