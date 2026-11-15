"""로그인한 사용자의 활동 기록 (user_events). 활동 분석에만 쓰고 앱 동작은 이 기록을 보지 않는다.

- 서버를 거치는 액션(로그인, 공유 앨범)은 그 요청이 직접 남긴다. 액션과 같은 트랜잭션에 넣어, 액션이
  실패하면 기록도 남지 않는다.
- 사진 고르기·앨범·메모처럼 기기 안에서 끝나는 액션은 앱이 POST /events로 보낸다
  (mobile/src/lib/activity.ts). Local 사용자(로그인하지 않음)는 보내지 않는다.
- 메모·장소·앨범 이름·댓글처럼 사용자가 쓴 글은 남기지 않는다. 수와 종류만 남긴다.
"""

from typing import Any, Literal

from sqlalchemy.orm import Session

from app.models.cloud import UserEvent

# 서버가 남기는 이벤트
ServerEvent = Literal[
    "signed_in",
    "shared_album_created",
    "shared_album_joined",
    "shared_album_left",
    "shared_member_removed",
    "shared_items_added",
    "shared_caption_set",
    "shared_comment_created",
    "content_reported",
    "user_blocked",
]

# 앱이 보내는 이벤트 (기기 안에서 끝나는 액션과 앱 사용)
ClientEvent = Literal[
    # 앱 실행 (콜드 스타트, 백그라운드에서 오래 있다 돌아옴)
    "app_open",
    # 화면 진입. entity_ref는 "screen:<라우트>" (사진 id 같은 값은 넣지 않는다)
    "screen_view",
    # 고르기에서 남기기를 눌렀다 (properties.count)
    "photos_kept",
    # 고르기에서 남기지 않고 지금까지 본 것으로 넘겼다
    "review_skipped",
    # 사진의 메모를 고쳤다 (내용은 보내지 않는다)
    "memo_edited",
    # 앨범을 만들었다 (properties.kind: 'custom' | 'safe')
    "album_created",
    # 남기지 않은 사진을 기기에서 지웠다 (properties.count)
    "photos_cleaned",
    # Local 기록을 계정으로 가져왔다 (properties.count)
    "local_imported",
    # 구독을 결제했다 (properties.plan)
    "subscribed",
]


def record(
    db: Session,
    user_id: str,
    event_type: ServerEvent | ClientEvent,
    entity_ref: str | None = None,
    properties: dict[str, Any] | None = None,
    *,
    platform: str | None = None,
    app_version: str | None = None,
) -> None:
    """이벤트를 세션에 더한다 (커밋하지 않는다). 부른 쪽의 커밋과 함께 남는다."""
    db.add(
        UserEvent(
            user_id=user_id,
            event_type=event_type,
            entity_ref=entity_ref,
            properties=properties or None,
            platform=platform,
            app_version=app_version,
        )
    )
