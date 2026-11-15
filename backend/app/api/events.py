import math
from datetime import UTC, datetime, timedelta
from typing import Literal, get_args

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select

from app.activity import ClientEvent, record
from app.api.deps import CurrentUser, DbSession
from app.models.cloud import UserEvent

router = APIRouter(prefix="/events", tags=["events"])

MAX_PROPERTIES = 10
# 사용자마다 1분에 받는 앱 이벤트 수. 화면을 빠르게 넘겨도 1분에 수십 번이라 넉넉하다.
# 토큰을 꺼내 스크립트로 보내거나 앱 버그로 같은 이벤트가 반복될 때 기록이 쌓이지 않게 막는다.
EVENTS_PER_MINUTE = 60
RATE_WINDOW = timedelta(minutes=1)
CLIENT_EVENTS = get_args(ClientEvent)


class EventRequest(BaseModel):
    event_type: ClientEvent
    entity_ref: str | None = Field(default=None, max_length=120)
    # 수·종류만 담는다. 글(메모 등)을 실을 수 없게 짧은 값만 받는다.
    properties: dict[str, int | float | bool | str | None] | None = None
    platform: Literal["ios", "android"] | None = None
    app_version: str | None = Field(default=None, max_length=32)

    @field_validator("properties")
    @classmethod
    def _small(cls, value: dict | None) -> dict | None:
        if value is None:
            return None
        if len(value) > MAX_PROPERTIES:
            raise ValueError("too many properties")
        for key, item in value.items():
            if len(key) > 40 or (isinstance(item, str) and len(item) > 80):
                raise ValueError("property is too long")
        # NaN·Infinity는 JSON 열에 저장할 수 없어(Postgres가 거절한다) 빈 값으로 둔다.
        # 422로 거절하면 오류 응답이 입력값을 되돌려 주다 직렬화에 실패해 결국 500이 된다.
        return {
            key: None if isinstance(item, float) and not math.isfinite(item) else item
            for key, item in value.items()
        }


@router.post("", status_code=status.HTTP_204_NO_CONTENT)
def log_event(payload: EventRequest, user: CurrentUser, db: DbSession) -> None:
    """기기 안에서 끝나는 액션과 앱 사용(app_open, screen_view)을 앱이 기록한다 (app/activity.py).

    앱은 기다리지 않고 보내며 실패해도 다시 보내지 않는다.
    """
    # 여러 서버 프로세스가 함께 세도록 기록 자체를 센다 (ix_user_events_user_created).
    # 서버가 남기는 이벤트는 세지 않는다 (공유 앨범을 많이 쓴 직후에 앱 기록이 막히지 않게).
    recent = db.scalar(
        select(func.count()).where(
            UserEvent.user_id == user.id,
            UserEvent.created_at >= datetime.now(UTC) - RATE_WINDOW,
            UserEvent.event_type.in_(CLIENT_EVENTS),
        )
    )
    if recent is not None and recent >= EVENTS_PER_MINUTE:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "too many events")
    record(
        db,
        user.id,
        payload.event_type,
        payload.entity_ref,
        payload.properties,
        platform=payload.platform,
        app_version=payload.app_version,
    )
    db.commit()
