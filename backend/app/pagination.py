"""Shared helpers for paginated SQLAlchemy query responses."""

from typing import Any, Callable, TypeVar

T = TypeVar("T")
U = TypeVar("U")


def paginate_query(query: Any, skip: int, limit: int):
    """Return (total, items) for a SQLAlchemy query slice."""
    total = query.order_by(None).count()
    items = query.offset(skip).limit(limit).all()
    return total, items


def build_page(
    page_model: Any,
    query: Any,
    skip: int,
    limit: int,
    transform: Callable[[T], U] | None = None,
):
    """Build a typed page response from a SQLAlchemy query."""
    total, items = paginate_query(query, skip, limit)
    if transform is not None:
        items = [transform(item) for item in items]
    return page_model(total=total, skip=skip, limit=limit, items=items)
