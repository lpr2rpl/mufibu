"""
MuFiBu - Multi-Tenant Financial Accounting System
FastAPI application entry point.
"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from passlib.context import CryptContext
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import Base, SessionLocal, engine
from app.models import AuditLog, Role, Tenant, User, UserRoleAssignment
from app.rls import BYPASS_CONTEXT, set_rls_context
from app.routers import accounts, audit, auth, journal, roles, tenants, users

logger = logging.getLogger(__name__)

settings = get_settings()
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def _seed_initial_data():
    """
    On first startup: create DB tables and seed the initial PowerAdmin user
    if no users exist yet.

    The BYPASS_CONTEXT is activated so that the RLS policies (FORCE ROW LEVEL
    SECURITY) do not block the seed queries.  This context is only used here
    and in the setup/migration path - never in any request handler.
    """
    Base.metadata.create_all(bind=engine)

    # Activate bypass so after_begin injects bypass_rls='true' into PostgreSQL.
    set_rls_context(BYPASS_CONTEXT)

    db: Session = SessionLocal()
    try:
        # Ensure role catalog is complete (including Officer added by migration)
        role_defs = [
            ("Reader",    "tenant", "Read all bookings of the assigned tenant"),
            ("Writer",    "tenant", "Reader + create bookings + modify own bookings"),
            ("PowerUser", "tenant", "Writer + modify all bookings of the tenant"),
            ("Approver",  "tenant", "Approve bookings that require four-eyes principle"),
            ("Admin",     "tenant", "Manage user-role assignments; no booking access"),
            ("Officer",   "tenant", "Read-only access for assigned tenants; assigned by PowerAdmin"),
            ("Auditor",   "global", "Read all data across all tenants; no write access"),
            ("PowerAdmin","global", "Create tenants and manage tenant Admins; no booking access"),
        ]
        for name, scope, desc in role_defs:
            if not db.query(Role).filter(Role.name == name).first():
                db.add(Role(name=name, scope=scope, description=desc))
        db.flush()

        # Seed initial PowerAdmin user if the users table is empty
        if db.query(User).count() == 0:
            pa_role = db.query(Role).filter(Role.name == "PowerAdmin").first()
            admin = User(
                username=settings.SEED_ADMIN_USERNAME,
                email=settings.SEED_ADMIN_EMAIL,
                password_hash=pwd_context.hash(settings.SEED_ADMIN_PASSWORD),
                full_name="Power Administrator",
            )
            db.add(admin)
            db.flush()

            db.add(UserRoleAssignment(
                user_id=admin.id,
                role_id=pa_role.id,
                assigned_by=admin.id,
            ))
            db.add(AuditLog(
                user_id=admin.id,
                action="INSERT",
                table_name="users",
                record_id=admin.id,
                notes="Initial seed: PowerAdmin user created",
            ))

        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
        # Clear the bypass context so no request handler can accidentally
        # inherit it (each request sets its own context via get_current_user).
        set_rls_context(None)  # type: ignore[arg-type]


@asynccontextmanager
async def lifespan(app: FastAPI):
    _seed_initial_data()
    yield


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="Multi-tenant financial accounting system with role-based access control",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Global exception handlers
# ---------------------------------------------------------------------------

@app.exception_handler(IntegrityError)
async def integrity_error_handler(request: Request, exc: IntegrityError):
    logger.warning("DB integrity error: %s", exc.orig)
    detail = str(exc.orig) if settings.DEBUG else "A database constraint was violated."
    return JSONResponse(status_code=409, content={"detail": detail})


@app.exception_handler(OperationalError)
async def operational_error_handler(request: Request, exc: OperationalError):
    logger.error("DB operational error: %s", exc)
    return JSONResponse(status_code=503, content={"detail": "Database temporarily unavailable."})


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled exception on %s %s", request.method, request.url.path)
    if settings.DEBUG:
        return JSONResponse(status_code=500, content={"detail": str(exc)})
    return JSONResponse(status_code=500, content={"detail": "An internal error occurred."})


# ---------------------------------------------------------------------------
# Routers
# ---------------------------------------------------------------------------

app.include_router(auth.router,     prefix="/api/v1")
app.include_router(tenants.router,  prefix="/api/v1")
app.include_router(users.router,    prefix="/api/v1")
app.include_router(roles.router,    prefix="/api/v1")
app.include_router(accounts.router, prefix="/api/v1")
app.include_router(journal.router,  prefix="/api/v1")
app.include_router(audit.router,    prefix="/api/v1")


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

@app.get("/api/v1/health", tags=["health"])
def health():
    """Basic liveness probe — returns OK without hitting the database."""
    return {"status": "ok", "app": settings.APP_NAME, "version": settings.APP_VERSION}


@app.get("/api/v1/health/db", tags=["health"])
def health_db():
    """Readiness probe — verifies database connectivity."""
    db = SessionLocal()
    try:
        db.execute(text("SELECT 1"))
        return {"status": "ok", "database": "connected"}
    except Exception as exc:
        logger.error("Health-DB probe failed: %s", exc)
        return JSONResponse(status_code=503, content={"status": "error", "database": "unreachable"})
    finally:
        db.close()
