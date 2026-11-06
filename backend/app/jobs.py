"""주기 작업: 유예 알림, 만료·삭제 데이터 정리, 미완료 업로드 정리.

플랫폼 cron에서 `python -m app.jobs`로 실행한다 (1시간마다 권장). 여러 번 실행해도 안전하다.
"""

import logging
from collections.abc import Callable
from datetime import UTC, datetime, timedelta

import httpx
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.cloud import (
    UserGone,
    delete_account,
    lock_user,
    purge_photos,
    refresh_from_revenuecat,
)
from app.config import get_settings
from app.db import SessionLocal
from app.models.cloud import BillingEvent, CloudObject, Device, Entitlement, StorageCleanup, User
from app.monitoring import init_sentry
from app.storage import UPLOAD_SETTLE_AFTER, delete_object, delete_prefix

log = logging.getLogger(__name__)

# 갱신이 잠시 늦은 구독을 만료로 보지 않는다.
RENEWAL_MARGIN = timedelta(days=1)
MAX_LOOKUP_FAILURES = 3
# 삭제 직전 경고를 보낸 뒤 이만큼 기다린 뒤에 지운다. 작업이 멈췄다 재개돼도 내려받을 시간을 준다.
FINAL_NOTICE_WAIT = timedelta(hours=12)
# 알림 서비스 장애가 길어져도 삭제를 끝없이 미루지 않는다.
MAX_PURGE_DELAY = timedelta(days=7)
# 대금결제 기록 보관 기간 (개인정보처리방침 §3)
BILLING_EVENT_RETENTION = timedelta(days=365 * 5)
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
    "d1": ("곧 Cloud 백업이 삭제돼요", "필요한 원본은 지금 내려받아 두세요. 기기의 기록은 남아요."),
}

Notifier = Callable[[Session, str, str, str], None]


class PushFailed(Exception):
    """알림 서비스에 전달하지 못했다. 단계를 저장하지 않아 다음 실행 때 다시 보낸다."""


def send_push(db: Session, user_id: str, title: str, body: str) -> None:
    """Expo 푸시 서비스로 사용자의 모든 기기에 보낸다. 한 기기에도 전달하지 못하면 PushFailed."""
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
        if not isinstance(tickets, list) or not tickets:
            raise ValueError("no push tickets")
    except (httpx.HTTPError, ValueError, AttributeError) as exc:
        raise PushFailed(user_id) from exc
    tickets = [ticket if isinstance(ticket, dict) else {} for ticket in tickets]
    # 앱을 지운 기기의 토큰은 다시 보내지 않도록 지운다.
    unregistered = 0
    for ticket, device_token in zip(tickets, tokens, strict=False):
        if (ticket.get("details") or {}).get("error") == "DeviceNotRegistered":
            unregistered += 1
            device = db.get(Device, device_token)
            if device is not None:
                db.delete(device)
    # HTTP 200이어도 자격 증명 오류나 한도 초과는 티켓으로 온다. 앱을 지운 기기뿐이면 끝으로 본다.
    delivered = any(ticket.get("status") == "ok" for ticket in tickets)
    if not delivered and unregistered < len(tickets):
        raise PushFailed(user_id)
    # TODO(Phase 3): 이메일 발송. 메일 서비스를 정하면 여기서 함께 보낸다.


def notify_grace(db: Session, now: datetime, notify: Notifier = send_push) -> None:
    user_ids = db.scalars(
        select(Entitlement.user_id)
        .join(User, User.id == Entitlement.user_id)
        .where(Entitlement.status == "grace", User.deleted_at.is_(None))
    ).all()
    for user_id in user_ids:
        try:
            entitlement = db.get(Entitlement, user_id)
            if entitlement is None or entitlement.grace_until is None:
                continue
            remaining = entitlement.grace_until - now
            due = [s for s, before in GRACE_STAGES if before is None or remaining <= before]
            stage = due[-1]
            if stage == entitlement.notified_stage:
                continue
            # 놓친 단계(작업이 멈췄던 경우)는 건너뛰고 가장 가까운 단계 하나만 보낸다.
            notify(db, user_id, *GRACE_MESSAGES[stage])
            entitlement.notified_stage = stage
            entitlement.notified_at = now
            db.commit()
        except PushFailed:
            log.warning("push notification failed for %s", user_id, exc_info=True)
            db.rollback()
        except Exception:
            log.exception("grace notification failed for %s", user_id)
            db.rollback()


def _final_notice_given(entitlement: Entitlement, now: datetime) -> bool:
    if entitlement.notified_stage == "d1" and entitlement.notified_at is not None:
        return now - entitlement.notified_at >= FINAL_NOTICE_WAIT
    # 경고를 전달하지 못한 채 오래 지났을 때만 경고 없이 지운다.
    return entitlement.grace_until is not None and now >= entitlement.grace_until + MAX_PURGE_DELAY


def expire_grace(db: Session, now: datetime) -> None:
    # 한 사용자의 오류 뒤 rollback해도 다음 행을 읽을 수 있게 id만 먼저 뽑는다.
    user_ids = db.scalars(
        select(Entitlement.user_id)
        .join(User, User.id == Entitlement.user_id)
        .where(
            Entitlement.status == "grace",
            Entitlement.grace_until <= now,
            User.deleted_at.is_(None),
        )
        # 조회가 계속 실패하는 사용자가 다른 사용자의 처리를 매번 막지 않게 순서를 섞는다.
        .order_by(func.random())
    ).all()
    failures = 0
    for user_id in user_ids:
        # RevenueCat 장애면 사용자마다 시간 제한을 기다리지 않고 다음 실행에 맡긴다.
        if failures >= MAX_LOOKUP_FAILURES:
            log.error("grace expiry stopped after %s lookup failures", failures)
            return
        try:
            entitlement = db.get(Entitlement, user_id)
            if entitlement is None or not _final_notice_given(entitlement, now):
                continue
            # 실수로 지우지 않도록 삭제 직전에 재구독 여부를 다시 확인한다 (§8 리스크).
            refreshed = refresh_from_revenuecat(db, entitlement)
            if not refreshed and get_settings().revenuecat_api_key:
                # 재구독 여부를 모르면 지우지 않는다. 다음 실행 때 다시 확인한다.
                log.error("skipped purge, subscription lookup failed: %s", user_id)
                failures += 1
                db.rollback()
                continue
            failures = 0
            db.commit()
            # 조회하는 사이 재구독했을 수 있어, 상태를 잠그고 다시 읽어 확인한 뒤 지운다.
            lock_user(db, user_id)
            db.refresh(entitlement, with_for_update=True)
            if (
                entitlement.status != "grace"
                or entitlement.grace_until is None
                or entitlement.grace_until > now
                or not _final_notice_given(entitlement, now)
            ):
                db.commit()
                continue
            purge_photos(db, user_id, now)
            entitlement.status = "expired"
            db.commit()
            log.info("purged cloud photos after grace: %s", user_id)
        except UserGone:
            db.rollback()
        except Exception:
            # 한 사용자의 R2 오류로 다른 사용자의 정리가 밀리지 않게 한다. 다음 실행 때 다시 한다.
            log.exception("purge failed for %s", user_id)
            db.rollback()


def recheck_lapsed_subscriptions(db: Session, now: datetime) -> None:
    """만료 webhook을 놓친 구독을 다시 조회한다. 스토어 결제 유예 중이면 active로 남는다."""
    if not get_settings().revenuecat_api_key:
        return
    user_ids = db.scalars(
        select(Entitlement.user_id)
        .join(User, User.id == Entitlement.user_id)
        .where(
            Entitlement.status == "active",
            Entitlement.expires_at < now - RENEWAL_MARGIN,
            User.deleted_at.is_(None),
        )
        # 조회가 계속 실패하는 사용자가 다른 사용자의 처리를 매번 막지 않게 순서를 섞는다.
        .order_by(func.random())
    ).all()
    failures = 0
    for user_id in user_ids:
        # RevenueCat 장애면 사용자마다 시간 제한을 기다리지 않고 다음 실행에 맡긴다.
        if failures >= MAX_LOOKUP_FAILURES:
            log.error("subscription recheck stopped after %s failures", failures)
            return
        try:
            entitlement = db.get(Entitlement, user_id)
            if entitlement is None:
                continue
            failures = 0 if refresh_from_revenuecat(db, entitlement) else failures + 1
            db.commit()
        except Exception:
            log.exception("subscription recheck failed for %s", user_id)
            db.rollback()


def finish_account_deletions(db: Session) -> None:
    user_ids = db.scalars(select(User.id).where(User.deleted_at.is_not(None))).all()
    for user_id in user_ids:
        try:
            user = db.get(User, user_id)
            if user is not None:
                delete_account(db, user)
        except UserGone:
            db.rollback()  # 요청 처리가 먼저 끝냈다.
        except Exception:
            log.exception("account deletion failed for %s", user_id)
            db.rollback()


def _delete_cleanup_target(db: Session, cleanup: StorageCleanup) -> None:
    prefix = cleanup.prefix
    # 업로드에서 대체된 키는 객체 하나다.
    if not prefix.endswith("/"):
        delete_object(prefix)
        return
    user_id = prefix.split("/")[1]
    if db.get(User, user_id) is None:
        delete_prefix(prefix)
        return
    # 유예 만료: 계정이 남아 있고 재구독했을 수 있어, 그 뒤에 올린 사진은 남긴다.
    keep = set(db.scalars(select(CloudObject.r2_key).where(CloudObject.user_id == user_id)).all())
    delete_prefix(prefix, older_than=cleanup.not_before, keep=keep)


def sweep_storage_cleanups(db: Session, now: datetime) -> None:
    prefixes = db.scalars(
        select(StorageCleanup.prefix).where(StorageCleanup.not_before <= now)
    ).all()
    failures = 0
    for prefix in prefixes:
        # R2 장애면 항목마다 시간 제한을 기다리지 않고 다음 실행에 맡긴다.
        if failures >= MAX_LOOKUP_FAILURES:
            log.error("storage cleanup stopped after %s failures", failures)
            return
        try:
            # 고른 뒤 계정 삭제가 같은 prefix의 시각을 늦췄을 수 있어, 잠그고 다시 읽어 확인한다.
            cleanup = db.get(StorageCleanup, prefix, with_for_update=True, populate_existing=True)
            if cleanup is not None and cleanup.not_before <= now:
                _delete_cleanup_target(db, cleanup)
                db.delete(cleanup)
            db.commit()
            failures = 0
        except Exception:
            failures += 1
            log.exception("storage cleanup failed: %s", prefix)
            db.rollback()


def prune_billing_events(db: Session, now: datetime) -> None:
    db.execute(delete(BillingEvent).where(BillingEvent.received_at < now - BILLING_EVENT_RETENTION))
    db.commit()


def clean_objects(db: Session, now: datetime) -> None:
    """지운 기록과 멈춘 업로드의 행을 지운다. R2 객체는 잠금 없이 다음 단계에서 지운다."""
    cutoff = now - UPLOAD_SETTLE_AFTER
    rows = db.execute(
        select(CloudObject.id, CloudObject.user_id).where(
            CloudObject.status.in_(("deleting", "pending")),
            CloudObject.created_at < cutoff,
        )
    ).all()
    for object_id, user_id in rows:
        try:
            # 고르는 사이 다시 올려 완료했을 수 있어, 잠근 뒤 다시 읽어 확인한다.
            lock_user(db, user_id)
            obj = db.get(CloudObject, object_id, populate_existing=True)
            if (
                obj is not None
                and obj.status in ("deleting", "pending")
                and obj.created_at < cutoff
            ):
                db.merge(StorageCleanup(prefix=obj.r2_key, not_before=now))
                db.delete(obj)
            db.commit()
        except UserGone:
            db.rollback()
        except Exception:
            log.exception("object cleanup failed: %s", object_id)
            db.rollback()


def run(db: Session, now: datetime | None = None, notify: Notifier = send_push) -> None:
    now = now or datetime.now(UTC)
    # 각 단계는 따로 실패해도 다음 단계가 돌도록 나눈다.
    for step in (
        lambda: finish_account_deletions(db),
        lambda: recheck_lapsed_subscriptions(db, now),
        lambda: notify_grace(db, now, notify),
        lambda: expire_grace(db, now),
        lambda: clean_objects(db, now),
        lambda: sweep_storage_cleanups(db, now),
        lambda: prune_billing_events(db, now),
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
