"""
Journal entry (Buchung) management.

Permission matrix:
  Reader     : GET (list/detail)
  Writer     : GET + POST + PATCH own entries (status=draft only)
  PowerUser  : GET + POST + PATCH any entry (status=draft/pending_approval)
  Approver   : POST /approve or /reject on pending_approval entries
  Officer    : GET only (read-only for assigned tenants)
  Admin      : no booking access at all
  Auditor    : GET all (across tenants, no tenant filter enforced)
  PowerAdmin : no booking access
"""
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_, text
from sqlalchemy.orm import Session

from app.auth.dependencies import CurrentUser, get_current_user
from app.auth.policies import (
    require_journal_approver,
    require_journal_power_user,
    require_journal_read,
    require_journal_writer,
)
from app.database import get_db
from app.pagination import build_page
from app.journal_workflow import can_reverse, lines_balance_error, postable_error
from app.models import Account, AuditLog, JournalEntry, JournalEntryLine
from app.schemas import (
    JournalEntryApprove, JournalEntryCreate, JournalEntryOut,
    JournalEntryPage, JournalEntryReject, JournalEntryUpdate,
    ReversalResponse,
)

router = APIRouter(prefix="/tenants/{tenant_id}/journal", tags=["journal"])


def _get_entry(db: Session, tenant_id: uuid.UUID, entry_id: uuid.UUID) -> JournalEntry:
    entry = db.query(JournalEntry).filter(
        JournalEntry.id == entry_id,
        JournalEntry.tenant_id == tenant_id,
        JournalEntry.deleted_at.is_(None),
    ).first()
    if not entry:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Journal entry not found")
    return entry


def _next_entry_number(db: Session, tenant_id: uuid.UUID) -> str:
    """
    Generate a sequential entry number per tenant: YYYYNNNNN.

    Two concurrent creates could otherwise read the same max and generate the
    same number (the UNIQUE (tenant_id, entry_number) constraint would reject
    the loser with a 409).  A transaction-scoped advisory lock keyed on the
    tenant serializes the read-then-insert window per tenant; the lock is held
    until this transaction commits or rolls back, so the next waiter sees the
    just-inserted row.  hashtext() maps the key to the bigint pg_advisory_xact_lock
    expects.
    """
    db.execute(
        text("SELECT pg_advisory_xact_lock(hashtext(:k))"),
        {"k": f"journal_entry_number:{tenant_id}"},
    )
    year = datetime.now(timezone.utc).year
    prefix = str(year)
    last = (
        db.query(JournalEntry)
        .filter(
            JournalEntry.tenant_id == tenant_id,
            JournalEntry.entry_number.like(f"{prefix}%"),
        )
        .order_by(JournalEntry.entry_number.desc())
        .first()
    )
    seq = int(last.entry_number[4:]) + 1 if last else 1
    return f"{prefix}{seq:05d}"


def _entry_list_query(
    db: Session,
    tenant_id: uuid.UUID,
    entry_status: Optional[str],
    from_date: Optional[str],
    to_date: Optional[str],
    search: Optional[str],
):
    q = db.query(JournalEntry).filter(
        JournalEntry.tenant_id == tenant_id,
        JournalEntry.deleted_at.is_(None),
    )
    if entry_status:
        q = q.filter(JournalEntry.status == entry_status)
    if from_date:
        q = q.filter(JournalEntry.entry_date >= from_date)
    if to_date:
        q = q.filter(JournalEntry.entry_date <= to_date)
    if search:
        pattern = f"%{search.strip()}%"
        q = q.filter(or_(
            JournalEntry.entry_number.ilike(pattern),
            JournalEntry.description.ilike(pattern),
            JournalEntry.reference.ilike(pattern),
            JournalEntry.notes.ilike(pattern),
        ))
    return q


@router.get("", response_model=List[JournalEntryOut])
def list_entries(
    tenant_id: uuid.UUID,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    entry_status: Optional[str] = Query(None, alias="status"),
    from_date: Optional[str] = Query(None),
    to_date: Optional[str] = Query(None),
    search: Optional[str] = Query(None, min_length=1, max_length=100),
    current: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_journal_read(current, tenant_id)
    q = _entry_list_query(db, tenant_id, entry_status, from_date, to_date, search)
    return q.order_by(JournalEntry.entry_number.desc()).offset(skip).limit(limit).all()


@router.get("/page", response_model=JournalEntryPage)
def list_entries_page(
    tenant_id: uuid.UUID,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    entry_status: Optional[str] = Query(None, alias="status"),
    from_date: Optional[str] = Query(None),
    to_date: Optional[str] = Query(None),
    search: Optional[str] = Query(None, min_length=1, max_length=100),
    current: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_journal_read(current, tenant_id)
    q = _entry_list_query(db, tenant_id, entry_status, from_date, to_date, search)
    return build_page(JournalEntryPage, q.order_by(JournalEntry.entry_number.desc()), skip, limit)


@router.post("", response_model=JournalEntryOut, status_code=status.HTTP_201_CREATED)
def create_entry(
    tenant_id: uuid.UUID,
    body: JournalEntryCreate,
    current: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_journal_writer(current, tenant_id)

    balance_err = lines_balance_error(body.lines)
    if balance_err:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=balance_err)

    for acc_id in (body.main_account_id, body.contra_account_id):
        acc = db.query(Account).filter(
            Account.id == acc_id,
            Account.tenant_id == tenant_id,
            Account.deleted_at.is_(None),
            Account.is_active == True,
        ).first()
        if not acc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Account {acc_id} not found or inactive in this tenant",
            )

    entry = JournalEntry(
        tenant_id=tenant_id,
        entry_number=_next_entry_number(db, tenant_id),
        entry_date=body.entry_date,
        description=body.description,
        status="pending_approval" if body.requires_approval else "draft",
        requires_approval=body.requires_approval,
        main_account_id=body.main_account_id,
        contra_account_id=body.contra_account_id,
        amount=body.amount,
        reference=body.reference,
        notes=body.notes,
        created_by=current.id,
    )
    if body.requires_approval:
        entry.submitted_at = datetime.now(timezone.utc)
        entry.submitted_by = current.id

    db.add(entry)
    db.flush()

    if body.lines:
        for line_data in body.lines:
            acc = db.query(Account).filter(
                Account.id == line_data.account_id,
                Account.tenant_id == tenant_id,
                Account.deleted_at.is_(None),
                Account.is_active == True,
            ).first()
            if not acc:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Line account {line_data.account_id} not found or inactive",
                )
            db.add(JournalEntryLine(
                journal_entry_id=entry.id,
                line_number=line_data.line_number,
                account_id=line_data.account_id,
                debit_credit=line_data.debit_credit,
                amount=line_data.amount,
                description=line_data.description,
            ))

    db.add(AuditLog(
        user_id=current.id,
        tenant_id=tenant_id,
        action="INSERT",
        table_name="journal_entries",
        record_id=entry.id,
        new_values={
            "entry_number": entry.entry_number,
            "amount": str(entry.amount),
            "status": entry.status,
        },
    ))
    db.commit()
    db.refresh(entry)
    return entry


@router.get("/{entry_id}", response_model=JournalEntryOut)
def get_entry(
    tenant_id: uuid.UUID,
    entry_id: uuid.UUID,
    current: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_journal_read(current, tenant_id)
    return _get_entry(db, tenant_id, entry_id)


@router.patch("/{entry_id}", response_model=JournalEntryOut)
def update_entry(
    tenant_id: uuid.UUID,
    entry_id: uuid.UUID,
    body: JournalEntryUpdate,
    current: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    entry = _get_entry(db, tenant_id, entry_id)

    if entry.status != "draft":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only draft entries can be modified",
        )
    if entry.created_by != current.id and not current.is_power_user(tenant_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="You can only modify your own entries (or be a PowerUser)")

    old = {
        "entry_date": str(entry.entry_date),
        "description": entry.description,
        "amount": str(entry.amount),
    }
    if body.entry_date is not None:
        entry.entry_date = body.entry_date
    if body.description is not None:
        entry.description = body.description
    if body.main_account_id is not None:
        acc = db.query(Account).filter(
            Account.id == body.main_account_id,
            Account.tenant_id == tenant_id,
            Account.deleted_at.is_(None),
            Account.is_active == True,
        ).first()
        if not acc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Account {body.main_account_id} not found or inactive in this tenant",
            )
        entry.main_account_id = body.main_account_id
    if body.contra_account_id is not None:
        acc = db.query(Account).filter(
            Account.id == body.contra_account_id,
            Account.tenant_id == tenant_id,
            Account.deleted_at.is_(None),
            Account.is_active == True,
        ).first()
        if not acc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Account {body.contra_account_id} not found or inactive in this tenant",
            )
        entry.contra_account_id = body.contra_account_id
    if body.amount is not None:
        entry.amount = body.amount
    if body.reference is not None:
        entry.reference = body.reference
    if body.notes is not None:
        entry.notes = body.notes

    entry.modified_at = datetime.now(timezone.utc)
    entry.modified_by = current.id

    db.add(AuditLog(
        user_id=current.id,
        tenant_id=tenant_id,
        action="UPDATE",
        table_name="journal_entries",
        record_id=entry_id,
        old_values=old,
        new_values=body.model_dump(exclude_none=True, mode="json"),
    ))
    db.commit()
    db.refresh(entry)
    return entry


@router.post("/{entry_id}/submit", response_model=JournalEntryOut)
def submit_for_approval(
    tenant_id: uuid.UUID,
    entry_id: uuid.UUID,
    current: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Move a draft entry to pending_approval (triggers four-eyes workflow)."""
    entry = _get_entry(db, tenant_id, entry_id)
    require_journal_writer(current, tenant_id)
    if entry.created_by != current.id and not current.is_power_user(tenant_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot submit another user's entry")
    if entry.status != "draft":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Entry is not in draft status")

    entry.status = "pending_approval"
    entry.requires_approval = True
    entry.submitted_at = datetime.now(timezone.utc)
    entry.submitted_by = current.id
    db.add(AuditLog(
        user_id=current.id, tenant_id=tenant_id, action="UPDATE",
        table_name="journal_entries", record_id=entry_id,
        new_values={"status": "pending_approval"},
    ))
    db.commit()
    db.refresh(entry)
    return entry


@router.post("/{entry_id}/approve", response_model=JournalEntryOut)
def approve_entry(
    tenant_id: uuid.UUID,
    entry_id: uuid.UUID,
    body: JournalEntryApprove,
    current: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_journal_approver(current, tenant_id)
    entry = _get_entry(db, tenant_id, entry_id)
    if entry.status != "pending_approval":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Entry is not pending approval")
    if entry.created_by == current.id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Four-eyes principle: approver must differ from creator",
        )

    now = datetime.now(timezone.utc)
    entry.status = "approved"
    entry.approved_at = now
    entry.approved_by = current.id
    if body.approval_notes:
        entry.approval_notes = body.approval_notes

    db.add(AuditLog(
        user_id=current.id, tenant_id=tenant_id, action="APPROVE",
        table_name="journal_entries", record_id=entry_id,
        new_values={"status": "approved"},
    ))
    db.commit()
    db.refresh(entry)
    return entry


@router.post("/{entry_id}/reject", response_model=JournalEntryOut)
def reject_entry(
    tenant_id: uuid.UUID,
    entry_id: uuid.UUID,
    body: JournalEntryReject,
    current: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_journal_approver(current, tenant_id)
    entry = _get_entry(db, tenant_id, entry_id)
    if entry.status != "pending_approval":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Entry is not pending approval")

    now = datetime.now(timezone.utc)
    entry.status = "rejected"
    entry.rejected_at = now
    entry.rejected_by = current.id
    entry.rejection_reason = body.rejection_reason

    db.add(AuditLog(
        user_id=current.id, tenant_id=tenant_id, action="REJECT",
        table_name="journal_entries", record_id=entry_id,
        new_values={"status": "rejected", "reason": body.rejection_reason},
    ))
    db.commit()
    db.refresh(entry)
    return entry


@router.post("/{entry_id}/post", response_model=JournalEntryOut)
def post_entry(
    tenant_id: uuid.UUID,
    entry_id: uuid.UUID,
    current: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Post an entry (finalise). Requires PowerUser.

    Entries that require approval must be in the 'approved' state first, so the
    four-eyes workflow cannot be bypassed; entries that do not require approval
    may be posted directly from draft.
    """
    require_journal_power_user(current, tenant_id)
    entry = _get_entry(db, tenant_id, entry_id)
    err = postable_error(entry.status, entry.requires_approval)
    if err:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=err)

    entry.status = "posted"
    entry.posted_at = datetime.now(timezone.utc)
    entry.posted_by = current.id

    db.add(AuditLog(
        user_id=current.id, tenant_id=tenant_id, action="UPDATE",
        table_name="journal_entries", record_id=entry_id,
        new_values={"status": "posted"},
    ))
    db.commit()
    db.refresh(entry)
    return entry


@router.post("/{entry_id}/reverse", response_model=ReversalResponse, status_code=status.HTTP_201_CREATED)
def reverse_entry(
    tenant_id: uuid.UUID,
    entry_id: uuid.UUID,
    current: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Create a draft reversal for a posted entry.

    The reversal swaps main and contra accounts (and swaps debit/credit on any
    split lines), so posting it cancels the effect of the original.  The
    original entry is unchanged; the reversal carries a reference back to it.
    Requires PowerUser (same permission as posting).
    """
    require_journal_power_user(current, tenant_id)
    entry = _get_entry(db, tenant_id, entry_id)

    err = can_reverse(entry.status)
    if err:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=err)

    reversal = JournalEntry(
        tenant_id=tenant_id,
        entry_number=_next_entry_number(db, tenant_id),
        entry_date=entry.entry_date,
        description=f"Reversal of {entry.entry_number}",
        status="draft",
        requires_approval=False,
        main_account_id=entry.contra_account_id,
        contra_account_id=entry.main_account_id,
        amount=entry.amount,
        reference=entry.entry_number,
        created_by=current.id,
    )
    db.add(reversal)
    db.flush()

    active_lines = [ln for ln in entry.lines if ln.deleted_at is None]
    for ln in active_lines:
        swapped_dc = "credit" if ln.debit_credit == "debit" else "debit"
        db.add(JournalEntryLine(
            journal_entry_id=reversal.id,
            line_number=ln.line_number,
            account_id=ln.account_id,
            debit_credit=swapped_dc,
            amount=ln.amount,
            description=ln.description,
        ))

    db.add(AuditLog(
        user_id=current.id,
        tenant_id=tenant_id,
        action="INSERT",
        table_name="journal_entries",
        record_id=reversal.id,
        new_values={
            "entry_number": reversal.entry_number,
            "reversal_of": entry.entry_number,
            "amount": str(reversal.amount),
            "status": reversal.status,
        },
    ))
    db.commit()
    db.refresh(reversal)
    return ReversalResponse(
        reversal_entry_id=reversal.id,
        reversal_entry_number=reversal.entry_number,
    )


@router.delete("/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
def soft_delete_entry(
    tenant_id: uuid.UUID,
    entry_id: uuid.UUID,
    current: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    entry = _get_entry(db, tenant_id, entry_id)
    if entry.status == "posted":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Posted entries cannot be deleted")
    if entry.created_by != current.id and not current.is_power_user(tenant_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")

    entry.deleted_at = datetime.now(timezone.utc)
    entry.deleted_by = current.id
    db.add(AuditLog(
        user_id=current.id, tenant_id=tenant_id, action="SOFT_DELETE",
        table_name="journal_entries", record_id=entry_id,
    ))
    db.commit()
