"""
Tenant management.
Only PowerAdmin may create tenants or list all tenants.
"""
import uuid
from datetime import date
from decimal import Decimal
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.auth.dependencies import CurrentUser, get_current_user
from app.auth.policies import require_power_admin, require_journal_read
from app.database import get_db
from app.pagination import build_page
from app.models import Account, AuditLog, JournalEntry, JournalEntryLine, Role, Tenant, User, UserRoleAssignment
from app.schemas import (
    TenantCreate, TenantOut, TenantPage, TenantSummary, TenantUpdate,
    TrialBalanceRow, IncomeStatementOut, IncomeStatementRow,
    BalanceSheetOut, BalanceSheetRow,
)

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
        .order_by(Tenant.created_at.desc())
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
    return build_page(TenantPage, q.order_by(Tenant.created_at.desc()), skip, limit)


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


@router.get("/{tenant_id}/summary", response_model=TenantSummary)
def get_tenant_summary(
    tenant_id: uuid.UUID,
    current: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_journal_read(current, tenant_id)
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id, Tenant.deleted_at.is_(None)).first()
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found")
    total_accounts = db.query(Account).filter(
        Account.tenant_id == tenant_id, Account.deleted_at.is_(None)
    ).count()
    entries_by_status = {}
    for s in ("draft", "pending_approval", "approved", "rejected", "posted"):
        entries_by_status[s] = db.query(JournalEntry).filter(
            JournalEntry.tenant_id == tenant_id,
            JournalEntry.status == s,
            JournalEntry.deleted_at.is_(None),
        ).count()
    posted_amount = db.query(func.sum(JournalEntry.amount)).filter(
        JournalEntry.tenant_id == tenant_id,
        JournalEntry.status == "posted",
        JournalEntry.deleted_at.is_(None),
    ).scalar() or Decimal("0")
    return TenantSummary(
        total_accounts=total_accounts,
        entries_by_status=entries_by_status,
        posted_amount=posted_amount,
    )


@router.patch("/{tenant_id}", response_model=TenantOut)
def update_tenant(
    tenant_id: uuid.UUID,
    body: TenantUpdate,
    current: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from datetime import datetime, timezone
    require_power_admin(current)
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id, Tenant.deleted_at.is_(None)).first()
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found")
    old = {"name": tenant.name, "description": tenant.description}
    if body.name is not None:
        clash = db.query(Tenant).filter(
            Tenant.name == body.name,
            Tenant.id != tenant_id,
            Tenant.deleted_at.is_(None),
        ).first()
        if clash:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Tenant name already exists")
        tenant.name = body.name
    if body.description is not None:
        tenant.description = body.description
    db.add(AuditLog(
        user_id=current.id,
        tenant_id=tenant_id,
        action="UPDATE",
        table_name="tenants",
        record_id=tenant_id,
        old_values=old,
        new_values=body.model_dump(exclude_none=True),
    ))
    db.commit()
    db.refresh(tenant)
    return tenant


@router.get("/{tenant_id}/trial-balance", response_model=List[TrialBalanceRow])
def get_trial_balance(
    tenant_id: uuid.UUID,
    as_of_date: Optional[date] = Query(None),
    current: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_journal_read(current, tenant_id)
    accounts = (
        db.query(Account)
        .filter(Account.tenant_id == tenant_id, Account.deleted_at.is_(None))
        .order_by(Account.account_number)
        .all()
    )
    rows = []
    for acct in accounts:
        posted_filter = [
            JournalEntry.tenant_id == tenant_id,
            JournalEntry.status == "posted",
            JournalEntry.deleted_at.is_(None),
        ]
        if as_of_date:
            posted_filter.append(JournalEntry.entry_date <= as_of_date)
        hdr_debit = (
            db.query(func.sum(JournalEntry.amount))
            .filter(*posted_filter, JournalEntry.main_account_id == acct.id)
            .scalar() or Decimal("0")
        )
        hdr_credit = (
            db.query(func.sum(JournalEntry.amount))
            .filter(*posted_filter, JournalEntry.contra_account_id == acct.id)
            .scalar() or Decimal("0")
        )
        line_debit = (
            db.query(func.sum(JournalEntryLine.amount))
            .join(JournalEntry, JournalEntry.id == JournalEntryLine.journal_entry_id)
            .filter(
                *posted_filter,
                JournalEntryLine.account_id == acct.id,
                JournalEntryLine.debit_credit == "debit",
                JournalEntryLine.deleted_at.is_(None),
            )
            .scalar() or Decimal("0")
        )
        line_credit = (
            db.query(func.sum(JournalEntryLine.amount))
            .join(JournalEntry, JournalEntry.id == JournalEntryLine.journal_entry_id)
            .filter(
                *posted_filter,
                JournalEntryLine.account_id == acct.id,
                JournalEntryLine.debit_credit == "credit",
                JournalEntryLine.deleted_at.is_(None),
            )
            .scalar() or Decimal("0")
        )
        debit_total = hdr_debit + line_debit
        credit_total = hdr_credit + line_credit
        rows.append(TrialBalanceRow(
            account_id=acct.id,
            account_number=acct.account_number,
            name=acct.name,
            account_type=acct.account_type,
            debit_total=debit_total,
            credit_total=credit_total,
            net=debit_total - credit_total,
        ))
    return rows


@router.get("/{tenant_id}/income-statement", response_model=IncomeStatementOut)
def get_income_statement(
    tenant_id: uuid.UUID,
    as_of_date: Optional[date] = Query(None),
    from_date: Optional[date] = Query(None),
    current: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_journal_read(current, tenant_id)
    accounts = (
        db.query(Account)
        .filter(
            Account.tenant_id == tenant_id,
            Account.deleted_at.is_(None),
            Account.account_type.in_(["revenue", "expense"]),
        )
        .order_by(Account.account_number)
        .all()
    )
    posted_filter = [
        JournalEntry.tenant_id == tenant_id,
        JournalEntry.status == "posted",
        JournalEntry.deleted_at.is_(None),
    ]
    if from_date:
        posted_filter.append(JournalEntry.entry_date >= from_date)
    if as_of_date:
        posted_filter.append(JournalEntry.entry_date <= as_of_date)
    revenue_rows, expense_rows = [], []
    for acct in accounts:
        hdr_debit = (
            db.query(func.sum(JournalEntry.amount))
            .filter(*posted_filter, JournalEntry.main_account_id == acct.id)
            .scalar() or Decimal("0")
        )
        hdr_credit = (
            db.query(func.sum(JournalEntry.amount))
            .filter(*posted_filter, JournalEntry.contra_account_id == acct.id)
            .scalar() or Decimal("0")
        )
        line_debit = (
            db.query(func.sum(JournalEntryLine.amount))
            .join(JournalEntry, JournalEntry.id == JournalEntryLine.journal_entry_id)
            .filter(
                *posted_filter,
                JournalEntryLine.account_id == acct.id,
                JournalEntryLine.debit_credit == "debit",
                JournalEntryLine.deleted_at.is_(None),
            )
            .scalar() or Decimal("0")
        )
        line_credit = (
            db.query(func.sum(JournalEntryLine.amount))
            .join(JournalEntry, JournalEntry.id == JournalEntryLine.journal_entry_id)
            .filter(
                *posted_filter,
                JournalEntryLine.account_id == acct.id,
                JournalEntryLine.debit_credit == "credit",
                JournalEntryLine.deleted_at.is_(None),
            )
            .scalar() or Decimal("0")
        )
        debit_total = hdr_debit + line_debit
        credit_total = hdr_credit + line_credit
        # Revenue accounts are credit-normal; expenses are debit-normal.
        net = (credit_total - debit_total) if acct.account_type == "revenue" else (debit_total - credit_total)
        row = IncomeStatementRow(
            account_id=acct.id,
            account_number=acct.account_number,
            name=acct.name,
            account_type=acct.account_type,
            debit_total=debit_total,
            credit_total=credit_total,
            net=net,
        )
        if acct.account_type == "revenue":
            revenue_rows.append(row)
        else:
            expense_rows.append(row)
    total_revenue = sum(r.net for r in revenue_rows)
    total_expenses = sum(r.net for r in expense_rows)
    return IncomeStatementOut(
        revenue=revenue_rows,
        expense=expense_rows,
        net_income=total_revenue - total_expenses,
    )


@router.get("/{tenant_id}/balance-sheet", response_model=BalanceSheetOut)
def get_balance_sheet(
    tenant_id: uuid.UUID,
    as_of_date: Optional[date] = Query(None),
    current: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_journal_read(current, tenant_id)
    accounts = (
        db.query(Account)
        .filter(
            Account.tenant_id == tenant_id,
            Account.deleted_at.is_(None),
            Account.account_type.in_(["asset", "liability", "equity"]),
        )
        .order_by(Account.account_number)
        .all()
    )
    posted_filter = [
        JournalEntry.tenant_id == tenant_id,
        JournalEntry.status == "posted",
        JournalEntry.deleted_at.is_(None),
    ]
    if as_of_date:
        posted_filter.append(JournalEntry.entry_date <= as_of_date)

    asset_rows, liability_rows, equity_rows = [], [], []
    for acct in accounts:
        hdr_debit = (
            db.query(func.sum(JournalEntry.amount))
            .filter(*posted_filter, JournalEntry.main_account_id == acct.id)
            .scalar() or Decimal("0")
        )
        hdr_credit = (
            db.query(func.sum(JournalEntry.amount))
            .filter(*posted_filter, JournalEntry.contra_account_id == acct.id)
            .scalar() or Decimal("0")
        )
        line_debit = (
            db.query(func.sum(JournalEntryLine.amount))
            .join(JournalEntry, JournalEntry.id == JournalEntryLine.journal_entry_id)
            .filter(
                *posted_filter,
                JournalEntryLine.account_id == acct.id,
                JournalEntryLine.debit_credit == "debit",
                JournalEntryLine.deleted_at.is_(None),
            )
            .scalar() or Decimal("0")
        )
        line_credit = (
            db.query(func.sum(JournalEntryLine.amount))
            .join(JournalEntry, JournalEntry.id == JournalEntryLine.journal_entry_id)
            .filter(
                *posted_filter,
                JournalEntryLine.account_id == acct.id,
                JournalEntryLine.debit_credit == "credit",
                JournalEntryLine.deleted_at.is_(None),
            )
            .scalar() or Decimal("0")
        )
        debit_total = hdr_debit + line_debit
        credit_total = hdr_credit + line_credit
        # Assets are debit-normal; liabilities and equity are credit-normal.
        net = (debit_total - credit_total) if acct.account_type == "asset" else (credit_total - debit_total)
        row = BalanceSheetRow(
            account_id=acct.id,
            account_number=acct.account_number,
            name=acct.name,
            account_type=acct.account_type,
            debit_total=debit_total,
            credit_total=credit_total,
            net=net,
        )
        if acct.account_type == "asset":
            asset_rows.append(row)
        elif acct.account_type == "liability":
            liability_rows.append(row)
        else:
            equity_rows.append(row)

    total_assets = sum(r.net for r in asset_rows)
    total_liabilities = sum(r.net for r in liability_rows)
    total_equity = sum(r.net for r in equity_rows)
    return BalanceSheetOut(
        assets=asset_rows,
        liabilities=liability_rows,
        equity=equity_rows,
        total_assets=total_assets,
        total_liabilities=total_liabilities,
        total_equity=total_equity,
    )


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
