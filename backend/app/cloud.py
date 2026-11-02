"""Cloud 구독 규칙: 쓰기·읽기 허용, 구독 상태 전환, 클라우드 데이터 삭제 (docs/PLAN.md §2.4)."""

import logging
from datetime import UTC, datetime, timedelta

import httpx
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models.cloud import (
    CloudObject,
    Entitlement,
    Moment,
    StorageCleanup,
    SyncRecord,
    Usage,
    User,
)
from app.storage import UPLOAD_URL_TTL, delete_prefix, user_prefix

log = logging.getLogger(__name__)

REVENUECAT_API = "https://api.revenuecat.com/v1"


def lock_user(db: Session, user_id: str) -> User:
    """사용자 행을 잠근다. 사용량·사진·동기화 번호를 바꾸는 요청은 모두 이것부터 해서
    같은 사용자의 요청이 차례로 처리되게 한다 (잠그는 순서가 같아 교착도 생기지 않는다)."""
    user = db.scalar(select(User).where(User.id == user_id).with_for_update())
    assert user is not None
    return user


def subscription_status(entitlement: Entitlement | None) -> str:
    """앱에 보여주고 권한을 판단하는 상태.

    결제 연결 전(CLOUD_BILLING_ENABLED=false)에는 구매한 적 없는 계정도 구독 중으로 본다.
    저장된 값은 바꾸지 않으므로 결제를 켜면 바로 원래 규칙으로 돌아간다.
    """
    if entitlement is None:
        return "none"
    if entitlement.status == "none" and not get_settings().cloud_billing_enabled:
        return "active"
    return entitlement.status


def can_write(entitlement: Entitlement | None) -> bool:
    """새 업로드·동기화 push. 스토어 결제 유예 중에는 RevenueCat이 active로 두므로 허용된다."""
    return subscription_status(entitlement) == "active"


def can_read(entitlement: Entitlement | None) -> bool:
    """pull·다운로드. 만료 후 30일(grace) 동안은 읽기와 전체 다운로드만 허용한다."""
    return subscription_status(entitlement) in {"active", "grace"}


def activate(entitlement: Entitlement, expires_at: datetime | None) -> None:
    # 유예 중 재구독: 아무것도 다시 올리지 않고 그대로 복구된다 (데이터를 아직 지우지 않았으므로).
    entitlement.status = "active"
    entitlement.expires_at = expires_at
    entitlement.grace_until = None
    entitlement.notified_stage = None


def start_grace(entitlement: Entitlement, expired_at: datetime | None) -> None:
    """구독 만료. 이미 grace/expired면 기한을 늦추지 않는다 (만료 이벤트가 여러 번 올 수 있음)."""
    if entitlement.status != "active":
        return
    # 만료를 늦게 알아도 30일은 보장한다. 지난 시각으로 계산하면 알림 없이 바로 지워진다.
    now = datetime.now(UTC)
    base = max(expired_at, now) if expired_at else now
    entitlement.status = "grace"
    entitlement.expires_at = expired_at
    entitlement.grace_until = base + timedelta(days=get_settings().cloud_grace_days)
    entitlement.notified_stage = None


def _parse_time(value: object) -> datetime | None:
    if not isinstance(value, str):
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def refresh_from_revenuecat(db: Session, entitlement: Entitlement) -> bool:
    """RevenueCat REST로 현재 구독 상태를 다시 읽어 반영한다. API 키가 없거나 조회에 실패하면 False.

    webhook은 순서가 뒤바뀌거나 빠질 수 있어서, 결제 상태 판단은 이 조회 결과를 우선한다.
    """
    settings = get_settings()
    if not settings.revenuecat_api_key:
        return False
    try:
        response = httpx.get(
            f"{REVENUECAT_API}/subscribers/{entitlement.user_id}",
            headers={"Authorization": f"Bearer {settings.revenuecat_api_key}"},
            timeout=10,
        )
        response.raise_for_status()
        info = response.json()["subscriber"]["entitlements"].get(settings.revenuecat_entitlement_id)
    except (httpx.HTTPError, KeyError, TypeError, ValueError):
        log.warning("RevenueCat lookup failed for %s", entitlement.user_id, exc_info=True)
        return False
    now = datetime.now(UTC)
    if info is None:
        start_grace(entitlement, None)
        return True
    expires_at = _parse_time(info.get("expires_date"))
    # 스토어 결제 유예(Apple Billing Grace Period, Google 계정 보류 전 유예)가 끝나는 시각
    store_grace = _parse_time(info.get("grace_period_expires_date"))
    effective_end = max((t for t in (expires_at, store_grace) if t is not None), default=None)
    if effective_end is None or effective_end > now:
        activate(entitlement, expires_at)
    else:
        start_grace(entitlement, effective_end)
    db.flush()
    return True


def delete_revenuecat_customer(user_id: str) -> None:
    """RevenueCat의 고객 정보를 지운다. 실패하면 예외를 내서 정리 작업이 다시 시도하게 한다."""
    settings = get_settings()
    if not settings.revenuecat_api_key:
        return
    response = httpx.delete(
        f"{REVENUECAT_API}/subscribers/{user_id}",
        headers={"Authorization": f"Bearer {settings.revenuecat_api_key}"},
        timeout=10,
    )
    if response.status_code != 404:
        response.raise_for_status()


def purge_cloud_data(db: Session, user_id: str) -> None:
    """R2 객체와 서버 기록(moments, sync_records, cloud_objects)을 지운다. 계정·구독 행은 남긴다."""
    user = lock_user(db, user_id)
    user.data_generation += 1
    delete_prefix(user_prefix(user_id))
    db.execute(delete(CloudObject).where(CloudObject.user_id == user_id))
    db.execute(delete(Moment).where(Moment.user_id == user_id))
    db.execute(delete(SyncRecord).where(SyncRecord.user_id == user_id))
    usage = db.get(Usage, user_id)
    if usage is not None:
        usage.bytes_total, usage.object_count = 0, 0


def delete_account(db: Session, user: User) -> None:
    """계정 삭제. R2와 RevenueCat을 먼저 지우고 계정 행을 지운다 (나머지 행은 FK cascade).

    중간에 실패하면 deleted_at만 남겨서 로그인·업로드를 막고, 정리 작업이 다시 시도한다.
    """
    lock_user(db, user.id)
    user.deleted_at = user.deleted_at or datetime.now(UTC)
    db.commit()
    prefix = user_prefix(user.id)
    delete_prefix(prefix)
    delete_revenuecat_customer(user.id)
    # 삭제 전에 받은 업로드 URL이 끝날 때쯤 한 번 더 지운다.
    db.merge(StorageCleanup(prefix=prefix, not_before=datetime.now(UTC) + UPLOAD_URL_TTL))
    db.delete(user)
    db.commit()


def stored_variants(db: Session, user_id: str, moment_ids: list[str]) -> dict[str, list[str]]:
    rows = db.execute(
        select(CloudObject.moment_id, CloudObject.variant).where(
            CloudObject.user_id == user_id,
            CloudObject.status == "stored",
            CloudObject.moment_id.in_(moment_ids),
        )
    ).all()
    result: dict[str, list[str]] = {}
    for moment_id, variant in rows:
        result.setdefault(moment_id, []).append(variant)
    return result
