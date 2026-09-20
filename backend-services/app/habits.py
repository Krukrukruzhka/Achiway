from uuid import UUID

from fastapi import APIRouter, HTTPException, Response, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import DatabaseSession
from app.auth import CurrentUser
from app.models import Habit
from app.schemas import HabitCreate, HabitResponse, HabitUpdate


router = APIRouter(prefix="/habits", tags=["habits"])


def constraint_name(exc: IntegrityError) -> str | None:
    return getattr(getattr(exc.orig, "diag", None), "constraint_name", None)


def find_habit(
    session: Session, habit_id: UUID, *, for_update: bool = False
) -> Habit:
    statement = select(Habit).where(Habit.id == habit_id)
    if for_update:
        statement = statement.with_for_update()
    habit = session.scalar(statement)
    if habit is None:
        raise HTTPException(status_code=404, detail="Habit not found")
    return habit


def commit_habit(session: Session) -> None:
    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        if constraint_name(exc) == "uq_habits_name_lower":
            raise HTTPException(
                status_code=409, detail="Habit name already exists"
            ) from exc
        raise


@router.get("", response_model=list[HabitResponse])
def list_habits(session: DatabaseSession, _current_user: CurrentUser) -> list[Habit]:
    statement = select(Habit).order_by(func.lower(Habit.name), Habit.id)
    return list(session.scalars(statement))


@router.get("/{habit_id}", response_model=HabitResponse)
def get_habit(
    habit_id: UUID, session: DatabaseSession, _current_user: CurrentUser
) -> Habit:
    return find_habit(session, habit_id)


@router.post("", response_model=HabitResponse, status_code=status.HTTP_201_CREATED)
def create_habit(
    payload: HabitCreate, session: DatabaseSession, _current_user: CurrentUser
) -> Habit:
    habit = Habit(**payload.model_dump())
    session.add(habit)
    commit_habit(session)
    return habit


@router.patch("/{habit_id}", response_model=HabitResponse)
def update_habit(
    habit_id: UUID,
    payload: HabitUpdate,
    session: DatabaseSession,
    _current_user: CurrentUser,
) -> Habit:
    habit = find_habit(session, habit_id, for_update=True)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(habit, field, value)
    commit_habit(session)
    return habit


@router.delete("/{habit_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_habit(
    habit_id: UUID, session: DatabaseSession, _current_user: CurrentUser
) -> Response:
    habit = find_habit(session, habit_id, for_update=True)
    session.delete(habit)
    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        if constraint_name(exc) == "fk_user_habits_habit_id_habits":
            raise HTTPException(status_code=409, detail="Habit is in use") from exc
        raise
    return Response(status_code=status.HTTP_204_NO_CONTENT)
