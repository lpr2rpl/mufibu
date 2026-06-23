"""
Contracts for the CSRF double-submit helpers.

csrf_valid backs the middleware check that the X-CSRF-Token header matches the
csrf_token cookie on cookie-authenticated, state-changing requests.
"""
import unittest

from app.auth.csrf import csrf_valid, generate_csrf_token


class CsrfTests(unittest.TestCase):
    def test_generated_tokens_are_nonempty_and_unique(self):
        a = generate_csrf_token()
        b = generate_csrf_token()
        self.assertTrue(a)
        self.assertNotEqual(a, b)

    def test_matching_tokens_are_valid(self):
        token = generate_csrf_token()
        self.assertTrue(csrf_valid(token, token))

    def test_mismatched_tokens_are_invalid(self):
        self.assertFalse(csrf_valid(generate_csrf_token(), generate_csrf_token()))

    def test_missing_tokens_are_invalid(self):
        token = generate_csrf_token()
        self.assertFalse(csrf_valid(None, token))
        self.assertFalse(csrf_valid(token, None))
        self.assertFalse(csrf_valid(None, None))
        self.assertFalse(csrf_valid("", ""))


if __name__ == "__main__":
    unittest.main()
