"""
Contracts for request-scoped audit metadata.

Verifies that the request context populated by the HTTP middleware is what the
before_flush event in app/database.py stamps onto audit rows (ip_address,
user_agent, and the request correlation id as session_id).
"""
import unittest

from app.logging_context import (
    audit_context_fields,
    clear_request_context,
    get_request_id,
    set_request_context,
)


class AuditContextTests(unittest.TestCase):
    def tearDown(self):
        clear_request_context()

    def test_fields_reflect_request_context(self):
        set_request_context("req-123", "203.0.113.7", "pytest-agent/1.0")
        fields = audit_context_fields()
        self.assertEqual(fields["ip_address"], "203.0.113.7")
        self.assertEqual(fields["user_agent"], "pytest-agent/1.0")
        # session_id is the per-request correlation id (stateless JWT design).
        self.assertEqual(fields["session_id"], "req-123")
        self.assertEqual(get_request_id(), "req-123")

    def test_fields_are_none_without_context(self):
        clear_request_context()
        fields = audit_context_fields()
        self.assertIsNone(fields["ip_address"])
        self.assertIsNone(fields["user_agent"])
        self.assertIsNone(fields["session_id"])

    def test_optional_metadata_defaults_to_none(self):
        set_request_context("req-only")
        fields = audit_context_fields()
        self.assertEqual(fields["session_id"], "req-only")
        self.assertIsNone(fields["ip_address"])
        self.assertIsNone(fields["user_agent"])


if __name__ == "__main__":
    unittest.main()
