"""
Pure login throttling policy shared by the auth router and tests.

State is persisted on the users table (failed_login_count, locked_until,
last_failed_login_at) so the lockout works across all Gunicorn workers and
survives restarts - an in-memory counter would be per-worker and easily
bypassed by spreading attempts across workers.

Kept free of framework/DB imports so the policy can be unit-tested without a
database (mirrors app/auth/permissions.py).
"""
from datetime import datetime, timedelta
from typing import Optional, Tuple


def is_locked(locked_until: Optional[datetime], now: datetime) -> bool:
    """True when an active lockout window has not yet elapsed."""
    return locked_until is not None and locked_until > now


def seconds_until_unlock(locked_until: Optional[datetime], now: datetime) -> int:
    """Whole seconds until the lockout expires (>=1), or 0 if not locked."""
    if not is_locked(locked_until, now):
        return 0
    return max(1, int((locked_until - now).total_seconds()))


def register_failure(
    failed_count: int,
    now: datetime,
    max_attempts: int,
    lockout_minutes: int,
) -> Tuple[int, Optional[datetime]]:
    """
    Compute the new throttle state after a failed login attempt.

    Returns (new_failed_count, new_locked_until).  When the attempt reaches
    max_attempts the account is locked: the counter resets to 0 and a
    locked_until timestamp is returned.  Otherwise the counter is incremented
    and no lock is applied (locked_until is None).
    """
    new_count = failed_count + 1
    if new_count >= max_attempts:
        return 0, now + timedelta(minutes=lockout_minutes)
    return new_count, None
