"""
Pure CSRF double-submit helpers shared by the auth code and tests.

Cookie-based auth attaches credentials ambiently, so state-changing requests
must also present a CSRF token: the backend sets a readable `csrf_token` cookie,
the SPA echoes it in the `X-CSRF-Token` header, and the two are compared here.
A cross-site attacker can neither read the victim's cookie nor set a custom
header, so a match proves the request originated from the SPA.

Kept free of framework imports so it can be unit-tested without FastAPI
(mirrors app/auth/permissions.py).
"""
import secrets
from typing import Optional


def generate_csrf_token() -> str:
    """Return a new, URL-safe, cryptographically random CSRF token."""
    return secrets.token_urlsafe(32)


def csrf_valid(header_value: Optional[str], cookie_value: Optional[str]) -> bool:
    """
    True when the header and cookie CSRF tokens are present and equal.

    Uses a constant-time comparison to avoid leaking the token via timing.
    """
    if not header_value or not cookie_value:
        return False
    return secrets.compare_digest(header_value, cookie_value)
