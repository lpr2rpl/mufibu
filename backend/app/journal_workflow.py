"""
Pure journal workflow rules shared by runtime routers and tests.

Kept free of framework/DB imports so the decision logic can be unit-tested
without a database (mirrors the style of app/auth/permissions.py).
"""
from typing import Optional


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
