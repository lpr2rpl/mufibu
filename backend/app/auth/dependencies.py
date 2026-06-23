"""
FastAPI dependency-injection helpers for authentication and authorisation.

Role permission matrix
======================
Reader      : can_read_bookings (tenant)
Writer      : can_read_bookings + can_write_own_bookings (tenant)
PowerUser   : can_read_bookings + can_write_all_bookings (tenant)
Approver    : can_approve_bookings only - no generic read/write (tenant)
Officer     : can_read_bookings for assigned tenants only (tenant, PowerAdmin assigns)
Admin       : can_manage_roles (no booking access) (tenant)
Auditor     : can_read_all tenants, read-only (global)
PowerAdmin  : can_manage_tenants + assign Officer, no booking access (global)

RLS context is derived from the JWT payload (roles list embedded at login) and
injected into every PostgreSQL transaction via SET LOCAL session variables
BEFORE the first query runs.  This ensures the DB-level policies are always
aligned with the application-level checks below.
"""
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import Depends, HTTPException, Request, status
from jose import JWTError
from sqlalchemy.orm import Session

from app.auth.cookies import ACCESS_COOKIE
from app.auth.jwt_handler import decode_token
from app.auth.permissions import (
    has_global_role,
    has_tenant_role,
    is_admin,
    is_approver,
    is_auditor,
    is_officer,
    is_power_admin,
    is_power_user,
    is_reader,
    is_writer,
)
from app.auth.token_revocation import token_revoked
from app.database import get_db
from app.models import User, UserRoleAssignment, Role
from app.rls import RLSContext, build_rls_context, set_rls_context

# ------------------------------------------------------------------
# Token extraction
# ------------------------------------------------------------------

def _get_token(request: Request) -> str:
    """
    Resolve the access token from the httpOnly access_token cookie (the browser
    path), falling back to an Authorization: Bearer header for non-browser API
    clients.
    """
    token = request.cookies.get(ACCESS_COOKIE)
    if not token:
        header = request.headers.get("Authorization", "")
        if header.startswith("Bearer "):
            token = header[len("Bearer "):]
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return token


def _decode(token: str = Depends(_get_token)) -> dict:
    try:
        payload = decode_token(token)
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if payload.get("type") != "access":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not an access token")
    return payload


# ------------------------------------------------------------------
# Current user
# ------------------------------------------------------------------

class CurrentUser:
    """
    Resolved current user injected by get_current_user.

    Permission helpers mirror the RLS policy logic so that application-layer
    checks remain consistent with database-layer enforcement.
    """

    def __init__(self, user: User, payload: dict):
        self.user = user
        self.id: uuid.UUID = user.id
        self.username: str = user.username
        self._roles: List[dict] = payload.get("roles", [])

    @property
    def roles(self) -> List[dict]:
        """Active role claims from the token (used by /auth/me)."""
        return self._roles

    # --- Low-level helpers ------------------------------------------------

    def has_global_role(self, *role_names: str) -> bool:
        return has_global_role(self._roles, *role_names)

    def has_tenant_role(self, tenant_id: uuid.UUID, *role_names: str) -> bool:
        return has_tenant_role(self._roles, tenant_id, *role_names)

    # --- Application-layer permission checks ------------------------------
    # These mirror what the RLS policies enforce at the DB level.

    def is_reader(self, tenant_id: uuid.UUID) -> bool:
        """Reader, Writer, PowerUser, Approver, Officer all grant read access."""
        return is_reader(self._roles, tenant_id)

    def is_writer(self, tenant_id: uuid.UUID) -> bool:
        return is_writer(self._roles, tenant_id)

    def is_power_user(self, tenant_id: uuid.UUID) -> bool:
        return is_power_user(self._roles, tenant_id)

    def is_approver(self, tenant_id: uuid.UUID) -> bool:
        return is_approver(self._roles, tenant_id)

    def is_officer(self, tenant_id: uuid.UUID) -> bool:
        """Officer: read-only for assigned tenants (assigned per-tenant by PowerAdmin)."""
        return is_officer(self._roles, tenant_id)

    def is_admin(self, tenant_id: uuid.UUID) -> bool:
        """Admin: role management only, NO booking read/write."""
        return is_admin(self._roles, tenant_id)

    def is_auditor(self) -> bool:
        return is_auditor(self._roles)

    def is_power_admin(self) -> bool:
        return is_power_admin(self._roles)


def get_current_user(
    payload: dict = Depends(_decode),
    db: Session = Depends(get_db),
) -> CurrentUser:
    """
    Resolves the authenticated user and sets the RLS context for this request.

    RLS context is built from the JWT payload (no extra DB round-trip) and
    injected into the ContextVar BEFORE the first DB query executes, so the
    SQLAlchemy after_begin event can propagate the session variables into
    PostgreSQL.
    """
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload")

    # Build and activate RLS context from JWT payload (roles are embedded
    # in the token at login time via build_roles_payload).
    roles = payload.get("roles", [])
    rls_ctx = build_rls_context(user_id, roles)
    set_rls_context(rls_ctx)

    # The DB query below is now safe: after_begin fires, sets PostgreSQL
    # session variables, and the users RLS policy allows the user to see
    # themselves (app.user_id matches).
    user = db.query(User).filter(
        User.id == user_id,
        User.is_active == True,
        User.deleted_at.is_(None),
    ).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive")

    # Reject tokens issued before the user's revocation watermark (logout,
    # deactivation, or PowerAdmin force-logout bumps it).
    if token_revoked(payload.get("iat"), user.tokens_valid_after):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token has been revoked")

    return CurrentUser(user, payload)


# ------------------------------------------------------------------
# Convenience guards
# ------------------------------------------------------------------

def require_power_admin(current: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if not current.is_power_admin():
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="PowerAdmin role required")
    return current


def require_auditor_or_power_admin(current: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if not (current.is_auditor() or current.is_power_admin()):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Auditor or PowerAdmin role required")
    return current


# ------------------------------------------------------------------
# JWT payload builder (used at login / refresh)
# ------------------------------------------------------------------

def build_roles_payload(user: User, db: Session) -> List[dict]:
    """
    Return currently active role assignments for the user as a list of dicts
    suitable for embedding in the JWT payload.

    Called with bypass_rls already active (login/refresh context) so the
    user_role_assignments query is unrestricted.
    """
    now = datetime.now(timezone.utc)
    assignments = (
        db.query(UserRoleAssignment, Role)
        .join(Role, Role.id == UserRoleAssignment.role_id)
        .filter(
            UserRoleAssignment.user_id == user.id,
            UserRoleAssignment.is_active == True,
            UserRoleAssignment.deleted_at.is_(None),
            UserRoleAssignment.valid_from <= now,
            (UserRoleAssignment.valid_until.is_(None)) | (UserRoleAssignment.valid_until > now),
        )
        .all()
    )
    result = []
    for ura, role in assignments:
        entry: dict = {"role": role.name, "scope": role.scope}
        if ura.tenant_id:
            entry["tenant_id"] = str(ura.tenant_id)
        result.append(entry)
    return result
