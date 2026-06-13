"""
Chart of accounts management.

Read access:  Reader, Writer, PowerUser, Approver, Officer, Admin (tenant),
              Auditor (global), PowerAdmin (global).
Write access: PowerUser, Admin (tenant), PowerAdmin (global).

Note: Admin requires read access to the account list for the role-management
UI (account selection in journal entries) even though they cannot access
journal entries themselves.  The DB-level RLS policy for accounts mirrors this.
"""
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.auth.dependencies import CurrentUser, get_current_user
from app.auth.policies import require_account_read, require_account_write
from app.database import get_db
from app.models import Account, AuditLog
from app.schemas import AccountCreate, AccountOut, AccountPage, AccountUpdate

router = APIRouter(prefix="/tenants/{tenant_id}/accounts", tags=["accounts"])


@router.get("", response_model=List[AccountOut])
def list_accounts(
    tenant_id: uuid.UUID,
    skip: int = Query(0, ge=0),
    limit: int = Query(200, ge=1, le=1000),
    account_type: Optional[str] = Query(None),
    active_only: bool = Query(True),
    current: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_account_read(current, tenant_id)
    q = db.query(Account).filter(Account.tenant_id == tenant_id, Account.deleted_at.is_(None))
    if active_only:
        q = q.filter(Account.is_active == True)
    if account_type:
        q = q.filter(Account.account_type == account_type)
    return q.order_by(Account.account_number).offset(skip).limit(limit).all()


@router.get("/page", response_model=AccountPage)
def list_accounts_page(
    tenant_id: uuid.UUID,
    skip: int = Query(0, ge=0),
    limit: int = Query(200, ge=1, le=1000),
    account_type: Optional[str] = Query(None),
    active_only: bool = Query(True),
    current: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_account_read(current, tenant_id)
    q = db.query(Account).filter(Account.tenant_id == tenant_id, Account.deleted_at.is_(None))
    if active_only:
        q = q.filter(Account.is_active == True)
    if account_type:
        q = q.filter(Account.account_type == account_type)
    total = q.count()
    items = q.order_by(Account.account_number).offset(skip).limit(limit).all()
    return AccountPage(total=total, skip=skip, limit=limit, items=items)


@router.post("", response_model=AccountOut, status_code=status.HTTP_201_CREATED)
def create_account(
    tenant_id: uuid.UUID,
    body: AccountCreate,
    current: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_account_write(current, tenant_id)
    if db.query(Account).filter(
        Account.tenant_id == tenant_id,
        Account.account_number == body.account_number,
        Account.deleted_at.is_(None),
    ).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Account number already exists")

    acct = Account(
        tenant_id=tenant_id,
        account_number=body.account_number,
        name=body.name,
        account_type=body.account_type,
        parent_account_id=body.parent_account_id,
        description=body.description,
        created_by=current.id,
    )
    db.add(acct)
    db.flush()
    db.add(AuditLog(
        user_id=current.id,
        tenant_id=tenant_id,
        action="INSERT",
        table_name="accounts",
        record_id=acct.id,
        new_values={"account_number": acct.account_number, "name": acct.name},
    ))
    db.commit()
    db.refresh(acct)
    return acct


@router.get("/{account_id}", response_model=AccountOut)
def get_account(
    tenant_id: uuid.UUID,
    account_id: uuid.UUID,
    current: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_account_read(current, tenant_id)
    acct = db.query(Account).filter(
        Account.id == account_id, Account.tenant_id == tenant_id, Account.deleted_at.is_(None)
    ).first()
    if not acct:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")
    return acct


@router.patch("/{account_id}", response_model=AccountOut)
def update_account(
    tenant_id: uuid.UUID,
    account_id: uuid.UUID,
    body: AccountUpdate,
    current: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_account_write(current, tenant_id)
    acct = db.query(Account).filter(
        Account.id == account_id, Account.tenant_id == tenant_id, Account.deleted_at.is_(None)
    ).first()
    if not acct:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")
    old = {"name": acct.name, "description": acct.description, "is_active": acct.is_active}
    if body.name is not None:
        acct.name = body.name
    if body.description is not None:
        acct.description = body.description
    if body.is_active is not None:
        acct.is_active = body.is_active
    acct.modified_at = datetime.now(timezone.utc)
    acct.modified_by = current.id
    db.add(AuditLog(
        user_id=current.id,
        tenant_id=tenant_id,
        action="UPDATE",
        table_name="accounts",
        record_id=account_id,
        old_values=old,
        new_values=body.model_dump(exclude_none=True),
    ))
    db.commit()
    db.refresh(acct)
    return acct


@router.delete("/{account_id}", status_code=status.HTTP_204_NO_CONTENT)
def soft_delete_account(
    tenant_id: uuid.UUID,
    account_id: uuid.UUID,
    current: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_account_write(current, tenant_id)
    acct = db.query(Account).filter(
        Account.id == account_id, Account.tenant_id == tenant_id, Account.deleted_at.is_(None)
    ).first()
    if not acct:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")
    acct.deleted_at = datetime.now(timezone.utc)
    acct.deleted_by = current.id
    db.add(AuditLog(
        user_id=current.id,
        tenant_id=tenant_id,
        action="SOFT_DELETE",
        table_name="accounts",
        record_id=account_id,
    ))
    db.commit()
