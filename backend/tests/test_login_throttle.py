"""
Contracts for the login brute-force throttling policy.

These pure functions back the per-user lockout enforced in the auth router.
"""
import unittest
from datetime import datetime, timedelta, timezone

from app.auth.login_throttle import (
    is_locked,
    register_failure,
    seconds_until_unlock,
)

NOW = datetime(2026, 6, 13, 12, 0, 0, tzinfo=timezone.utc)
MAX_ATTEMPTS = 5
LOCKOUT_MINUTES = 15


class LoginThrottleTests(unittest.TestCase):
    def test_not_locked_when_no_lock_set(self):
        self.assertFalse(is_locked(None, NOW))
        self.assertEqual(seconds_until_unlock(None, NOW), 0)

    def test_locked_within_window(self):
        until = NOW + timedelta(minutes=10)
        self.assertTrue(is_locked(until, NOW))
        self.assertEqual(seconds_until_unlock(until, NOW), 600)

    def test_lock_expired(self):
        until = NOW - timedelta(seconds=1)
        self.assertFalse(is_locked(until, NOW))
        self.assertEqual(seconds_until_unlock(until, NOW), 0)

    def test_failure_below_threshold_increments_without_lock(self):
        count, locked_until = register_failure(0, NOW, MAX_ATTEMPTS, LOCKOUT_MINUTES)
        self.assertEqual(count, 1)
        self.assertIsNone(locked_until)

    def test_failure_reaching_threshold_locks_and_resets_counter(self):
        # 5th consecutive failure (count was 4) trips the lock.
        count, locked_until = register_failure(
            MAX_ATTEMPTS - 1, NOW, MAX_ATTEMPTS, LOCKOUT_MINUTES
        )
        self.assertEqual(count, 0)
        self.assertEqual(locked_until, NOW + timedelta(minutes=LOCKOUT_MINUTES))

    def test_progression_locks_exactly_at_max_attempts(self):
        count = 0
        locked_until = None
        locks = 0
        for _ in range(MAX_ATTEMPTS):
            count, locked_until = register_failure(count, NOW, MAX_ATTEMPTS, LOCKOUT_MINUTES)
            if locked_until is not None:
                locks += 1
        self.assertEqual(locks, 1)
        self.assertEqual(count, 0)


if __name__ == "__main__":
    unittest.main()
