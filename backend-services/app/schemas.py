from datetime import datetime
from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    SecretStr,
    StringConstraints,
    field_validator,
)


Login = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        to_lower=True,
        min_length=1,
        max_length=64,
        pattern=r"^[a-zA-Z0-9][a-zA-Z0-9_.-]*$",
    ),
]
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
Gender = Literal["male", "female", "other"]
Age = Annotated[int, Field(strict=True, ge=0, le=150)]
HabitName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)
]
HabitDescription = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1000)
]
HabitCategory = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True, to_lower=True, min_length=1, max_length=64
    ),
]
TargetValue = Annotated[
    Decimal, Field(gt=0, max_digits=12, decimal_places=3, allow_inf_nan=False)
]
TargetUnit = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True, to_lower=True, min_length=1, max_length=32
    ),
]
TargetPeriod = Literal["day", "week", "month"]
Password = Annotated[SecretStr, Field(min_length=12, max_length=128)]


class UserCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    login: Login = Field(description="Уникальный никнейм, без учёта регистра")
    name: Name | None = None
    gender: Gender | None = None
    age: Age | None = None


class UserUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    login: Login | None = Field(
        default=None, description="Новый никнейм; null недопустим"
    )
    name: Name | None = None
    gender: Gender | None = None
    age: Age | None = None

    @field_validator("login")
    @classmethod
    def require_login(cls, value: str | None) -> str:
        if value is None:
            raise ValueError("Логин не может быть null")
        return value


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    login: str
    name: str | None
    gender: Gender | None
    age: int | None


class RegistrationRequest(UserCreate):
    password: Password


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    login: Login
    password: SecretStr = Field(min_length=1, max_length=128)


class HabitCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: HabitName
    description: HabitDescription | None = None
    category: HabitCategory | None = None


class HabitUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: HabitName | None = None
    description: HabitDescription | None = None
    category: HabitCategory | None = None

    @field_validator("name")
    @classmethod
    def require_name(cls, value: str | None) -> str:
        if value is None:
            raise ValueError("Название привычки не может быть null")
        return value


class HabitResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    description: str | None
    category: str | None


class UserHabitCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    habit_id: UUID
    target_value: TargetValue
    target_unit: TargetUnit
    target_period: TargetPeriod


class UserHabitResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    habit_id: UUID
    target_value: Decimal
    target_unit: str
    target_period: TargetPeriod
    created_at: datetime
    archived_at: datetime | None
