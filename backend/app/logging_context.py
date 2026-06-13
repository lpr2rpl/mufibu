"""
Request-scoped logging context.
"""
import logging
from contextvars import ContextVar
from typing import Optional


_request_id: ContextVar[Optional[str]] = ContextVar("request_id", default=None)


def set_request_id(request_id: str) -> None:
    _request_id.set(request_id)


def get_request_id() -> Optional[str]:
    return _request_id.get()


def clear_request_id() -> None:
    _request_id.set(None)


class RequestIdFilter(logging.Filter):
    def filter(self, record) -> bool:
        record.request_id = get_request_id() or "-"
        return True
