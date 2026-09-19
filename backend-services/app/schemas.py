from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator


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
