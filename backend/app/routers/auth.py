"""
Authentication endpoints: login, refresh, logout.

The login and refresh endpoints operate WITHOUT an authenticated user context
(that is the whole point - we are establishing one).  Before querying the
users table we activate the BYPASS_CONTEXT so that the RLS policies do not
block the lookup.  The bypass is cleared and replaced with the proper user
context immediately after the password is verified.
"""
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from jose import JWTError
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from app.auth.cookies import REFRESH_COOKIE, clear_auth_cookies, set_auth_cookies
from app.auth.csrf import generate_csrf_token
from app.auth.dependencies import build_roles_payload, get_current_user, CurrentUser
from app.auth.jwt_handler import create_access_token, create_refresh_token, decode_token
from app.auth.login_throttle import is_locked, register_failure, seconds_until_unlock
from app.auth.token_revocation import token_revoked
from app.config import get_settings
from app.database import get_db
from app.models import AuditLog, User
from app.rls import BYPASS_CONTEXT, build_rls_context, set_rls_context
from app.schemas import AuthSession, LoginRequest, RefreshRequest


def _issue_session(response: Response, user: User, roles: list) -> AuthSession:
    """Mint fresh tokens, deliver them as cookies, and return the session body."""
    from datetime import timedelta
    now = datetime.now(timezone.utc)
    token_data = {"sub": str(user.id), "username": user.username, "roles": roles}
    set_auth_cookies(
        response,
        create_access_token(token_data),
        create_refresh_token(token_data),
        generate_csrf_token(),
    )
    access_expires_at = now + timedelta(minutes=settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES)
    return AuthSession(user=user, roles=roles, access_expires_at=access_expires_at)

router = APIRouter(prefix="/auth", tags=["auth"])

logger = logging.getLogger(__name__)
settings = get_settings()
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# Fixed hash used to equalize password-verification timing when the supplied
# identifier matches no user, so response time does not reveal account existence.
_DUMMY_HASH = pwd_context.hash("mufibu-timing-equalizer")


def _audit(db: Session, user: User, action: str, notes: str = ""):
    # ip_address, user_agent, and session_id are stamped centrally by the
    # before_flush event in app/database.py from the request context.
    db.add(AuditLog(
        user_id=user.id,
        action=action,
        notes=notes,
    ))


@router.post("/login", response_model=AuthSession)
def login(body: LoginRequest, response: Response, db: Session = Depends(get_db)):
    # Activate bypass so the RLS after_begin event allows the user lookup.
    # The bypass is intentional here: we need to find the user BEFORE we can
    # build a proper RLS context (chicken-and-egg at authentication time).
    set_rls_context(BYPASS_CONTEXT)
    now = datetime.now(timezone.utc)

    user = db.query(User).filter(
        (User.username == body.username) | (User.email == body.username),
        User.deleted_at.is_(None),
    ).first()

    # Reject early while the account is locked, even with correct credentials.
    if user and is_locked(user.locked_until, now):
        retry_after = seconds_until_unlock(user.locked_until, now)
        logger.warning("login blocked: account locked username=%s", user.username)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Account temporarily locked due to repeated failed logins. Try again later.",
            headers={"Retry-After": str(retry_after)},
        )

    # Verify the password.  When no user matched, verify against a dummy hash so
    # the timing does not reveal whether the identifier exists.
    password_ok = pwd_context.verify(body.password, user.password_hash if user else _DUMMY_HASH)

    if not user or not password_ok:
        if user:
            new_count, locked_until = register_failure(
                user.failed_login_count, now,
                settings.LOGIN_MAX_FAILED_ATTEMPTS, settings.LOGIN_LOCKOUT_MINUTES,
            )
            user.failed_login_count = new_count
            user.last_failed_login_at = now
            if locked_until is not None:
                user.locked_until = locked_until
                logger.warning(
                    "account locked after %d failed logins username=%s",
                    settings.LOGIN_MAX_FAILED_ATTEMPTS, user.username,
                )
            db.commit()
        logger.warning("failed login attempt identifier=%s", body.username)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        )
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is disabled")

    # Successful login: clear any prior throttle state.
    if user.failed_login_count or user.locked_until is not None:
        user.failed_login_count = 0
        user.locked_until = None

    # Build proper RLS context now that we know the user
    roles = build_roles_payload(user, db)
    set_rls_context(build_rls_context(str(user.id), roles))

    _audit(db, user, "LOGIN")
    db.commit()

    return _issue_session(response, user, roles)


@router.post("/refresh", response_model=AuthSession)
def refresh(
    request: Request,
    response: Response,
    body: Optional[RefreshRequest] = None,
    db: Session = Depends(get_db),
):
    # Browsers send the refresh token as an httpOnly cookie; non-browser clients
    # may supply it in the body instead.
    refresh_token = request.cookies.get(REFRESH_COOKIE) or (body.refresh_token if body else None)
    if not refresh_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing refresh token")
    try:
        payload = decode_token(refresh_token)
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

    # Honor the revocation watermark so a logged-out/revoked refresh token
    # cannot be used to mint new access tokens.
    if token_revoked(payload.get("iat"), user.tokens_valid_after):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh token has been revoked")

    roles = build_roles_payload(user, db)
    set_rls_context(build_rls_context(str(user.id), roles))

    return _issue_session(response, user, roles)


@router.post("/logout")
def logout(
    response: Response,
    current: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # Bump the revocation watermark so this user's outstanding access and
    # refresh tokens stop working immediately (RLS allows updating self).
    current.user.tokens_valid_after = datetime.now(timezone.utc)
    _audit(db, current.user, "LOGOUT")
    db.commit()
    clear_auth_cookies(response)
    return {"detail": "Logged out"}


@router.get("/me", response_model=AuthSession)
def me(current: CurrentUser = Depends(get_current_user)):
    exp = current.token_exp
    access_expires_at = (
        datetime.fromtimestamp(exp, tz=timezone.utc) if exp else None
    )
    return AuthSession(user=current.user, roles=current.roles, access_expires_at=access_expires_at)
