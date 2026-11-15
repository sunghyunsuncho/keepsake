"""활동 기록(user_events) 통합 테스트. 로컬 Postgres·S3를 쓴다."""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from app import jobs
from app.api import events as events_api
from app.api import shared_albums
from app.models.cloud import UserEvent
from tests.test_cloud import sign_in
from tests.test_reports import family, photo_of
from tests.test_shared_albums import small_plan  # noqa: F401


@pytest.fixture(autouse=True)
def no_pushes(monkeypatch) -> None:
    monkeypatch.setattr(shared_albums, "send_comment_push", lambda *args: None)


def events(db, user_id: str) -> list[UserEvent]:
    db.expire_all()
    return list(
        db.scalars(select(UserEvent).where(UserEvent.user_id == user_id).order_by(UserEvent.id))
    )


def test_sign_in_is_recorded_with_whether_the_account_is_new(client, db):
    user_id, _ = sign_in(client, "same-person")
    sign_in(client, "same-person")
    assert [(e.event_type, e.properties) for e in events(db, user_id)] == [
        ("signed_in", {"provider": "apple", "new": True}),
        ("signed_in", {"provider": "apple", "new": False}),
    ]


def test_app_sends_on_device_actions(client, db):
    user_id, headers = sign_in(client)
    response = client.post(
        "/events",
        headers=headers,
        json={
            "event_type": "photos_kept",
            "properties": {"count": 3},
            "platform": "ios",
            "app_version": "1.0.0",
        },
    )
    assert response.status_code == 204
    kept = events(db, user_id)[-1]
    assert (kept.event_type, kept.properties, kept.platform, kept.app_version) == (
        "photos_kept",
        {"count": 3},
        "ios",
        "1.0.0",
    )


def test_events_need_sign_in_and_a_known_type(client):
    _, headers = sign_in(client)
    assert client.post("/events", json={"event_type": "app_open"}).status_code == 401
    assert (
        client.post("/events", headers=headers, json={"event_type": "anything"}).status_code == 422
    )


def test_properties_cannot_carry_long_text(client):
    _, headers = sign_in(client)
    long_text = {"event_type": "memo_edited", "properties": {"memo": "가" * 81}}
    assert client.post("/events", headers=headers, json=long_text).status_code == 422
    nested = {"event_type": "memo_edited", "properties": {"memo": {"text": "가"}}}
    assert client.post("/events", headers=headers, json=nested).status_code == 422
    many = {"event_type": "app_open", "properties": {f"k{i}": i for i in range(11)}}
    assert client.post("/events", headers=headers, json=many).status_code == 422


def test_non_finite_numbers_are_stored_as_null(client, db):
    # JSON 표준은 아니지만 파서가 받아들이는 NaN은 JSON 열에 저장할 수 없다 (500이 나지 않게).
    user_id, headers = sign_in(client)
    response = client.post(
        "/events",
        headers={**headers, "content-type": "application/json"},
        content='{"event_type": "app_open", "properties": {"count": NaN, "ok": 1}}',
    )
    assert response.status_code == 204
    assert events(db, user_id)[-1].properties == {"count": None, "ok": 1}


def test_app_events_are_limited_per_minute(client, db, monkeypatch):
    monkeypatch.setattr(events_api, "EVENTS_PER_MINUTE", 3)
    user_id, headers = sign_in(client)
    _, other = sign_in(client, "someone-else")
    app_open = {"event_type": "app_open"}
    # 서버가 남긴 signed_in은 세지 않는다.
    for _ in range(3):
        assert client.post("/events", headers=headers, json=app_open).status_code == 204
    assert client.post("/events", headers=headers, json=app_open).status_code == 429
    # 다른 사람은 따로 센다.
    assert client.post("/events", headers=other, json=app_open).status_code == 204

    # 1분이 지난 기록은 세지 않는다.
    for event in events(db, user_id):
        event.created_at = datetime.now(UTC) - events_api.RATE_WINDOW - timedelta(seconds=1)
    db.commit()
    assert client.post("/events", headers=headers, json=app_open).status_code == 204


def test_shared_album_actions_are_recorded_without_text(client, db):
    album_id, (owner_id, owner), (member_id, member) = family(client)
    photo = photo_of(client, owner, album_id, owner_id)
    client.post(
        f"/shared-albums/{album_id}/items/{photo['id']}/comments",
        headers=member,
        json={"body": "너무 예뻐요"},
    )
    client.patch(
        f"/shared-albums/{album_id}/items/{photo['id']}", headers=owner, json={"caption": "바다"}
    )

    ref = f"shared_album:{album_id}"
    owner_events = [(e.event_type, e.entity_ref) for e in events(db, owner_id)]
    assert ("shared_album_created", ref) in owner_events
    assert ("shared_items_added", ref) in owner_events
    assert ("shared_caption_set", ref) in owner_events
    member_events = [(e.event_type, e.entity_ref) for e in events(db, member_id)]
    assert ("shared_album_joined", ref) in member_events
    assert ("shared_comment_created", ref) in member_events
    # 댓글·캡션 내용은 남기지 않는다.
    for event in events(db, owner_id) + events(db, member_id):
        assert "너무 예뻐요" not in str(event.properties)
        assert "바다" not in str(event.properties)

    left = client.delete(f"/shared-albums/{album_id}/members/{member_id}", headers=member)
    assert left.status_code == 204
    assert events(db, member_id)[-1].event_type == "shared_album_left"


def test_old_events_are_pruned(client, db):
    user_id, headers = sign_in(client)
    client.post("/events", headers=headers, json={"event_type": "app_open"})
    old = events(db, user_id)[-1]
    old.created_at = datetime.now(UTC) - jobs.USER_EVENT_RETENTION - timedelta(days=1)
    db.commit()

    jobs.prune_user_events(db, datetime.now(UTC))
    assert [e.event_type for e in events(db, user_id)] == ["signed_in"]
