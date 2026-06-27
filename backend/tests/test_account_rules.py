"""
Unit tests for account hierarchy cycle detection (app.account_rules).
"""
import unittest
import uuid

from app.account_rules import cycle_exists

A = uuid.UUID("aaaaaaaa-0000-0000-0000-000000000000")
B = uuid.UUID("bbbbbbbb-0000-0000-0000-000000000000")
C = uuid.UUID("cccccccc-0000-0000-0000-000000000000")
D = uuid.UUID("dddddddd-0000-0000-0000-000000000000")


def make_parent_of(mapping):
    """Return a parent_of callable backed by a plain dict."""
    return lambda uid: mapping.get(uid)


class CycleExistsTests(unittest.TestCase):
    def test_no_parent_is_not_a_cycle(self):
        self.assertFalse(cycle_exists(A, None, make_parent_of({})))

    def test_self_parent_is_cycle(self):
        # A -> A
        self.assertTrue(cycle_exists(A, A, make_parent_of({A: None})))

    def test_two_node_cycle(self):
        # Existing: B -> A.  Setting A's parent to B would create A -> B -> A.
        parent_of = make_parent_of({B: A})
        self.assertTrue(cycle_exists(A, B, parent_of))

    def test_three_node_cycle(self):
        # Existing: C -> B -> A.  Setting A's parent to C: A -> C -> B -> A.
        parent_of = make_parent_of({C: B, B: A})
        self.assertTrue(cycle_exists(A, C, parent_of))

    def test_no_cycle_linear_chain(self):
        # Existing: D -> C -> B.  Setting B's parent to nothing new; just
        # check that C as parent of A (who is a root) is not a cycle.
        parent_of = make_parent_of({D: C, C: B, B: None})
        self.assertFalse(cycle_exists(A, C, parent_of))

    def test_proposed_parent_not_in_hierarchy(self):
        parent_of = make_parent_of({B: None})
        self.assertFalse(cycle_exists(A, B, parent_of))

    def test_visited_set_prevents_infinite_loop_on_corrupt_data(self):
        # Pre-existing cycle B <-> C (corrupt DB); updating A's parent to B
        # must not loop forever.
        parent_of = make_parent_of({B: C, C: B})
        result = cycle_exists(A, B, parent_of)
        # A does not appear in the B <-> C cycle, so no cycle from A's perspective.
        self.assertFalse(result)


if __name__ == "__main__":
    unittest.main()
