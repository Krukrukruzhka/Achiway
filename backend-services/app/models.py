from datetime import date, datetime
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Numeric,
    SmallInteger,
    String,
    UniqueConstraint,
    Uuid,
    func,
    text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        UniqueConstraint("login", name="uq_users_login"),
        CheckConstraint(
            "login ~ '^[a-z0-9][a-z0-9_.-]{0,63}$'", name="ck_users_login"
        ),
        CheckConstraint(
            "name IS NULL OR (name = btrim(name) AND char_length(name) BETWEEN 1 AND 100)",
            name="ck_users_name",
        ),
        CheckConstraint(
            "gender IS NULL OR gender IN ('male', 'female', 'other')",
            name="ck_users_gender",
        ),
        CheckConstraint("age IS NULL OR age BETWEEN 0 AND 150", name="ck_users_age"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    login: Mapped[str] = mapped_column(String(64))
    name: Mapped[str | None] = mapped_column(String(100))
    gender: Mapped[str | None] = mapped_column(String(16))
    age: Mapped[int | None] = mapped_column(SmallInteger)


class PasswordCredential(Base):
    __tablename__ = "password_credentials"

    user_id: Mapped[UUID] = mapped_column(
        ForeignKey(
            "users.id",
            name="fk_password_credentials_user_id_users",
            ondelete="CASCADE",
        ),
        primary_key=True,
    )
    password_hash: Mapped[str] = mapped_column(String(255))
    failed_login_attempts: Mapped[int] = mapped_column(
        SmallInteger, default=0, server_default="0"
    )
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class AuthSession(Base):
    __tablename__ = "auth_sessions"
    __table_args__ = (
        UniqueConstraint("token_hash", name="uq_auth_sessions_token_hash"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(
        ForeignKey(
            "users.id", name="fk_auth_sessions_user_id_users", ondelete="CASCADE"
        ),
        index=True,
    )
    token_hash: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)


class Habit(Base):
    __tablename__ = "habits"
    __table_args__ = (
        CheckConstraint(
            "name = btrim(name) AND char_length(name) BETWEEN 1 AND 100",
            name="ck_habits_name",
        ),
        CheckConstraint(
            "description IS NULL OR "
            "(description = btrim(description) AND "
            "char_length(description) BETWEEN 1 AND 1000)",
            name="ck_habits_description",
        ),
        CheckConstraint(
            "category IS NULL OR "
            "(category = btrim(category) AND category = lower(category) AND "
            "char_length(category) BETWEEN 1 AND 64)",
            name="ck_habits_category",
        ),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(100))
    description: Mapped[str | None] = mapped_column(String(1000))
    category: Mapped[str | None] = mapped_column(String(64))


Index("uq_habits_name_lower", func.lower(Habit.name), unique=True)


class UserHabit(Base):
    __tablename__ = "user_habits"
    __table_args__ = (
        CheckConstraint("target_value > 0", name="ck_user_habits_target_value"),
        CheckConstraint(
            "target_unit = btrim(target_unit) AND "
            "target_unit = lower(target_unit) AND "
            "char_length(target_unit) BETWEEN 1 AND 32",
            name="ck_user_habits_target_unit",
        ),
        CheckConstraint(
            "target_period IN ('day', 'week', 'month')",
            name="ck_user_habits_target_period",
        ),
        Index(
            "uq_user_habits_active",
            "user_id",
            "habit_id",
            unique=True,
            postgresql_where=text("archived_at IS NULL"),
        ),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(
        ForeignKey(
            "users.id", name="fk_user_habits_user_id_users", ondelete="CASCADE"
        )
    )
    habit_id: Mapped[UUID] = mapped_column(
        ForeignKey(
            "habits.id",
            name="fk_user_habits_habit_id_habits",
            ondelete="RESTRICT",
        )
    )
    target_value: Mapped[Decimal] = mapped_column(Numeric(12, 3))
    target_unit: Mapped[str] = mapped_column(String(32))
    target_period: Mapped[str] = mapped_column(String(8))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class HabitProgressEntry(Base):
    __tablename__ = "habit_progress_entries"
    __table_args__ = (
        UniqueConstraint(
            "user_habit_id",
            "period_start",
            name="uq_habit_progress_entries_period",
        ),
        CheckConstraint(
            "target_value > 0", name="ck_habit_progress_entries_target_value"
        ),
        CheckConstraint(
            "target_unit = btrim(target_unit) AND "
            "target_unit = lower(target_unit) AND "
            "char_length(target_unit) BETWEEN 1 AND 32",
            name="ck_habit_progress_entries_target_unit",
        ),
        CheckConstraint(
            "target_period IN ('day', 'week', 'month')",
            name="ck_habit_progress_entries_target_period",
        ),
        CheckConstraint(
            "result_value >= 0", name="ck_habit_progress_entries_result_value"
        ),
        CheckConstraint(
            "(status = 'done' AND result_value >= target_value) OR "
            "(status = 'tried' AND result_value > 0 AND "
            "result_value < target_value) OR "
            "(status = 'skipped' AND result_value = 0)",
            name="ck_habit_progress_entries_status",
        ),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    user_habit_id: Mapped[UUID] = mapped_column(
        ForeignKey(
            "user_habits.id",
            name="fk_habit_progress_entries_user_habit_id_user_habits",
            ondelete="CASCADE",
        )
    )
    period_start: Mapped[date] = mapped_column(Date)
    target_value: Mapped[Decimal] = mapped_column(Numeric(12, 3))
    target_unit: Mapped[str] = mapped_column(String(32))
    target_period: Mapped[str] = mapped_column(String(8))
    result_value: Mapped[Decimal] = mapped_column(Numeric(12, 3))
    status: Mapped[str] = mapped_column(String(8))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
