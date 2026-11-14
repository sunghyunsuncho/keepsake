"""공유 앨범 신고·차단 통합 테스트. test_shared_albums.py의 도우미와 로컬 Postgres·S3를 쓴다."""

from datetime import UTC, datetime, timedelta

from app import jobs
from app.config import get_settings
from app.jobs import REPORT_RETENTION
from app.models.cloud import ContentReport
from tests.test_admin import ADMIN, ADMIN_TOKEN
from tests.test_cloud import sign_in
from tests.test_shared_albums import (  # noqa: F401
    add,
    album,
    invite_and_join,
    items,
    new_album,
    push_moment,
    small_plan,
    subscriber,
)


def family(client):
    """소유자(엄마)와 구성원(지민)이 사진을 한 장씩 담은 앨범."""
    owner_id, owner = subscriber(client)
    created = new_album(client, owner)
    member_id, member = sign_in(client)
    invite_and_join(client, owner, created["id"], member, "지민")
    add(client, owner, created["id"], push_moment(client, owner))
    add(client, member, created["id"], push_moment(client, member))
    return created["id"], (owner_id, owner), (member_id, member)


def photo_of(client, headers, album_id, author_id) -> dict:
    return next(i for i in items(client, headers, album_id) if i["author_id"] == author_id)


def test_blocking_hides_their_photos_only_from_me(client):
    album_id, (owner_id, owner), (member_id, member) = family(client)

    blocked = client.post(
        f"/shared-albums/{album_id}/blocks", headers=owner, json={"user_id": member_id}
    )
    assert blocked.status_code == 204
    assert [i["author_id"] for i in items(client, owner, album_id)] == [owner_id]
    assert album(client, owner, album_id)["item_count"] == 1
    assert [m["blocked"] for m in album(client, owner, album_id)["members"]] == [False, True]
    # 차단당한 사람과 다른 구성원에게는 그대로 보인다.
    assert len(items(client, member, album_id)) == 2

    listed = client.get("/shared-albums/blocks", headers=owner).json()["users"]
    assert [(u["user_id"], u["display_name"]) for u in listed] == [(member_id, "지민")]

    assert client.delete(f"/shared-albums/blocks/{member_id}", headers=owner).status_code == 204
    assert len(items(client, owner, album_id)) == 2


def test_blocked_photo_cannot_be_downloaded(client):
    album_id, (_, owner), (member_id, member) = family(client)
    theirs = photo_of(client, member, album_id, member_id)
    client.post(f"/shared-albums/{album_id}/blocks", headers=owner, json={"user_id": member_id})
    response = client.get(
        f"/shared-albums/{album_id}/items/{theirs['id']}/photo",
        headers=owner,
        params={"variant": "display"},
    )
    assert response.status_code == 404


def test_cannot_block_or_report_yourself_or_strangers(client):
    album_id, (owner_id, owner), _ = family(client)
    stranger_id, _ = sign_in(client)
    for path, body in [
        ("blocks", {"user_id": owner_id}),
        ("reports", {"user_id": owner_id, "reason": "spam"}),
    ]:
        assert (
            client.post(f"/shared-albums/{album_id}/{path}", headers=owner, json=body).status_code
            == 422
        )
    for path, body in [
        ("blocks", {"user_id": stranger_id}),
        ("reports", {"user_id": stranger_id, "reason": "spam"}),
    ]:
        assert (
            client.post(f"/shared-albums/{album_id}/{path}", headers=owner, json=body).status_code
            == 404
        )


def test_only_members_can_report(client):
    album_id, (owner_id, _), _ = family(client)
    _, outsider = sign_in(client)
    response = client.post(
        f"/shared-albums/{album_id}/reports",
        headers=outsider,
        json={"user_id": owner_id, "reason": "harassment"},
    )
    assert response.status_code == 404


def test_admin_removes_a_reported_photo(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "admin_token", ADMIN_TOKEN)
    album_id, (_, owner), (member_id, member) = family(client)
    theirs = photo_of(client, owner, album_id, member_id)
    reported = client.post(
        f"/shared-albums/{album_id}/reports",
        headers=owner,
        json={"item_id": theirs["id"], "reason": "sexual", "detail": "  아이들도 보는 앨범이에요 "},
    )
    assert reported.status_code == 204

    listed = client.get("/admin/api/reports", headers=ADMIN).json()
    assert listed["open"] == 1
    report = listed["reports"][0]
    assert (report["reported_user_id"], report["reported_name"], report["reason"]) == (
        member_id,
        "지민",
        "sexual",
    )
    assert report["detail"] == "아이들도 보는 앨범이에요"
    assert report["item_in_album"] and report["still_member"]

    resolved = client.post(
        f"/admin/api/reports/{report['id']}/resolve", headers=ADMIN, json={"action": "remove_item"}
    )
    assert resolved.status_code == 200
    assert theirs["id"] not in [i["id"] for i in items(client, member, album_id)]
    assert client.get("/admin/api/reports", headers=ADMIN).json()["open"] == 0
    closed = client.get("/admin/api/reports", headers=ADMIN, params={"state": "closed"}).json()
    assert [r["action"] for r in closed["reports"]] == ["remove_item"]


def test_admin_removes_a_reported_member_and_their_photos(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "admin_token", ADMIN_TOKEN)
    album_id, (owner_id, owner), (member_id, _) = family(client)
    for reason in ["harassment", "spam"]:
        client.post(
            f"/shared-albums/{album_id}/reports",
            headers=owner,
            json={"user_id": member_id, "reason": reason},
        )
    report_id = client.get("/admin/api/reports", headers=ADMIN).json()["reports"][0]["id"]

    client.post(
        f"/admin/api/reports/{report_id}/resolve", headers=ADMIN, json={"action": "remove_member"}
    )
    assert [m["user_id"] for m in album(client, owner, album_id)["members"]] == [owner_id]
    assert [i["author_id"] for i in items(client, owner, album_id)] == [owner_id]
    # 같은 사람에 대한 다른 신고도 함께 닫힌다.
    assert client.get("/admin/api/reports", headers=ADMIN).json()["open"] == 0


def test_dismissing_keeps_everything(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "admin_token", ADMIN_TOKEN)
    album_id, (_, owner), (member_id, _) = family(client)
    theirs = photo_of(client, owner, album_id, member_id)
    client.post(
        f"/shared-albums/{album_id}/reports",
        headers=owner,
        json={"item_id": theirs["id"], "reason": "other"},
    )
    report_id = client.get("/admin/api/reports", headers=ADMIN).json()["reports"][0]["id"]
    client.post(
        f"/admin/api/reports/{report_id}/resolve", headers=ADMIN, json={"action": "dismiss"}
    )
    assert len(items(client, owner, album_id)) == 2


def test_closed_reports_are_pruned_after_a_year(client, db, monkeypatch):
    monkeypatch.setattr(get_settings(), "admin_token", ADMIN_TOKEN)
    album_id, (_, owner), (member_id, _) = family(client)
    for reason in ["spam", "other"]:
        client.post(
            f"/shared-albums/{album_id}/reports",
            headers=owner,
            json={"user_id": member_id, "reason": reason},
        )
    first = client.get("/admin/api/reports", headers=ADMIN).json()["reports"][0]
    report = db.get(ContentReport, first["id"])
    report.status, report.action = "closed", "dismiss"
    report.resolved_at = datetime.now(UTC) - REPORT_RETENTION - timedelta(days=1)
    db.commit()

    jobs.prune_reports(db, datetime.now(UTC))
    db.expire_all()
    assert db.get(ContentReport, first["id"]) is None
    # 처리 전인 신고는 남는다.
    assert client.get("/admin/api/reports", headers=ADMIN).json()["open"] == 1


def test_repeated_report_is_kept_once(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "admin_token", ADMIN_TOKEN)
    album_id, (_, owner), (member_id, _) = family(client)
    before = client.get("/admin/api/reports", headers=ADMIN).json()["open"]
    body = {"user_id": member_id, "reason": "spam"}
    for _ in range(3):
        response = client.post(f"/shared-albums/{album_id}/reports", headers=owner, json=body)
        assert response.status_code == 204
    assert client.get("/admin/api/reports", headers=ADMIN).json()["open"] == before + 1


def test_resolved_report_cannot_be_resolved_again(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "admin_token", ADMIN_TOKEN)
    album_id, (_, owner), (member_id, _) = family(client)
    client.post(
        f"/shared-albums/{album_id}/reports",
        headers=owner,
        json={"user_id": member_id, "reason": "harassment"},
    )
    report_id = client.get("/admin/api/reports", headers=ADMIN).json()["reports"][0]["id"]
    path = f"/admin/api/reports/{report_id}/resolve"
    assert client.post(path, headers=ADMIN, json={"action": "dismiss"}).status_code == 200
    # 처리한 신고로 구성원을 내보내지 않는다.
    assert client.post(path, headers=ADMIN, json={"action": "remove_member"}).status_code == 409
    assert member_id in [m["user_id"] for m in album(client, owner, album_id)["members"]]


def test_admin_removes_photos_left_behind_by_a_departed_member(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "admin_token", ADMIN_TOKEN)
    album_id, (owner_id, owner), (member_id, member) = family(client)
    client.post(
        f"/shared-albums/{album_id}/reports",
        headers=owner,
        json={"user_id": member_id, "reason": "harassment"},
    )
    # 신고당한 사람이 사진을 남기고 나간다.
    left = client.delete(
        f"/shared-albums/{album_id}/members/{member_id}", headers=member, params={"photos": "keep"}
    )
    assert left.status_code == 204
    report = next(
        r
        for r in client.get("/admin/api/reports", headers=ADMIN).json()["reports"]
        if r["album_id"] == album_id
    )
    assert (report["still_member"], report["reported_items"]) == (False, 1)

    path = f"/admin/api/reports/{report['id']}/resolve"
    client.post(path, headers=ADMIN, json={"action": "remove_member"})
    assert [i["author_id"] for i in items(client, owner, album_id)] == [owner_id]
