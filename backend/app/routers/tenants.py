"""
Tenant management.
Only PowerAdmin may create tenants or list all tenants.
"""
import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.auth.dependencies import CurrentUser, get_current_user
from app.auth.policies import require_power_admin
from app.database import get_db
from app.models import AuditLog, Role, Tenant, User, UserRoleAssignment
from app.schemas import TenantCreate, TenantOut, TenantPage

router = APIRouter(prefix="/tenants", tags=["tenants"])


@router.get("", response_model=List[TenantOut])
def list_tenants(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    current: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not (current.is_power_admin() or current.is_auditor()):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
    return (
        db.query(Tenant)
        .filter(Tenant.deleted_at.is_(None))
        .offset(skip)
        .limit(limit)
        .all()
    )


@router.get("/page", response_model=TenantPage)
def list_tenants_page(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    current: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not (current.is_power_admin() or current.is_auditor()):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
    q = db.query(Tenant).filter(Tenant.deleted_at.is_(None))
    total = q.count()
    items = q.offset(skip).limit(limit).all()
    return TenantPage(total=total, skip=skip, limit=limit, items=items)


@router.post("", response_model=TenantOut, status_code=status.HTTP_201_CREATED)
def create_tenant(
    body: TenantCreate,
    current: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_power_admin(current)

    if db.query(Tenant).filter(Tenant.name == body.name, Tenant.deleted_at.is_(None)).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Tenant name already exists")

    tenant = Tenant(
        name=body.name,
        description=body.description,
        created_by=current.id,
    )
    db.add(tenant)
    db.flush()

    db.add(AuditLog(
        user_id=current.id,
        tenant_id=tenant.id,
        action="TENANT_CREATE",
        table_name="tenants",
        record_id=tenant.id,
        new_values={"name": tenant.name, "description": tenant.description},
    ))
    db.commit()
    db.refresh(tenant)
    return tenant


@router.get("/{tenant_id}", response_model=TenantOut)
def get_tenant(
    tenant_id: uuid.UUID,
    current: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not (current.is_power_admin() or current.is_auditor()
            or current.is_admin(tenant_id) or current.is_reader(tenant_id)):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id, Tenant.deleted_at.is_(None)).first()
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found")
    return tenant


@router.delete("/{tenant_id}", status_code=status.HTTP_204_NO_CONTENT)
def soft_delete_tenant(
    tenant_id: uuid.UUID,
    current: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_power_admin(current)
    from datetime import datetime, timezone
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id, Tenant.deleted_at.is_(None)).first()
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found")
    tenant.deleted_at = datetime.now(timezone.utc)
    tenant.deleted_by = current.id
    db.add(AuditLog(
        user_id=current.id,
        tenant_id=tenant_id,
        action="SOFT_DELETE",
        table_name="tenants",
        record_id=tenant_id,
    ))
    db.commit()
