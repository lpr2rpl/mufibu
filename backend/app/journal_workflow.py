"""
Pure journal workflow rules shared by runtime routers and tests.

Kept free of framework/DB imports so the decision logic can be unit-tested
without a database (mirrors the style of app/auth/permissions.py).
"""
from decimal import Decimal
from typing import Optional


def lines_balance_error(lines) -> Optional[str]:
    """
    Validate double-entry balance for split journal lines.

    `lines` is an iterable of objects exposing `.debit_credit` ('debit' or
    'credit') and `.amount` (Decimal).  Returns an error message when lines are
    present but total debits do not equal total credits, otherwise None.

    Header-only entries (no lines) are balanced by construction: a single
    `amount` is debited and credited across the main/contra accounts.  Split
    lines, however, can be entered unbalanced, which would break the accounting
    invariant - this is the check that prevents it.
    """
    if not lines:
        return None
    debit = sum((ln.amount for ln in lines if ln.debit_credit == "debit"), Decimal("0"))
    credit = sum((ln.amount for ln in lines if ln.debit_credit == "credit"), Decimal("0"))
    if debit != credit:
        return (
            f"Journal lines are unbalanced: total debits ({debit}) "
            f"must equal total credits ({credit})"
        )
    return None


def postable_error(entry_status: str, requires_approval: bool) -> Optional[str]:
    """
    Return an error message if an entry in the given state may NOT be posted,
    or None when posting is allowed.

    Four-eyes principle: an entry that requires approval can only be posted once
    it has reached the 'approved' state (approval by someone other than the
    creator is enforced in /approve).  This closes the prior loophole where a
    PowerUser could post a draft directly and skip approval.  Entries that do
    not require approval may still be posted directly from draft.
    """
    if entry_status == "posted":
        return "Entry is already posted"
    if requires_approval:
        if entry_status != "approved":
            return "Entries requiring approval must be approved before they can be posted"
        return None
    if entry_status not in ("draft", "approved"):
        return "Only draft or approved entries can be posted"
    return None
