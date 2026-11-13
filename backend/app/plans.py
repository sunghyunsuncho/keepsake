"""요금제별 한도 (docs/PRICING.md). 안전 보관 10GB와 100GB 두 가지다.

RevenueCat entitlement는 `cloud` 하나이고, 어느 요금제인지는 구독한 스토어 상품으로 정한다
(plan_for_product). 나머지 규칙은 PlanLimit 값만 본다.
"""

from dataclasses import dataclass

from app.cloud import subscription_status
from app.models.cloud import Entitlement

GB = 1024 * 1024 * 1024


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
    return {
        "cloud_10gb": PlanLimit(
            plan="cloud_10gb",
            max_bytes=10 * GB,
            allow_original=True,
            shared_albums=2,
            suggested_allocation=2 * GB,
        ),
        "cloud_100gb": PlanLimit(
            plan="cloud_100gb",
            max_bytes=100 * GB,
            allow_original=True,
            shared_albums=50,
            suggested_allocation=10 * GB,
        ),
    }


# 스토어 상품 ID → 요금제. App Store는 `keepsake_cloud_10gb_monthly`처럼 기간까지 붙이고,
# Play는 구독 ID에 기본 요금제를 붙여 `keepsake_cloud_10gb:monthly`로 온다.
PRODUCT_PLANS = {
    "keepsake_cloud_10gb": "cloud_10gb",
    "keepsake_cloud_100gb": "cloud_100gb",
}
PERIOD_SUFFIXES = ("_monthly", "_yearly")


def plan_for_product(product_id: object) -> str | None:
    """모르는 상품이면 None (요금제를 바꾸지 않는다)."""
    if not isinstance(product_id, str):
        return None
    base = product_id.split(":", 1)[0]
    for suffix in PERIOD_SUFFIXES:
        base = base.removesuffix(suffix)
    return PRODUCT_PLANS.get(base)


def larger_plan(*names: str | None) -> str | None:
    """두 상품을 함께 구독한 경우(Play는 막지 않는다) 용량이 큰 쪽을 쓴다."""
    available = plans()
    known = [available[name] for name in names if name in available]
    return max(known, key=lambda p: p.max_bytes).plan if known else None


def plan_limit(entitlement: Entitlement | None) -> PlanLimit | None:
    """구독 중(active)이거나 유예 중인 요금제. 구독하지 않았으면 None.

    관리자가 무상 제공한 계정은 가장 큰 요금제를 쓴다.
    """
    if subscription_status(entitlement) not in {"active", "grace"}:
        return None
    assert entitlement is not None
    if entitlement.access_override == "cloud":
        return top_plan()
    return plans().get(entitlement.plan, default_plan())


def default_plan() -> PlanLimit:
    return plans()["cloud_10gb"]


def top_plan() -> PlanLimit:
    return plans()["cloud_100gb"]
