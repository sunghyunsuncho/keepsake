"""공유 앨범: 가족·친구·파트너가 함께 사진을 담는 안전 앨범.

docs/PLAN.md §0 '공유 앨범', docs/PRICING.md.

- 서버가 기준이다. 구성원마다 다른 기기에서 동시에 고치므로 계정별 동기화(sync_records)에
  두지 않는다.
- 파일은 올린 사람의 Cloud 파일 하나뿐이고 복사·이동하지 않는다. 앨범이 쓰는 파일은 앨범 용량에서
  센다. 앨범 용량은 구성원이 만들거나 참여할 때 자기 안전 보관 용량에서 떼어 준 할당의 합이다.
- 소유자(관리자 중 한 명)의 요금제가 공유 앨범 수를 정한다. 관리자는 여럿일 수 있다.
- 앨범 공간이 남아 있으면 구독하지 않은 구성원도 사진을 담는다. 보기는 로그인만 하면 된다.
- 사진은 올린 사람이나 관리자만 뺀다.
- 구성원은 사진이나 다른 구성원을 신고하고(운영자가 관리자 화면에서 처리한다), 차단할 수 있다.
  차단한 사람이 담은 사진은 모든 앨범에서 나에게만 보이지 않는다.
- 메모와 장소 이름은 개인 기록이라 다른 구성원에게 보내지 않는다. 촬영 시각·좌표·파일 종류는
  공유 사진의 EXIF와 지도 표시에 필요해 구성원에게 보낸다.
"""

import re
import secrets
from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import delete, func, select, tuple_
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser, DbSession
from app.api.uploads import (
    DOWNLOAD_URL_TTL,
    EXTENSIONS,
    VIDEO_DOWNLOAD_URL_TTL,
    DownloadResponse,
    Variant,
)
from app.cloud import can_write, lock_active_user
from app.config import get_settings
from app.models.cloud import (
    CloudObject,
    ContentReport,
    Entitlement,
    Moment,
    SharedAlbum,
    SharedAlbumInvite,
    SharedAlbumItem,
    SharedAlbumMember,
    User,
    UserBlock,
)
from app.plans import default_plan, plan_limit
from app.shared import (
    ITEM_QUALITY,
    album_limit,
    author_usage,
    can_own_more,
    capacity,
    is_counted,
    item_quality,
    items_of_author,
    lock_album_row,
    member_count,
    moment_data,
    owned_count,
    personal_free,
    recount,
    recount_album,
    refresh_funding,
    remove_items,
    remove_member_rows,
    remove_my_items,
    wanted_variants,
)
from app.shared import delete_album as delete_album_rows
from app.storage import r2_client

router = APIRouter(prefix="/shared-albums", tags=["shared_albums"])

MAX_MEMBERS = 30
ITEM_PAGE_LIMIT = 500
INVITE_TTL = timedelta(days=7)
# 헷갈리는 글자(0/O, 1/I/L)를 뺀 대문자·숫자. 말로 불러 주거나 손으로 옮겨 적기 쉽게 한다.
INVITE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
INVITE_LENGTH = 8
GIB = 1024 * 1024 * 1024
# 만드는 사람은 적어도 이만큼 떼어 준다 (빈 앨범으로 시작하지 않게).
MIN_OWNER_ALLOCATION = GIB

Relation = Literal["family", "friends", "partner", "other"]
Role = Literal["admin", "member"]
Quality = Literal["original", "display"]
CoverMode = Literal["latest", "photo", "design"]
DisplayName = Annotated[str, Field(min_length=1, max_length=20)]
Allocation = Annotated[int, Field(ge=0, le=10 * 1024 * GIB)]
ReportReason = Literal["sexual", "violence", "harassment", "spam", "other"]


def _non_blank(value: str) -> str:
    """API를 직접 부를 때 공백뿐인 앨범명·표시 이름이 저장되지 않게 한다."""
    value = value.strip()
    if not value:
        raise ValueError("must not be blank")
    return value


class CreateSharedAlbumRequest(BaseModel):
    title: str = Field(min_length=1, max_length=40)
    relation: Relation = "other"
    photo_quality: Quality = "original"
    # 이 앨범에서 내가 보일 이름
    display_name: DisplayName
    # 내 안전 보관 용량에서 이 앨범에 떼어 줄 용량
    allocated_bytes: Allocation
    # 나만 보던 안전 앨범을 바꿀 때 그 앨범의 기록. 파일은 다시 올리지 않고 앨범 용량으로 옮겨 센다.
    moment_ids: list[str] = Field(default_factory=list, max_length=5000)
    # 그 기록 중 사진마다 따로 고른 화질 {기록: 화질}. 없는 기록은 앨범 화질을 따른다.
    photo_qualities: dict[str, Quality] = Field(default_factory=dict, max_length=5000)

    @field_validator("title", "display_name")
    @classmethod
    def required_text(cls, value: str) -> str:
        return _non_blank(value)


class UpdateSharedAlbumRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=40)
    relation: Relation | None = None
    photo_quality: Quality | None = None
    # 표지를 바꿀 때만 보낸다. 'photo'면 cover_item_id, 'design'이면 cover_emoji를 함께 보낸다.
    cover_mode: CoverMode | None = None
    cover_item_id: str | None = Field(default=None, max_length=36)
    cover_emoji: str | None = Field(default=None, min_length=1, max_length=16)

    @field_validator("title")
    @classmethod
    def required_title(cls, value: str | None) -> str | None:
        return _non_blank(value) if value is not None else None


class AlbumStorage(BaseModel):
    # 앨범이 쓰는 파일의 크기
    bytes_total: int
    # 구성원 할당의 합 (구독이 끝난 사람의 할당은 세지 않는다) + 추가 용량
    capacity_bytes: int
    # 추가 구매한 용량 (결제는 아직 없다)
    extra_bytes: int
    # 내가 떼어 준 용량
    my_allocation: int
    # 사용량이 용량보다 크다 (구성원이 나갔거나 구독이 끝났을 때). 새 사진을 담을 수 없다.
    over_capacity: bool
    # 나눠 준 용량이 하나도 없어 사진을 정리할 시각 (구성원에게 알린 뒤에만 값이 있다)
    cleanup_after: datetime | None


class SharedAlbumSummary(BaseModel):
    id: str
    title: str
    relation: Relation
    photo_quality: Quality
    role: Role
    is_owner: bool
    member_count: int
    item_count: int
    cover_mode: CoverMode
    # 표지로 쓸 항목 (표시용 사진이 올라간 것). 고른 항목이 빠졌거나 아직 올라가지 않았으면
    # 가장 최근 항목.
    cover_item_id: str | None
    # cover_mode가 'design'일 때 그릴 이모지
    cover_emoji: str | None
    storage: AlbumStorage
    # 새 사진을 담을 수 있는지
    writable: bool
    updated_at: datetime


class MemberOut(BaseModel):
    user_id: str
    display_name: str
    role: Role
    is_owner: bool
    allocated_bytes: int
    # 할당이 앨범 용량에 들어가는지 (구독이 끝나면 들어가지 않는다)
    allocation_counted: bool
    joined_at: datetime
    is_me: bool
    # 내가 차단한 사람 (그 사람이 담은 사진은 나에게 보이지 않는다)
    blocked: bool


class ContributorOut(BaseModel):
    """사진을 담은 사람별 사용량. 용량이 넘쳤을 때 누구의 사진을 정리할지 고르는 데 쓴다."""

    author_id: str
    display_name: str | None
    is_member: bool
    is_me: bool
    item_count: int
    bytes: int


class InviteOut(BaseModel):
    code: str
    expires_at: datetime


class SharedAlbumDetail(SharedAlbumSummary):
    members: list[MemberOut]
    contributors: list[ContributorOut]
    # 관리자에게만 보여준다
    invite: InviteOut | None


class SharedAlbumList(BaseModel):
    albums: list[SharedAlbumSummary]
    # 내가 소유한 공유 앨범 수와 요금제 한도 (구독하지 않으면 0)
    owned: int
    limit: int
    # 할당이나 개인 사진에 더 쓸 수 있는 내 용량
    free_bytes: int
    # 만들거나 참여할 때 처음 보여 줄 할당
    suggested_allocation: int


class SharedItemOut(BaseModel):
    id: str
    author_id: str
    author_name: str
    is_mine: bool
    # 올린 사람이거나 관리자
    can_delete: bool
    # 내가 담은 항목이면 내 기록 id (기기 사진첩 원본으로 그린다).
    # 다른 사람의 기록 id는 보내지 않는다.
    moment_id: str | None
    media_type: Literal["photo", "video"]
    duration: float | None
    taken_at: str | None
    taken_tz_offset: int | None
    lat: float | None
    lng: float | None
    width: int | None
    height: int | None
    stored_variants: list[Variant]
    # 이 사진의 화질 (사진마다 고른 화질, 없으면 앨범 화질)
    photo_quality: Quality
    # 사진마다 따로 고른 화질인지
    quality_chosen: bool
    added_at: datetime


class SharedItemsPage(BaseModel):
    items: list[SharedItemOut]
    cursor: int
    has_more: bool


class AddItemsRequest(BaseModel):
    moment_ids: list[str] = Field(min_length=1, max_length=500)
    # 담는 사진에 따로 고른 화질. None이면 앨범 화질을 따른다.
    photo_quality: Quality | None = None


class ItemQualityRequest(BaseModel):
    item_ids: list[str] = Field(min_length=1, max_length=500)
    # None이면 앨범 화질을 따르게 되돌린다.
    photo_quality: Quality | None


class AddItemsResponse(BaseModel):
    added: int


class RemoveItemsRequest(BaseModel):
    item_ids: list[str] = Field(min_length=1, max_length=500)


class MyItemRow(BaseModel):
    album_id: str
    moment_id: str
    photo_quality: Quality


class MyItemsResponse(BaseModel):
    """내가 담은 항목 전체 (나간 앨범에 남긴 사진 포함). 기기는 이 목록으로 올릴 파일과
    지우면 안 되는 파일을 정한다.
    """

    items: list[MyItemRow]


class InvitePreview(BaseModel):
    album_id: str
    title: str
    relation: Relation
    member_count: int
    invited_by: str | None
    already_member: bool


class JoinRequest(BaseModel):
    code: str = Field(min_length=4, max_length=16)
    display_name: DisplayName
    # 구독하지 않았으면 0 (보고 담기만 한다)
    allocated_bytes: Allocation = 0

    @field_validator("display_name")
    @classmethod
    def required_display_name(cls, value: str) -> str:
        return _non_blank(value)


class UpdateMemberRequest(BaseModel):
    role: Role | None = None
    display_name: DisplayName | None = None
    # 내 할당만 바꾼다
    allocated_bytes: Allocation | None = None

    @field_validator("display_name")
    @classmethod
    def required_display_name(cls, value: str | None) -> str | None:
        return _non_blank(value) if value is not None else None


class TransferOwnerRequest(BaseModel):
    user_id: str = Field(max_length=36)


class ReportRequest(BaseModel):
    # 사진을 신고하면 item_id, 구성원을 신고하면 user_id를 보낸다.
    item_id: str | None = Field(default=None, max_length=36)
    user_id: str | None = Field(default=None, max_length=36)
    reason: ReportReason
    detail: str | None = Field(default=None, max_length=500)


class BlockRequest(BaseModel):
    user_id: str = Field(max_length=36)


class BlockedUserOut(BaseModel):
    user_id: str
    display_name: str | None
    blocked_at: datetime


class BlockList(BaseModel):
    users: list[BlockedUserOut]


class LeavePreview(BaseModel):
    """구성원이 빠지면 그 사람의 할당만큼 용량이 준다. 사진을 남길지 고르기 전에 보여준다."""

    capacity_before: int
    capacity_after: int
    bytes_total: int
    member_bytes: int
    member_items: int
    over_if_kept: bool
    over_if_removed: bool


# ---------------------------------------------------------------------------
# 권한·용량


def _membership(db: Session, album_id: str, user_id: str) -> SharedAlbumMember:
    member = db.get(SharedAlbumMember, (album_id, user_id))
    if member is None:
        # 구성원이 아니면 앨범이 있는지도 알리지 않는다.
        raise HTTPException(status.HTTP_404_NOT_FOUND, "shared album not found")
    return member


def _blocked_ids(user_id: str):
    """내가 차단한 사람들 (서브쿼리). 그 사람이 담은 항목은 목록·표지·내려받기에서 뺀다."""
    return select(UserBlock.blocked_id).where(UserBlock.blocker_id == user_id)


def _require_admin(member: SharedAlbumMember) -> None:
    if member.role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "only admins can do this")


def _lock_album(db: Session, album_id: str) -> SharedAlbum:
    album = lock_album_row(db, album_id)
    if album is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "shared album not found")
    return album


def _require_my_space(db: Session, user_id: str) -> None:
    """할당을 늘린 뒤 확인한다. 개인 사용량과 할당의 합이 요금제 용량을 넘으면 되돌린다."""
    if personal_free(db, user_id) < 0:
        db.rollback()
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "not enough Cloud storage")


def _require_room(db: Session, album: SharedAlbum) -> None:
    """앨범이 쓰는 파일이 앨범 용량을 넘으면 되돌린다."""
    if album.bytes_total > capacity(db, album):
        db.rollback()
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "shared album storage is full")


def _storage(db: Session, album: SharedAlbum, user_id: str) -> AlbumStorage:
    used = album.bytes_total
    cap = capacity(db, album)
    mine = db.get(SharedAlbumMember, (album.id, user_id))
    return AlbumStorage(
        bytes_total=used,
        capacity_bytes=cap,
        extra_bytes=album.extra_bytes,
        my_allocation=mine.allocated_bytes if mine else 0,
        over_capacity=used > cap,
        cleanup_after=(
            album.unfunded_notified_at + timedelta(days=get_settings().shared_album_grace_days)
            if album.unfunded_since is not None and album.unfunded_notified_at is not None
            else None
        ),
    )


# ---------------------------------------------------------------------------
# 응답


def _summaries(
    db: Session, user_id: str, album_ids: list[str] | None = None
) -> list[SharedAlbumDetail]:
    query = (
        select(SharedAlbum, SharedAlbumMember.role)
        .join(SharedAlbumMember, SharedAlbumMember.album_id == SharedAlbum.id)
        .where(SharedAlbumMember.user_id == user_id)
        .order_by(SharedAlbum.updated_at.desc())
    )
    if album_ids is not None:
        query = query.where(SharedAlbum.id.in_(album_ids))
    rows = db.execute(query).all()
    ids = [album.id for album, _ in rows]
    if not ids:
        return []
    hidden = _blocked_ids(user_id)
    item_counts = dict(
        db.execute(
            select(SharedAlbumItem.album_id, func.count())
            .where(SharedAlbumItem.album_id.in_(ids), SharedAlbumItem.author_id.not_in(hidden))
            .group_by(SharedAlbumItem.album_id)
        ).all()
    )
    has_display = (
        (CloudObject.user_id == SharedAlbumItem.author_id)
        & (CloudObject.moment_id == SharedAlbumItem.moment_id)
        & (CloudObject.variant == "display")
        & (CloudObject.status == "stored")
    )
    latest = (
        select(
            SharedAlbumItem.album_id,
            SharedAlbumItem.id,
            func.row_number()
            .over(partition_by=SharedAlbumItem.album_id, order_by=SharedAlbumItem.seq.desc())
            .label("rank"),
        )
        .join(CloudObject, has_display)
        .where(SharedAlbumItem.album_id.in_(ids), SharedAlbumItem.author_id.not_in(hidden))
        .subquery()
    )
    covers = dict(
        db.execute(select(latest.c.album_id, latest.c.id).where(latest.c.rank == 1)).all()
    )
    # 고른 표지가 아직 앨범에 있고 표시용 사진이 올라갔을 때만 그 항목을 쓴다.
    chosen = [
        album.cover_item_id
        for album, _ in rows
        if album.cover_mode == "photo" and album.cover_item_id is not None
    ]
    if chosen:
        covers.update(
            db.execute(
                select(SharedAlbumItem.album_id, SharedAlbumItem.id)
                .join(CloudObject, has_display)
                .where(
                    SharedAlbumItem.id.in_(chosen),
                    SharedAlbumItem.album_id.in_(ids),
                    SharedAlbumItem.author_id.not_in(hidden),
                )
            ).all()
        )
    result = []
    for album, role in rows:
        storage = _storage(db, album, user_id)
        result.append(
            SharedAlbumDetail(
                id=album.id,
                title=album.title,
                relation=album.relation,  # type: ignore[arg-type]
                photo_quality=album.photo_quality,  # type: ignore[arg-type]
                role=role,
                is_owner=album.owner_id == user_id,
                member_count=member_count(db, album.id),
                item_count=item_counts.get(album.id, 0),
                cover_mode=album.cover_mode,  # type: ignore[arg-type]
                cover_item_id=covers.get(album.id),
                cover_emoji=album.cover_emoji if album.cover_mode == "design" else None,
                storage=storage,
                writable=storage.bytes_total < storage.capacity_bytes,
                updated_at=album.updated_at,
                members=[],
                contributors=[],
                invite=None,
            )
        )
    return result


def _detail(db: Session, album_id: str, user_id: str) -> SharedAlbumDetail:
    found = _summaries(db, user_id, [album_id])
    if not found:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "shared album not found")
    detail = found[0]
    album = db.get(SharedAlbum, album_id)
    assert album is not None
    members = db.scalars(
        select(SharedAlbumMember)
        .where(SharedAlbumMember.album_id == album_id)
        .order_by(SharedAlbumMember.joined_at, SharedAlbumMember.user_id)
    ).all()
    names = {member.user_id: member.display_name for member in members}
    blocked = set(db.scalars(_blocked_ids(user_id)))
    detail.members = [
        MemberOut(
            user_id=member.user_id,
            display_name=member.display_name,
            role=member.role,  # type: ignore[arg-type]
            is_owner=member.user_id == album.owner_id,
            allocated_bytes=member.allocated_bytes,
            allocation_counted=member.allocated_bytes > 0 and is_counted(db, member.user_id),
            joined_at=member.joined_at,
            is_me=member.user_id == user_id,
            blocked=member.user_id in blocked,
        )
        for member in members
    ]
    counts = dict(
        db.execute(
            select(SharedAlbumItem.author_id, func.count())
            .where(SharedAlbumItem.album_id == album_id)
            .group_by(SharedAlbumItem.author_id)
        ).all()
    )
    sizes = author_usage(db, album_id)
    detail.contributors = sorted(
        (
            ContributorOut(
                author_id=author_id,
                display_name=names.get(author_id),
                is_member=author_id in names,
                is_me=author_id == user_id,
                item_count=count,
                bytes=sizes.get(author_id, 0),
            )
            for author_id, count in counts.items()
        ),
        key=lambda row: -row.bytes,
    )
    if detail.role == "admin":
        invite = db.scalar(select(SharedAlbumInvite).where(SharedAlbumInvite.album_id == album_id))
        if invite is not None and _aware(invite.expires_at) > datetime.now(UTC):
            detail.invite = InviteOut(code=invite.code, expires_at=invite.expires_at)
    return detail


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=UTC)


def _number(value: object) -> float | None:
    return float(value) if isinstance(value, int | float) and not isinstance(value, bool) else None


def _int(value: object) -> int | None:
    return int(value) if isinstance(value, int | float) and not isinstance(value, bool) else None


def _add_items(
    db: Session,
    album: SharedAlbum,
    user_id: str,
    moment_ids: list[str],
    qualities: dict[str, str] | None = None,
) -> int:
    """내 기록을 항목으로 넣는다 (커밋하지 않는다). 서버에 없거나 지운 기록은 건너뛴다.
    qualities: 사진마다 고른 화질 {기록: 화질}.
    """
    wanted = list(dict.fromkeys(moment_ids))
    moments = {
        row.id: row
        for row in db.scalars(
            select(Moment).where(
                Moment.user_id == user_id, Moment.id.in_(wanted), Moment.deleted_at.is_(None)
            )
        )
    }
    existing = set(
        db.scalars(
            select(SharedAlbumItem.moment_id).where(
                SharedAlbumItem.album_id == album.id,
                SharedAlbumItem.author_id == user_id,
                SharedAlbumItem.moment_id.in_(wanted),
            )
        )
    )
    added = 0
    for moment_id in wanted:
        moment = moments.get(moment_id)
        if moment is None or moment_id in existing:
            continue
        data = moment_data(moment)
        album.item_seq += 1
        db.add(
            SharedAlbumItem(
                id=str(uuid4()),
                album_id=album.id,
                author_id=user_id,
                moment_id=moment_id,
                seq=album.item_seq,
                photo_quality=(qualities or {}).get(moment_id),
                media_type="video" if data.get("media_type") == "video" else "photo",
                duration=_number(data.get("duration")),
                taken_at=data.get("taken_at") if isinstance(data.get("taken_at"), str) else None,
                taken_tz_offset=_int(data.get("taken_tz_offset")),
                lat=_number(data.get("lat")),
                lng=_number(data.get("lng")),
                width=_int(data.get("width")),
                height=_int(data.get("height")),
            )
        )
        added += 1
    if added:
        album.updated_at = datetime.now(UTC)
        # 이미 안전 보관한 파일은 담는 순간 앨범 사용량이 된다.
        recount(db, user_id, wanted, [album])
    return added


def _set_cover(db: Session, album: SharedAlbum, payload: UpdateSharedAlbumRequest) -> None:
    """표지를 바꾼다 (커밋하지 않는다). 고른 항목은 이 앨범에 있어야 한다."""
    item_id = None
    emoji = None
    if payload.cover_mode == "photo":
        item = db.get(SharedAlbumItem, payload.cover_item_id) if payload.cover_item_id else None
        if item is None or item.album_id != album.id:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "cover item not in album")
        item_id = item.id
    elif payload.cover_mode == "design":
        emoji = (payload.cover_emoji or "").strip() or "✨"
    album.cover_mode = payload.cover_mode  # type: ignore[assignment]
    album.cover_item_id = item_id
    album.cover_emoji = emoji


# ---------------------------------------------------------------------------
# 앨범


@router.get("", response_model=SharedAlbumList)
def list_albums(user: CurrentUser, db: DbSession) -> SharedAlbumList:
    return SharedAlbumList(
        albums=[
            SharedAlbumSummary(**row.model_dump(exclude={"members", "contributors", "invite"}))
            for row in _summaries(db, user.id)
        ],
        owned=owned_count(db, user.id),
        limit=album_limit(db, user.id),
        free_bytes=max(personal_free(db, user.id), 0),
        suggested_allocation=(
            plan_limit(db.get(Entitlement, user.id)) or default_plan()
        ).suggested_allocation,
    )


@router.post("", response_model=SharedAlbumDetail, status_code=status.HTTP_201_CREATED)
def create_album(
    payload: CreateSharedAlbumRequest, user: CurrentUser, db: DbSession
) -> SharedAlbumDetail:
    """공유 앨범은 안전 보관 요금제의 기능이다. 요금제마다 소유할 수 있는 수가 정해져 있고,
    만드는 사람은 자기 용량에서 앨범 용량을 떼어 준다.

    moment_ids(안전 앨범 바꾸기): 그 사진이 이미 쓰던 개인 용량은 앨범 용량으로 옮겨 센다.
    할당이 그 사진들보다 작으면 거절한다.
    """
    lock_active_user(db, user.id)
    if not can_write(db.get(Entitlement, user.id)):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "an active Cloud subscription is required")
    if not can_own_more(db, user.id):
        raise HTTPException(status.HTTP_409_CONFLICT, "shared album limit reached")
    if payload.allocated_bytes < MIN_OWNER_ALLOCATION:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "allocation is too small")
    album = SharedAlbum(
        id=str(uuid4()),
        title=payload.title.strip(),
        relation=payload.relation,
        photo_quality=payload.photo_quality,
        owner_id=user.id,
    )
    db.add(album)
    db.flush()
    db.add(
        SharedAlbumMember(
            album_id=album.id,
            user_id=user.id,
            role="admin",
            display_name=payload.display_name.strip(),
            allocated_bytes=payload.allocated_bytes,
        )
    )
    db.flush()
    _add_items(db, album, user.id, payload.moment_ids, dict(payload.photo_qualities))
    _require_room(db, album)
    _require_my_space(db, user.id)
    db.commit()
    return _detail(db, album.id, user.id)


@router.get("/my-items", response_model=MyItemsResponse)
def my_items(user: CurrentUser, db: DbSession) -> MyItemsResponse:
    rows = db.execute(
        select(SharedAlbumItem.album_id, SharedAlbumItem.moment_id, ITEM_QUALITY)
        .join(SharedAlbum, SharedAlbum.id == SharedAlbumItem.album_id)
        .where(SharedAlbumItem.author_id == user.id)
        .order_by(SharedAlbumItem.album_id, SharedAlbumItem.moment_id)
    ).all()
    return MyItemsResponse(
        items=[
            MyItemRow(album_id=album_id, moment_id=moment_id, photo_quality=quality)
            for album_id, moment_id, quality in rows
        ]
    )


class RemoveMyItemsRequest(BaseModel):
    moment_ids: list[str] = Field(min_length=1, max_length=500)


class RemoveMyItemsResponse(BaseModel):
    removed: int


@router.post("/my-items/remove", response_model=RemoveMyItemsResponse)
def remove_my_moments(
    payload: RemoveMyItemsRequest, user: CurrentUser, db: DbSession
) -> RemoveMyItemsResponse:
    """내 기록을 모든 공유 앨범에서 뺀다. 기록을 지우며 공유 앨범에서도 빼기로 했을 때 기기가
    부른다."""
    lock_active_user(db, user.id)
    removed = remove_my_items(db, user.id, list(dict.fromkeys(payload.moment_ids)))
    db.commit()
    return RemoveMyItemsResponse(removed=removed)


@router.get("/blocks", response_model=BlockList)
def list_blocks(user: CurrentUser, db: DbSession) -> BlockList:
    rows = db.scalars(
        select(UserBlock)
        .where(UserBlock.blocker_id == user.id)
        .order_by(UserBlock.created_at.desc())
    ).all()
    return BlockList(
        users=[
            BlockedUserOut(
                user_id=row.blocked_id, display_name=row.display_name, blocked_at=row.created_at
            )
            for row in rows
        ]
    )


@router.delete("/blocks/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def unblock(user_id: str, user: CurrentUser, db: DbSession) -> None:
    db.execute(
        delete(UserBlock).where(UserBlock.blocker_id == user.id, UserBlock.blocked_id == user_id)
    )
    db.commit()


@router.get("/invites/{code}", response_model=InvitePreview)
def preview_invite(code: str, user: CurrentUser, db: DbSession) -> InvitePreview:
    invite = _valid_invite(db, code)
    album = db.get(SharedAlbum, invite.album_id)
    assert album is not None
    inviter = (
        db.get(SharedAlbumMember, (album.id, invite.created_by)) if invite.created_by else None
    )
    return InvitePreview(
        album_id=album.id,
        title=album.title,
        relation=album.relation,  # type: ignore[arg-type]
        member_count=member_count(db, album.id),
        invited_by=inviter.display_name if inviter else None,
        already_member=db.get(SharedAlbumMember, (album.id, user.id)) is not None,
    )


@router.post("/join", response_model=SharedAlbumDetail)
def join_album(payload: JoinRequest, user: CurrentUser, db: DbSession) -> SharedAlbumDetail:
    """초대 코드로 참여한다. 구독 중이면 내 용량에서 앨범 용량을 떼어 줄 수 있다."""
    lock_active_user(db, user.id)
    invite = _valid_invite(db, payload.code)
    album = _lock_album(db, invite.album_id)
    if db.get(SharedAlbumMember, (album.id, user.id)) is None:
        if member_count(db, album.id) >= MAX_MEMBERS:
            raise HTTPException(status.HTTP_409_CONFLICT, "shared album is full")
        db.add(
            SharedAlbumMember(
                album_id=album.id,
                user_id=user.id,
                role="member",
                display_name=payload.display_name.strip(),
                allocated_bytes=payload.allocated_bytes,
            )
        )
        album.updated_at = datetime.now(UTC)
        db.flush()
        if payload.allocated_bytes > 0:
            _require_my_space(db, user.id)
        refresh_funding(db, album)
        db.commit()
    return _detail(db, album.id, user.id)


def _valid_invite(db: Session, code: str) -> SharedAlbumInvite:
    # 말로 불러 주거나 옮겨 적은 코드의 공백·하이픈과 대소문자는 무시한다 (앱 normalizeCode와 같다).
    invite = db.get(SharedAlbumInvite, re.sub(r"[^0-9A-Za-z]", "", code).upper())
    if invite is None or _aware(invite.expires_at) <= datetime.now(UTC):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "invite not found")
    return invite


@router.get("/{album_id}", response_model=SharedAlbumDetail)
def get_album(album_id: str, user: CurrentUser, db: DbSession) -> SharedAlbumDetail:
    _membership(db, album_id, user.id)
    return _detail(db, album_id, user.id)


@router.patch("/{album_id}", response_model=SharedAlbumDetail)
def update_album(
    album_id: str, payload: UpdateSharedAlbumRequest, user: CurrentUser, db: DbSession
) -> SharedAlbumDetail:
    album = _lock_album(db, album_id)
    _require_admin(_membership(db, album_id, user.id))
    if payload.title is not None:
        album.title = payload.title.strip()
    if payload.relation is not None:
        album.relation = payload.relation
    if payload.photo_quality is not None and payload.photo_quality != album.photo_quality:
        # 담은 사람의 기기가 다음 동기화에서 새 화질에 맞춰 올리고 지운다 (/shared-albums/my-items).
        # 필요 없어진 원본은 지금부터 앨범이 아니라 올린 사람의 개인 사용량에서 센다.
        album.photo_quality = payload.photo_quality
        recount_album(db, album)
        # 이미 올린 원본을 다시 앨범 사용량으로 세면 할당을 넘을 수 있다. 새 항목을 담을 때와
        # 마찬가지로 이 변경 전체를 거절해야, 기본 화질만 바꿔 앨범을 초과 상태로 만들 수 없다.
        _require_room(db, album)
    if payload.cover_mode is not None:
        _set_cover(db, album, payload)
    album.updated_at = datetime.now(UTC)
    refresh_funding(db, album)
    db.commit()
    return _detail(db, album_id, user.id)


@router.delete("/{album_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_album(album_id: str, user: CurrentUser, db: DbSession) -> None:
    """관리자가 앨범을 지운다. 구성원의 기록은 남고, 다른 앨범에 필요 없는 파일은 각자의 기기가
    지운다."""
    album = _lock_album(db, album_id)
    _require_admin(_membership(db, album_id, user.id))
    delete_album_rows(db, album)
    db.commit()


@router.post("/{album_id}/owner", response_model=SharedAlbumDetail)
def transfer_owner(
    album_id: str, payload: TransferOwnerRequest, user: CurrentUser, db: DbSession
) -> SharedAlbumDetail:
    """소유자를 넘긴다. 받는 사람은 구독 중이고 요금제의 공유 앨범 수에 여유가 있어야 한다."""
    album = _lock_album(db, album_id)
    _membership(db, album_id, user.id)
    if album.owner_id != user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "only the owner can transfer the album")
    target = db.get(SharedAlbumMember, (album_id, payload.user_id))
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "member not found")
    if payload.user_id != user.id:
        if not can_own_more(db, payload.user_id):
            raise HTTPException(status.HTTP_409_CONFLICT, "member cannot own another album")
        target.role = "admin"
        album.owner_id = payload.user_id
        album.updated_at = datetime.now(UTC)
        db.commit()
    return _detail(db, album_id, user.id)


# ---------------------------------------------------------------------------
# 초대


@router.post("/{album_id}/invite", response_model=InviteOut)
def create_invite(album_id: str, user: CurrentUser, db: DbSession) -> InviteOut:
    """새 초대 코드를 만든다. 이전 코드는 더 쓸 수 없다."""
    _lock_album(db, album_id)
    _require_admin(_membership(db, album_id, user.id))
    db.execute(delete(SharedAlbumInvite).where(SharedAlbumInvite.album_id == album_id))
    code = "".join(secrets.choice(INVITE_ALPHABET) for _ in range(INVITE_LENGTH))
    invite = SharedAlbumInvite(
        code=code,
        album_id=album_id,
        created_by=user.id,
        expires_at=datetime.now(UTC) + INVITE_TTL,
    )
    db.add(invite)
    db.commit()
    return InviteOut(code=invite.code, expires_at=invite.expires_at)


@router.delete("/{album_id}/invite", status_code=status.HTTP_204_NO_CONTENT)
def revoke_invite(album_id: str, user: CurrentUser, db: DbSession) -> None:
    _lock_album(db, album_id)
    _require_admin(_membership(db, album_id, user.id))
    db.execute(delete(SharedAlbumInvite).where(SharedAlbumInvite.album_id == album_id))
    db.commit()


# ---------------------------------------------------------------------------
# 구성원


@router.patch("/{album_id}/members/{member_id}", response_model=SharedAlbumDetail)
def update_member(
    album_id: str,
    member_id: str,
    payload: UpdateMemberRequest,
    user: CurrentUser,
    db: DbSession,
) -> SharedAlbumDetail:
    """이름과 할당은 자기 것만 바꾼다. 역할은 관리자가 바꾼다 (관리자는 여럿일 수 있다).

    소유자는 관리자에서 해제할 수 없고, 관리자가 한 명도 없게 만들 수는 없다.
    할당은 내 남은 용량 안에서 늘리고, 앨범이 이미 쓰는 만큼보다 작게 줄일 수 없다.
    """
    if payload.allocated_bytes is not None:
        lock_active_user(db, user.id)
    album = _lock_album(db, album_id)
    me = _membership(db, album_id, user.id)
    target = db.get(SharedAlbumMember, (album_id, member_id))
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "member not found")
    if (payload.display_name is not None or payload.allocated_bytes is not None) and (
        member_id != user.id
    ):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "you can only change your own settings")
    if payload.display_name is not None:
        target.display_name = payload.display_name.strip()
    if payload.allocated_bytes is not None and payload.allocated_bytes != target.allocated_bytes:
        smaller = payload.allocated_bytes < target.allocated_bytes
        target.allocated_bytes = payload.allocated_bytes
        db.flush()
        if smaller and album.bytes_total > capacity(db, album):
            db.rollback()
            raise HTTPException(status.HTTP_409_CONFLICT, "allocation is below the album usage")
        if not smaller:
            _require_my_space(db, user.id)
    if payload.role is not None and payload.role != target.role:
        _require_admin(me)
        if payload.role == "member":
            if member_id == album.owner_id:
                raise HTTPException(status.HTTP_409_CONFLICT, "the owner must stay an admin")
            admins = db.scalar(
                select(func.count()).where(
                    SharedAlbumMember.album_id == album_id, SharedAlbumMember.role == "admin"
                )
            )
            if (admins or 0) <= 1:
                raise HTTPException(status.HTTP_409_CONFLICT, "an album needs at least one admin")
        target.role = payload.role
    album.updated_at = datetime.now(UTC)
    refresh_funding(db, album)
    db.commit()
    return _detail(db, album_id, user.id)


@router.get("/{album_id}/members/{member_id}/leave-preview", response_model=LeavePreview)
def leave_preview(album_id: str, member_id: str, user: CurrentUser, db: DbSession) -> LeavePreview:
    album = db.get(SharedAlbum, album_id)
    me = _membership(db, album_id, user.id)
    if member_id != user.id:
        _require_admin(me)
    if album is None or db.get(SharedAlbumMember, (album_id, member_id)) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "member not found")
    usage = author_usage(db, album_id)
    used = album.bytes_total
    after = capacity(db, album, without=member_id)
    theirs = usage.get(member_id, 0)
    return LeavePreview(
        capacity_before=capacity(db, album),
        capacity_after=after,
        bytes_total=used,
        member_bytes=theirs,
        member_items=len(items_of_author(db, album_id, member_id)),
        over_if_kept=used > after,
        over_if_removed=used - theirs > after,
    )


@router.delete("/{album_id}/members/{member_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_member(
    album_id: str,
    member_id: str,
    user: CurrentUser,
    db: DbSession,
    photos: Literal["keep", "remove"] = "remove",
) -> None:
    """스스로 나가거나, 관리자가 구성원을 내보낸다. 그 사람의 할당도 빠진다.

    photos=keep: 그 사람이 담은 사진을 앨범에 남긴다. 용량이 넘치면 새 사진을 받지 않고,
    관리자가 사진을 정리하거나 다른 구성원이 할당을 늘려 푼다.
    """
    album = _lock_album(db, album_id)
    me = _membership(db, album_id, user.id)
    if member_id != user.id:
        _require_admin(me)
        if db.get(SharedAlbumMember, (album_id, member_id)) is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "member not found")
    remove_member_rows(db, album, member_id, keep_photos=photos == "keep")
    db.commit()


# ---------------------------------------------------------------------------
# 신고·차단


def _other_person(db: Session, album_id: str, user_id: str, target_id: str) -> str | None:
    """이 앨범의 구성원이거나 사진을 남긴 다른 사람이면 그 사람의 이 앨범 이름을 준다 (나간 사람은
    None). 아니면 404, 나 자신이면 422."""
    if target_id == user_id:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "cannot target yourself")
    member = db.get(SharedAlbumMember, (album_id, target_id))
    if member is not None:
        return member.display_name
    if not items_of_author(db, album_id, target_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "member not found")
    return None


@router.post("/{album_id}/reports", status_code=status.HTTP_204_NO_CONTENT)
def report(album_id: str, payload: ReportRequest, user: CurrentUser, db: DbSession) -> None:
    """사진이나 구성원을 신고한다. 운영자가 관리자 화면에서 보고 사진을 빼거나 구성원을 내보낸다."""
    _membership(db, album_id, user.id)
    album = db.get(SharedAlbum, album_id)
    assert album is not None
    item = None
    if payload.item_id is not None:
        item = db.get(SharedAlbumItem, payload.item_id)
        if item is None or item.album_id != album_id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "item not found")
        target_id = item.author_id
    elif payload.user_id is not None:
        target_id = payload.user_id
    else:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "item_id or user_id is required")
    name = _other_person(db, album_id, user.id, target_id)
    # 같은 대상을 같은 이유로 처리 전에 또 신고하면 하나만 둔다 (반복 신고로 처리 목록이 늘지 않게).
    pending = db.scalar(
        select(ContentReport.id).where(
            ContentReport.reporter_id == user.id,
            ContentReport.album_id == album_id,
            ContentReport.reported_user_id == target_id,
            ContentReport.item_id.is_(None) if item is None else ContentReport.item_id == item.id,
            ContentReport.reason == payload.reason,
            ContentReport.status == "open",
        )
    )
    if pending is not None:
        return
    db.add(
        ContentReport(
            reporter_id=user.id,
            album_id=album_id,
            album_title=album.title,
            reported_user_id=target_id,
            reported_name=name,
            item_id=item.id if item else None,
            moment_id=item.moment_id if item else None,
            reason=payload.reason,
            detail=(payload.detail or "").strip() or None,
        )
    )
    db.commit()


@router.post("/{album_id}/blocks", status_code=status.HTTP_204_NO_CONTENT)
def block(album_id: str, payload: BlockRequest, user: CurrentUser, db: DbSession) -> None:
    """이 앨범에서 만난 사람을 차단한다. 그 사람이 담은 사진은 모든 공유 앨범에서 나에게 보이지
    않는다."""
    _membership(db, album_id, user.id)
    name = _other_person(db, album_id, user.id, payload.user_id)
    if db.get(User, payload.user_id) is None:
        return  # 계정을 지운 사람은 차단할 행이 없다 (user_blocks의 FK).
    if db.get(UserBlock, (user.id, payload.user_id)) is None:
        db.add(UserBlock(blocker_id=user.id, blocked_id=payload.user_id, display_name=name))
        db.commit()


# ---------------------------------------------------------------------------
# 항목


@router.get("/{album_id}/items", response_model=SharedItemsPage)
def list_items(
    album_id: str,
    user: CurrentUser,
    db: DbSession,
    cursor: Annotated[int, Query(ge=0)] = 0,
) -> SharedItemsPage:
    me = _membership(db, album_id, user.id)
    album = db.get(SharedAlbum, album_id)
    assert album is not None
    rows = db.execute(
        select(SharedAlbumItem, SharedAlbumMember.display_name)
        .outerjoin(
            SharedAlbumMember,
            (SharedAlbumMember.album_id == SharedAlbumItem.album_id)
            & (SharedAlbumMember.user_id == SharedAlbumItem.author_id),
        )
        .where(
            SharedAlbumItem.album_id == album_id,
            SharedAlbumItem.seq > cursor,
            SharedAlbumItem.author_id.not_in(_blocked_ids(user.id)),
        )
        .order_by(SharedAlbumItem.seq)
        .limit(ITEM_PAGE_LIMIT + 1)
    ).all()
    page = rows[:ITEM_PAGE_LIMIT]
    stored: dict[tuple[str, str], set[str]] = {}
    by_author: dict[str, set[str]] = {}
    for item, _ in page:
        by_author.setdefault(item.author_id, set()).add(item.moment_id)
    for author_id, moment_ids in by_author.items():
        for moment_id, variant in db.execute(
            select(CloudObject.moment_id, CloudObject.variant).where(
                CloudObject.user_id == author_id,
                CloudObject.moment_id.in_(sorted(moment_ids)),
                CloudObject.status == "stored",
            )
        ).all():
            stored.setdefault((author_id, moment_id), set()).add(variant)
    # 좌표 열을 추가하기 전부터 있던 공유 항목도, 원 기록이 남아 있으면 지도에 바로 보인다.
    # 사진을 남기고 기록을 지운 항목은 당시 스냅샷(null)만 쓰므로 위치를 새로 노출하지 않는다.
    locations: dict[tuple[str, str], tuple[float | None, float | None]] = {}
    keys = [(item.author_id, item.moment_id) for item, _ in page]
    if keys:
        for moment in db.scalars(select(Moment).where(tuple_(Moment.user_id, Moment.id).in_(keys))):
            data = moment_data(moment)
            locations[(moment.user_id, moment.id)] = (
                _number(data.get("lat")),
                _number(data.get("lng")),
            )
    items = []
    for item, name in page:
        mine = item.author_id == user.id
        saved_lat, saved_lng = locations.get((item.author_id, item.moment_id), (None, None))
        items.append(
            SharedItemOut(
                id=item.id,
                author_id=item.author_id,
                author_name=name or "나간 구성원",
                is_mine=mine,
                can_delete=mine or me.role == "admin",
                moment_id=item.moment_id if mine else None,
                media_type="video" if item.media_type == "video" else "photo",
                duration=item.duration,
                taken_at=item.taken_at,
                taken_tz_offset=item.taken_tz_offset,
                lat=item.lat if item.lat is not None else saved_lat,
                lng=item.lng if item.lng is not None else saved_lng,
                width=item.width,
                height=item.height,
                # 효율 보관 사진은 원본이 개인 Cloud에 남아 있어도 공유하지 않는다.
                stored_variants=sorted(
                    stored.get((item.author_id, item.moment_id), set())
                    & wanted_variants(
                        item_quality(item, album),
                        item.media_type,
                        stored.get((item.author_id, item.moment_id), set()),
                    )
                ),  # type: ignore[arg-type]
                photo_quality=item_quality(item, album),  # type: ignore[arg-type]
                quality_chosen=item.photo_quality is not None,
                added_at=item.added_at,
            )
        )
    return SharedItemsPage(
        items=items,
        cursor=page[-1][0].seq if page else cursor,
        has_more=len(rows) > ITEM_PAGE_LIMIT,
    )


@router.post("/{album_id}/items", response_model=AddItemsResponse)
def add_items(
    album_id: str, payload: AddItemsRequest, user: CurrentUser, db: DbSession
) -> AddItemsResponse:
    """내 기록을 담는다. 개인 안전 보관에 이미 있는 파일은 다시 올리지 않고 앨범 용량으로 옮겨 센다.
    없는 파일은 내 기기가 다음 동기화에서 올린다. 앨범 용량을 넘으면 담지 않는다.
    """
    album = _lock_album(db, album_id)
    _membership(db, album_id, user.id)
    quality = payload.photo_quality
    qualities = dict.fromkeys(payload.moment_ids, quality) if quality else None
    added = _add_items(db, album, user.id, payload.moment_ids, qualities)
    _require_room(db, album)
    db.commit()
    return AddItemsResponse(added=added)


@router.post("/{album_id}/items/quality", status_code=status.HTTP_204_NO_CONTENT)
def set_item_quality(
    album_id: str, payload: ItemQualityRequest, user: CurrentUser, db: DbSession
) -> None:
    """사진마다 화질을 바꾼다. 빼기와 같이 올린 사람이나 관리자만 바꾼다.

    원본이 필요해지면 올린 사람의 기기가 다음 동기화에서 올리고(앨범 용량에서 확인한다),
    필요 없어진 원본은 그 기기가 정리한다.
    """
    album = _lock_album(db, album_id)
    me = _membership(db, album_id, user.id)
    found = db.scalars(
        select(SharedAlbumItem).where(
            SharedAlbumItem.album_id == album_id, SharedAlbumItem.id.in_(payload.item_ids)
        )
    ).all()
    if me.role != "admin" and any(item.author_id != user.id for item in found):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "only the uploader or an admin can change")
    by_author: dict[str, set[str]] = {}
    for item in found:
        item.photo_quality = payload.photo_quality
        by_author.setdefault(item.author_id, set()).add(item.moment_id)
    for author_id in sorted(by_author):
        recount(db, author_id, by_author[author_id], [album])
    # 이미 개인 Cloud에 있던 원본을 이 앨범에서도 쓰게 만들면 사용량이 즉시 늘어난다.
    # 항목 추가와 같은 제한을 적용하지 않으면 사진별 화질 변경으로 할당을 우회할 수 있다.
    _require_room(db, album)
    album.updated_at = datetime.now(UTC)
    # 사용량이 바뀌었으니 용량이 없는 앨범 표시도 다시 본다 (update_album과 같다).
    refresh_funding(db, album)
    db.commit()


@router.delete("/{album_id}/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_item(album_id: str, item_id: str, user: CurrentUser, db: DbSession) -> None:
    """올린 사람이나 관리자만 뺀다. 올린 사람의 기록은 남는다."""
    album = _lock_album(db, album_id)
    me = _membership(db, album_id, user.id)
    item = db.get(SharedAlbumItem, item_id)
    if item is None or item.album_id != album_id:
        return  # 다른 구성원이 먼저 뺐다.
    if item.author_id != user.id and me.role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "only the uploader or an admin can remove")
    remove_items(db, album, [item_id])
    db.commit()


@router.post("/{album_id}/items/remove", status_code=status.HTTP_204_NO_CONTENT)
def remove_selected_items(
    album_id: str, payload: RemoveItemsRequest, user: CurrentUser, db: DbSession
) -> None:
    """여러 장을 한 번에 뺀다. 하나라도 뺄 수 없는 사진이 있으면 아무것도 빼지 않는다."""
    album = _lock_album(db, album_id)
    me = _membership(db, album_id, user.id)
    found = db.scalars(
        select(SharedAlbumItem).where(
            SharedAlbumItem.album_id == album_id, SharedAlbumItem.id.in_(payload.item_ids)
        )
    ).all()
    # 없는 항목은 다른 구성원이 먼저 뺐다.
    if me.role != "admin" and any(item.author_id != user.id for item in found):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "only the uploader or an admin can remove")
    remove_items(db, album, [item.id for item in found])
    db.commit()


@router.delete("/{album_id}/authors/{author_id}/items", status_code=status.HTTP_204_NO_CONTENT)
def remove_author_items(album_id: str, author_id: str, user: CurrentUser, db: DbSession) -> None:
    """한 사람이 담은 사진을 모두 뺀다. 넘친 용량을 정리할 때 쓴다 (나간 구성원의 사진 등)."""
    album = _lock_album(db, album_id)
    me = _membership(db, album_id, user.id)
    if author_id != user.id:
        _require_admin(me)
    remove_items(db, album, items_of_author(db, album_id, author_id))
    db.commit()


@router.get("/{album_id}/items/{item_id}/photo", response_model=DownloadResponse)
def download_item(
    album_id: str, item_id: str, variant: Variant, user: CurrentUser, db: DbSession
) -> DownloadResponse:
    """구성원이면 볼 수 있다. 파일은 올린 사람의 Cloud 파일 그대로이고, 보는 사람의 구독은 묻지
    않는다."""
    _membership(db, album_id, user.id)
    album = db.get(SharedAlbum, album_id)
    assert album is not None
    item = db.get(SharedAlbumItem, item_id)
    if (
        item is None
        or item.album_id != album_id
        or db.get(UserBlock, (user.id, item.author_id)) is not None
    ):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "item not found")
    stored = set(
        db.scalars(
            select(CloudObject.variant).where(
                CloudObject.user_id == item.author_id,
                CloudObject.moment_id == item.moment_id,
                CloudObject.status == "stored",
            )
        )
    )
    if variant not in wanted_variants(item_quality(item, album), item.media_type, stored):
        # 효율 보관 사진에서 개인 원본을 유추하거나 내려받지 못하게, 없는 파일과 같은 응답을 준다.
        raise HTTPException(status.HTTP_404_NOT_FOUND, "photo not found")
    obj = db.scalar(
        select(CloudObject).where(
            CloudObject.user_id == item.author_id,
            CloudObject.moment_id == item.moment_id,
            CloudObject.variant == variant,
            CloudObject.status == "stored",
        )
    )
    if obj is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "photo not found")
    ttl = VIDEO_DOWNLOAD_URL_TTL if obj.content_type.startswith("video/") else DOWNLOAD_URL_TTL
    url = r2_client().generate_presigned_url(
        "get_object",
        Params={"Bucket": get_settings().r2_bucket, "Key": obj.r2_key},
        ExpiresIn=int(ttl.total_seconds()),
    )
    return DownloadResponse(
        download_url=url,
        content_type=obj.content_type,
        extension=EXTENSIONS.get(obj.content_type, "bin"),
        size=obj.size_bytes,
        expires_at=datetime.now(UTC) + ttl,
    )
