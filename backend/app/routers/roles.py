"""
Role assignment management.

Assignment rules:
- PowerAdmin can assign/revoke ALL roles (global and tenant-scoped).
- PowerAdmin is the ONLY one who can assign/revoke the Admin and Officer roles.
  (Officer is PowerAdmin-assigned per-tenant to implement the tenant map.)
- Tenant Admin can assign/revoke Reader, Writer, PowerUser, Approver for their
  own tenant.
- Phase extension: assigned_by or PowerAdmin/Admin may extend valid_until.
- When a phase expires, create a new assignment record (old record is kept for
  audit trail).
"""
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session, joinedload

from app.auth.dependencies import CurrentUser, get_current_user
from app.auth.permissions import POWER_ADMIN_ONLY_ROLES
from app.database import get_db
from app.models import AuditLog, Role, Tenant, User, UserRoleAssignment
from app.schemas import (
    RoleAssignmentCreate, RoleAssignmentExtend, RoleAssignmentOut,
    RoleAssignmentPage, RoleAssignmentRevoke, RoleOut, RolePage,
)

router = APIRouter(prefix="/roles", tags=["roles"])

# ------------------------------------------------------------------
# Role catalog
# ------------------------------------------------------------------

@router.get("", response_model=List[RoleOut])
def list_roles(current: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    return db.query(Role).all()


@router.get("/page", response_model=RolePage)
def list_roles_page(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    current: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = db.query(Role)
    total = q.count()
    items = q.offset(skip).limit(limit).all()
    return RolePage(total=total, skip=skip, limit=limit, items=items)


# ------------------------------------------------------------------
# Assignments
# ------------------------------------------------------------------


def _assignment_query(
    db: Session,
    current: CurrentUser,
    user_id: Optional[uuid.UUID],
    tenant_id: Optional[uuid.UUID],
    active_only: bool,
):
    q = (
        db.query(UserRoleAssignment)
        .options(
            joinedload(UserRoleAssignment.user),
            joinedload(UserRoleAssignment.role),
            joinedload(UserRoleAssignment.tenant),
        )
        .filter(UserRoleAssignment.deleted_at.is_(None))
    )

    # Restrict visibility: PowerAdmin/Auditor see all; Admin sees their tenant;
    # others see only their own assignments.
    if not (current.is_power_admin() or current.is_auditor()):
        if tenant_id and current.is_admin(tenant_id):
            q = q.filter(UserRoleAssignment.tenant_id == tenant_id)
        else:
            q = q.filter(UserRoleAssignment.user_id == current.id)
    else:
        if user_id:
            q = q.filter(UserRoleAssignment.user_id == user_id)
        if tenant_id:
            q = q.filter(UserRoleAssignment.tenant_id == tenant_id)

    if active_only:
        now = datetime.now(timezone.utc)
        q = q.filter(
            UserRoleAssignment.is_active == True,
            UserRoleAssignment.valid_from <= now,
            (UserRoleAssignment.valid_until.is_(None)) | (UserRoleAssignment.valid_until > now),
        )

    return q


def _assignment_out(a: UserRoleAssignment) -> RoleAssignmentOut:
    return RoleAssignmentOut(
        id=a.id,
        user_id=a.user_id,
        username=a.user.username if a.user else None,
        role_id=a.role_id,
        role_name=a.role.name if a.role else None,
        role_scope=a.role.scope if a.role else None,
        tenant_id=a.tenant_id,
        tenant_name=a.tenant.name if a.tenant else None,
        valid_from=a.valid_from,
        valid_until=a.valid_until,
        is_active=a.is_active,
        assigned_at=a.assigned_at,
    )


@router.get("/assignments", response_model=List[RoleAssignmentOut])
def list_assignments(
    user_id: Optional[uuid.UUID] = Query(None),
    tenant_id: Optional[uuid.UUID] = Query(None),
    active_only: bool = Query(True),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    current: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = _assignment_query(db, current, user_id, tenant_id, active_only)
    assignments = q.offset(skip).limit(limit).all()
    return [_assignment_out(a) for a in assignments]


@router.get("/assignments/page", response_model=RoleAssignmentPage)
def list_assignments_page(
    user_id: Optional[uuid.UUID] = Query(None),
    tenant_id: Optional[uuid.UUID] = Query(None),
    active_only: bool = Query(True),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    current: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = _assignment_query(db, current, user_id, tenant_id, active_only)
    total = q.count()
    assignments = q.offset(skip).limit(limit).all()
    return RoleAssignmentPage(
        total=total,
        skip=skip,
        limit=limit,
        items=[_assignment_out(a) for a in assignments],
    )


@router.post("/assignments", response_model=RoleAssignmentOut, status_code=status.HTTP_201_CREATED)
def assign_role(
    body: RoleAssignmentCreate,
    current: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    role = db.query(Role).filter(Role.name == body.role_name).first()
    if not role:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Role '{body.role_name}' not found")

    # ---------- permission matrix ----------
    if role.scope == "global":
        # Global roles (Auditor, PowerAdmin) require PowerAdmin
        if not current.is_power_admin():
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                                detail="PowerAdmin role required for global roles")
        if body.tenant_id is not None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                                detail="Global roles must not have a tenant_id")

    else:  # tenant-scoped role
        if body.tenant_id is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                                detail="tenant_id is required for tenant-scoped roles")

        if role.name in POWER_ADMIN_ONLY_ROLES:
            # Admin and Officer can only be assigned by PowerAdmin.
            # Officer implements the "tenant map": PowerAdmin selects which
            # tenants an Officer user gets read access to.
            if not current.is_power_admin():
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=f"Only PowerAdmin can assign the {role.name} role",
                )
        else:
            # Reader, Writer, PowerUser, Approver: Admin of that tenant or PowerAdmin
            if not (current.is_power_admin() or current.is_admin(body.tenant_id)):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Tenant Admin or PowerAdmin role required",
                )

    # Target user must exist
    target_user = db.query(User).filter(
        User.id == body.user_id, User.deleted_at.is_(None)
    ).first()
    if not target_user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Target user not found")

    now = datetime.now(timezone.utc)
    ura = UserRoleAssignment(
        user_id=body.user_id,
        role_id=role.id,
        tenant_id=body.tenant_id,
        valid_from=body.valid_from or now,
        valid_until=body.valid_until,
        assigned_by=current.id,
        notes=body.notes,
    )
    db.add(ura)
    db.flush()
    db.add(AuditLog(
        user_id=current.id,
        tenant_id=body.tenant_id,
        action="ROLE_ASSIGN",
        table_name="user_role_assignments",
        record_id=ura.id,
        new_values={
            "target_user": str(body.user_id),
            "role": role.name,
            "valid_from": str(ura.valid_from),
            "valid_until": str(ura.valid_until) if ura.valid_until else None,
        },
    ))
    db.commit()
    db.refresh(ura)

    return RoleAssignmentOut(
        id=ura.id,
        user_id=ura.user_id,
        username=target_user.username,
        role_id=ura.role_id,
        role_name=role.name,
        role_scope=role.scope,
        tenant_id=ura.tenant_id,
        valid_from=ura.valid_from,
        valid_until=ura.valid_until,
        is_active=ura.is_active,
        assigned_at=ura.assigned_at,
    )


@router.patch("/assignments/{assignment_id}/extend", response_model=RoleAssignmentOut)
def extend_assignment(
    assignment_id: uuid.UUID,
    body: RoleAssignmentExtend,
    current: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ura = db.query(UserRoleAssignment).filter(
        UserRoleAssignment.id == assignment_id,
        UserRoleAssignment.deleted_at.is_(None),
    ).first()
    if not ura:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found")

    role = db.query(Role).filter(Role.id == ura.role_id).first()

    # Permission: PowerAdmin for all; Admin for their tenant (except Admin/Officer);
    # the original assigner may also extend their own assignment.
    if role and role.name in POWER_ADMIN_ONLY_ROLES:
        if not current.is_power_admin():
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                                detail=f"Only PowerAdmin can extend the {role.name} role")
    elif not (
        current.is_power_admin()
        or (ura.tenant_id and current.is_admin(ura.tenant_id))
        or current.id == ura.assigned_by
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="Insufficient permissions to extend this assignment")

    current_until = ura.valid_until or datetime.now(timezone.utc)
    if body.valid_until <= current_until:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="New valid_until must be later than the current valid_until",
        )

    ura.previous_valid_until = ura.valid_until
    ura.valid_until = body.valid_until
    ura.extended_by = current.id
    ura.extended_at = datetime.now(timezone.utc)
    if body.notes:
        ura.notes = body.notes

    db.add(AuditLog(
        user_id=current.id,
        tenant_id=ura.tenant_id,
        action="PHASE_EXTEND",
        table_name="user_role_assignments",
        record_id=ura.id,
        old_values={"valid_until": str(ura.previous_valid_until)},
        new_values={"valid_until": str(ura.valid_until)},
    ))
    db.commit()
    db.refresh(ura)

    return RoleAssignmentOut(
        id=ura.id,
        user_id=ura.user_id,
        role_id=ura.role_id,
        role_name=role.name if role else None,
        role_scope=role.scope if role else None,
        tenant_id=ura.tenant_id,
        valid_from=ura.valid_from,
        valid_until=ura.valid_until,
        is_active=ura.is_active,
        assigned_at=ura.assigned_at,
    )


@router.patch("/assignments/{assignment_id}/revoke", status_code=status.HTTP_200_OK)
def revoke_assignment(
    assignment_id: uuid.UUID,
    body: RoleAssignmentRevoke,
    current: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ura = db.query(UserRoleAssignment).filter(
        UserRoleAssignment.id == assignment_id,
        UserRoleAssignment.deleted_at.is_(None),
        UserRoleAssignment.is_active == True,
    ).first()
    if not ura:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Active assignment not found")

    role = db.query(Role).filter(Role.id == ura.role_id).first()

    # Global roles: PowerAdmin only
    if role and role.scope == "global":
        if not current.is_power_admin():
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                                detail="PowerAdmin role required to revoke global roles")
    # Tenant roles: Admin/Officer require PowerAdmin; others allow tenant Admin
    elif role and role.name in POWER_ADMIN_ONLY_ROLES:
        if not current.is_power_admin():
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Only PowerAdmin can revoke the {role.name} role",
            )
    else:
        if not (current.is_power_admin() or (ura.tenant_id and current.is_admin(ura.tenant_id))):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                                detail="Tenant Admin or PowerAdmin role required")

    now = datetime.now(timezone.utc)
    ura.is_active = False
    ura.revoked_by = current.id
    ura.revoked_at = now
    ura.revoke_reason = body.revoke_reason

    db.add(AuditLog(
        user_id=current.id,
        tenant_id=ura.tenant_id,
        action="ROLE_REVOKE",
        table_name="user_role_assignments",
        record_id=ura.id,
        new_values={"revoke_reason": body.revoke_reason},
    ))
    db.commit()
    return {"detail": "Assignment revoked"}
