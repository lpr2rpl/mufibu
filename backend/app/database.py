from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import sessionmaker, DeclarativeBase, Session

from app.config import get_settings

settings = get_settings()

engine = create_engine(
    settings.DATABASE_URL,
    pool_pre_ping=True,
    pool_size=10,
    max_overflow=20,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Row-Level Security: inject PostgreSQL session variables at the start of
# every transaction so the RLS policies in 002_rls_officer.sql can evaluate
# the current user's authorisation attributes.
#
# We use SET LOCAL (via set_config(..., is_local => true)) so that variables
# are transaction-scoped: they are reset automatically when the transaction
# ends (commit or rollback).  Pooled connections therefore never leak one
# request's security context into the next.
#
# The RLSContext is stored in a ContextVar (app.rls) so it is thread-safe
# and async-safe.  get_current_user() populates it from the JWT payload
# before any DB query runs.
# ---------------------------------------------------------------------------

def _set_local(connection, name: str, value: str) -> None:
    """Execute set_config(name, value, is_local => true) with parameterised query."""
    connection.execute(
        text("SELECT set_config(:n, :v, true)"),
        {"n": name, "v": value},
    )


@event.listens_for(SessionLocal, "after_begin")
def _inject_rls_context(session: Session, transaction, connection) -> None:
    """
    Fires once per transaction on this session.  Reads the current RLSContext
    from the ContextVar and writes all relevant attributes into the PostgreSQL
    session as SET LOCAL variables consumed by the RLS policies.

    If no context is set (anonymous / health-check requests), all variables
    are set to safe deny-all defaults.
    """
    # Deferred import avoids circular dependency (rls -> database -> rls).
    from app.rls import get_rls_context

    ctx = get_rls_context()

    if ctx is None:
        # No authenticated context: deny-all defaults
        _set_local(connection, "app.user_id",             "")
        _set_local(connection, "app.readable_tenant_ids", "")
        _set_local(connection, "app.writable_tenant_ids", "")
        _set_local(connection, "app.admin_tenant_ids",    "")
        _set_local(connection, "app.is_auditor",          "false")
        _set_local(connection, "app.is_power_admin",      "false")
        _set_local(connection, "app.bypass_rls",          "false")
        return

    _set_local(connection, "app.user_id",             ctx.user_id)
    _set_local(connection, "app.readable_tenant_ids", ",".join(ctx.readable_tenant_ids))
    _set_local(connection, "app.writable_tenant_ids", ",".join(ctx.writable_tenant_ids))
    _set_local(connection, "app.admin_tenant_ids",    ",".join(ctx.admin_tenant_ids))
    _set_local(connection, "app.is_auditor",          "true" if ctx.is_auditor    else "false")
    _set_local(connection, "app.is_power_admin",      "true" if ctx.is_power_admin else "false")
    _set_local(connection, "app.bypass_rls",          "true" if ctx.bypass_rls    else "false")


# ---------------------------------------------------------------------------
# Audit metadata: stamp ip_address, user_agent, and session_id (request
# correlation id) onto every AuditLog row before it is flushed, so forensic
# fields are recorded for ALL audited actions rather than only login/logout.
# Values are read from the request-scoped context populated by the HTTP
# middleware.  Fields explicitly set by a caller are left untouched, and rows
# created outside a request (e.g. startup seeding) simply keep NULLs.
# ---------------------------------------------------------------------------

@event.listens_for(SessionLocal, "before_flush")
def _stamp_audit_metadata(session: Session, flush_context, instances) -> None:
    # Deferred imports avoid circular dependencies at module load time.
    from app.logging_context import audit_context_fields
    from app.models import AuditLog

    fields = None
    for obj in session.new:
        if not isinstance(obj, AuditLog):
            continue
        if fields is None:
            fields = audit_context_fields()
        if obj.ip_address is None:
            obj.ip_address = fields["ip_address"]
        if obj.user_agent is None:
            obj.user_agent = fields["user_agent"]
        if obj.session_id is None:
            obj.session_id = fields["session_id"]
