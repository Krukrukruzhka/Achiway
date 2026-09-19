from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, SmallInteger, String, UniqueConstraint, Uuid
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
