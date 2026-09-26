import asyncio
import os
from collections.abc import AsyncIterator, Iterator
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, Request
from sqlalchemy import URL, create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session


def database_url() -> URL:
    value = os.environ.get("DATABASE_URL")
    if not value:
        raise RuntimeError("Set DATABASE_URL before starting the backend or migrations")
    url = make_url(value)
    if url.drivername not in {"postgresql", "postgresql+psycopg"}:
        raise RuntimeError("DATABASE_URL must use PostgreSQL with psycopg")
    return url.set(drivername="postgresql+psycopg")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    from app.habit_instances import run_instance_worker

    engine = create_engine(
        database_url(),
        pool_pre_ping=True,
        hide_parameters=True,
        connect_args={"connect_timeout": 5},
    )
    app.state.engine = engine
    stop = asyncio.Event()
    worker = asyncio.create_task(run_instance_worker(engine, stop))
    try:
        yield
    finally:
        stop.set()
        try:
            await worker
        finally:
            engine.dispose()


def get_session(request: Request) -> Iterator[Session]:
    with Session(request.app.state.engine, expire_on_commit=False) as session:
        yield session


DatabaseSession = Annotated[Session, Depends(get_session)]
