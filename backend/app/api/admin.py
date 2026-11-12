import secrets
from datetime import datetime
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, Header, HTTPException, status
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import func, or_, select

from app.api.deps import DbSession
from app.cloud import subscription_status
from app.config import get_settings
from app.models.cloud import AuthIdentity, Device, Entitlement, Moment, SyncRecord, Usage, User

# 운영자용 회원 관리 화면. 모바일 앱이 쓰지 않으므로 OpenAPI 스키마(앱 TS 타입)에 넣지 않는다.
# ADMIN_TOKEN이 비어 있으면 화면과 API 모두 없는 것처럼 404로 답한다.

_PAGE = Path(__file__).resolve().parents[1] / "admin" / "index.html"
LIST_LIMIT = 200

# default: 결제 상태를 따른다 (가입하면 무료 회원) / cloud: 결제 없이 구독 회원
Access = Literal["default", "cloud"]


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
    return "cloud" if entitlement and entitlement.access_override == "cloud" else "default"


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
