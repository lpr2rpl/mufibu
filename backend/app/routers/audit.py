"""
Audit log endpoint.
Auditor and PowerAdmin can read audit log.
"""
import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.auth.dependencies import CurrentUser, get_current_user
from app.database import get_db
from app.models import AuditLog
from app.schemas import AuditLogOut

router = APIRouter(prefix="/audit", tags=["audit"])


@router.get("", response_model=List[AuditLogOut])
def list_audit_log(
    tenant_id: Optional[uuid.UUID] = Query(None),
    user_id: Optional[uuid.UUID] = Query(None),
    action: Optional[str] = Query(None),
    table_name: Optional[str] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    current: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not (current.is_auditor() or current.is_power_admin()):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Auditor or PowerAdmin role required")

    q = db.query(AuditLog)

    if tenant_id:
        q = q.filter(AuditLog.tenant_id == tenant_id)
    if user_id:
        q = q.filter(AuditLog.user_id == user_id)
    if action:
        q = q.filter(AuditLog.action == action)
    if table_name:
        q = q.filter(AuditLog.table_name == table_name)

    return q.order_by(AuditLog.occurred_at.desc()).offset(skip).limit(limit).all()
