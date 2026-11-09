"""요금제별 한도 (docs/PRICING.md). 지금은 기본 안전 보관 요금제 하나다.

요금제를 늘릴 때는 plans()에 항목을 더하고 Entitlement.plan에 그 이름을 넣는다. 나머지 규칙은 이
값만 본다.
"""

from dataclasses import dataclass

from app.cloud import subscription_status
from app.config import get_settings
from app.models.cloud import Entitlement


@dataclass(frozen=True)
class PlanLimit:
    plan: str
    # 개인 안전 보관 용량
    max_bytes: int
    allow_original: bool
    # 소유할 수 있는 공유 앨범 수 (참여한 앨범은 세지 않는다)
    shared_albums: int
    # 공유 앨범을 만들거나 참여할 때 처음 제안하는 할당 (사용자가 바꾼다)
    suggested_allocation: int


def plans() -> dict[str, PlanLimit]:
    settings = get_settings()
    return {
        "cloud": PlanLimit(
            plan="cloud",
            max_bytes=settings.cloud_max_bytes,
            allow_original=True,
            shared_albums=settings.shared_album_limit,
            suggested_allocation=10 * 1024 * 1024 * 1024,
        ),
    }


def plan_limit(entitlement: Entitlement | None) -> PlanLimit | None:
    """구독 중(active)이거나 유예 중인 요금제. 구독하지 않았으면 None."""
    if subscription_status(entitlement) not in {"active", "grace"}:
        return None
    assert entitlement is not None
    return plans().get(entitlement.plan, plans()["cloud"])


def default_plan() -> PlanLimit:
    return plans()["cloud"]
