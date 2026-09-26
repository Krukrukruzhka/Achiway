from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.database import DatabaseSession
from app.auth import CurrentUser
from app.habits import constraint_name, find_habit
from app.habit_instances import sync_template, sync_user
from app.models import HabitProgressEntry, UserHabit
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
    now = sync_user(session, current_user.id)
    habit = find_habit(session, payload.habit_id)
    values = payload.model_dump()
    if "category" not in payload.model_fields_set:
        values["category"] = habit.category
    # An archived template's running instance still lasts until its scheduled end.
    previous = session.execute(
        select(UserHabit, HabitProgressEntry)
        .join(HabitProgressEntry, HabitProgressEntry.user_habit_id == UserHabit.id)
        .where(
            UserHabit.user_id == current_user.id,
            UserHabit.habit_id == payload.habit_id,
            HabitProgressEntry.status == "active",
        )
        .order_by(HabitProgressEntry.period_end.desc())
        .limit(1)
    ).first()
    start = previous[1].period_end if previous else now
    anchor = (
        previous[0].schedule_anchor
        if previous and previous[0].target_period == payload.target_period else start
    )
    user_habit = UserHabit(
        user_id=current_user.id, created_at=now,
        schedule_anchor=anchor, next_instance_at=start, **values
    )
    session.add(user_habit)
    try:
        session.flush()
        sync_template(session, user_habit, now)
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

    now = datetime.now(timezone.utc)
    sync_template(session, user_habit, now)
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
        start = user_habit.next_instance_at
        anchor = (
            user_habit.schedule_anchor
            if values["target_period"] == user_habit.target_period else start
        )
        user_habit.archived_at = now
        session.flush()
        user_habit = UserHabit(
            user_id=current_user.id, habit_id=user_habit.habit_id,
            created_at=now, schedule_anchor=anchor, next_instance_at=start, **values
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
    now = datetime.now(timezone.utc)
    sync_template(session, user_habit, now)
    user_habit.archived_at = now
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
