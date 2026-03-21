"""
Authentication endpoints: login, refresh, logout.

The login and refresh endpoints operate WITHOUT an authenticated user context
(that is the whole point - we are establishing one).  Before querying the
users table we activate the BYPASS_CONTEXT so that the RLS policies do not
block the lookup.  The bypass is cleared and replaced with the proper user
context immediately after the password is verified.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from jose import JWTError
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from app.auth.dependencies import build_roles_payload, get_current_user, CurrentUser
from app.auth.jwt_handler import create_access_token, create_refresh_token, decode_token
from app.database import get_db
from app.models import AuditLog, User
from app.rls import BYPASS_CONTEXT, build_rls_context, set_rls_context
from app.schemas import LoginRequest, RefreshRequest, TokenResponse, UserOut

router = APIRouter(prefix="/auth", tags=["auth"])

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def _audit(db: Session, user: User, action: str, request: Request, notes: str = ""):
    ip = request.client.host if request.client else None
    ua = request.headers.get("user-agent")
    db.add(AuditLog(
        user_id=user.id,
        action=action,
        ip_address=ip,
        user_agent=ua,
        notes=notes,
    ))


@router.post("/login", response_model=TokenResponse)
def login(body: LoginRequest, request: Request, db: Session = Depends(get_db)):
    # Activate bypass so the RLS after_begin event allows the user lookup.
    # The bypass is intentional here: we need to find the user BEFORE we can
    # build a proper RLS context (chicken-and-egg at authentication time).
    set_rls_context(BYPASS_CONTEXT)

    user = db.query(User).filter(
        (User.username == body.username) | (User.email == body.username),
        User.deleted_at.is_(None),
    ).first()

    if not user or not pwd_context.verify(body.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        )
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is disabled")

    # Build proper RLS context now that we know the user
    roles = build_roles_payload(user, db)
    set_rls_context(build_rls_context(str(user.id), roles))

    token_data = {"sub": str(user.id), "username": user.username, "roles": roles}

    _audit(db, user, "LOGIN", request)
    db.commit()

    return TokenResponse(
        access_token=create_access_token(token_data),
        refresh_token=create_refresh_token(token_data),
    )


@router.post("/refresh", response_model=TokenResponse)
def refresh(body: RefreshRequest, db: Session = Depends(get_db)):
    try:
        payload = decode_token(body.refresh_token)
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")

    if payload.get("type") != "refresh":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not a refresh token")

    # Bypass for the user lookup (same reason as login)
    set_rls_context(BYPASS_CONTEXT)

    user = db.query(User).filter(
        User.id == payload["sub"],
        User.is_active == True,
        User.deleted_at.is_(None),
    ).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    roles = build_roles_payload(user, db)
    set_rls_context(build_rls_context(str(user.id), roles))

    token_data = {"sub": str(user.id), "username": user.username, "roles": roles}

    return TokenResponse(
        access_token=create_access_token(token_data),
        refresh_token=create_refresh_token(token_data),
    )


@router.post("/logout")
def logout(request: Request, current: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    _audit(db, current.user, "LOGOUT", request)
    db.commit()
    return {"detail": "Logged out"}


@router.get("/me", response_model=UserOut)
def me(current: CurrentUser = Depends(get_current_user)):
    return current.user
