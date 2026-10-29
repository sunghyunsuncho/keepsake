"""RevenueCat webhook → Entitlement (docs/PLAN.md §2.3).

앱이 보낸 구독 여부는 믿지 않는다. RevenueCat 비밀 API 키가 설정돼 있으면 이벤트를 받을 때마다
REST로 현재 상태를 다시 읽고(순서가 뒤바뀐 이벤트에도 안전), 없으면 이벤트 종류로 상태를 정한다.
"""

import json
import secrets
from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Header, HTTPException, Request, status
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.api.deps import DbSession
from app.cloud import activate, refresh_from_revenuecat, start_grace
from app.config import get_settings
from app.models.cloud import BillingEvent, Entitlement

router = APIRouter(prefix="/billing", tags=["billing"])

# 구독이 유효해지는 이벤트. BILLING_ISSUE·CANCELLATION은 스토어 결제 유예나 자동 갱신 해제일 뿐
# 만료 시각까지는 구독 중이므로 상태를 바꾸지 않는다. 실제 만료는 EXPIRATION으로 온다.
ACTIVE_EVENTS = {
    "INITIAL_PURCHASE",
    "RENEWAL",
    "UNCANCELLATION",
    "PRODUCT_CHANGE",
    "SUBSCRIPTION_EXTENDED",
    "TEMPORARY_ENTITLEMENT_GRANT",
}


def _ms_to_datetime(value: Any) -> datetime | None:
    if not isinstance(value, (int, float)):
        return None
    return datetime.fromtimestamp(value / 1000, tz=UTC)


def _candidate_user_ids(event: dict[str, Any]) -> list[str]:
    """이 이벤트가 영향을 주는 우리 user_id 후보. 앱은 구매 전에 logIn(user_id)을 하지만,
    익명 ID로 시작한 구매가 나중에 합쳐진 경우를 위해 별칭도 함께 본다."""
    ids: list[str] = []
    for value in (
        event.get("app_user_id"),
        event.get("original_app_user_id"),
        *(event.get("aliases") or []),
        *(event.get("transferred_from") or []),
        *(event.get("transferred_to") or []),
    ):
        if isinstance(value, str) and not value.startswith("$RCAnonymousID") and value not in ids:
            ids.append(value)
    return ids


def _apply_event(entitlement: Entitlement, event: dict[str, Any]) -> None:
    event_at = _ms_to_datetime(event.get("event_timestamp_ms"))
    if event_at and entitlement.event_at and event_at < entitlement.event_at:
        return  # 이미 더 최근 이벤트를 반영했다
    event_type = event["type"]
    expires_at = _ms_to_datetime(event.get("expiration_at_ms"))
    # TRANSFER: 같은 스토어 계정의 구매를 다른 우리 계정에서 복원했다 (from → to로 구독이 옮겨감).
    transferred_to = entitlement.user_id in (event.get("transferred_to") or [])
    transferred_from = entitlement.user_id in (event.get("transferred_from") or [])
    if event_type in ACTIVE_EVENTS or (event_type == "TRANSFER" and transferred_to):
        activate(entitlement, expires_at)
    elif event_type == "EXPIRATION" or (event_type == "TRANSFER" and transferred_from):
        start_grace(entitlement, expires_at)
    if event_at:
        entitlement.event_at = event_at


@router.post("/revenuecat", status_code=status.HTTP_204_NO_CONTENT)
async def revenuecat_webhook(
    request: Request,
    db: DbSession,
    authorization: Annotated[str | None, Header()] = None,
) -> None:
    secret = get_settings().revenuecat_webhook_secret
    if not secret or not secrets.compare_digest(authorization or "", f"Bearer {secret}"):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid webhook authorization")
    # 원본을 그대로 저장하려고 body를 직접 읽는다 (async). DB와 RevenueCat 조회는 블로킹이라
    # 이벤트 루프를 막지 않도록 스레드에서 처리한다.
    raw = await request.body()
    await run_in_threadpool(_handle_event, db, raw)


def _handle_event(db: Session, raw: bytes) -> None:
    settings = get_settings()
    try:
        event = json.loads(raw)["event"]
        event_id, event_type = str(event["id"]), str(event["type"])
    except (KeyError, TypeError, json.JSONDecodeError) as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid RevenueCat event") from exc
    if db.get(BillingEvent, event_id) is not None:
        return  # RevenueCat은 응답을 못 받으면 같은 이벤트를 다시 보낸다
    record = BillingEvent(id=event_id, raw_payload=raw.decode("utf-8"))
    db.add(record)

    entitlement_ids = event.get("entitlement_ids")
    relevant = event_type != "TEST" and (
        not isinstance(entitlement_ids, list)
        or settings.revenuecat_entitlement_id in entitlement_ids
        or event_type == "TRANSFER"
    )
    if relevant:
        for user_id in _candidate_user_ids(event):
            entitlement = db.get(Entitlement, user_id)
            # 우리 계정이 아닌 ID(예: 삭제된 계정)는 재시도해도 복구되지 않으므로 기록만 남긴다.
            if entitlement is not None and not refresh_from_revenuecat(db, entitlement):
                _apply_event(entitlement, event)
    record.processed_at = datetime.now(UTC)
    db.commit()
