from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db import get_db

router = APIRouter(prefix="/health", tags=["health"])


class HealthResponse(BaseModel):
    status: Literal["ok"]


@router.get("")
def health() -> HealthResponse:
    """서버 프로세스가 살아 있는지 확인한다."""
    return HealthResponse(status="ok")


@router.get("/ready")
def ready(db: Annotated[Session, Depends(get_db)]) -> HealthResponse:
    """DB까지 연결되어 요청을 처리할 준비가 되었는지 확인한다."""
    try:
        db.execute(text("SELECT 1"))
    except Exception as exc:
        raise HTTPException(status_code=503, detail="database unavailable") from exc
    return HealthResponse(status="ok")
