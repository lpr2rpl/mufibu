"""
Authentication endpoints: login, refresh, logout.
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

    roles = build_roles_payload(user, db)
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

    user = db.query(User).filter(
        User.id == payload["sub"],
        User.is_active == True,
        User.deleted_at.is_(None),
    ).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    roles = build_roles_payload(user, db)
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
