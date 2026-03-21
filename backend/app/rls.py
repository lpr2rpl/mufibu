"""
Row-Level Security (RLS) context management.

The PostgreSQL RLS policies defined in database/migrations/002_rls_officer.sql
rely on session-level variables that the backend sets at the start of every
transaction.  This module provides:

  - RLSContext   : dataclass holding the security attributes for one request
  - build_rls_context : builds an RLSContext from the JWT payload (no DB query
                        needed - roles are embedded in the token at login)
  - set/get/clear_rls_context : thread-safe (contextvar-based) store

Variable names and semantics
-----------------------------
  app.user_id             UUID of the authenticated user (empty for anonymous)
  app.readable_tenant_ids Comma-separated tenant UUIDs the user can READ:
                          Reader, Writer, PowerUser, Approver, Officer
  app.writable_tenant_ids Comma-separated tenant UUIDs the user can WRITE:
                          Writer, PowerUser
  app.admin_tenant_ids    Comma-separated tenant UUIDs the user can ADMIN:
                          Admin (role management only, no booking r/w)
  app.is_auditor          'true' when user holds the global Auditor role
  app.is_power_admin      'true' when user holds the global PowerAdmin role
  app.bypass_rls          'true' ONLY for internal seed/migration operations;
                          never set from a user-supplied JWT
"""

from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import List, Optional


@dataclass
class RLSContext:
    user_id: str = ""
    readable_tenant_ids: List[str] = field(default_factory=list)
    writable_tenant_ids: List[str] = field(default_factory=list)
    admin_tenant_ids: List[str] = field(default_factory=list)
    is_auditor: bool = False
    is_power_admin: bool = False
    bypass_rls: bool = False


# One context per async task / OS thread via PEP 567 ContextVar
_rls_ctx: ContextVar[Optional[RLSContext]] = ContextVar("rls_ctx", default=None)


def set_rls_context(ctx: RLSContext) -> None:
    _rls_ctx.set(ctx)


def get_rls_context() -> Optional[RLSContext]:
    return _rls_ctx.get()


def clear_rls_context() -> None:
    _rls_ctx.set(None)


# A safe bypass context used only during startup seeding and DB migrations.
# Never expose this through any API path.
BYPASS_CONTEXT = RLSContext(bypass_rls=True)


def build_rls_context(user_id: str, roles: List[dict]) -> RLSContext:
    """
    Derive an RLSContext purely from the JWT payload.

    Called inside get_current_user() BEFORE the first DB query so that the
    SQLAlchemy after_begin event can inject the correct session variables into
    PostgreSQL before any row is fetched.

    Role -> variable mapping
    ------------------------
    Reader, Writer, PowerUser, Approver, Officer  => readable_tenant_ids
    Writer, PowerUser                             => writable_tenant_ids
    Admin                                         => admin_tenant_ids
    Auditor  (global)                             => is_auditor = True
    PowerAdmin (global)                           => is_power_admin = True
    """
    readable: set = set()
    writable: set = set()
    admin:    set = set()
    is_auditor    = False
    is_power_admin = False

    for r in roles:
        name  = r.get("role", "")
        scope = r.get("scope", "")
        tid   = r.get("tenant_id")  # present only for tenant-scoped roles

        if scope == "global":
            if name == "Auditor":
                is_auditor = True
            elif name == "PowerAdmin":
                is_power_admin = True

        elif scope == "tenant" and tid:
            if name in ("Reader", "Writer", "PowerUser", "Approver", "Officer"):
                readable.add(tid)
            if name in ("Writer", "PowerUser"):
                writable.add(tid)
            if name == "Admin":
                admin.add(tid)

    return RLSContext(
        user_id=user_id,
        readable_tenant_ids=sorted(readable),
        writable_tenant_ids=sorted(writable),
        admin_tenant_ids=sorted(admin),
        is_auditor=is_auditor,
        is_power_admin=is_power_admin,
    )
