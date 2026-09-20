from dataclasses import dataclass
from typing import Literal

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.exc import InterfaceError, OperationalError, SQLAlchemyError

from app.database import DatabaseSession, lifespan
from app.habits import router as habits_router
from app.models import Habit, HabitProgressEntry, User, UserHabit
from app.user_habits import router as user_habits_router
from app.users import router as users_router


@dataclass
class MessageResponse:
    message: str


@dataclass
class HealthResponse:
    status: Literal["ok"] = "ok"


app = FastAPI(title="Achiway", lifespan=lifespan)
app.include_router(users_router)
app.include_router(habits_router)
app.include_router(user_habits_router)


@app.exception_handler(OperationalError)
@app.exception_handler(InterfaceError)
async def database_unavailable(request: Request, exc: Exception) -> JSONResponse:
    return JSONResponse(status_code=503, content={"detail": "Database unavailable"})


@app.get("/ping", response_model=MessageResponse)
async def ping() -> MessageResponse:
    return MessageResponse(message="pong")


@app.get("/hello", response_model=MessageResponse)
async def hello() -> MessageResponse:
    return MessageResponse(message="Hello, world!")


@app.get("/health/live", response_model=HealthResponse, tags=["health"])
async def liveness() -> HealthResponse:
    return HealthResponse()


@app.get("/health/ready", response_model=HealthResponse, tags=["health"])
def readiness(session: DatabaseSession) -> HealthResponse:
    try:
        for model in (User, Habit, UserHabit, HabitProgressEntry):
            session.execute(select(model).limit(0))
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="Database or schema unavailable") from exc
    return HealthResponse()


@app.get("/health/startup", response_model=HealthResponse, tags=["health"])
async def startup() -> HealthResponse:
    return HealthResponse()
