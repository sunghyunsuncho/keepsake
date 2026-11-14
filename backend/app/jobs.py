"""주기 작업: 유예 알림, 만료·삭제 데이터 정리, 미완료 업로드 정리.

플랫폼 cron에서 `python -m app.jobs`로 실행한다 (1시간마다 권장). 여러 번 실행해도 안전하다.
"""

import logging
import sys
import time
from collections.abc import Mapping
from datetime import UTC, datetime, timedelta
from typing import Protocol

import httpx
from sqlalchemy import delete, func, select, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.cloud import (
    UserGone,
    delete_account,
    lock_user,
    purge_photos,
    refresh_from_revenuecat,
)
from app.config import get_settings
from app.db import SessionLocal, engine
from app.models.cloud import (
    BillingEvent,
    CloudObject,
    ContentReport,
    Device,
    Entitlement,
    Moment,
    SharedAlbum,
    SharedAlbumItem,
    SharedAlbumMember,
    SharedMoment,
    StorageCleanup,
    Usage,
    User,
)
from app.monitoring import init_sentry
from app.shared import (
    delete_unneeded_files,
    funding_changed_for_user,
    lock_album_row,
    recount,
    recount_album,
    refresh_funding,
    release_unfunded_album,
)
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
# 처리한 신고 기록 보관 기간 (개인정보처리방침 §3). 같은 사람의 신고가 반복되는지 보는 데 쓴다.
REPORT_RETENTION = timedelta(days=365)
EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"

# 유예 알림 단계 (docs/PLAN.md §2.4): 만료 즉시, 삭제 7일 전, 삭제 1일 전.
# (단계, 삭제까지 남은 기간이 이 값 이하일 때 보냄)
GRACE_STAGES: tuple[tuple[str, timedelta | None], ...] = (
    ("expired", None),
    ("d7", timedelta(days=7)),
    ("d1", timedelta(days=1)),
)

# 서버가 보내는 알림 문구. 기기마다 앱 언어로 보낸다 (devices.language, send_push).
# 언어별 (제목, 본문)이고, {} 자리는 notify_localized가 채운다.
Messages = Mapping[str, tuple[str, str]]

GRACE_MESSAGES: dict[str, Messages] = {
    "expired": {
        "ko": (
            "Cloud 구독이 끝났어요",
            "30일 동안 백업한 사진을 내려받을 수 있어요. 다시 구독하면 그대로 이어져요.",
        ),
        "en": (
            "Your Secure Storage subscription has ended",
            "You can download your backed-up photos for 30 days. "
            "Subscribe again to pick up right where you left off.",
        ),
        "ja": (
            "安全保管のサブスクリプションが終了しました",
            "30日間、バックアップした写真をダウンロードできます。再登録すれば、そのまま続けられます。",
        ),
    },
    "d7": {
        "ko": ("7일 뒤 Cloud 백업이 삭제돼요", "필요한 원본은 지금 기기로 내려받아 두세요."),
        "en": (
            "Your Secure Storage backup will be deleted in 7 days",
            "Download any originals you need to your device now.",
        ),
        "ja": (
            "7日後に安全保管のバックアップが削除されます",
            "必要なオリジナルは、今のうちにデバイスへダウンロードしておいてください。",
        ),
    },
    "d1": {
        "ko": (
            "곧 Cloud 백업이 삭제돼요",
            "필요한 원본은 지금 내려받아 두세요. 기기의 기록은 남아요.",
        ),
        "en": (
            "Your Secure Storage backup will be deleted soon",
            "Download any originals you need now. The memories on your device will stay.",
        ),
        "ja": (
            "まもなく安全保管のバックアップが削除されます",
            "必要なオリジナルは今すぐダウンロードしてください。デバイスの思い出は残ります。",
        ),
    },
}


class Notifier(Protocol):
    def __call__(
        self,
        db: Session,
        user_id: str,
        title: str,
        body: str,
        *,
        translations: Mapping[str, tuple[str, str]] | None = None,
    ) -> None: ...


class PushFailed(Exception):
    """알림 서비스에 전달하지 못했다. 단계를 저장하지 않아 다음 실행 때 다시 보낸다."""


def send_push(
    db: Session,
    user_id: str,
    title: str,
    body: str,
    *,
    url: str = "/settings",
    translations: Mapping[str, tuple[str, str]] | None = None,
) -> None:
    """Expo 푸시 서비스로 사용자의 모든 기기에 보낸다. 한 기기에도 전달하지 못하면 PushFailed.

    url: 알림을 누르면 앱이 여는 화면.
    translations: 기기 언어별 (제목, 본문). 없는 언어는 title·body로 보낸다.
    """
    devices = db.execute(
        select(Device.token, Device.language).where(Device.user_id == user_id)
    ).all()
    if not devices:
        return
    tokens = [t for t, _ in devices]
    headers = {"Content-Type": "application/json"}
    token = get_settings().expo_access_token
    if token:
        headers["Authorization"] = f"Bearer {token}"
    messages = []
    for device_token, language in devices:
        text_title, text_body = (translations or {}).get(language, (title, body))
        messages.append(
            {"to": device_token, "title": text_title, "body": text_body, "data": {"url": url}}
        )
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


def notify_localized(
    notify: Notifier, db: Session, user_id: str, messages: Messages, **values: object
) -> None:
    """언어별 문구에 값을 채워 보낸다. 언어를 모르는 기기에는 한국어로 보낸다.

    값에 없는 자리는 쓰지 않는 언어도 있다 (예: 영어 복수형 photos)."""
    texts = {
        language: (title.format(**values), body.format(**values))
        for language, (title, body) in messages.items()
    }
    notify(db, user_id, *texts["ko"], translations=texts)


def notify_grace(db: Session, now: datetime, notify: Notifier = send_push) -> None:
    user_ids = db.scalars(
        select(Entitlement.user_id)
        .join(User, User.id == Entitlement.user_id)
        .where(
            Entitlement.status == "grace",
            # 관리자가 구독 회원으로 둔 계정은 결제가 끝나도 사진을 지우지 않으므로 알리지 않는다.
            Entitlement.access_override.is_distinct_from("cloud"),
            User.deleted_at.is_(None),
        )
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
            notify_localized(notify, db, user_id, GRACE_MESSAGES[stage])
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
            Entitlement.access_override.is_distinct_from("cloud"),
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
                or entitlement.access_override == "cloud"
                or entitlement.grace_until is None
                or entitlement.grace_until > now
                or not _final_notice_given(entitlement, now)
            ):
                db.commit()
                continue
            purge_photos(db, user_id, now)
            entitlement.status = "expired"
            # 이제 이 사람이 나눠 준 용량은 앨범 용량에 들어가지 않는다.
            funding_changed_for_user(db, user_id)
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


LEFT_PHOTOS_MESSAGES: Messages = {
    "ko": (
        "공유 앨범의 사진이 빠졌어요",
        "'{title}'에 사진을 담았던 구성원이 계정을 지워, 그 사람이 담은 사진 {count}장이 빠졌어요.",
    ),
    "en": (
        "Photos were removed from a shared album",
        "A member who added photos to “{title}” deleted their account, "
        "so the {photos} they added {were} removed.",
    ),
    "ja": (
        "共有アルバムの写真が外れました",
        "「{title}」に写真を追加したメンバーがアカウントを削除したため、"
        "そのメンバーが追加した写真{count}枚が外れました。",
    ),
}


def notify_deleted_photos(
    db: Session, notices: list[tuple[list[str], str, int]], notify: Notifier | None = None
) -> None:
    """계정 삭제로 사진이 빠진 공유 앨범의 관리자에게 알린다. 실패해도 삭제는 끝난 것으로 본다."""
    notify = notify or send_push
    for admins, title, count in notices:
        for admin_id in admins:
            try:
                notify_localized(
                    notify,
                    db,
                    admin_id,
                    LEFT_PHOTOS_MESSAGES,
                    title=title,
                    count=count,
                    photos="photo" if count == 1 else f"{count} photos",
                    were="was" if count == 1 else "were",
                )
                db.commit()
            except Exception:
                log.warning("deleted photos notice failed: %s", admin_id, exc_info=True)
                db.rollback()


def finish_account_deletions(db: Session) -> None:
    user_ids = db.scalars(select(User.id).where(User.deleted_at.is_not(None))).all()
    for user_id in user_ids:
        try:
            user = db.get(User, user_id)
            if user is not None:
                notify_deleted_photos(db, delete_account(db, user))
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


def prune_reports(db: Session, now: datetime) -> None:
    """처리하고 보관 기간이 지난 신고를 지운다. 처리 전인 신고는 남긴다."""
    db.execute(
        delete(ContentReport).where(
            ContentReport.status == "closed", ContentReport.resolved_at < now - REPORT_RETENTION
        )
    )
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


UNFUNDED_MESSAGES: Messages = {
    "ko": (
        "공유 앨범에 보관 용량이 없어요",
        "'{title}'에 용량을 나눠 준 구성원이 없어 {days}일 뒤 사진이 지워져요. "
        "필요한 사진은 앨범에서 기기 사진첩에 저장하거나, 구독 후 용량을 나눠 주세요.",
    ),
    "en": (
        "A shared album has no storage",
        "No one is sharing storage with “{title}”, so its photos will be deleted in {days} days. "
        "Save the photos you want to your device library from the album, "
        "or subscribe and share some of your storage.",
    ),
    "ja": (
        "共有アルバムに保管容量がありません",
        "「{title}」に容量を割り当てているメンバーがいないため、{days}日後に写真が削除されます。"
        "必要な写真はアルバムからデバイスのライブラリに保存するか、"
        "サブスクリプション後に容量を割り当ててください。",
    ),
}


def expire_unfunded_albums(db: Session, now: datetime, notify: Notifier = send_push) -> None:
    """용량을 나눠 준 사람이 하나도 남지 않은 공유 앨범을 정리한다 (docs/PRICING.md §3.5).

    용량을 바꾸는 일이 생길 때 refresh_funding이 unfunded_since를 표시해 두므로, 표시된 앨범만 본다.
    먼저 구성원에게 알리고, 알린 때부터 기한(SHARED_ALBUM_GRACE_DAYS)이 지나면 항목을 모두 빼고 올린
    사람이 구독하지 않는 파일을 지운다 (나간 구성원이 남긴 사진 포함). 아직 구독 중인 사람의 파일은
    그 사람의 개인 사용량으로 돌아간다. 기한 안에 누가 용량을 나눠 주면 표시가 지워져 그대로
    이어진다.
    """
    days = get_settings().shared_album_grace_days
    album_ids = db.scalars(
        select(SharedAlbum.id).where(SharedAlbum.unfunded_since.is_not(None))
    ).all()
    for album_id in album_ids:
        by_author: dict[str, list[str]] = {}
        try:
            album = lock_album_row(db, album_id)
            if album is None:
                db.rollback()
                continue
            # 표시한 뒤 다시 구독한 사람이 있을 수 있어 정리하기 전에 다시 확인한다.
            refresh_funding(db, album)
            if album.unfunded_since is None:
                db.commit()
                continue
            if album.unfunded_notified_at is None:
                album.unfunded_notified_at = now
                title = album.title
                members = db.scalars(
                    select(SharedAlbumMember.user_id).where(SharedAlbumMember.album_id == album_id)
                ).all()
                db.commit()
                for member_id in members:
                    try:
                        notify_localized(
                            notify, db, member_id, UNFUNDED_MESSAGES, title=title, days=days
                        )
                        db.commit()
                    except Exception:
                        log.warning("unfunded album notice failed: %s", member_id, exc_info=True)
                        db.rollback()
                continue
            if album.unfunded_notified_at + timedelta(days=days) > now:
                db.commit()
                continue
            by_author = release_unfunded_album(db, album)
            db.commit()
            log.info("released unfunded shared album %s", album_id)
        except Exception:
            log.exception("unfunded album cleanup failed: %s", album_id)
            db.rollback()
            continue
        # 파일은 올린 사람의 행을 잠그고 지운다 (잠그는 순서: 사용자 → 앨범).
        for author_id in sorted(by_author):
            try:
                user = lock_user(db, author_id)
                for moment_id in delete_unneeded_files(db, author_id, by_author[author_id]):
                    moment = db.get(Moment, (author_id, moment_id))
                    if moment is not None:
                        user.sync_seq += 1
                        moment.seq = user.sync_seq
                db.commit()
            except UserGone:
                db.rollback()
            except Exception:
                log.exception("unfunded album file cleanup failed: %s", author_id)
                db.rollback()


def reconcile_shared_usage(db: Session) -> None:
    """저장해 둔 공유 앨범 사용량을 모두 다시 센다. 바뀐 만큼 고치는 값이 어긋나도 하루 안에
    맞춘다."""
    for album_id in db.scalars(select(SharedAlbum.id).order_by(SharedAlbum.id)).all():
        try:
            album = lock_album_row(db, album_id)
            if album is not None:
                recount_album(db, album)
                # 결제 설정을 바꾸는 등 구독 변경을 거치지 않고 용량이 바뀐 경우도 맞춘다.
                refresh_funding(db, album)
            db.commit()
        except Exception:
            log.exception("shared usage reconcile failed: %s", album_id)
            db.rollback()
    # 항목이 없어진 기록도 shared_moments에서 빠지도록, 행이 남은 사용자도 다시 센다.
    user_ids = set(db.scalars(select(SharedAlbumItem.author_id).distinct())) | set(
        db.scalars(select(SharedMoment.user_id).distinct())
    )
    for user_id in sorted(user_ids):
        try:
            moments = set(
                db.scalars(
                    select(SharedAlbumItem.moment_id).where(SharedAlbumItem.author_id == user_id)
                )
            ) | set(
                db.scalars(select(SharedMoment.moment_id).where(SharedMoment.user_id == user_id))
            )
            recount(db, user_id, moments, [])
            db.flush()
            total = db.scalar(
                select(func.coalesce(func.sum(SharedMoment.bytes), 0)).where(
                    SharedMoment.user_id == user_id
                )
            )
            usage = db.get(Usage, user_id, populate_existing=True)
            if usage is not None:
                usage.shared_bytes = total
            db.commit()
        except Exception:
            log.exception("shared usage reconcile failed for %s", user_id)
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
        lambda: expire_unfunded_albums(db, now, notify),
        # 하루 한 번 (새벽 4시 실행에서)
        lambda: reconcile_shared_usage(db) if now.hour == 4 else None,
        lambda: sweep_storage_cleanups(db, now),
        lambda: prune_billing_events(db, now),
        lambda: prune_reports(db, now),
    ):
        try:
            step()
        except Exception:
            log.exception("cloud job step failed")
            db.rollback()


def wait_for_db(attempts: int = 12, delay: float = 5) -> None:
    """cron 컨테이너가 막 뜬 직후에는 Railway 내부 주소(postgres.railway.internal)가
    아직 풀리지 않을 수 있다. 단계마다 같은 연결 오류를 내지 않도록 먼저 연결을 기다린다."""
    for attempt in range(1, attempts + 1):
        try:
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            return
        except OperationalError:
            if attempt == attempts:
                raise
            log.warning("database not reachable yet (%d/%d)", attempt, attempts)
            time.sleep(delay)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    init_sentry()
    wait_for_db()
    with SessionLocal() as session:
        # `python -m app.jobs reconcile`: 공유 앨범 사용량만 지금 다시 센다 (배포 직후 등).
        if sys.argv[1:] == ["reconcile"]:
            reconcile_shared_usage(session)
        else:
            run(session)
