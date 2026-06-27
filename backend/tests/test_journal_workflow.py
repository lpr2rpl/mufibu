"""
Contracts for the journal posting workflow (four-eyes enforcement).

postable_error is the pure decision used by POST /journal/{id}/post.  These
tests pin the rule that approval-required entries cannot be posted until they
are approved, while non-approval entries may be posted directly from draft.
"""
import unittest
from collections import namedtuple
from decimal import Decimal

from app.journal_workflow import can_reverse, lines_balance_error, postable_error

Line = namedtuple("Line", ["debit_credit", "amount"])


def _d(value):
    return Decimal(str(value))


class CanReverseTests(unittest.TestCase):
    def test_posted_entry_can_be_reversed(self):
        self.assertIsNone(can_reverse("posted"))

    def test_non_posted_states_cannot_be_reversed(self):
        for state in ("draft", "pending_approval", "approved", "rejected"):
            self.assertIsNotNone(
                can_reverse(state),
                f"{state} should not be reversible",
            )


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


class LinesBalanceTests(unittest.TestCase):
    def test_no_lines_is_balanced(self):
        self.assertIsNone(lines_balance_error(None))
        self.assertIsNone(lines_balance_error([]))

    def test_balanced_two_line_entry(self):
        lines = [Line("debit", _d("100.00")), Line("credit", _d("100.00"))]
        self.assertIsNone(lines_balance_error(lines))

    def test_balanced_split_entry(self):
        lines = [
            Line("debit", _d("70.00")),
            Line("debit", _d("30.00")),
            Line("credit", _d("100.00")),
        ]
        self.assertIsNone(lines_balance_error(lines))

    def test_unbalanced_entry_is_rejected(self):
        lines = [Line("debit", _d("100.00")), Line("credit", _d("99.99"))]
        self.assertIsNotNone(lines_balance_error(lines))

    def test_single_sided_entry_is_rejected(self):
        # Only debits -> credit total is zero -> unbalanced.
        lines = [Line("debit", _d("50.00")), Line("debit", _d("50.00"))]
        self.assertIsNotNone(lines_balance_error(lines))

    def test_decimal_precision_does_not_false_positive(self):
        lines = [
            Line("debit", _d("33.33")),
            Line("debit", _d("33.33")),
            Line("debit", _d("33.34")),
            Line("credit", _d("100.00")),
        ]
        self.assertIsNone(lines_balance_error(lines))


if __name__ == "__main__":
    unittest.main()
