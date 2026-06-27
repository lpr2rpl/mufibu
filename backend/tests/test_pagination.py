import unittest

from app.pagination import build_page, paginate_query


class DummyQuery:
    def __init__(self, items):
        self._items = list(items)
        self.count_calls = 0
        self.order_by_calls = []
        self.offset_value = None
        self.limit_value = None

    def count(self):
        self.count_calls += 1
        return len(self._items)

    def order_by(self, *args):
        self.order_by_calls.append(args)
        return self

    def offset(self, skip):
        self.offset_value = skip
        return self

    def limit(self, limit):
        self.limit_value = limit
        return self

    def all(self):
        start = self.offset_value or 0
        end = start + self.limit_value if self.limit_value is not None else None
        return self._items[start:end]


class DummyPage:
    def __init__(self, total, skip, limit, items):
        self.total = total
        self.skip = skip
        self.limit = limit
        self.items = items


class PaginationTests(unittest.TestCase):
    def test_paginate_query_returns_total_and_slice(self):
        query = DummyQuery([1, 2, 3, 4, 5])
        total, items = paginate_query(query, 1, 2)

        self.assertEqual(total, 5)
        self.assertEqual(items, [2, 3])
        self.assertEqual(query.count_calls, 1)
        self.assertEqual(query.order_by_calls, [(None,)])

    def test_build_page_applies_transform(self):
        query = DummyQuery([{"id": 1}, {"id": 2}, {"id": 3}])
        page = build_page(
            DummyPage,
            query,
            0,
            2,
            transform=lambda row: row["id"],
        )

        self.assertEqual(page.total, 3)
        self.assertEqual(page.skip, 0)
        self.assertEqual(page.limit, 2)
        self.assertEqual(page.items, [1, 2])


if __name__ == "__main__":
    unittest.main()
