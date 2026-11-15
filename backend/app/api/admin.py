import secrets
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal, get_args

from fastapi import APIRouter, Depends, Header, HTTPException, status
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import func, or_, select, tuple_

from app.api.deps import DbSession
from app.api.uploads import DOWNLOAD_URL_TTL
from app.cloud import subscription_status
from app.config import get_settings
from app.models.cloud import (
    AuthIdentity,
    CloudObject,
    ContentReport,
    Device,
    Entitlement,
    Moment,
    SharedAlbum,
    SharedAlbumItem,
    SharedAlbumMember,
    SharedItemComment,
    SyncRecord,
    Usage,
    User,
)
from app.shared import (
    items_of_author,
    lock_album_row,
    remove_comments_of_author,
    remove_items,
    remove_member_rows,
)
from app.storage import r2_client

# 운영자용 회원 관리 화면. 모바일 앱이 쓰지 않으므로 OpenAPI 스키마(앱 TS 타입)에 넣지 않는다.
# ADMIN_TOKEN이 비어 있으면 화면과 API 모두 없는 것처럼 404로 답한다.

_PAGE = Path(__file__).resolve().parents[1] / "admin" / "index.html"
LIST_LIMIT = 200

# default: 결제 상태를 따른다 (가입하면 무료 회원) / 요금제 이름: 결제 없이 그 요금제를 무상 제공한다
Access = Literal["default", "cloud_10gb", "cloud_100gb"]


def _enabled() -> str:
    token = (get_settings().admin_token or "").strip()
    if not token:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not Found")
    return token


def require_admin(authorization: str | None = Header(None)) -> None:
    expected = _enabled()
    scheme, _, token = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not secrets.compare_digest(token, expected):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "admin token is invalid")


page_router = APIRouter(prefix="/admin", include_in_schema=False)
router = APIRouter(
    prefix="/admin/api", include_in_schema=False, dependencies=[Depends(require_admin)]
)


@page_router.get("")
def admin_page() -> FileResponse:
    # 화면 자체에는 데이터가 없다. 토큰을 넣어야 API로 회원 정보를 읽는다.
    _enabled()
    return FileResponse(_PAGE, media_type="text/html", headers={"Cache-Control": "no-store"})


class AdminUser(BaseModel):
    id: str
    email: str | None
    providers: list[str]
    created_at: datetime
    deleted_at: datetime | None
    # 앱이 보는 상태 (관리자 지정·결제 연결 여부까지 반영)
    effective_status: str
    # RevenueCat이 정한 저장 값
    stored_status: str
    access: Access
    expires_at: datetime | None
    grace_until: datetime | None
    moments: int
    records: int
    bytes_total: int
    object_count: int
    devices: int


class AdminUserList(BaseModel):
    total: int
    users: list[AdminUser]


class AccessRequest(BaseModel):
    access: Access


def _count(model, column=None):
    """사용자별 (지우지 않은) 행 수 서브쿼리."""
    query = select(model.user_id, func.count().label("n")).group_by(model.user_id)
    if column is not None:
        query = query.where(column.is_(None))
    return query.subquery()


def _access(entitlement: Entitlement | None) -> Access:
    if entitlement is None or entitlement.access_override not in get_args(Access):
        return "default"
    return entitlement.access_override


@router.get("/users")
def list_users(db: DbSession, q: str = "") -> AdminUserList:
    moments = _count(Moment, Moment.deleted_at)
    records = _count(SyncRecord, SyncRecord.deleted_at)
    devices = _count(Device)
    query = (
        select(
            User,
            Entitlement,
            Usage,
            func.coalesce(moments.c.n, 0),
            func.coalesce(records.c.n, 0),
            func.coalesce(devices.c.n, 0),
        )
        .outerjoin(Entitlement, Entitlement.user_id == User.id)
        .outerjoin(Usage, Usage.user_id == User.id)
        .outerjoin(moments, moments.c.user_id == User.id)
        .outerjoin(records, records.c.user_id == User.id)
        .outerjoin(devices, devices.c.user_id == User.id)
        .order_by(User.created_at.desc())
    )
    if q.strip():
        pattern = f"%{q.strip()}%"
        query = query.where(or_(User.email.ilike(pattern), User.id.ilike(pattern)))
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    rows = db.execute(query.limit(LIST_LIMIT)).all()
    providers: dict[str, list[str]] = {}
    for user_id, provider in db.execute(
        select(AuthIdentity.user_id, AuthIdentity.provider).where(
            AuthIdentity.user_id.in_([row[0].id for row in rows])
        )
    ):
        providers.setdefault(user_id, []).append(provider)
    return AdminUserList(
        total=total,
        users=[
            AdminUser(
                id=user.id,
                email=user.email,
                providers=sorted(providers.get(user.id, [])),
                created_at=user.created_at,
                deleted_at=user.deleted_at,
                effective_status=subscription_status(entitlement),
                stored_status=entitlement.status if entitlement else "none",
                access=_access(entitlement),
                expires_at=entitlement.expires_at if entitlement else None,
                grace_until=entitlement.grace_until if entitlement else None,
                moments=moment_count,
                records=record_count,
                bytes_total=usage.bytes_total if usage else 0,
                object_count=usage.object_count if usage else 0,
                devices=device_count,
            )
            for user, entitlement, usage, moment_count, record_count, device_count in rows
        ],
    )


@router.put("/users/{user_id}/access")
def set_access(user_id: str, body: AccessRequest, db: DbSession) -> dict[str, str]:
    user = db.get(User, user_id)
    if user is None or user.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user not found")
    entitlement = db.get(Entitlement, user_id)
    if entitlement is None:
        entitlement = Entitlement(user_id=user_id)
        db.add(entitlement)
    entitlement.access_override = None if body.access == "default" else body.access
    db.commit()
    return {"access": body.access, "effective_status": subscription_status(entitlement)}


# ---------------------------------------------------------------------------
# 신고 (공유 앨범의 사진·구성원)

# dismiss: 문제없음 / remove_item: 신고한 사진을 앨범에서 뺀다 / remove_comment: 신고한 댓글을
# 지운다 / remove_member: 신고당한 사람을 앨범에서 내보내고 그 사람이 담은 사진·댓글도 모두 뺀다
ReportAction = Literal["dismiss", "remove_item", "remove_comment", "remove_member"]


class AdminReport(BaseModel):
    id: str
    created_at: datetime
    status: str
    action: str | None
    resolved_at: datetime | None
    reason: str
    detail: str | None
    album_id: str
    album_title: str
    album_exists: bool
    reporter_id: str | None
    reporter_email: str | None
    reported_user_id: str
    reported_name: str | None
    reported_email: str | None
    still_member: bool
    # 신고당한 사람이 이 앨범에 아직 남긴 사진 수 (나간 뒤에도 남긴 사진이 있으면 뺄 수 있다)
    reported_items: int
    item_id: str | None
    item_in_album: bool
    # 신고한 사진에 담은 사람이 쓴 글 (지금 값)
    item_caption: str | None
    comment_id: str | None
    # 신고할 때의 댓글 내용 (지워진 뒤에도 남는다)
    comment_body: str | None
    comment_exists: bool
    # 신고한 사진의 표시용 파일 (10분 동안 열린다). 파일이 지워졌으면 없다.
    photo_url: str | None


class AdminReportList(BaseModel):
    open: int
    reports: list[AdminReport]


class ResolveRequest(BaseModel):
    action: ReportAction


def _photo_urls(db, reports: list[ContentReport]) -> dict[str, str]:
    """사진 신고마다 표시용(없으면 썸네일) 파일의 열람 주소.

    신고 수만큼 쿼리하지 않게 한 번에 찾는다."""
    keys = {(r.reported_user_id, r.moment_id) for r in reports if r.moment_id is not None}
    if not keys:
        return {}
    found: dict[tuple[str, str], CloudObject] = {}
    for obj in db.scalars(
        select(CloudObject).where(
            tuple_(CloudObject.user_id, CloudObject.moment_id).in_(sorted(keys)),
            CloudObject.variant.in_(["display", "thumb"]),
            CloudObject.status == "stored",
        )
    ):
        key = (obj.user_id, obj.moment_id)
        if key not in found or obj.variant == "display":
            found[key] = obj
    client = r2_client()
    bucket = get_settings().r2_bucket
    urls = {}
    for r in reports:
        obj = found.get((r.reported_user_id, r.moment_id))  # type: ignore[arg-type]
        if obj is not None:
            urls[r.id] = client.generate_presigned_url(
                "get_object",
                Params={"Bucket": bucket, "Key": obj.r2_key},
                ExpiresIn=int(DOWNLOAD_URL_TTL.total_seconds()),
            )
    return urls


@router.get("/reports")
def list_reports(db: DbSession, state: Literal["open", "closed"] = "open") -> AdminReportList:
    reports = db.scalars(
        select(ContentReport)
        .where(ContentReport.status == state)
        .order_by(ContentReport.created_at.desc())
        .limit(LIST_LIMIT)
    ).all()
    user_ids = {r.reporter_id for r in reports if r.reporter_id} | {
        r.reported_user_id for r in reports
    }
    emails = dict(db.execute(select(User.id, User.email).where(User.id.in_(user_ids))).all())
    album_ids = {r.album_id for r in reports}
    albums = set(db.scalars(select(SharedAlbum.id).where(SharedAlbum.id.in_(album_ids))))
    members = set(
        db.execute(
            select(SharedAlbumMember.album_id, SharedAlbumMember.user_id).where(
                SharedAlbumMember.album_id.in_(album_ids)
            )
        ).all()
    )
    authors = sorted({(r.album_id, r.reported_user_id) for r in reports})
    author_items: dict[tuple[str, str], int] = {}
    if authors:
        for album_id, author_id, count in db.execute(
            select(SharedAlbumItem.album_id, SharedAlbumItem.author_id, func.count())
            .where(tuple_(SharedAlbumItem.album_id, SharedAlbumItem.author_id).in_(authors))
            .group_by(SharedAlbumItem.album_id, SharedAlbumItem.author_id)
        ):
            author_items[(album_id, author_id)] = count
    item_ids = {r.item_id for r in reports if r.item_id}
    items = dict(
        db.execute(
            select(SharedAlbumItem.id, SharedAlbumItem.caption).where(
                SharedAlbumItem.id.in_(item_ids)
            )
        ).all()
    )
    comment_ids = {r.comment_id for r in reports if r.comment_id}
    comments = set(
        db.scalars(select(SharedItemComment.id).where(SharedItemComment.id.in_(comment_ids)))
    )
    photo_urls = _photo_urls(db, list(reports))
    return AdminReportList(
        open=db.scalar(select(func.count()).where(ContentReport.status == "open")) or 0,
        reports=[
            AdminReport(
                id=r.id,
                created_at=r.created_at,
                status=r.status,
                action=r.action,
                resolved_at=r.resolved_at,
                reason=r.reason,
                detail=r.detail,
                album_id=r.album_id,
                album_title=r.album_title,
                album_exists=r.album_id in albums,
                reporter_id=r.reporter_id,
                reporter_email=emails.get(r.reporter_id) if r.reporter_id else None,
                reported_user_id=r.reported_user_id,
                reported_name=r.reported_name,
                reported_email=emails.get(r.reported_user_id),
                still_member=(r.album_id, r.reported_user_id) in members,
                reported_items=author_items.get((r.album_id, r.reported_user_id), 0),
                item_id=r.item_id,
                item_in_album=r.item_id in items,
                item_caption=items.get(r.item_id) if r.item_id else None,
                comment_id=r.comment_id,
                comment_body=r.comment_body,
                comment_exists=r.comment_id in comments,
                photo_url=photo_urls.get(r.id),
            )
            for r in reports
        ],
    )


@router.post("/reports/{report_id}/resolve")
def resolve_report(report_id: str, body: ResolveRequest, db: DbSession) -> dict[str, str]:
    """신고를 처리한다. 같은 사진(remove_item)·댓글(remove_comment)이나 같은 사람(remove_member)에
    대한 다른 신고도 함께 닫는다.

    이미 처리한 신고는 다시 처리하지 않는다 (나중에 다시 들어온 구성원을 옛 신고로 내보내지 않게).
    잠그는 순서는 앨범 → 신고다. 같은 앨범의 신고 두 건을 동시에 처리해도 서로 기다리다 멈추지
    않고, 신고 행은 잠근 뒤 상태를 다시 보므로 한 번만 처리한다.
    """
    found = db.get(ContentReport, report_id)
    if found is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "report not found")
    if body.action == "remove_item" and found.item_id is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "not a photo report")
    if body.action == "remove_comment" and found.comment_id is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "not a comment report")
    album = lock_album_row(db, found.album_id) if body.action != "dismiss" else None
    report = db.scalar(
        select(ContentReport)
        .where(ContentReport.id == report_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if report is None or report.status != "open":
        raise HTTPException(status.HTTP_409_CONFLICT, "report already resolved")
    same = ContentReport.id == report.id
    if body.action == "remove_item":
        if album is not None and db.get(SharedAlbumItem, report.item_id) is not None:
            remove_items(db, album, [report.item_id])  # type: ignore[list-item]
        same = same | (ContentReport.item_id == report.item_id)
    elif body.action == "remove_comment":
        comment = db.get(SharedItemComment, report.comment_id)
        if comment is not None:
            db.delete(comment)
        same = same | (ContentReport.comment_id == report.comment_id)
    elif body.action == "remove_member":
        if album is not None:
            if db.get(SharedAlbumMember, (album.id, report.reported_user_id)) is not None:
                remove_member_rows(db, album, report.reported_user_id, keep_photos=False)
            else:
                # 사진을 남기고 나간 사람이면 남긴 사진·댓글만 뺀다.
                remove_items(db, album, items_of_author(db, album.id, report.reported_user_id))
                remove_comments_of_author(db, album.id, report.reported_user_id)
        same = same | (
            (ContentReport.album_id == report.album_id)
            & (ContentReport.reported_user_id == report.reported_user_id)
        )
    now = datetime.now(UTC)
    for row in db.scalars(
        select(ContentReport).where(same, ContentReport.status == "open").with_for_update()
    ):
        row.status = "closed"
        row.action = body.action
        row.resolved_at = now
    db.commit()
    return {"status": "closed", "action": body.action}
