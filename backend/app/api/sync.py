"""기기 ↔ 서버 동기화 (docs/PLAN.md §3.2).

- ID는 기기가 만든 UUID, 충돌은 updated_at 최신 우선, 삭제는 deleted_at.
- pull 커서는 서버가 매기는 변경 번호(seq)다. 기기 시계가 틀려도 다른 기기의 변경을 놓치지 않는다.
"""

import json
from datetime import UTC, datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, select, update

from app.api.deps import CurrentUser, DbSession, require_read, require_write
from app.cloud import lock_active_user, stored_variants
from app.models.cloud import CloudObject, DeviceLink, Moment, SyncRecord, Usage

router = APIRouter(prefix="/sync", tags=["sync"])

PULL_LIMIT = 500
LINK_PAGE_LIMIT = 500

# 기기마다 다른 값(사진첩 연결, 동기화 표시)은 기록에 넣지 않는다. 다른 기기로 내려가기 때문이다.
# 사진첩 연결은 기기별로 따로 받는다 (/sync/device-links).
# local_*_path는 사진을 앱에 복사하던 이전 버전 앱이 보낸다.
DEVICE_ONLY_FIELDS = frozenset(
    {
        "source_asset_id",
        "source_uri",
        "source_missing",
        "local_original_path",
        "local_display_path",
        "sync_state",
        "original_uploaded",
        "display_uploaded",
    }
)

RecordKind = Literal["review_sessions", "albums", "album_moments"]


def _aware(value: datetime) -> datetime:
    # SQLite(테스트)는 시간대를 돌려주지 않는다. 기기 시각은 모두 UTC다.
    return value if value.tzinfo else value.replace(tzinfo=UTC)


class SyncRow(BaseModel):
    id: str = Field(max_length=80)
    updated_at: datetime
    deleted_at: datetime | None = None
    data: dict[str, Any] = Field(default_factory=dict)


class SyncMoment(SyncRow):
    id: str = Field(max_length=36)
    # pull 응답에서만 채운다. 클라우드에 저장된 사진 종류 ('display', 'original').
    stored_variants: list[Literal["display", "original"]] = Field(default_factory=list)


class SyncRecordRow(SyncRow):
    kind: RecordKind


class PushRequest(BaseModel):
    moments: list[SyncMoment] = Field(default_factory=list, max_length=500)
    records: list[SyncRecordRow] = Field(default_factory=list, max_length=500)


class PushResponse(BaseModel):
    # 서버에 더 최신 값이 있어서 받아들이지 않은 행. 기기는 다음 pull에서 서버 값을 받는다.
    stale_moment_ids: list[str]
    stale_record_ids: list[str]


class PullResponse(BaseModel):
    moments: list[SyncMoment]
    records: list[SyncRecordRow]
    cursor: int
    has_more: bool


class DeviceLinkRow(BaseModel):
    moment_id: str = Field(max_length=36)
    asset_id: str = Field(max_length=255)


class PutDeviceLinksRequest(BaseModel):
    device_id: str = Field(pattern=r"^[0-9a-f]{64}$")
    links: list[DeviceLinkRow] = Field(max_length=LINK_PAGE_LIMIT)


class DeviceLinksResponse(BaseModel):
    links: list[DeviceLinkRow]
    has_more: bool


def _encode(row: SyncRow) -> str:
    data = {k: v for k, v in row.data.items() if k not in DEVICE_ONLY_FIELDS}
    return json.dumps(
        {
            "id": row.id,
            "updated_at": row.updated_at.isoformat(),
            "deleted_at": row.deleted_at.isoformat() if row.deleted_at else None,
            "data": data,
        },
        ensure_ascii=False,
    )


@router.post("/push", response_model=PushResponse)
def push(payload: PushRequest, user: CurrentUser, db: DbSession) -> PushResponse:
    require_write(db, user)
    # 사용자 행을 잠가서 같은 사용자의 push가 동시에 와도 seq가 커밋 순서대로 매겨지게 한다.
    locked = lock_active_user(db, user.id)
    seq = locked.sync_seq
    stale_moments: list[str] = []
    stale_records: list[str] = []
    deleted_moments: list[str] = []

    # 같은 요청에 같은 행이 두 번 오면 (autoflush가 꺼져 있어) 두 번 INSERT되므로 첫 행만 쓴다.
    seen_moments: set[str] = set()
    for incoming in payload.moments:
        if incoming.id in seen_moments:
            continue
        seen_moments.add(incoming.id)
        existing = db.get(Moment, (user.id, incoming.id))
        if existing is not None and _aware(existing.updated_at) >= incoming.updated_at:
            stale_moments.append(incoming.id)
            continue
        seq += 1
        if existing is None:
            db.add(
                Moment(
                    id=incoming.id,
                    user_id=user.id,
                    data=_encode(incoming),
                    updated_at=incoming.updated_at,
                    deleted_at=incoming.deleted_at,
                    seq=seq,
                )
            )
        else:
            existing.data, existing.updated_at = _encode(incoming), incoming.updated_at
            existing.deleted_at, existing.seq = incoming.deleted_at, seq
        if incoming.deleted_at is not None:
            deleted_moments.append(incoming.id)

    seen_records: set[tuple[str, str]] = set()
    for incoming in payload.records:
        if (incoming.kind, incoming.id) in seen_records:
            continue
        seen_records.add((incoming.kind, incoming.id))
        existing = db.get(SyncRecord, (user.id, incoming.kind, incoming.id))
        if existing is not None and _aware(existing.updated_at) >= incoming.updated_at:
            stale_records.append(incoming.id)
            continue
        seq += 1
        if existing is None:
            db.add(
                SyncRecord(
                    user_id=user.id,
                    kind=incoming.kind,
                    id=incoming.id,
                    data=_encode(incoming),
                    updated_at=incoming.updated_at,
                    deleted_at=incoming.deleted_at,
                    seq=seq,
                )
            )
        else:
            existing.data, existing.updated_at = _encode(incoming), incoming.updated_at
            existing.deleted_at, existing.seq = incoming.deleted_at, seq

    if deleted_moments:
        _release_photos(db, user.id, deleted_moments)
        db.execute(
            delete(DeviceLink).where(
                DeviceLink.user_id == user.id, DeviceLink.moment_id.in_(deleted_moments)
            )
        )
    locked.sync_seq = seq
    db.commit()
    return PushResponse(stale_moment_ids=stale_moments, stale_record_ids=stale_records)


def _release_photos(db: DbSession, user_id: str, moment_ids: list[str]) -> None:
    """지운 기록의 사진은 정리 작업이 R2에서 지운다. 사용량은 바로 돌려준다."""
    objects = db.scalars(
        select(CloudObject).where(
            CloudObject.user_id == user_id,
            CloudObject.moment_id.in_(moment_ids),
            CloudObject.status.in_(("stored", "pending")),
        )
    ).all()
    usage = db.get(Usage, user_id)
    for obj in objects:
        if obj.status == "stored" and usage is not None:
            usage.bytes_total -= obj.size_bytes
            usage.object_count -= 1
    db.execute(
        update(CloudObject)
        .where(CloudObject.id.in_([obj.id for obj in objects]))
        .values(status="deleting")
    )


@router.get("/pull", response_model=PullResponse)
def pull(
    user: CurrentUser,
    db: DbSession,
    cursor: Annotated[int, Query(ge=0)] = 0,
) -> PullResponse:
    require_read(db, user)
    # 두 테이블의 seq는 같은 번호 공간이라, 합쳐서 seq 순으로 PULL_LIMIT개까지 돌려준다.
    moments = db.scalars(
        select(Moment)
        .where(Moment.user_id == user.id, Moment.seq > cursor)
        .order_by(Moment.seq)
        .limit(PULL_LIMIT + 1)
    ).all()
    records = db.scalars(
        select(SyncRecord)
        .where(SyncRecord.user_id == user.id, SyncRecord.seq > cursor)
        .order_by(SyncRecord.seq)
        .limit(PULL_LIMIT + 1)
    ).all()
    merged = sorted([*moments, *records], key=lambda row: row.seq)
    has_more = len(merged) > PULL_LIMIT
    page = merged[:PULL_LIMIT]
    next_cursor = page[-1].seq if page else cursor

    page_moments = [row for row in page if isinstance(row, Moment)]
    variants = stored_variants(db, user.id, [row.id for row in page_moments])
    return PullResponse(
        moments=[
            SyncMoment.model_validate(
                {**json.loads(row.data), "stored_variants": variants.get(row.id, [])}
            )
            for row in page_moments
        ],
        records=[
            SyncRecordRow.model_validate({**json.loads(row.data), "kind": row.kind})
            for row in page
            if isinstance(row, SyncRecord)
        ],
        cursor=next_cursor,
        has_more=has_more,
    )


@router.put("/device-links", status_code=status.HTTP_204_NO_CONTENT)
def put_device_links(payload: PutDeviceLinksRequest, user: CurrentUser, db: DbSession) -> None:
    require_write(db, user)
    lock_active_user(db, user.id)
    # 서버에 없거나 지워진 기록의 연결은 받지 않는다.
    active = set(
        db.scalars(
            select(Moment.id).where(
                Moment.user_id == user.id,
                Moment.id.in_([link.moment_id for link in payload.links]),
                Moment.deleted_at.is_(None),
            )
        )
    )
    seen: set[str] = set()
    for link in payload.links:
        if link.moment_id not in active or link.moment_id in seen:
            continue
        seen.add(link.moment_id)
        existing = db.get(DeviceLink, (user.id, payload.device_id, link.moment_id))
        if existing is None:
            db.add(
                DeviceLink(
                    user_id=user.id,
                    device_id=payload.device_id,
                    moment_id=link.moment_id,
                    asset_id=link.asset_id,
                )
            )
        else:
            existing.asset_id = link.asset_id
    db.commit()


@router.get("/device-links", response_model=DeviceLinksResponse)
def get_device_links(
    user: CurrentUser,
    db: DbSession,
    device_id: Annotated[str, Query(pattern=r"^[0-9a-f]{64}$")],
    after: Annotated[str, Query(max_length=36)] = "",
) -> DeviceLinksResponse:
    """요청한 기기의 연결만 돌려준다. moment_id 순으로 나눠 받는다."""
    require_read(db, user)
    rows = db.scalars(
        select(DeviceLink)
        .where(
            DeviceLink.user_id == user.id,
            DeviceLink.device_id == device_id,
            DeviceLink.moment_id > after,
        )
        .order_by(DeviceLink.moment_id)
        .limit(LINK_PAGE_LIMIT + 1)
    ).all()
    return DeviceLinksResponse(
        links=[
            DeviceLinkRow(moment_id=row.moment_id, asset_id=row.asset_id)
            for row in rows[:LINK_PAGE_LIMIT]
        ],
        has_more=len(rows) > LINK_PAGE_LIMIT,
    )
