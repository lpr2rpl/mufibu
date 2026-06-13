"""
Request-scoped context (logging + audit metadata).

The HTTP middleware (see app/main.py) populates these context variables once per
request.  They are read by the logging filter and by the SQLAlchemy before_flush
event that stamps audit rows (see app/database.py), so that ip_address,
user_agent, and a request correlation id are recorded for every audited action
- not only for login/logout.
"""
import logging
from contextvars import ContextVar
from typing import Optional


_request_id: ContextVar[Optional[str]] = ContextVar("request_id", default=None)
_client_ip: ContextVar[Optional[str]] = ContextVar("client_ip", default=None)
_user_agent: ContextVar[Optional[str]] = ContextVar("user_agent", default=None)


def set_request_context(
    request_id: str,
    client_ip: Optional[str] = None,
    user_agent: Optional[str] = None,
) -> None:
    _request_id.set(request_id)
    _client_ip.set(client_ip)
    _user_agent.set(user_agent)


def clear_request_context() -> None:
    _request_id.set(None)
    _client_ip.set(None)
    _user_agent.set(None)


def get_request_id() -> Optional[str]:
    return _request_id.get()


def audit_context_fields() -> dict:
    """
    Return the request-scoped fields used to stamp audit rows.

    The system uses stateless JWTs, so there is no server-side session table;
    the per-request correlation id (X-Request-ID) is recorded as session_id to
    tie together all audit rows produced by a single HTTP request.
    """
    return {
        "ip_address": _client_ip.get(),
        "user_agent": _user_agent.get(),
        "session_id": _request_id.get(),
    }


class RequestIdFilter(logging.Filter):
    def filter(self, record) -> bool:
        record.request_id = get_request_id() or "-"
        return True
