"""Unit tests for pure role-assignment temporal validation rules."""
import unittest
from datetime import datetime, timezone

from app.role_rules import assignment_valid_until_error, extension_valid_until_error

NOW    = datetime(2026, 6, 28, 12, 0, 0, tzinfo=timezone.utc)
PAST   = datetime(2026, 1, 1,  0, 0, 0, tzinfo=timezone.utc)
FUTURE = datetime(2027, 1, 1,  0, 0, 0, tzinfo=timezone.utc)
LATER  = datetime(2028, 1, 1,  0, 0, 0, tzinfo=timezone.utc)


class AssignmentValidUntilTests(unittest.TestCase):
    def test_none_is_allowed(self):
        self.assertIsNone(assignment_valid_until_error(None, NOW))

    def test_future_is_allowed(self):
        self.assertIsNone(assignment_valid_until_error(FUTURE, NOW))

    def test_past_is_rejected(self):
        self.assertIsNotNone(assignment_valid_until_error(PAST, NOW))

    def test_exactly_now_is_rejected(self):
        self.assertIsNotNone(assignment_valid_until_error(NOW, NOW))


class ExtensionValidUntilTests(unittest.TestCase):
    def test_future_beyond_current_is_allowed(self):
        self.assertIsNone(extension_valid_until_error(FUTURE, NOW, current_valid_until=PAST))

    def test_future_with_no_current_is_allowed(self):
        self.assertIsNone(extension_valid_until_error(FUTURE, NOW))

    def test_future_beyond_further_future_current_is_allowed(self):
        self.assertIsNone(extension_valid_until_error(LATER, NOW, current_valid_until=FUTURE))

    def test_past_is_rejected(self):
        self.assertIsNotNone(extension_valid_until_error(PAST, NOW))

    def test_now_is_rejected(self):
        self.assertIsNotNone(extension_valid_until_error(NOW, NOW))

    def test_equal_to_current_is_rejected(self):
        self.assertIsNotNone(extension_valid_until_error(FUTURE, NOW, current_valid_until=FUTURE))

    def test_shortening_is_rejected(self):
        self.assertIsNotNone(extension_valid_until_error(FUTURE, NOW, current_valid_until=LATER))


if __name__ == "__main__":
    unittest.main()
