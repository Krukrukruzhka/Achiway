import asyncio
import calendar
import logging
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import exists, or_, select
from sqlalchemy.engine import Engine
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.models import Habit, HabitProgressEntry, UserHabit


MOSCOW = ZoneInfo("Europe/Moscow")
logger = logging.getLogger(__name__)


def next_period_end(start: datetime, anchor: datetime, period: str) -> datetime:
    local_start = start.astimezone(MOSCOW)
    if period == "month":
        year, month = divmod(local_start.year * 12 + local_start.month, 12)
        month += 1
        day = min(anchor.astimezone(MOSCOW).day, calendar.monthrange(year, month)[1])
        end = local_start.replace(year=year, month=month, day=day)
    else:
        end = local_start + timedelta(days=1 if period == "day" else 7)
    return end.astimezone(timezone.utc)


def final_status(result: Decimal, target: Decimal) -> str:
    if result >= target:
        return "done"
    return "tried" if result > 0 else "skipped"


def sync_template(session: Session, template: UserHabit, now: datetime) -> None:
    """Caller holds the template row lock until commit, including for result edits."""
    expired = session.scalars(
        select(HabitProgressEntry).where(
            HabitProgressEntry.user_habit_id == template.id,
            HabitProgressEntry.status == "active",
            HabitProgressEntry.period_end <= now,
        )
    )
    for entry in expired:
        entry.status = final_status(entry.result_value, entry.target_value)
    # Release the partial unique index before inserting the next active instance.
    session.flush()
    if template.archived_at is not None or template.next_instance_at > now:
        return

    habit = session.get(Habit, template.habit_id)
    while template.next_instance_at <= now:
        start = template.next_instance_at
        end = next_period_end(start, template.schedule_anchor, template.target_period)
        session.add(HabitProgressEntry(
            user_habit_id=template.id,
            period_start=start,
            period_end=end,
            habit_name=habit.name,
            category=template.category,
            target_value=template.target_value,
            target_unit=template.target_unit,
            target_period=template.target_period,
            result_value=Decimal(0),
            status="active" if end > now else "skipped",
        ))
        template.next_instance_at = end
    session.flush()


def sync_user(session: Session, user_id: UUID) -> datetime:
    templates = list(session.scalars(
        select(UserHabit)
        .where(UserHabit.user_id == user_id)
        .order_by(UserHabit.id)
        .with_for_update()
    ))
    # Read the clock after waiting for locks, so an expired instance cannot be edited.
    now = datetime.now(timezone.utc)
    for template in templates:
        sync_template(session, template, now)
    return now


def sync_due_templates(engine: Engine) -> None:
    with Session(engine) as session:
        now = datetime.now(timezone.utc)
        templates = list(session.scalars(
            select(UserHabit)
            .where(or_(
                (UserHabit.archived_at.is_(None)) & (UserHabit.next_instance_at <= now),
                exists().where(
                    HabitProgressEntry.user_habit_id == UserHabit.id,
                    HabitProgressEntry.status == "active",
                    HabitProgressEntry.period_end <= now,
                ),
            ))
            .order_by(UserHabit.id)
            .limit(100)
            .with_for_update(skip_locked=True)
        ))
        for template in templates:
            sync_template(session, template, now)
        session.commit()


async def run_instance_worker(engine: Engine, stop: asyncio.Event) -> None:
    while not stop.is_set():
        delay = 1
        try:
            await asyncio.to_thread(sync_due_templates, engine)
        except SQLAlchemyError:
            # Avoid logging connection strings, query parameters or user data.
            logger.warning("Habit instance refresh failed; retrying in 30 seconds")
            delay = 30
        try:
            await asyncio.wait_for(stop.wait(), timeout=delay)
        except asyncio.TimeoutError:
            pass
