"""
Chart of accounts management.

Read access:  Reader, Writer, PowerUser, Approver, Officer, Admin (tenant),
              Auditor (global), PowerAdmin (global).
Write access: PowerUser (tenant), PowerAdmin (global).

Note: Admin requires read access to the account list for the role-management
UI (account selection in journal entries) even though they cannot access
journal entries themselves.  Admin has no account write access.  The app-layer
checks and the DB-level RLS policy for accounts mirror each other.
"""
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.auth.dependencies import CurrentUser, get_current_user
from app.auth.policies import require_account_read, require_account_write
from app.database import get_db
from app.pagination import build_page
from app.account_rules import cycle_exists
from app.models import Account, AuditLog, JournalEntry, Tenant
from app.schemas import AccountCreate, AccountOut, AccountPage, AccountTreeNode, AccountUpdate, JournalEntryOut

router = APIRouter(prefix="/tenants/{tenant_id}/accounts", tags=["accounts"])


def _parent_of(db: Session):
    """Return a parent_of callable backed by the live DB for use with cycle_exists."""
    def _lookup(uid):
        return db.query(Account.parent_account_id).filter(Account.id == uid).scalar()
    return _lookup


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
    search: Optional[str] = Query(None, min_length=1, max_length=100),
    current: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_account_read(current, tenant_id)
    q = db.query(Account).filter(Account.tenant_id == tenant_id, Account.deleted_at.is_(None))
    if active_only:
        q = q.filter(Account.is_active == True)
    if account_type:
        q = q.filter(Account.account_type == account_type)
    if search:
        pattern = f"%{search.strip()}%"
        q = q.filter(or_(
            Account.account_number.ilike(pattern),
            Account.name.ilike(pattern),
            Account.description.ilike(pattern),
        ))
    return build_page(AccountPage, q.order_by(Account.account_number), skip, limit)


@router.get("/tree", response_model=List[AccountTreeNode])
def get_accounts_tree(
    tenant_id: uuid.UUID,
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
    all_accts = q.order_by(Account.account_number).all()

    nodes = {a.id: AccountTreeNode(
        id=a.id,
        account_number=a.account_number,
        name=a.name,
        account_type=a.account_type,
        description=a.description,
        is_active=a.is_active,
    ) for a in all_accts}
    roots: List[AccountTreeNode] = []
    for a in all_accts:
        node = nodes[a.id]
        if a.parent_account_id and a.parent_account_id in nodes:
            nodes[a.parent_account_id].children.append(node)
        else:
            roots.append(node)
    return roots


@router.post("", response_model=AccountOut, status_code=status.HTTP_201_CREATED)
def create_account(
    tenant_id: uuid.UUID,
    body: AccountCreate,
    current: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_account_write(current, tenant_id)
    _tenant = db.query(Tenant).filter(Tenant.id == tenant_id, Tenant.deleted_at.is_(None)).first()
    if not _tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found")
    if not _tenant.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant is inactive")
    if db.query(Account).filter(
        Account.tenant_id == tenant_id,
        Account.account_number == body.account_number,
        Account.deleted_at.is_(None),
    ).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Account number already exists")

    if body.parent_account_id is not None:
        parent = db.query(Account).filter(
            Account.id == body.parent_account_id,
            Account.tenant_id == tenant_id,
            Account.deleted_at.is_(None),
        ).first()
        if not parent:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="parent_account_id must belong to the same tenant",
            )

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
    old = {"name": acct.name, "description": acct.description, "is_active": acct.is_active,
           "parent_account_id": str(acct.parent_account_id) if acct.parent_account_id else None}
    if body.name is not None:
        acct.name = body.name
    if body.description is not None:
        acct.description = body.description
    if "parent_account_id" in body.model_fields_set:
        new_parent = body.parent_account_id
        if new_parent is not None:
            parent = db.query(Account).filter(
                Account.id == new_parent,
                Account.tenant_id == tenant_id,
                Account.deleted_at.is_(None),
            ).first()
            if not parent:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="parent_account_id must belong to the same tenant",
                )
            if cycle_exists(account_id, new_parent, _parent_of(db)):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="parent_account_id would create a circular reference in the account hierarchy",
                )
        acct.parent_account_id = new_parent
    if body.is_active is not None:
        if body.is_active is False and acct.is_active:
            blocking = db.query(JournalEntry).filter(
                JournalEntry.tenant_id == tenant_id,
                JournalEntry.deleted_at.is_(None),
                JournalEntry.status.in_(("draft", "pending_approval", "approved")),
                or_(
                    JournalEntry.main_account_id == account_id,
                    JournalEntry.contra_account_id == account_id,
                ),
            ).first()
            if blocking:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=(
                        f"Cannot deactivate account: journal entry "
                        f"{blocking.entry_number} references it and is in '{blocking.status}' status"
                    ),
                )
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


@router.get("/{account_id}/ledger", response_model=List[JournalEntryOut])
def get_account_ledger(
    tenant_id: uuid.UUID,
    account_id: uuid.UUID,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    current: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_account_read(current, tenant_id)
    acct = db.query(Account).filter(
        Account.id == account_id, Account.tenant_id == tenant_id, Account.deleted_at.is_(None)
    ).first()
    if not acct:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")
    return (
        db.query(JournalEntry)
        .filter(
            JournalEntry.tenant_id == tenant_id,
            JournalEntry.status == "posted",
            JournalEntry.deleted_at.is_(None),
            or_(
                JournalEntry.main_account_id == account_id,
                JournalEntry.contra_account_id == account_id,
            ),
        )
        .order_by(JournalEntry.entry_date.desc(), JournalEntry.entry_number.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )


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
