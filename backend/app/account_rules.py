"""
Pure account hierarchy rules shared by routers and tests.

Kept free of SQLAlchemy / DB imports so decision logic can be unit-tested
without a database (mirrors the style of app/journal_workflow.py).
"""
import uuid
from typing import Callable, Optional


def cycle_exists(
    self_id: uuid.UUID,
    proposed_parent_id: Optional[uuid.UUID],
    parent_of: Callable[[uuid.UUID], Optional[uuid.UUID]],
) -> bool:
    """Return True if assigning proposed_parent_id as the parent of self_id
    would create a cycle in the account hierarchy.

    `parent_of` is a callable (uid) -> Optional[uuid.UUID] that the caller
    provides.  Pass a DB-backed lambda in the router; pass a plain dict
    lookup in tests.

    A visited set prevents infinite loops on pre-existing corrupt data.
    """
    if proposed_parent_id is None:
        return False
    visited: set = set()
    current: Optional[uuid.UUID] = proposed_parent_id
    while current is not None:
        if current == self_id:
            return True
        if current in visited:
            break
        visited.add(current)
        current = parent_of(current)
    return False
