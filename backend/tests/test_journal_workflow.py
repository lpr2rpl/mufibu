"""
Contracts for the journal posting workflow (four-eyes enforcement).

postable_error is the pure decision used by POST /journal/{id}/post.  These
tests pin the rule that approval-required entries cannot be posted until they
are approved, while non-approval entries may be posted directly from draft.
"""
import unittest

from app.journal_workflow import postable_error


class PostableRuleTests(unittest.TestCase):
    def test_approval_required_entry_must_be_approved(self):
        # Draft / pending / rejected are all blocked when approval is required.
        for state in ("draft", "pending_approval", "rejected"):
            self.assertIsNotNone(
                postable_error(state, requires_approval=True),
                f"{state} should not be postable when approval is required",
            )

    def test_approval_required_entry_approved_is_postable(self):
        self.assertIsNone(postable_error("approved", requires_approval=True))

    def test_non_approval_entry_postable_from_draft(self):
        self.assertIsNone(postable_error("draft", requires_approval=False))
        self.assertIsNone(postable_error("approved", requires_approval=False))

    def test_non_approval_entry_blocked_from_pending_or_rejected(self):
        self.assertIsNotNone(postable_error("pending_approval", requires_approval=False))
        self.assertIsNotNone(postable_error("rejected", requires_approval=False))

    def test_already_posted_is_blocked(self):
        self.assertIsNotNone(postable_error("posted", requires_approval=False))
        self.assertIsNotNone(postable_error("posted", requires_approval=True))


if __name__ == "__main__":
    unittest.main()
