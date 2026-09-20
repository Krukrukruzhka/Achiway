from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.database import DatabaseSession
from app.auth import CurrentUser
from app.habits import constraint_name, find_habit
from app.models import UserHabit
from app.schemas import UserHabitCreate, UserHabitResponse, UserHabitUpdate


router = APIRouter(prefix="/users/me/habits", tags=["user habits"])


@router.get("", response_model=list[UserHabitResponse])
def list_user_habits(
    current_user: CurrentUser, session: DatabaseSession
) -> list[UserHabit]:
    statement = (
        select(UserHabit)
        .where(UserHabit.user_id == current_user.id, UserHabit.archived_at.is_(None))
        .order_by(UserHabit.created_at.desc(), UserHabit.id)
    )
    return list(session.scalars(statement))


@router.post(
    "", response_model=UserHabitResponse, status_code=status.HTTP_201_CREATED
)
def create_user_habit(
    payload: UserHabitCreate, current_user: CurrentUser, session: DatabaseSession
) -> UserHabit:
    habit = find_habit(session, payload.habit_id)
    values = payload.model_dump()
    if "category" not in payload.model_fields_set:
        values["category"] = habit.category
    user_habit = UserHabit(user_id=current_user.id, **values)
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


@router.patch("/{user_habit_id}", response_model=UserHabitResponse)
def update_user_habit(
    user_habit_id: UUID,
    payload: UserHabitUpdate,
    current_user: CurrentUser,
    session: DatabaseSession,
) -> UserHabit:
    user_habit = session.scalar(
        select(UserHabit)
        .where(
            UserHabit.id == user_habit_id,
            UserHabit.user_id == current_user.id,
            UserHabit.archived_at.is_(None),
        )
        .with_for_update()
    )
    if user_habit is None:
        raise HTTPException(status_code=404, detail="Active user habit not found")

    changes = payload.model_dump(exclude_unset=True)
    target_fields = ("target_value", "target_unit", "target_period")
    if any(
        field in changes and changes[field] != getattr(user_habit, field)
        for field in target_fields
    ):
        # Keep the previous goal and its progress; replace it in one transaction.
        values = {
            field: getattr(user_habit, field)
            for field in ("category", *target_fields)
        }
        values.update(changes)
        user_habit.archived_at = datetime.now(timezone.utc)
        session.flush()
        user_habit = UserHabit(
            user_id=current_user.id, habit_id=user_habit.habit_id, **values
        )
        session.add(user_habit)
    else:
        for field, value in changes.items():
            setattr(user_habit, field, value)
    session.commit()
    return user_habit


@router.delete("/{user_habit_id}", status_code=status.HTTP_204_NO_CONTENT)
def archive_user_habit(
    user_habit_id: UUID, current_user: CurrentUser, session: DatabaseSession
) -> Response:
    statement = (
        select(UserHabit)
        .where(
            UserHabit.id == user_habit_id,
            UserHabit.user_id == current_user.id,
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
