"""
Pydantic request/response schemas.
"""
import uuid
from datetime import datetime, date
from decimal import Decimal
from typing import Optional, List

from pydantic import BaseModel, EmailStr, field_validator, model_validator


# ------------------------------------------------------------------
# Auth
# ------------------------------------------------------------------

class LoginRequest(BaseModel):
    username: str
    password: str

class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"

class RefreshRequest(BaseModel):
    refresh_token: str

class TokenPayload(BaseModel):
    sub: str           # user_id
    username: str
    roles: List[dict]  # [{"role": "PowerAdmin", "scope": "global"}, ...]
    exp: int

# ------------------------------------------------------------------
# Tenant
# ------------------------------------------------------------------

class TenantCreate(BaseModel):
    name: str
    description: Optional[str] = None

class TenantOut(BaseModel):
    id: uuid.UUID
    name: str
    description: Optional[str]
    is_active: bool
    created_at: datetime
    model_config = {"from_attributes": True}

# ------------------------------------------------------------------
# User
# ------------------------------------------------------------------

class UserCreate(BaseModel):
    username: str
    email: EmailStr
    password: str
    full_name: Optional[str] = None

    @field_validator("password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        return v

class UserOut(BaseModel):
    id: uuid.UUID
    username: str
    email: str
    full_name: Optional[str]
    is_active: bool
    created_at: datetime
    model_config = {"from_attributes": True}

class UserUpdate(BaseModel):
    email: Optional[EmailStr] = None
    full_name: Optional[str] = None
    is_active: Optional[bool] = None

# ------------------------------------------------------------------
# Role
# ------------------------------------------------------------------

class RoleOut(BaseModel):
    id: uuid.UUID
    name: str
    scope: str
    description: Optional[str]
    model_config = {"from_attributes": True}

# ------------------------------------------------------------------
# Role Assignment
# ------------------------------------------------------------------

class RoleAssignmentCreate(BaseModel):
    user_id: uuid.UUID
    role_name: str
    tenant_id: Optional[uuid.UUID] = None    # required for tenant-scoped roles
    valid_from: Optional[datetime] = None
    valid_until: Optional[datetime] = None
    notes: Optional[str] = None

class RoleAssignmentExtend(BaseModel):
    valid_until: datetime
    notes: Optional[str] = None

class RoleAssignmentRevoke(BaseModel):
    revoke_reason: Optional[str] = None

class RoleAssignmentOut(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    username: Optional[str] = None
    role_id: uuid.UUID
    role_name: Optional[str] = None
    role_scope: Optional[str] = None
    tenant_id: Optional[uuid.UUID]
    tenant_name: Optional[str] = None
    valid_from: datetime
    valid_until: Optional[datetime]
    is_active: bool
    assigned_at: datetime
    model_config = {"from_attributes": True}

# ------------------------------------------------------------------
# Account
# ------------------------------------------------------------------

class AccountCreate(BaseModel):
    account_number: str
    name: str
    account_type: str
    parent_account_id: Optional[uuid.UUID] = None
    description: Optional[str] = None

    @field_validator("account_type")
    @classmethod
    def valid_type(cls, v: str) -> str:
        if v not in ("asset", "liability", "equity", "revenue", "expense"):
            raise ValueError("Invalid account_type")
        return v

class AccountUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None

class AccountOut(BaseModel):
    id: uuid.UUID
    tenant_id: uuid.UUID
    account_number: str
    name: str
    account_type: str
    parent_account_id: Optional[uuid.UUID]
    description: Optional[str]
    is_active: bool
    created_at: datetime
    model_config = {"from_attributes": True}

# ------------------------------------------------------------------
# Journal Entry Line
# ------------------------------------------------------------------

class JournalEntryLineCreate(BaseModel):
    line_number: int
    account_id: uuid.UUID
    debit_credit: str
    amount: Decimal
    description: Optional[str] = None

    @field_validator("debit_credit")
    @classmethod
    def valid_dc(cls, v: str) -> str:
        if v not in ("debit", "credit"):
            raise ValueError("debit_credit must be 'debit' or 'credit'")
        return v

    @field_validator("amount")
    @classmethod
    def positive_amount(cls, v: Decimal) -> Decimal:
        if v <= 0:
            raise ValueError("amount must be positive")
        return v

class JournalEntryLineOut(BaseModel):
    id: uuid.UUID
    line_number: int
    account_id: uuid.UUID
    debit_credit: str
    amount: Decimal
    description: Optional[str]
    model_config = {"from_attributes": True}

# ------------------------------------------------------------------
# Journal Entry
# ------------------------------------------------------------------

class JournalEntryCreate(BaseModel):
    entry_date: date
    description: str
    main_account_id: uuid.UUID
    contra_account_id: uuid.UUID
    amount: Decimal
    requires_approval: bool = False
    reference: Optional[str] = None
    notes: Optional[str] = None
    lines: Optional[List[JournalEntryLineCreate]] = None

    @field_validator("amount")
    @classmethod
    def positive_amount(cls, v: Decimal) -> Decimal:
        if v <= 0:
            raise ValueError("amount must be positive")
        return v

class JournalEntryUpdate(BaseModel):
    entry_date: Optional[date] = None
    description: Optional[str] = None
    main_account_id: Optional[uuid.UUID] = None
    contra_account_id: Optional[uuid.UUID] = None
    amount: Optional[Decimal] = None
    reference: Optional[str] = None
    notes: Optional[str] = None

class JournalEntryApprove(BaseModel):
    notes: Optional[str] = None

class JournalEntryReject(BaseModel):
    rejection_reason: str

class JournalEntryOut(BaseModel):
    id: uuid.UUID
    tenant_id: uuid.UUID
    entry_number: str
    entry_date: date
    description: str
    status: str
    requires_approval: bool
    main_account_id: uuid.UUID
    contra_account_id: uuid.UUID
    amount: Decimal
    reference: Optional[str]
    notes: Optional[str]
    created_at: datetime
    created_by: uuid.UUID
    modified_at: Optional[datetime]
    approved_at: Optional[datetime]
    approved_by: Optional[uuid.UUID]
    rejected_at: Optional[datetime]
    rejection_reason: Optional[str]
    posted_at: Optional[datetime]
    deleted_at: Optional[datetime]
    lines: List[JournalEntryLineOut] = []
    model_config = {"from_attributes": True}

# ------------------------------------------------------------------
# Audit Log
# ------------------------------------------------------------------

class AuditLogOut(BaseModel):
    id: uuid.UUID
    occurred_at: datetime
    user_id: Optional[uuid.UUID]
    tenant_id: Optional[uuid.UUID]
    action: str
    table_name: Optional[str]
    record_id: Optional[uuid.UUID]
    old_values: Optional[dict]
    new_values: Optional[dict]
    notes: Optional[str]
    model_config = {"from_attributes": True}

# ------------------------------------------------------------------
# Pagination wrapper
# ------------------------------------------------------------------

class Page(BaseModel):
    total: int
    skip: int
    limit: int
    items: list


class AccountPage(Page):
    items: List[AccountOut]


class AuditLogPage(Page):
    items: List[AuditLogOut]


class JournalEntryPage(Page):
    items: List[JournalEntryOut]


class RoleAssignmentPage(Page):
    items: List[RoleAssignmentOut]


class RolePage(Page):
    items: List[RoleOut]


class TenantPage(Page):
    items: List[TenantOut]


class UserPage(Page):
    items: List[UserOut]
