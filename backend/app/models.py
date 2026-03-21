"""
SQLAlchemy ORM models for the multi-tenant accounting system.
All tables use soft deletes (deleted_at / deleted_by).
"""
import uuid
from datetime import datetime, date
from decimal import Decimal
from typing import Optional, List

from sqlalchemy import (
    Boolean, Date, DateTime, ForeignKey, Index, Integer,
    Numeric, String, Text, UniqueConstraint, Enum as SAEnum
)
from sqlalchemy.dialects.postgresql import UUID, JSONB, INET
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.database import Base

# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------

def new_uuid() -> uuid.UUID:
    return uuid.uuid4()


# ------------------------------------------------------------------
# Tenant
# ------------------------------------------------------------------

class Tenant(Base):
    __tablename__ = "tenants"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    name: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    description: Mapped[Optional[str]] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    created_by: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    deleted_by: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))

    role_assignments: Mapped[List["UserRoleAssignment"]] = relationship(
        back_populates="tenant", foreign_keys="UserRoleAssignment.tenant_id"
    )
    accounts: Mapped[List["Account"]] = relationship(back_populates="tenant")
    journal_entries: Mapped[List["JournalEntry"]] = relationship(back_populates="tenant")


# ------------------------------------------------------------------
# User
# ------------------------------------------------------------------

class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    username: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)
    email: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[Optional[str]] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    created_by: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    deleted_by: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))

    role_assignments: Mapped[List["UserRoleAssignment"]] = relationship(
        back_populates="user", foreign_keys="UserRoleAssignment.user_id"
    )


# ------------------------------------------------------------------
# Role
# ------------------------------------------------------------------

class Role(Base):
    __tablename__ = "roles"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    name: Mapped[str] = mapped_column(String(50), nullable=False, unique=True)
    scope: Mapped[str] = mapped_column(SAEnum("tenant", "global", name="role_scope"), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    assignments: Mapped[List["UserRoleAssignment"]] = relationship(back_populates="role")


# ------------------------------------------------------------------
# UserRoleAssignment  (phase-based)
# ------------------------------------------------------------------

class UserRoleAssignment(Base):
    __tablename__ = "user_role_assignments"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)

    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    role_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("roles.id"), nullable=False)
    tenant_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id"))

    valid_from: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    valid_until: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    assigned_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    assigned_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    extended_by: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    extended_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    previous_valid_until: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    revoked_by: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    revoked_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    revoke_reason: Mapped[Optional[str]] = mapped_column(Text)

    notes: Mapped[Optional[str]] = mapped_column(Text)

    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    deleted_by: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))

    user: Mapped["User"] = relationship(back_populates="role_assignments", foreign_keys=[user_id])
    role: Mapped["Role"] = relationship(back_populates="assignments", foreign_keys=[role_id])
    tenant: Mapped[Optional["Tenant"]] = relationship(back_populates="role_assignments", foreign_keys=[tenant_id])

    __table_args__ = (
        Index("idx_ura_user", "user_id"),
        Index("idx_ura_tenant", "tenant_id"),
        Index("idx_ura_active_phase", "user_id", "tenant_id", "is_active", "valid_from", "valid_until"),
    )


# ------------------------------------------------------------------
# Account  (Chart of Accounts)
# ------------------------------------------------------------------

class Account(Base):
    __tablename__ = "accounts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    account_number: Mapped[str] = mapped_column(String(20), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    account_type: Mapped[str] = mapped_column(
        SAEnum("asset", "liability", "equity", "revenue", "expense", name="account_type"),
        nullable=False
    )
    parent_account_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("accounts.id"))
    description: Mapped[Optional[str]] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    created_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    modified_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    modified_by: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    deleted_by: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))

    tenant: Mapped["Tenant"] = relationship(back_populates="accounts", foreign_keys=[tenant_id])

    __table_args__ = (
        UniqueConstraint("tenant_id", "account_number", name="uq_account_number_per_tenant"),
        Index("idx_accounts_tenant", "tenant_id"),
    )


# ------------------------------------------------------------------
# JournalEntry
# ------------------------------------------------------------------

class JournalEntry(Base):
    __tablename__ = "journal_entries"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    entry_number: Mapped[str] = mapped_column(String(50), nullable=False)
    entry_date: Mapped[date] = mapped_column(Date, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(
        SAEnum("draft", "pending_approval", "approved", "rejected", "posted", name="entry_status"),
        nullable=False,
        default="draft"
    )
    requires_approval: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    main_account_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("accounts.id"), nullable=False)
    contra_account_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("accounts.id"), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    reference: Mapped[Optional[str]] = mapped_column(String(255))
    notes: Mapped[Optional[str]] = mapped_column(Text)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    created_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    modified_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    modified_by: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))

    submitted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    submitted_by: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    approved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    approved_by: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    rejected_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    rejected_by: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    rejection_reason: Mapped[Optional[str]] = mapped_column(Text)
    posted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    posted_by: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))

    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    deleted_by: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))

    tenant: Mapped["Tenant"] = relationship(back_populates="journal_entries", foreign_keys=[tenant_id])
    main_account: Mapped["Account"] = relationship(foreign_keys=[main_account_id])
    contra_account: Mapped["Account"] = relationship(foreign_keys=[contra_account_id])
    lines: Mapped[List["JournalEntryLine"]] = relationship(back_populates="journal_entry")

    __table_args__ = (
        UniqueConstraint("tenant_id", "entry_number", name="uq_entry_number_per_tenant"),
        Index("idx_je_tenant", "tenant_id"),
        Index("idx_je_date", "tenant_id", "entry_date"),
        Index("idx_je_status", "tenant_id", "status"),
    )


# ------------------------------------------------------------------
# JournalEntryLine
# ------------------------------------------------------------------

class JournalEntryLine(Base):
    __tablename__ = "journal_entry_lines"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    journal_entry_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("journal_entries.id"), nullable=False
    )
    line_number: Mapped[int] = mapped_column(Integer, nullable=False)
    account_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("accounts.id"), nullable=False)
    debit_credit: Mapped[str] = mapped_column(
        SAEnum("debit", "credit", name="debit_credit"), nullable=False
    )
    amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text)
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    deleted_by: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))

    journal_entry: Mapped["JournalEntry"] = relationship(back_populates="lines")

    __table_args__ = (
        UniqueConstraint("journal_entry_id", "line_number", name="uq_line_per_entry"),
        Index("idx_jel_entry", "journal_entry_id"),
    )


# ------------------------------------------------------------------
# AuditLog  (append-only)
# ------------------------------------------------------------------

class AuditLog(Base):
    __tablename__ = "audit_log"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    user_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    tenant_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id"))
    action: Mapped[str] = mapped_column(
        SAEnum(
            "INSERT", "UPDATE", "SOFT_DELETE", "LOGIN", "LOGOUT",
            "APPROVE", "REJECT", "ROLE_ASSIGN", "ROLE_REVOKE",
            "TENANT_CREATE", "PHASE_EXTEND",
            name="audit_action"
        ),
        nullable=False
    )
    table_name: Mapped[Optional[str]] = mapped_column(String(100))
    record_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True))
    old_values: Mapped[Optional[dict]] = mapped_column(JSONB)
    new_values: Mapped[Optional[dict]] = mapped_column(JSONB)
    ip_address: Mapped[Optional[str]] = mapped_column(String(45))
    user_agent: Mapped[Optional[str]] = mapped_column(Text)
    session_id: Mapped[Optional[str]] = mapped_column(String(255))
    notes: Mapped[Optional[str]] = mapped_column(Text)

    __table_args__ = (
        Index("idx_audit_time", "occurred_at"),
        Index("idx_audit_user", "user_id"),
        Index("idx_audit_tenant", "tenant_id"),
        Index("idx_audit_record", "table_name", "record_id"),
    )
