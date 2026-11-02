"""주기 작업: 유예 알림, 만료·삭제 데이터 정리, 미완료 업로드 정리.

플랫폼 cron에서 `python -m app.jobs`로 실행한다 (1시간마다 권장). 여러 번 실행해도 안전하다.
"""

import logging
from collections.abc import Callable
from datetime import UTC, datetime, timedelta

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.cloud import delete_account, purge_cloud_data, refresh_from_revenuecat
from app.config import get_settings
from app.db import SessionLocal
from app.models.cloud import CloudObject, Device, Entitlement, User
from app.monitoring import init_sentry
from app.storage import delete_object

log = logging.getLogger(__name__)

STALE_UPLOAD_AFTER = timedelta(minutes=15)
EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"

# 유예 알림 단계 (docs/PLAN.md §2.4): 만료 즉시, 삭제 7일 전, 삭제 1일 전.
# (단계, 삭제까지 남은 기간이 이 값 이하일 때 보냄)
GRACE_STAGES: tuple[tuple[str, timedelta | None], ...] = (
    ("expired", None),
    ("d7", timedelta(days=7)),
    ("d1", timedelta(days=1)),
)

GRACE_MESSAGES = {
    "expired": (
        "Cloud 구독이 끝났어요",
        "30일 동안 백업한 사진을 내려받을 수 있어요. 다시 구독하면 그대로 이어져요.",
    ),
    "d7": ("7일 뒤 Cloud 백업이 삭제돼요", "필요한 원본은 지금 기기로 내려받아 두세요."),
    "d1": ("내일 Cloud 백업이 삭제돼요", "기기에 있는 기록은 그대로 남아요."),
}

Notifier = Callable[[Session, str, str, str], None]


def send_push(db: Session, user_id: str, title: str, body: str) -> None:
    """Expo 푸시 서비스로 사용자의 모든 기기에 보낸다. 실패해도 작업 전체를 멈추지 않는다."""
    tokens = db.scalars(select(Device.token).where(Device.user_id == user_id)).all()
    if not tokens:
        return
    headers = {"Content-Type": "application/json"}
    token = get_settings().expo_access_token
    if token:
        headers["Authorization"] = f"Bearer {token}"
    messages = [
        {"to": t, "title": title, "body": body, "data": {"url": "/settings"}} for t in tokens
    ]
    try:
        response = httpx.post(EXPO_PUSH_URL, json=messages, headers=headers, timeout=15)
        response.raise_for_status()
        tickets = response.json().get("data", [])
    except (httpx.HTTPError, ValueError, AttributeError):
        log.warning("push notification failed for %s", user_id, exc_info=True)
        return
    # 앱을 지운 기기의 토큰은 다시 보내지 않도록 지운다.
    for ticket, device_token in zip(tickets, tokens, strict=False):
        if ticket.get("details", {}).get("error") == "DeviceNotRegistered":
            device = db.get(Device, device_token)
            if device is not None:
                db.delete(device)
    # TODO(Phase 3): 이메일 발송. 메일 서비스를 정하면 여기서 함께 보낸다.


def notify_grace(db: Session, now: datetime, notify: Notifier = send_push) -> None:
    for entitlement in db.scalars(select(Entitlement).where(Entitlement.status == "grace")).all():
        if entitlement.grace_until is None:
            continue
        remaining = entitlement.grace_until - now
        due = [s for s, before in GRACE_STAGES if before is None or remaining <= before]
        stage = due[-1]
        if stage == entitlement.notified_stage:
            continue
        # 놓친 단계(작업이 멈췄던 경우)는 건너뛰고 가장 가까운 단계 하나만 보낸다.
        notify(db, entitlement.user_id, *GRACE_MESSAGES[stage])
        entitlement.notified_stage = stage
        db.commit()


def expire_grace(db: Session, now: datetime) -> None:
    expired = db.scalars(
        select(Entitlement).where(Entitlement.status == "grace", Entitlement.grace_until <= now)
    ).all()
    for entitlement in expired:
        user_id = entitlement.user_id
        try:
            # 실수로 지우지 않도록 삭제 직전에 재구독 여부를 다시 확인한다 (§8 리스크).
            refreshed = refresh_from_revenuecat(db, entitlement)
            if not refreshed and get_settings().revenuecat_api_key:
                # 재구독 여부를 모르면 지우지 않는다. 다음 실행 때 다시 확인한다.
                log.error("skipped purge, subscription lookup failed: %s", user_id)
                db.rollback()
                continue
            if entitlement.status != "grace":
                db.commit()
                continue
            purge_cloud_data(db, user_id)
            entitlement.status = "expired"
            db.commit()
            log.info("purged cloud data after grace: %s", user_id)
        except Exception:
            # 한 사용자의 R2 오류로 다른 사용자의 정리가 밀리지 않게 한다. 다음 실행 때 다시 한다.
            log.exception("purge failed for %s", user_id)
            db.rollback()


def finish_account_deletions(db: Session) -> None:
    for user in db.scalars(select(User).where(User.deleted_at.is_not(None))).all():
        user_id = user.id
        try:
            delete_account(db, user)
        except Exception:
            log.exception("account deletion failed for %s", user_id)
            db.rollback()


def clean_objects(db: Session, now: datetime) -> None:
    rows = db.scalars(
        select(CloudObject).where(
            (CloudObject.status == "deleting")
            | (
                (CloudObject.status == "pending")
                & (CloudObject.created_at < now - STALE_UPLOAD_AFTER)
            )
        )
    ).all()
    for obj in rows:
        delete_object(obj.r2_key)
        db.delete(obj)
    db.commit()


def run(db: Session, now: datetime | None = None, notify: Notifier = send_push) -> None:
    now = now or datetime.now(UTC)
    # 각 단계는 따로 실패해도 다음 단계가 돌도록 나눈다.
    for step in (
        lambda: finish_account_deletions(db),
        lambda: notify_grace(db, now, notify),
        lambda: expire_grace(db, now),
        lambda: clean_objects(db, now),
    ):
        try:
            step()
        except Exception:
            log.exception("cloud job step failed")
            db.rollback()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    init_sentry()
    with SessionLocal() as session:
        run(session)
