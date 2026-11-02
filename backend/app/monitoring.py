import re

import sentry_sdk

from app.config import get_settings


def _scrub(event, _hint):
    # Postgres 오류의 DETAIL과 SQL에는 행 값(메모·장소)이 들어 있을 수 있다.
    for exception in event.get("exception", {}).get("values", []):
        if exception.get("value"):
            exception["value"] = re.sub(
                r"\s*(DETAIL:|\[SQL:).*", "", exception["value"], flags=re.S
            )
    # 기기 구분값과 기록 id가 쿼리에 들어 있다.
    event.get("request", {}).pop("query_string", None)
    return event


def init_sentry() -> None:
    """오류를 Sentry로 보낸다. DSN이 없으면(로컬) 아무것도 하지 않는다."""
    settings = get_settings()
    if not settings.sentry_dsn:
        return
    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.env,
        release=settings.railway_git_commit_sha,
        # 메모·장소가 오류 정보에 실려 나가지 않게 한다 (개인정보처리방침 §2.3).
        send_default_pii=False,
        max_request_body_size="never",
        include_local_variables=False,
        before_send=_scrub,
    )
