"""
User management.
PowerAdmin can create users.
Admin can list users in their tenant.
"""
import uuid
from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Query, status
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from app.auth.dependencies import CurrentUser, get_current_user
from app.auth.policies import require_power_admin
from app.database import get_db
from app.models import AuditLog, User
from app.schemas import UserCreate, UserOut, UserPage, UserUpdate

router = APIRouter(prefix="/users", tags=["users"])
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


@router.get("", response_model=List[UserOut])
def list_users(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    current: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # PowerAdmin and Auditor see all; others see only themselves
    if current.is_power_admin() or current.is_auditor():
        return (
            db.query(User)
            .filter(User.deleted_at.is_(None))
            .offset(skip).limit(limit).all()
        )
    return [current.user]


@router.get("/page", response_model=UserPage)
def list_users_page(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    current: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current.is_power_admin() or current.is_auditor():
        q = db.query(User).filter(User.deleted_at.is_(None))
        total = q.count()
        items = q.offset(skip).limit(limit).all()
        return UserPage(total=total, skip=skip, limit=limit, items=items)

    items = [current.user] if skip == 0 else []
    return UserPage(total=1, skip=skip, limit=limit, items=items[:limit])


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(
    body: UserCreate,
    current: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_power_admin(current)

    if db.query(User).filter(
        (User.username == body.username) | (User.email == body.email),
        User.deleted_at.is_(None)
    ).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username or email already exists")

    user = User(
        username=body.username,
        email=body.email,
        password_hash=pwd_context.hash(body.password),
        full_name=body.full_name,
        created_by=current.id,
    )
    db.add(user)
    db.flush()
    db.add(AuditLog(
        user_id=current.id,
        action="INSERT",
        table_name="users",
        record_id=user.id,
        new_values={"username": user.username, "email": user.email},
    ))
    db.commit()
    db.refresh(user)
    return user


@router.get("/{user_id}", response_model=UserOut)
def get_user(
    user_id: uuid.UUID,
    current: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not (current.is_power_admin() or current.is_auditor() or current.id == user_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
    user = db.query(User).filter(User.id == user_id, User.deleted_at.is_(None)).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return user


@router.patch("/{user_id}", response_model=UserOut)
def update_user(
    user_id: uuid.UUID,
    body: UserUpdate,
    current: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not (current.is_power_admin() or current.id == user_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
    user = db.query(User).filter(User.id == user_id, User.deleted_at.is_(None)).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    old = {"email": user.email, "full_name": user.full_name, "is_active": user.is_active}
    if body.email is not None:
        user.email = body.email
    if body.full_name is not None:
        user.full_name = body.full_name
    if body.is_active is not None:
        if not current.is_power_admin():
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot change active status")
        user.is_active = body.is_active
        # Deactivating a user revokes their outstanding tokens immediately.
        if body.is_active is False:
            user.tokens_valid_after = datetime.now(timezone.utc)

    db.add(AuditLog(
        user_id=current.id,
        action="UPDATE",
        table_name="users",
        record_id=user_id,
        old_values=old,
        new_values=body.model_dump(exclude_none=True),
    ))
    db.commit()
    db.refresh(user)
    return user


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def soft_delete_user(
    user_id: uuid.UUID,
    current: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_power_admin(current)
    user = db.query(User).filter(User.id == user_id, User.deleted_at.is_(None)).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    now = datetime.now(timezone.utc)
    user.deleted_at = now
    user.deleted_by = current.id
    # Revoke the deleted user's outstanding tokens immediately.
    user.tokens_valid_after = now
    db.add(AuditLog(
        user_id=current.id,
        action="SOFT_DELETE",
        table_name="users",
        record_id=user_id,
    ))
    db.commit()


@router.post("/{user_id}/revoke-tokens", status_code=status.HTTP_200_OK)
def revoke_user_tokens(
    user_id: uuid.UUID,
    current: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Force-logout: invalidate all of a user's outstanding access and refresh
    tokens by advancing their revocation watermark.  PowerAdmin only; the
    recommended action after revoking a sensitive role or during an incident.
    """
    require_power_admin(current)
    user = db.query(User).filter(User.id == user_id, User.deleted_at.is_(None)).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    user.tokens_valid_after = datetime.now(timezone.utc)
    db.add(AuditLog(
        user_id=current.id,
        action="UPDATE",
        table_name="users",
        record_id=user_id,
        notes="Tokens revoked (force-logout)",
    ))
    db.commit()
    return {"detail": "User tokens revoked"}
