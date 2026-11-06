import logging
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, status
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.api.deps import CurrentUser, DbSession
from app.cloud import (
    UserGone,
    can_read,
    can_write,
    delete_account,
    lock_active_user,
    mark_account_deleted,
    refresh_from_revenuecat,
    subscription_status,
)
from app.config import get_settings
from app.models.cloud import Device, Entitlement, Moment, SyncRecord, Usage, User

log = logging.getLogger(__name__)

router = APIRouter(prefix="/account", tags=["account"])


class SubscriptionState(BaseModel):
    status: Literal["none", "active", "grace", "expired"]
    expires_at: datetime | None
    # 이 시각이 지나면 클라우드 데이터를 지운다 (status가 grace일 때만 값이 있다).
    grace_until: datetime | None
    can_upload: bool
    can_download: bool


class StorageUsage(BaseModel):
    bytes_total: int
    object_count: int
    max_bytes: int


class AccountResponse(BaseModel):
    user_id: str
    # 클라우드 데이터를 지울 때마다 바뀐다. 기기는 값이 바뀌면 계정 공간을 비운다.
    data_generation: int
    email: str | None
    subscription: SubscriptionState
    usage: StorageUsage
    # 사진 사용량과 별개다. 무료 기록 백업 계정도 이미 기록이 있음을 기기가 알아야 Local 기록을
    # 자동으로 섞어 올리지 않는다.
    has_records: bool


class DeviceRequest(BaseModel):
    expo_push_token: str = Field(max_length=255, pattern=r"^Expo(nent)?PushToken\[.+\]$")
    platform: Literal["ios", "android"]


def account_response(db: DbSession, user: User) -> AccountResponse:
    entitlement = db.get(Entitlement, user.id)
    usage = db.get(Usage, user.id)
    # Local 기록을 자동으로 선택해 올릴지는 이 계정이 완전히 비어 있는지에 달려 있다.
    # moment가 없어도 빈 앨범이나 고르기 이력이 있으면 이미 사용한 계정이므로 SyncRecord도 본다.
    has_records = any(
        db.scalar(
            select(model.id)
            .where(
                model.user_id == user.id,
                model.deleted_at.is_(None),
            )
            .limit(1)
        )
        is not None
        for model in (Moment, SyncRecord)
    )
    return AccountResponse(
        user_id=user.id,
        data_generation=user.data_generation,
        email=user.email,
        subscription=SubscriptionState(
            status=subscription_status(entitlement),  # type: ignore[arg-type]
            expires_at=entitlement.expires_at if entitlement else None,
            grace_until=entitlement.grace_until if entitlement else None,
            can_upload=can_write(entitlement),
            can_download=can_read(entitlement),
        ),
        usage=StorageUsage(
            bytes_total=usage.bytes_total if usage else 0,
            object_count=usage.object_count if usage else 0,
            max_bytes=get_settings().cloud_max_bytes,
        ),
        has_records=has_records,
    )


@router.get("", response_model=AccountResponse)
def get_account(user: CurrentUser, db: DbSession) -> AccountResponse:
    return account_response(db, user)


@router.post("/refresh-subscription", response_model=AccountResponse)
def refresh_subscription(user: CurrentUser, db: DbSession) -> AccountResponse:
    """구매·복원 직후 앱이 부른다. webhook보다 먼저 맞추려고 RevenueCat을 직접 조회한다."""
    entitlement = db.get(Entitlement, user.id)
    if entitlement is not None and refresh_from_revenuecat(db, entitlement):
        db.commit()
    return account_response(db, user)


@router.put("/devices", status_code=status.HTTP_204_NO_CONTENT)
def register_device(payload: DeviceRequest, user: CurrentUser, db: DbSession) -> None:
    lock_active_user(db, user.id)
    device = db.get(Device, payload.expo_push_token)
    if device is None:
        db.add(Device(token=payload.expo_push_token, user_id=user.id, platform=payload.platform))
    else:
        # 같은 기기에서 다른 계정으로 로그인하면 토큰의 주인을 옮긴다.
        device.user_id, device.platform = user.id, payload.platform
    db.commit()


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
def remove_account(user: CurrentUser, db: DbSession) -> None:
    """서버 데이터와 R2 객체를 바로 지운다. 앱은 기기 사진의 기록을 Local에 남기고 돌아간다.

    스토어 구독은 서버가 해지할 수 없으므로 앱이 해지 방법을 안내한다.
    """
    user_id = user.id
    # 표시를 남기지 못하면 삭제가 이어지지 않으므로 앱에 실패로 알린다.
    mark_account_deleted(db, user)
    try:
        delete_account(db, user)
    except UserGone:
        db.rollback()  # 주기 작업이 먼저 끝냈다.
    except Exception:
        # 남은 정리는 주기 작업이 다시 하므로 앱에는 성공으로 알린다.
        log.exception("account deletion will be retried: %s", user_id)
        db.rollback()
