"""
Pure role-assignment temporal validation rules.

Kept free of framework/DB imports so the decision logic can be unit-tested
without a database (mirrors the pattern of app/journal_workflow.py).
"""
from typing import Optional


def assignment_valid_until_error(valid_until, now) -> Optional[str]:
    """Return an error string if valid_until is set but is not in the future."""
    if valid_until is not None and valid_until <= now:
        return "valid_until must be a future date"
    return None


def extension_valid_until_error(new_valid_until, now, current_valid_until=None) -> Optional[str]:
    """Return an error string if new_valid_until is invalid for a phase extension.

    Two checks:
    1. new_valid_until must be strictly in the future.
    2. new_valid_until must be strictly later than the current valid_until
       (or later than now if the assignment is open-ended).
    """
    if new_valid_until <= now:
        return "valid_until must be a future date"
    effective_current = current_valid_until or now
    if new_valid_until <= effective_current:
        return "New valid_until must be later than the current valid_until"
    return None
