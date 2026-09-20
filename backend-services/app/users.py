from fastapi import APIRouter, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import DatabaseSession
from app.auth import CurrentUser, clear_session_cookie
from app.models import User
from app.schemas import UserResponse, UserUpdate


router = APIRouter(prefix="/users", tags=["users"])


def find_user(session: Session, login: str, *, for_update: bool = False) -> User:
    statement = select(User).where(User.login == login)
    if for_update:
        statement = statement.with_for_update()
    user = session.scalar(statement)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return user


def commit_user(session: Session) -> None:
    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        constraint = getattr(getattr(exc.orig, "diag", None), "constraint_name", None)
        if constraint == "uq_users_login":
            raise HTTPException(status_code=409, detail="Login already exists") from exc
        raise


@router.get("/me", response_model=UserResponse)
def get_user(current_user: CurrentUser) -> User:
    return current_user


@router.patch("/me", response_model=UserResponse)
def update_user(
    profile: UserUpdate, current_user: CurrentUser, session: DatabaseSession
) -> User:
    user = find_user(session, current_user.login, for_update=True)
    for field, value in profile.model_dump(exclude_unset=True).items():
        setattr(user, field, value)
    commit_user(session)
    return user


@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    response: Response, current_user: CurrentUser, session: DatabaseSession
) -> None:
    user = find_user(session, current_user.login, for_update=True)
    session.delete(user)
    session.commit()
    clear_session_cookie(response)
