"""
Audit log endpoint.

Read access:
  Auditor    : all entries (no tenant filter enforced)
  PowerAdmin : all entries (oversight of tenant management)
  Officer    : entries for their assigned readable tenants only
               (tenant_id IS NOT NULL AND tenant_id in readable_tenant_ids)

The DB-level RLS policy enforces the same rules at the PostgreSQL layer so
even if the application layer is bypassed the data remains protected.
"""
import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.auth.dependencies import CurrentUser, get_current_user
from app.database import get_db
from app.pagination import build_page
from app.models import AuditLog
from app.schemas import AuditLogOut, AuditLogPage

router = APIRouter(prefix="/audit", tags=["audit"])


def _audit_query(
    db: Session,
    current: CurrentUser,
    tenant_id: Optional[uuid.UUID],
    user_id: Optional[uuid.UUID],
    action: Optional[str],
    table_name: Optional[str],
    search: Optional[str] = None,
    record_id: Optional[uuid.UUID] = None,
):
    # Determine access level:
    #   Auditor / PowerAdmin : unrestricted read
    #   Officer              : restricted to their readable tenants
    #                         (must supply tenant_id parameter)
    #   Others               : denied
    is_global_reader = current.is_auditor() or current.is_power_admin()

    officer_tenant_ids = [
        r.get("tenant_id")
        for r in current.roles
        if r.get("role") == "Officer" and r.get("tenant_id")
    ]
    is_officer = bool(officer_tenant_ids)

    if not is_global_reader and not is_officer:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Auditor, PowerAdmin, or Officer role required",
        )

    q = db.query(AuditLog)

    if not is_global_reader:
        if tenant_id:
            if str(tenant_id) not in officer_tenant_ids:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="You do not have Officer access for this tenant",
                )
            q = q.filter(AuditLog.tenant_id == tenant_id)
        else:
            q = q.filter(AuditLog.tenant_id.in_(officer_tenant_ids))
    else:
        if tenant_id:
            q = q.filter(AuditLog.tenant_id == tenant_id)

    if user_id:
        q = q.filter(AuditLog.user_id == user_id)
    if action:
        q = q.filter(AuditLog.action == action)
    if table_name:
        q = q.filter(AuditLog.table_name == table_name)
    if search:
        pattern = f"%{search.strip()}%"
        q = q.filter(or_(
            AuditLog.notes.ilike(pattern),
            AuditLog.table_name.ilike(pattern),
        ))
    if record_id:
        q = q.filter(AuditLog.record_id == record_id)

    return q


@router.get("", response_model=List[AuditLogOut])
def list_audit_log(
    tenant_id: Optional[uuid.UUID] = Query(None),
    user_id: Optional[uuid.UUID] = Query(None),
    action: Optional[str] = Query(None),
    table_name: Optional[str] = Query(None),
    record_id: Optional[uuid.UUID] = Query(None),
    search: Optional[str] = Query(None, min_length=1, max_length=100),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    current: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = _audit_query(db, current, tenant_id, user_id, action, table_name, search, record_id)
    return q.order_by(AuditLog.occurred_at.desc()).offset(skip).limit(limit).all()


@router.get("/page", response_model=AuditLogPage)
def list_audit_log_page(
    tenant_id: Optional[uuid.UUID] = Query(None),
    user_id: Optional[uuid.UUID] = Query(None),
    action: Optional[str] = Query(None),
    table_name: Optional[str] = Query(None),
    record_id: Optional[uuid.UUID] = Query(None),
    search: Optional[str] = Query(None, min_length=1, max_length=100),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    current: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = _audit_query(db, current, tenant_id, user_id, action, table_name, search, record_id)
    return build_page(AuditLogPage, q.order_by(AuditLog.occurred_at.desc()), skip, limit)
