"""
Contracts for the token revocation watermark.

token_revoked backs the iat-vs-tokens_valid_after check enforced in
get_current_user and the refresh endpoint.
"""
import unittest
from datetime import datetime, timedelta, timezone

from app.auth.token_revocation import token_revoked

WATERMARK = datetime(2026, 6, 14, 12, 0, 0, tzinfo=timezone.utc)


def epoch(dt):
    return int(dt.timestamp())


class TokenRevocationTests(unittest.TestCase):
    def test_no_watermark_means_not_revoked(self):
        self.assertFalse(token_revoked(epoch(WATERMARK), None))
        self.assertFalse(token_revoked(None, None))

    def test_token_issued_before_watermark_is_revoked(self):
        before = epoch(WATERMARK - timedelta(seconds=1))
        self.assertTrue(token_revoked(before, WATERMARK))

    def test_token_issued_after_watermark_is_valid(self):
        after = epoch(WATERMARK + timedelta(seconds=1))
        self.assertFalse(token_revoked(after, WATERMARK))

    def test_token_issued_exactly_at_watermark_is_valid(self):
        # issued == watermark is "at or after" -> still valid.
        self.assertFalse(token_revoked(epoch(WATERMARK), WATERMARK))

    def test_missing_iat_with_watermark_is_revoked(self):
        # A token that cannot prove when it was issued is treated as revoked.
        self.assertTrue(token_revoked(None, WATERMARK))
        self.assertTrue(token_revoked(0, WATERMARK))


if __name__ == "__main__":
    unittest.main()
