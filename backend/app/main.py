"""
MuFiBu - Multi-Tenant Financial Accounting System
FastAPI application entry point.
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import Base, SessionLocal, engine
from app.models import AuditLog, Role, Tenant, User, UserRoleAssignment
from app.routers import accounts, audit, auth, journal, roles, tenants, users

settings = get_settings()
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def _seed_initial_data():
    """
    On first startup: create DB tables and seed the initial PowerAdmin user
    if no users exist yet.
    """
    Base.metadata.create_all(bind=engine)

    db: Session = SessionLocal()
    try:
        # Ensure role catalog exists
        role_defs = [
            ("Reader",    "tenant", "Read all bookings of the assigned tenant"),
            ("Writer",    "tenant", "Reader + create bookings + modify own bookings"),
            ("PowerUser", "tenant", "Writer + modify all bookings of the tenant"),
            ("Approver",  "tenant", "Approve bookings that require four-eyes principle"),
            ("Admin",     "tenant", "Manage user-role assignments; no booking access"),
            ("Auditor",   "global", "Read all data across all tenants; no write access"),
            ("PowerAdmin","global", "Create tenants and manage tenant Admins; no booking access"),
        ]
        for name, scope, desc in role_defs:
            if not db.query(Role).filter(Role.name == name).first():
                db.add(Role(name=name, scope=scope, description=desc))
        db.flush()

        # Seed PowerAdmin user if no users at all
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

# Include routers
app.include_router(auth.router,     prefix="/api/v1")
app.include_router(tenants.router,  prefix="/api/v1")
app.include_router(users.router,    prefix="/api/v1")
app.include_router(roles.router,    prefix="/api/v1")
app.include_router(accounts.router, prefix="/api/v1")
app.include_router(journal.router,  prefix="/api/v1")
app.include_router(audit.router,    prefix="/api/v1")


@app.get("/api/v1/health")
def health():
    return {"status": "ok", "app": settings.APP_NAME, "version": settings.APP_VERSION}
