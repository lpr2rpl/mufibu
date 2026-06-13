"""
Reusable application-layer authorization policies.
"""
import uuid
from typing import TYPE_CHECKING

from fastapi import HTTPException, status

if TYPE_CHECKING:
    from app.auth.dependencies import CurrentUser


def require_power_admin(current: "CurrentUser") -> None:
    if not current.is_power_admin():
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="PowerAdmin role required")


def require_account_read(current: "CurrentUser", tenant_id: uuid.UUID) -> None:
    if not (
        current.is_reader(tenant_id)
        or current.is_admin(tenant_id)
        or current.is_power_admin()
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")


def require_account_write(current: "CurrentUser", tenant_id: uuid.UUID) -> None:
    if not (
        current.is_power_user(tenant_id)
        or current.is_admin(tenant_id)
        or current.is_power_admin()
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="PowerUser or Admin role required")


def require_journal_read(current: "CurrentUser", tenant_id: uuid.UUID) -> None:
    if not current.is_reader(tenant_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Read access denied")


def require_journal_writer(current: "CurrentUser", tenant_id: uuid.UUID) -> None:
    if not current.is_writer(tenant_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Writer role required")


def require_journal_power_user(current: "CurrentUser", tenant_id: uuid.UUID) -> None:
    if not current.is_power_user(tenant_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="PowerUser role required")


def require_journal_approver(current: "CurrentUser", tenant_id: uuid.UUID) -> None:
    if not current.is_approver(tenant_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Approver role required")
