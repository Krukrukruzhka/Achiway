from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.database import DatabaseSession
from app.habits import constraint_name, find_habit
from app.models import UserHabit
from app.schemas import Login, UserHabitCreate, UserHabitResponse
from app.users import find_user


router = APIRouter(prefix="/users/{login}/habits", tags=["user habits"])


@router.post(
    "", response_model=UserHabitResponse, status_code=status.HTTP_201_CREATED
)
def create_user_habit(
    login: Login, payload: UserHabitCreate, session: DatabaseSession
) -> UserHabit:
    user = find_user(session, login)
    find_habit(session, payload.habit_id)
    user_habit = UserHabit(user_id=user.id, **payload.model_dump())
    session.add(user_habit)
    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        constraint = constraint_name(exc)
        if constraint == "uq_user_habits_active":
            raise HTTPException(
                status_code=409, detail="User already has this active habit"
            ) from exc
        if constraint in {
            "fk_user_habits_user_id_users",
            "fk_user_habits_habit_id_habits",
        }:
            raise HTTPException(
                status_code=404, detail="User or habit not found"
            ) from exc
        raise
    return user_habit


@router.delete("/{user_habit_id}", status_code=status.HTTP_204_NO_CONTENT)
def archive_user_habit(
    login: Login, user_habit_id: UUID, session: DatabaseSession
) -> Response:
    user = find_user(session, login)
    statement = (
        select(UserHabit)
        .where(
            UserHabit.id == user_habit_id,
            UserHabit.user_id == user.id,
            UserHabit.archived_at.is_(None),
        )
        .with_for_update()
    )
    user_habit = session.scalar(statement)
    if user_habit is None:
        raise HTTPException(status_code=404, detail="Active user habit not found")
    user_habit.archived_at = datetime.now(timezone.utc)
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
