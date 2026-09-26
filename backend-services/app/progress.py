from datetime import datetime, timezone
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import select

from app.auth import CurrentUser
from app.database import DatabaseSession
from app.habit_instances import sync_template, sync_user
from app.models import HabitProgressEntry, UserHabit
from app.schemas import HabitInstancePage, HabitInstanceResponse, HabitInstanceUpdate


router = APIRouter(prefix="/users/me/habit-instances", tags=["habit instances"])


@router.get("", response_model=HabitInstancePage)
def list_instances(
    current_user: CurrentUser,
    session: DatabaseSession,
    state: Literal["active", "history"] = "active",
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> HabitInstancePage:
    now = sync_user(session, current_user.id)
    statement = (
        select(HabitProgressEntry)
        .join(UserHabit, UserHabit.id == HabitProgressEntry.user_habit_id)
        .where(UserHabit.user_id == current_user.id)
    )
    if state == "active":
        statement = statement.where(HabitProgressEntry.status == "active").order_by(
            HabitProgressEntry.period_end, HabitProgressEntry.id
        )
    else:
        statement = statement.where(HabitProgressEntry.status != "active").order_by(
            HabitProgressEntry.period_end.desc(), HabitProgressEntry.id
        )
    items = list(session.scalars(statement.offset(offset).limit(limit + 1)))
    result = HabitInstancePage(
        items=[HabitInstanceResponse.model_validate(item) for item in items[:limit]],
        has_more=len(items) > limit,
        server_time=now,
    )
    session.commit()
    return result


@router.patch("/{instance_id}", response_model=HabitInstanceResponse)
def update_instance(
    instance_id: UUID,
    payload: HabitInstanceUpdate,
    current_user: CurrentUser,
    session: DatabaseSession,
) -> HabitProgressEntry:
    template = session.scalar(
        select(UserHabit)
        .join(HabitProgressEntry, HabitProgressEntry.user_habit_id == UserHabit.id)
        .where(HabitProgressEntry.id == instance_id, UserHabit.user_id == current_user.id)
        .with_for_update(of=UserHabit)
    )
    if template is None:
        raise HTTPException(status_code=404, detail="Habit instance not found")
    sync_template(session, template, datetime.now(timezone.utc))
    entry = session.get(HabitProgressEntry, instance_id)
    if entry.status != "active":
        session.commit()
        raise HTTPException(status_code=409, detail="Habit instance is closed")
    entry.result_value = payload.result_value
    session.commit()
    return entry
