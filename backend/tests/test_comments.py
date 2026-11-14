"""공유 앨범 댓글 통합 테스트. test_reports.py의 도우미와 로컬 Postgres·S3를 쓴다."""

from datetime import timedelta
from uuid import uuid4

import httpx
import pytest

from app import jobs
from app.api import shared_albums
from app.config import get_settings
from app.models.cloud import Device, SharedItemComment
from tests.test_admin import ADMIN, ADMIN_TOKEN
from tests.test_cloud import sign_in
from tests.test_reports import family, photo_of
from tests.test_shared_albums import (  # noqa: F401
    add,
    invite_and_join,
    items,
    push_moment,
    small_plan,
)


@pytest.fixture(autouse=True)
def pushes(monkeypatch) -> list[tuple]:
    """보낸 댓글 알림 (받는 사람, 제목, 언어별 본문, 주소). 실제로 보내지 않는다."""
    sent: list[tuple] = []
    monkeypatch.setattr(shared_albums, "send_comment_push", lambda *args: sent.append(args))
    return sent


def comments(client, headers, album_id, item_id) -> list[dict]:
    response = client.get(f"/shared-albums/{album_id}/items/{item_id}/comments", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()["comments"]


def write(client, headers, album_id, item_id, body: str):
    return client.post(
        f"/shared-albums/{album_id}/items/{item_id}/comments", headers=headers, json={"body": body}
    )


def test_members_comment_on_each_others_photos(client):
    album_id, (owner_id, owner), (member_id, member) = family(client)
    photo = photo_of(client, owner, album_id, owner_id)

    first = write(client, member, album_id, photo["id"], "  너무 예뻐요  ")
    assert first.status_code == 201
    assert first.json()["body"] == "너무 예뻐요"
    assert write(client, owner, album_id, photo["id"], "고마워").status_code == 201

    seen = comments(client, owner, album_id, photo["id"])
    assert [(c["author_name"], c["body"], c["is_mine"]) for c in seen] == [
        ("지민", "너무 예뻐요", False),
        (seen[1]["author_name"], "고마워", True),
    ]
    # 관리자는 모든 댓글을, 구성원은 자기 댓글만 지운다.
    assert [c["can_delete"] for c in seen] == [True, True]
    assert [c["can_delete"] for c in comments(client, member, album_id, photo["id"])] == [
        True,
        False,
    ]
    assert photo_of(client, member, album_id, owner_id)["comment_count"] == 2
    assert photo_of(client, member, album_id, member_id)["comment_count"] == 0


def test_blank_or_long_comments_are_rejected(client):
    album_id, (owner_id, owner), _ = family(client)
    photo = photo_of(client, owner, album_id, owner_id)
    assert write(client, owner, album_id, photo["id"], "   ").status_code == 422
    assert write(client, owner, album_id, photo["id"], "가" * 501).status_code == 422


def test_only_the_writer_or_an_admin_deletes_a_comment(client):
    album_id, (owner_id, owner), (member_id, member) = family(client)
    photo = photo_of(client, owner, album_id, member_id)
    mine = write(client, owner, album_id, photo["id"], "관리자 댓글").json()
    theirs = write(client, member, album_id, photo["id"], "구성원 댓글").json()
    url = f"/shared-albums/{album_id}/items/{photo['id']}/comments"

    assert client.delete(f"{url}/{mine['id']}", headers=member).status_code == 403
    assert client.delete(f"{url}/{theirs['id']}", headers=owner).status_code == 204
    assert client.delete(f"{url}/{mine['id']}", headers=owner).status_code == 204
    assert comments(client, owner, album_id, photo["id"]) == []


def test_outsiders_cannot_read_or_write_comments(client):
    album_id, (owner_id, owner), _ = family(client)
    photo = photo_of(client, owner, album_id, owner_id)
    write(client, owner, album_id, photo["id"], "우리끼리")
    _, stranger = sign_in(client)
    url = f"/shared-albums/{album_id}/items/{photo['id']}/comments"
    assert client.get(url, headers=stranger).status_code == 404
    assert write(client, stranger, album_id, photo["id"], "안녕").status_code == 404


def test_blocked_peoples_comments_are_hidden_only_from_me(client):
    album_id, (owner_id, owner), (member_id, member) = family(client)
    photo = photo_of(client, owner, album_id, owner_id)
    write(client, member, album_id, photo["id"], "지민 댓글")
    client.post(f"/shared-albums/{album_id}/blocks", headers=owner, json={"user_id": member_id})

    assert comments(client, owner, album_id, photo["id"]) == []
    assert photo_of(client, owner, album_id, owner_id)["comment_count"] == 0
    assert len(comments(client, member, album_id, photo["id"])) == 1
    # 차단한 사람이 담은 사진에는 댓글을 볼 수도 남길 수도 없다.
    theirs = photo_of(client, member, album_id, member_id)
    assert write(client, owner, album_id, theirs["id"], "안녕").status_code == 404


def test_comments_go_with_the_photo(client):
    album_id, (_, owner), (member_id, member) = family(client)
    photo = photo_of(client, member, album_id, member_id)
    write(client, owner, album_id, photo["id"], "좋다")
    removed = client.delete(f"/shared-albums/{album_id}/items/{photo['id']}", headers=member)
    assert removed.status_code == 204
    url = f"/shared-albums/{album_id}/items/{photo['id']}/comments"
    assert client.get(url, headers=owner).status_code == 404


def test_leaving_keeps_comments_unless_photos_are_removed_too(client):
    album_id, (owner_id, owner), (member_id, member) = family(client)
    photo = photo_of(client, owner, album_id, owner_id)
    write(client, member, album_id, photo["id"], "남는 댓글")

    client.delete(
        f"/shared-albums/{album_id}/members/{member_id}", headers=member, params={"photos": "keep"}
    )
    assert [c["author_name"] for c in comments(client, owner, album_id, photo["id"])] == [
        "나간 구성원"
    ]

    other_id, other = sign_in(client)
    invite_and_join(client, owner, album_id, other, "하늘")
    add(client, other, album_id, push_moment(client, other))
    write(client, other, album_id, photo["id"], "사라질 댓글")
    client.delete(
        f"/shared-albums/{album_id}/members/{other_id}", headers=other, params={"photos": "remove"}
    )
    assert [c["body"] for c in comments(client, owner, album_id, photo["id"])] == ["남는 댓글"]


def test_admin_removes_a_reported_comment(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "admin_token", ADMIN_TOKEN)
    album_id, (owner_id, owner), (member_id, member) = family(client)
    photo = photo_of(client, owner, album_id, owner_id)
    bad = write(client, member, album_id, photo["id"], "나쁜 말").json()

    reported = client.post(
        f"/shared-albums/{album_id}/reports",
        headers=owner,
        json={"comment_id": bad["id"], "reason": "harassment"},
    )
    assert reported.status_code == 204
    report = client.get("/admin/api/reports", headers=ADMIN).json()["reports"][0]
    assert (report["reported_user_id"], report["comment_body"], report["comment_exists"]) == (
        member_id,
        "나쁜 말",
        True,
    )
    assert report["item_id"] is None

    resolved = client.post(
        f"/admin/api/reports/{report['id']}/resolve",
        headers=ADMIN,
        json={"action": "remove_comment"},
    )
    assert resolved.status_code == 200
    assert comments(client, owner, album_id, photo["id"]) == []
    closed = client.get("/admin/api/reports", headers=ADMIN, params={"state": "closed"}).json()
    assert closed["reports"][0]["comment_body"] == "나쁜 말"
    assert not closed["reports"][0]["comment_exists"]


def test_cannot_report_my_own_comment(client):
    album_id, (owner_id, owner), _ = family(client)
    photo = photo_of(client, owner, album_id, owner_id)
    mine = write(client, owner, album_id, photo["id"], "내 댓글").json()
    reported = client.post(
        f"/shared-albums/{album_id}/reports",
        headers=owner,
        json={"comment_id": mine["id"], "reason": "spam"},
    )
    assert reported.status_code == 422


def test_photo_author_is_notified_of_a_new_comment(client, pushes):
    album_id, (owner_id, owner), (member_id, member) = family(client)
    photo = photo_of(client, owner, album_id, owner_id)

    write(client, member, album_id, photo["id"], "너무 " + "예뻐요 " * 20)
    assert len(pushes) == 1
    recipient, title, bodies, url = pushes[0]
    assert (recipient, title) == (owner_id, "우리 가족")
    assert bodies["ko"].startswith("지민님이 내 사진에 댓글을 남겼어요: 너무 예뻐요")
    assert bodies["ko"].endswith("…")
    assert bodies["en"].startswith("지민 commented on your photo")
    assert url == f"/shared-albums/{album_id}?item={photo['id']}&comments=1"

    # 내 사진에 내가 단 댓글은 알리지 않는다.
    write(client, owner, album_id, photo["id"], "고마워")
    assert len(pushes) == 1


def test_quick_follow_up_comments_notify_once(client, db, pushes):
    album_id, (owner_id, owner), (_, member) = family(client)
    photo = photo_of(client, owner, album_id, owner_id)
    write(client, member, album_id, photo["id"], "하나")
    write(client, member, album_id, photo["id"], "둘")
    assert len(pushes) == 1

    # 조용한 시간이 지나면 다시 알린다.
    for row in db.query(SharedItemComment).filter_by(item_id=photo["id"]):
        row.created_at -= shared_albums.COMMENT_NOTIFY_QUIET + timedelta(minutes=1)
    db.commit()
    write(client, member, album_id, photo["id"], "셋")
    assert len(pushes) == 2


def test_no_notification_when_the_author_blocked_me_or_left(client, pushes):
    album_id, (owner_id, owner), (member_id, member) = family(client)
    theirs = photo_of(client, owner, album_id, member_id)
    client.post(f"/shared-albums/{album_id}/blocks", headers=member, json={"user_id": owner_id})
    write(client, owner, album_id, theirs["id"], "안녕")
    assert pushes == []

    client.delete(
        f"/shared-albums/{album_id}/members/{member_id}", headers=member, params={"photos": "keep"}
    )
    client.delete(f"/shared-albums/blocks/{owner_id}", headers=member)
    write(client, owner, album_id, theirs["id"], "잘 지내?")
    assert pushes == []


def test_push_uses_each_devices_language(client, db, monkeypatch):
    user_id, headers = sign_in(client)
    for language in ["ko", "ja"]:
        client.put(
            "/account/devices",
            headers=headers,
            json={
                "expo_push_token": f"ExponentPushToken[{uuid4()}]",
                "platform": "ios",
                "language": language,
            },
        )
    sent: list = []
    request = httpx.Request("POST", jobs.EXPO_PUSH_URL)

    def post(_url, json, **_kwargs):
        sent.extend(json)
        return httpx.Response(200, request=request, json={"data": [{"status": "ok"}] * len(json)})

    monkeypatch.setattr(httpx, "post", post)
    jobs.send_push(
        db,
        user_id,
        "앨범",
        "한국어",
        url="/shared-albums/a",
        translations={"ja": ("アルバム", "日本語")},
    )
    assert sorted((m["title"], m["body"], m["data"]["url"]) for m in sent) == [
        ("アルバム", "日本語", "/shared-albums/a"),
        ("앨범", "한국어", "/shared-albums/a"),
    ]


def test_signed_out_device_stops_getting_notifications(client, db):
    token = f"ExponentPushToken[{uuid4()}]"
    device = {"expo_push_token": token, "platform": "ios"}
    first_id, first = sign_in(client)
    _, second = sign_in(client)
    client.put("/account/devices", headers=first, json=device)
    # 다른 계정의 토큰은 지우지 못한다.
    assert (
        client.delete("/account/devices", headers=second, params={"token": token}).status_code
        == 204
    )
    assert db.get(Device, token).user_id == first_id
    assert (
        client.delete("/account/devices", headers=first, params={"token": token}).status_code == 204
    )
    db.expire_all()
    assert db.get(Device, token) is None
    assert (
        client.delete("/account/devices", headers=first, params={"token": "x"}).status_code == 422
    )


def test_latest_comment_is_shown_with_the_photo(client):
    album_id, (owner_id, owner), (member_id, member) = family(client)
    photo = photo_of(client, owner, album_id, owner_id)
    assert photo["latest_comment"] is None
    write(client, member, album_id, photo["id"], "첫 댓글")
    write(client, owner, album_id, photo["id"], "두 번째")

    latest = photo_of(client, member, album_id, owner_id)["latest_comment"]
    assert latest == {"author_name": latest["author_name"], "is_mine": False, "body": "두 번째"}
    # 차단한 사람의 댓글은 최근 댓글로도 보이지 않는다.
    theirs = photo_of(client, owner, album_id, member_id)
    write(client, member, album_id, theirs["id"], "내 사진에 내 댓글")
    write(client, owner, album_id, theirs["id"], "관리자 댓글")
    client.post(f"/shared-albums/{album_id}/blocks", headers=member, json={"user_id": owner_id})
    hidden = photo_of(client, member, album_id, member_id)["latest_comment"]
    assert hidden == {"author_name": "지민", "is_mine": True, "body": "내 사진에 내 댓글"}


def test_only_the_uploader_writes_the_caption(client):
    album_id, (owner_id, owner), (member_id, member) = family(client)
    mine = photo_of(client, member, album_id, member_id)
    url = f"/shared-albums/{album_id}/items/{mine['id']}"

    assert client.patch(url, headers=member, json={"caption": "  바다에서  "}).status_code == 204
    assert photo_of(client, owner, album_id, member_id)["caption"] == "바다에서"
    # 관리자여도 남의 글은 고치지 못한다.
    assert client.patch(url, headers=owner, json={"caption": "고침"}).status_code == 403
    assert client.patch(url, headers=member, json={"caption": "가" * 301}).status_code == 422
    assert client.patch(url, headers=member, json={"caption": "   "}).status_code == 204
    assert photo_of(client, owner, album_id, member_id)["caption"] is None
