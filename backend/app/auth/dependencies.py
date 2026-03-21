"""
FastAPI dependency-injection helpers for authentication and authorisation.

Role permission matrix
======================
Reader      : can_read_bookings
Writer      : can_read_bookings + can_write_own_bookings
PowerUser   : can_read_bookings + can_write_all_bookings
Approver    : can_approve_bookings  (no read/write otherwise)
Admin       : can_manage_roles      (no booking access)
Auditor     : can_read_all_tenants  (global, read-only)
PowerAdmin  : can_manage_tenants    (global, no booking access)
"""
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError
from sqlalchemy.orm import Session

from app.auth.jwt_handler import decode_token
from app.database import get_db
from app.models import User, UserRoleAssignment, Role

security = HTTPBearer()

# ------------------------------------------------------------------
# Token extraction
# ------------------------------------------------------------------

def _get_token(credentials: HTTPAuthorizationCredentials = Depends(security)) -> str:
    return credentials.credentials


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
    """Resolved current user, injected by get_current_user."""
    def __init__(self, user: User, payload: dict):
        self.user = user
        self.id: uuid.UUID = user.id
        self.username: str = user.username
        self._roles: List[dict] = payload.get("roles", [])  # [{role, scope, tenant_id}, ...]

    def has_global_role(self, *role_names: str) -> bool:
        return any(
            r["role"] in role_names and r["scope"] == "global"
            for r in self._roles
        )

    def has_tenant_role(self, tenant_id: uuid.UUID, *role_names: str) -> bool:
        tid = str(tenant_id)
        return any(
            r["role"] in role_names and r.get("tenant_id") == tid
            for r in self._roles
        )

    def is_reader(self, tenant_id: uuid.UUID) -> bool:
        return self.has_tenant_role(tenant_id, "Reader", "Writer", "PowerUser") \
               or self.has_global_role("Auditor")

    def is_writer(self, tenant_id: uuid.UUID) -> bool:
        return self.has_tenant_role(tenant_id, "Writer", "PowerUser")

    def is_power_user(self, tenant_id: uuid.UUID) -> bool:
        return self.has_tenant_role(tenant_id, "PowerUser")

    def is_approver(self, tenant_id: uuid.UUID) -> bool:
        return self.has_tenant_role(tenant_id, "Approver")

    def is_admin(self, tenant_id: uuid.UUID) -> bool:
        return self.has_tenant_role(tenant_id, "Admin")

    def is_auditor(self) -> bool:
        return self.has_global_role("Auditor")

    def is_power_admin(self) -> bool:
        return self.has_global_role("PowerAdmin")


def get_current_user(
    payload: dict = Depends(_decode),
    db: Session = Depends(get_db),
) -> CurrentUser:
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload")
    user = db.query(User).filter(
        User.id == user_id,
        User.is_active == True,
        User.deleted_at.is_(None)
    ).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive")
    return CurrentUser(user, payload)


# ------------------------------------------------------------------
# Convenience guards  (raise 403 if condition fails)
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
# Helper: build roles list from DB for JWT payload
# ------------------------------------------------------------------

def build_roles_payload(user: User, db: Session) -> List[dict]:
    """
    Return currently active role assignments for the user as a list of dicts
    suitable for embedding in the JWT payload.
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
        entry = {
            "role": role.name,
            "scope": role.scope,
        }
        if ura.tenant_id:
            entry["tenant_id"] = str(ura.tenant_id)
        result.append(entry)
    return result
