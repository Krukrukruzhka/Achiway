from dataclasses import dataclass
from typing import Literal

from fastapi import FastAPI


@dataclass
class MessageResponse:
    message: str


@dataclass
class HealthResponse:
    status: Literal["ok"] = "ok"


app = FastAPI(title="Achiway")


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
async def readiness() -> HealthResponse:
    return HealthResponse()


@app.get("/health/startup", response_model=HealthResponse, tags=["health"])
async def startup() -> HealthResponse:
    return HealthResponse()
