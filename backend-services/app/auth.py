import hashlib
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Annotated
from uuid import UUID

from argon2 import PasswordHasher
from argon2.exceptions import VerificationError
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import DatabaseSession
from app.models import AuthSession, PasswordCredential, User
from app.schemas import LoginRequest, RegistrationRequest, UserResponse


SESSION_COOKIE = "achiway_session"
SESSION_LIFETIME = timedelta(days=7)
MAX_FAILED_LOGIN_ATTEMPTS = 5
LOGIN_LOCKOUT_TIME = timedelta(minutes=15)
PASSWORD_HASHER = PasswordHasher()
DUMMY_PASSWORD_HASH = PASSWORD_HASHER.hash("not-a-real-user-password")

router = APIRouter(prefix="/auth", tags=["auth"])


def session_token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("ascii")).hexdigest()


def cookie_secure() -> bool:
    return os.environ.get("SESSION_COOKIE_SECURE", "false").lower() in {
        "1",
        "true",
        "yes",
    }


def set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=SESSION_COOKIE,
        value=token,
        max_age=int(SESSION_LIFETIME.total_seconds()),
        path="/",
        secure=cookie_secure(),
        httponly=True,
        samesite="lax",
    )
    response.headers["Cache-Control"] = "no-store"


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(
        key=SESSION_COOKIE,
        path="/",
        secure=cookie_secure(),
        httponly=True,
        samesite="lax",
    )
    response.headers["Cache-Control"] = "no-store"


def create_session(session: Session, user_id: UUID) -> str:
    token = secrets.token_urlsafe(32)
    session.add(
        AuthSession(
            user_id=user_id,
            token_hash=session_token_hash(token),
            expires_at=datetime.now(timezone.utc) + SESSION_LIFETIME,
        )
    )
    return token


def unauthorized() -> HTTPException:
    return HTTPException(status_code=401, detail="Authentication required")


def require_user(request: Request, session: DatabaseSession) -> User:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        raise unauthorized()

    statement = (
        select(User)
        .join(AuthSession, AuthSession.user_id == User.id)
        .where(
            AuthSession.token_hash == session_token_hash(token),
            AuthSession.expires_at > datetime.now(timezone.utc),
        )
    )
    user = session.scalar(statement)
    if user is None:
        raise unauthorized()
    return user


CurrentUser = Annotated[User, Depends(require_user)]


def login_failure() -> HTTPException:
    return HTTPException(status_code=401, detail="Invalid login or password")


def login_locked(retry_after: int) -> HTTPException:
    return HTTPException(
        status_code=429,
        detail="Too many login attempts. Try again later",
        headers={"Retry-After": str(retry_after)},
    )


@router.post(
    "/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED
)
def register(
    payload: RegistrationRequest, response: Response, session: DatabaseSession
) -> User:
    password = payload.password.get_secret_value()
    user = User(**payload.model_dump(exclude={"password"}))
    session.add(user)
    try:
        session.flush()
        session.add(
            PasswordCredential(
                user_id=user.id,
                password_hash=PASSWORD_HASHER.hash(password),
            )
        )
        token = create_session(session, user.id)
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        constraint = getattr(getattr(exc.orig, "diag", None), "constraint_name", None)
        if constraint == "uq_users_login":
            raise HTTPException(status_code=409, detail="Login already exists") from exc
        raise

    set_session_cookie(response, token)
    return user


@router.post("/login", response_model=UserResponse)
def login(
    payload: LoginRequest, response: Response, session: DatabaseSession
) -> User:
    password = payload.password.get_secret_value()
    statement = (
        select(User, PasswordCredential)
        .join(PasswordCredential, PasswordCredential.user_id == User.id)
        .where(User.login == payload.login)
        .with_for_update()
    )
    result = session.execute(statement).one_or_none()
    stored_hash = result[1].password_hash if result is not None else DUMMY_PASSWORD_HASH
    try:
        password_valid = PASSWORD_HASHER.verify(stored_hash, password)
    except VerificationError:
        password_valid = False

    if result is None:
        raise login_failure()

    user, credential = result
    now = datetime.now(timezone.utc)
    if credential.locked_until is not None and credential.locked_until > now:
        retry_after = max(1, int((credential.locked_until - now).total_seconds()))
        raise login_locked(retry_after)

    if not password_valid:
        credential.failed_login_attempts += 1
        if credential.failed_login_attempts >= MAX_FAILED_LOGIN_ATTEMPTS:
            credential.failed_login_attempts = 0
            credential.locked_until = now + LOGIN_LOCKOUT_TIME
        session.commit()
        raise login_failure()

    credential.failed_login_attempts = 0
    credential.locked_until = None
    if PASSWORD_HASHER.check_needs_rehash(credential.password_hash):
        credential.password_hash = PASSWORD_HASHER.hash(password)

    token = create_session(session, user.id)
    session.commit()
    set_session_cookie(response, token)
    return user


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(request: Request, response: Response, session: DatabaseSession) -> None:
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        auth_session = session.scalar(
            select(AuthSession).where(
                AuthSession.token_hash == session_token_hash(token)
            )
        )
        if auth_session is not None:
            session.delete(auth_session)
            session.commit()
    clear_session_cookie(response)


@router.get("/me", response_model=UserResponse)
def get_current_user(current_user: CurrentUser) -> User:
    return current_user
