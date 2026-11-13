"""공유 앨범 통합 테스트. test_cloud.py와 같은 로컬 Postgres·S3(`make up`)를 쓴다.

용량 규칙을 작은 숫자로 확인하려고 요금제 용량을 100바이트로 줄인다.
"""

import hashlib
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app import jobs
from app import plans as plans_module
from app.api import shared_albums
from app.cloud import purge_photos
from app.models.cloud import CloudObject, Entitlement, SharedAlbum
from app.shared import funding_changed_for_user
from tests.test_cloud import moment, sign_in, webhook

MAX = 100


@pytest.fixture(autouse=True)
def small_plan(monkeypatch):
    full = plans_module.plans
    monkeypatch.setattr(
        plans_module, "plans", lambda: {k: replace(v, max_bytes=MAX) for k, v in full().items()}
    )
    monkeypatch.setattr(shared_albums, "MIN_OWNER_ALLOCATION", 1)


def subscriber(client: TestClient) -> tuple[str, dict[str, str]]:
    user_id, headers = sign_in(client)
    webhook(client, user_id, "INITIAL_PURCHASE")
    return user_id, headers


def push_moment(client: TestClient, headers: dict, **data) -> str:
    moment_id = str(uuid4())
    pushed = client.post(
        "/sync/push",
        headers=headers,
        json={"moments": [moment(moment_id, "2026-10-01T00:00:00Z", **data)]},
    )
    assert pushed.status_code == 200
    return moment_id


def store(client: TestClient, headers: dict, moment_id: str, variant: str, body: bytes) -> None:
    content_type = "video/mp4" if variant == "compact" else "image/jpeg"
    created = client.post(
        "/uploads",
        headers=headers,
        json={
            "moment_id": moment_id,
            "variant": variant,
            "size": len(body),
            "content_type": content_type,
            "md5": hashlib.md5(body).hexdigest(),
        },
    )
    assert created.status_code == 200, created.text
    info = created.json()
    put = httpx.put(info["upload_url"], content=body, headers=info["headers"])
    assert put.status_code == 200, put.text
    upload_id = info["id"]
    assert client.post(f"/uploads/{upload_id}/complete", headers=headers).status_code == 204


def create_album(client: TestClient, headers: dict, allocated: int = 40, **extra):
    return client.post(
        "/shared-albums",
        headers=headers,
        json={
            "title": "우리 가족",
            "relation": "family",
            "display_name": "엄마",
            "allocated_bytes": allocated,
            **extra,
        },
    )


def new_album(client: TestClient, headers: dict, allocated: int = 40, **extra) -> dict:
    created = create_album(client, headers, allocated, **extra)
    assert created.status_code == 201, created.text
    return created.json()


def invite_and_join(
    client: TestClient, admin: dict, album_id: str, member: dict, name: str, allocated: int = 0
) -> dict:
    code = client.post(f"/shared-albums/{album_id}/invite", headers=admin).json()["code"]
    joined = client.post(
        "/shared-albums/join",
        headers=member,
        json={"code": code.lower(), "display_name": name, "allocated_bytes": allocated},
    )
    assert joined.status_code == 200, joined.text
    return joined.json()


def add(client: TestClient, headers: dict, album_id: str, *moment_ids: str):
    return client.post(
        f"/shared-albums/{album_id}/items", headers=headers, json={"moment_ids": list(moment_ids)}
    )


def items(client: TestClient, headers: dict, album_id: str) -> list[dict]:
    response = client.get(f"/shared-albums/{album_id}/items", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()["items"]


def album(client: TestClient, headers: dict, album_id: str) -> dict:
    response = client.get(f"/shared-albums/{album_id}", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def usage(client: TestClient, headers: dict) -> dict:
    return client.get("/account", headers=headers).json()["usage"]


def try_upload(client: TestClient, headers: dict, moment_id: str, variant: str, body: bytes):
    return client.post(
        "/uploads",
        headers=headers,
        json={
            "moment_id": moment_id,
            "variant": variant,
            "size": len(body),
            "content_type": "image/jpeg",
            "md5": hashlib.md5(body).hexdigest(),
        },
    )


def test_creator_allocates_from_their_plan_and_members_join_for_free(client):
    _, free = sign_in(client)
    assert create_album(client, free).status_code == 403

    _, owner = subscriber(client)
    # 요금제 용량보다 많이 떼어 줄 수 없다.
    assert create_album(client, owner, allocated=MAX + 1).status_code == 413
    created = new_album(client, owner, allocated=40)
    assert created["is_owner"] and created["storage"]["capacity_bytes"] == 40
    assert created["storage"]["my_allocation"] == 40
    assert usage(client, owner)["allocated_bytes"] == 40
    listed = client.get("/shared-albums", headers=owner).json()
    assert (listed["owned"], listed["limit"], listed["free_bytes"]) == (1, 2, 60)

    # 구독하지 않은 구성원은 할당 없이 참여해 보고, 앨범 공간에 사진을 담는다.
    joined = invite_and_join(client, owner, created["id"], free, "지민")
    assert joined["member_count"] == 2 and joined["storage"]["capacity_bytes"] == 40
    moment_id = push_moment(client, free, memo="개인 메모", place_name="우리 집")
    assert add(client, free, created["id"], moment_id).json() == {"added": 1}
    mine = client.get("/shared-albums/my-items", headers=free).json()["items"]
    assert mine == [
        {"album_id": created["id"], "moment_id": moment_id, "photo_quality": "original"}
    ]
    store(client, free, moment_id, "display", b"poster")

    [item] = items(client, owner, created["id"])
    assert item["author_name"] == "지민" and item["stored_variants"] == ["display"]
    assert "memo" not in item and "place_name" not in item
    detail = album(client, owner, created["id"])
    assert detail["storage"]["bytes_total"] == len(b"poster")
    assert detail["contributors"][0]["display_name"] == "지민"
    photo = client.get(
        f"/shared-albums/{created['id']}/items/{item['id']}/photo",
        params={"variant": "display"},
        headers=owner,
    )
    assert photo.status_code == 200

    # 구독하지 않은 사람은 할당할 용량이 없다.
    refused = client.patch(
        f"/shared-albums/{created['id']}/members/{joined['members'][1]['user_id']}",
        headers=free,
        json={"allocated_bytes": 10},
    )
    assert refused.status_code == 413


def test_shared_album_names_cannot_be_blank_after_trimming(client):
    _, owner = subscriber(client)
    assert create_album(client, owner, title="   ").status_code == 422
    created = new_album(client, owner)
    assert (
        client.patch(
            f"/shared-albums/{created['id']}", headers=owner, json={"title": "\t"}
        ).status_code
        == 422
    )
    _, guest = sign_in(client)
    code = client.post(f"/shared-albums/{created['id']}/invite", headers=owner).json()["code"]
    assert (
        client.post(
            "/shared-albums/join",
            headers=guest,
            json={"code": code, "display_name": "  ", "allocated_bytes": 0},
        ).status_code
        == 422
    )


def test_each_plan_owns_a_limited_number_of_albums(client):
    # 10GB 요금제는 2개, 100GB 요금제는 50개까지 만든다.
    user_id, owner = subscriber(client)
    new_album(client, owner, allocated=10)
    new_album(client, owner, allocated=10)
    assert create_album(client, owner, allocated=10).status_code == 409
    webhook(client, user_id, "RENEWAL", product_id="keepsake_cloud_100gb_monthly")
    assert new_album(client, owner, allocated=10)["is_owner"]
    # 다른 사람의 앨범에 참여하는 것은 세지 않는다.
    _, other = subscriber(client)
    theirs = new_album(client, other, allocated=10)
    invite_and_join(client, other, theirs["id"], owner, "나")
    overview = client.get("/shared-albums", headers=owner).json()
    assert (overview["owned"], overview["limit"]) == (3, 50)


def test_album_files_move_between_personal_and_album_usage_without_copies(client):
    _, author = subscriber(client)
    created = new_album(client, author, allocated=40)
    moment_id = push_moment(client, author)
    store(client, author, moment_id, "display", b"small")
    store(client, author, moment_id, "original", b"original")
    assert usage(client, author)["bytes_total"] == len(b"smalloriginal")

    add(client, author, created["id"], moment_id)
    # 파일은 그대로이고, 앨범에서 센다.
    assert usage(client, author)["bytes_total"] == 0
    assert usage(client, author)["object_count"] == 2
    assert album(client, author, created["id"])["storage"]["bytes_total"] == 13
    assert client.get("/shared-albums", headers=author).json()["free_bytes"] == MAX - 40

    # 이 기기가 공유 앨범을 아직 몰라 지우려 해도, 앨범이 쓰는 파일은 남는다.
    photos = [{"moment_id": moment_id, "variant": v} for v in ("display", "original")]
    client.post("/photos/delete", headers=author, json={"photos": photos})
    assert usage(client, author)["object_count"] == 2
    # 기록을 지워도 앨범에 남는다.
    deleted = moment(moment_id, "2026-10-02T00:00:00Z")
    deleted["deleted_at"] = "2026-10-02T00:00:00Z"
    client.post("/sync/push", headers=author, json={"moments": [deleted]})
    assert items(client, author, created["id"])[0]["stored_variants"] == ["display", "original"]

    # 효율 보관으로 바꾸면 원본은 앨범이 쓰지 않아 다시 개인 사용량이 되고, 기기가 지울 수 있다.
    client.patch(
        f"/shared-albums/{created['id']}", headers=author, json={"photo_quality": "display"}
    )
    assert album(client, author, created["id"])["storage"]["bytes_total"] == len(b"small")
    assert usage(client, author)["bytes_total"] == len(b"original")
    client.post("/photos/delete", headers=author, json={"photos": photos})
    assert usage(client, author)["object_count"] == 1


def test_display_album_does_not_expose_an_authors_personal_original(client):
    _, owner = subscriber(client)
    created = new_album(client, owner, allocated=40, photo_quality="display")
    moment_id = push_moment(client, owner)
    store(client, owner, moment_id, "display", b"small")
    store(client, owner, moment_id, "original", b"private-original")
    add(client, owner, created["id"], moment_id)

    _, member = sign_in(client)
    invite_and_join(client, owner, created["id"], member, "지민")
    [item] = items(client, member, created["id"])
    assert item["stored_variants"] == ["display"]
    assert (
        client.get(
            f"/shared-albums/{created['id']}/items/{item['id']}/photo",
            params={"variant": "original"},
            headers=member,
        ).status_code
        == 404
    )


def test_members_see_the_thumbnail_and_it_counts_in_album_usage(client):
    _, owner = subscriber(client)
    created = new_album(client, owner, photo_quality="display")
    moment_id = push_moment(client, owner)
    add(client, owner, created["id"], moment_id)
    store(client, owner, moment_id, "display", b"d" * 8)
    store(client, owner, moment_id, "thumb", b"t" * 2)
    _, member = sign_in(client)
    invite_and_join(client, owner, created["id"], member, "지민")

    [item] = items(client, member, created["id"])
    assert item["stored_variants"] == ["display", "thumb"]
    assert album(client, member, created["id"])["storage"]["bytes_total"] == 10
    thumb = client.get(
        f"/shared-albums/{created['id']}/items/{item['id']}/photo",
        headers=member,
        params={"variant": "thumb"},
    )
    assert thumb.status_code == 200 and thumb.json()["size"] == 2


def test_each_photo_can_keep_its_own_quality_for_everyone(client):
    _, owner = subscriber(client)
    created = new_album(client, owner, photo_quality="display")
    _, member = sign_in(client)
    invite_and_join(client, owner, created["id"], member, "지민")
    sharp, light = push_moment(client, owner), push_moment(client, owner)
    response = client.post(
        f"/shared-albums/{created['id']}/items",
        headers=owner,
        json={"moment_ids": [sharp], "photo_quality": "original"},
    )
    assert response.status_code == 200, response.text
    add(client, owner, created["id"], light)
    for moment_id in (sharp, light):
        store(client, owner, moment_id, "display", b"d" * 4)
        store(client, owner, moment_id, "original", b"o" * 10)

    # 구성원 모두에게 같은 파일이 보이고, 앨범 용량은 사진마다 남기는 파일로 센다.
    by_quality = {item["photo_quality"]: item for item in items(client, member, created["id"])}
    assert by_quality["original"]["stored_variants"] == ["display", "original"]
    assert by_quality["original"]["quality_chosen"] is True
    assert by_quality["display"]["stored_variants"] == ["display"]
    assert by_quality["display"]["quality_chosen"] is False
    assert album(client, owner, created["id"])["storage"]["bytes_total"] == 4 + 10 + 4
    mine = client.get("/shared-albums/my-items", headers=owner).json()["items"]
    assert {row["moment_id"]: row["photo_quality"] for row in mine} == {
        sharp: "original",
        light: "display",
    }

    # 올린 사람이나 관리자만 바꾼다. 앨범 화질로 되돌리면 원본은 앨범에서 세지 않는다.
    path = f"/shared-albums/{created['id']}/items/quality"
    item_id = by_quality["original"]["id"]
    body = {"item_ids": [item_id], "photo_quality": None}
    assert client.post(path, headers=member, json=body).status_code == 403
    assert client.post(path, headers=owner, json=body).status_code == 204
    assert album(client, owner, created["id"])["storage"]["bytes_total"] == 4 + 4
    original = client.get(
        f"/shared-albums/{created['id']}/items/{item_id}/photo",
        headers=member,
        params={"variant": "original"},
    )
    assert original.status_code == 404


def test_quality_changes_cannot_exceed_shared_album_capacity(client):
    """이미 개인 Cloud에 있는 원본도 사진별·기본 화질을 바꿔 앨범 사용량이 될 수 있다."""
    _, owner = subscriber(client)
    created = new_album(client, owner, allocated=10, photo_quality="display")
    moment_id = push_moment(client, owner)
    add(client, owner, created["id"], moment_id)
    store(client, owner, moment_id, "display", b"d" * 4)
    store(client, owner, moment_id, "original", b"o" * 10)
    item_id = items(client, owner, created["id"])[0]["id"]

    # 사진별 원본 선택(14바이트)은 10바이트 할당을 넘기며, 기존 선택은 그대로여야 한다.
    response = client.post(
        f"/shared-albums/{created['id']}/items/quality",
        headers=owner,
        json={"item_ids": [item_id], "photo_quality": "original"},
    )
    assert response.status_code == 413
    assert album(client, owner, created["id"])["storage"]["bytes_total"] == 4
    assert items(client, owner, created["id"])[0]["photo_quality"] == "display"

    # 앨범 기본 화질 변경도 같은 우회 경로가 되지 않는다.
    response = client.patch(
        f"/shared-albums/{created['id']}", headers=owner, json={"photo_quality": "original"}
    )
    assert response.status_code == 413
    assert album(client, owner, created["id"])["photo_quality"] == "display"


def test_converting_keeps_each_photos_chosen_quality(client):
    _, owner = subscriber(client)
    sharp, light = push_moment(client, owner), push_moment(client, owner)
    created = new_album(
        client,
        owner,
        photo_quality="display",
        moment_ids=[sharp, light],
        photo_qualities={sharp: "original"},
    )
    by_moment = {item["moment_id"]: item for item in items(client, owner, created["id"])}
    assert by_moment[sharp]["photo_quality"] == "original"
    assert by_moment[light]["photo_quality"] == "display"


def test_album_capacity_limits_uploads_and_adds(client):
    _, owner = subscriber(client)
    created = new_album(client, owner, allocated=8)
    first, second, third = (push_moment(client, owner) for _ in range(3))
    add(client, owner, created["id"], first, second)
    store(client, owner, first, "display", b"123456")
    full = try_upload(client, owner, second, "display", b"789")
    assert full.status_code == 413 and full.json()["detail"] == "shared album storage is full"
    # 이미 올린 파일이 있는 기록은 담는 순간 앨범 용량에서 세므로, 넘치면 담지 않는다.
    store(client, owner, third, "display", b"abc")
    assert add(client, owner, created["id"], third).status_code == 413
    assert usage(client, owner)["bytes_total"] == 3  # 개인 사용량으로 남는다


def test_unsubscribed_member_can_upload_first_compact_video_for_display_album(client):
    """compact가 아직 없을 때도 효율 보관 공유 앨범의 파일로 용량을 판정한다."""
    _, owner = subscriber(client)
    created = new_album(client, owner, allocated=20, photo_quality="display")
    _, member = sign_in(client)
    invite_and_join(client, owner, created["id"], member, "지민")
    moment_id = push_moment(client, member, media_type="video")
    assert add(client, member, created["id"], moment_id).status_code == 200

    # compact가 올라오기 전에는 원본이 임시로 필요하지만, compact 자체는 앨범 용량에서 센다.
    store(client, member, moment_id, "display", b"poster")
    store(client, member, moment_id, "compact", b"compact")
    detail = album(client, owner, created["id"])
    assert detail["storage"]["bytes_total"] == len(b"postercompact")
    assert usage(client, member)["bytes_total"] == 0


def test_changing_my_allocation(client):
    owner_id, owner = subscriber(client)
    created = new_album(client, owner, allocated=10)
    moment_id = push_moment(client, owner)
    add(client, owner, created["id"], moment_id)
    store(client, owner, moment_id, "display", b"1234567")
    me = f"/shared-albums/{created['id']}/members/{owner_id}"
    # 내 남은 용량 안에서 늘린다.
    assert client.patch(me, headers=owner, json={"allocated_bytes": MAX + 1}).status_code == 413
    assert (
        client.patch(me, headers=owner, json={"allocated_bytes": 50}).json()["storage"][
            "capacity_bytes"
        ]
        == 50
    )
    # 앨범이 쓰는 만큼보다 작게 줄일 수 없다.
    assert client.patch(me, headers=owner, json={"allocated_bytes": 5}).status_code == 409
    assert client.patch(me, headers=owner, json={"allocated_bytes": 7}).status_code == 200
    # 다른 사람의 할당은 바꿀 수 없다.
    other_id, other = subscriber(client)
    invite_and_join(client, owner, created["id"], other, "지민", allocated=5)
    other_path = f"/shared-albums/{created['id']}/members/{other_id}"
    assert client.patch(other_path, headers=owner, json={"allocated_bytes": 0}).status_code == 403


def test_leaving_can_keep_photos_and_admins_resolve_overflow(client):
    owner_id, owner = subscriber(client)
    created = new_album(client, owner, allocated=10)
    member_id, member = subscriber(client)
    invite_and_join(client, owner, created["id"], member, "지민", allocated=10)
    assert album(client, owner, created["id"])["storage"]["capacity_bytes"] == 20
    for headers, body in ((owner, b"o" * 6), (member, b"m" * 6)):
        moment_id = push_moment(client, headers)
        add(client, headers, created["id"], moment_id)
        store(client, headers, moment_id, "display", body)

    preview = client.get(
        f"/shared-albums/{created['id']}/members/{member_id}/leave-preview", headers=member
    ).json()
    assert preview == {
        "capacity_before": 20,
        "capacity_after": 10,
        "bytes_total": 12,
        "member_bytes": 6,
        "member_items": 1,
        "over_if_kept": True,
        "over_if_removed": False,
    }
    left = client.delete(
        f"/shared-albums/{created['id']}/members/{member_id}",
        params={"photos": "keep"},
        headers=member,
    )
    assert left.status_code == 204
    # 나간 사람의 할당은 돌려받고, 남긴 사진은 앨범에서 센다.
    assert usage(client, member)["allocated_bytes"] == 0
    assert usage(client, member)["bytes_total"] == 0

    detail = album(client, owner, created["id"])
    assert detail["storage"]["over_capacity"] and not detail["writable"]
    gone = next(c for c in detail["contributors"] if not c["is_member"])
    assert gone["author_id"] == member_id and gone["bytes"] == 6
    # 넘친 앨범은 새 사진을 받지 않는다.
    assert add(client, owner, created["id"], push_moment(client, owner)).status_code == 413

    # 할당을 늘리거나, 나간 구성원의 사진을 정리하면 풀린다.
    me = f"/shared-albums/{created['id']}/members/{owner_id}"
    assert not client.patch(me, headers=owner, json={"allocated_bytes": 12}).json()["storage"][
        "over_capacity"
    ]
    client.patch(me, headers=owner, json={"allocated_bytes": 10})
    path = f"/shared-albums/{created['id']}/authors/{member_id}/items"
    assert client.delete(path, headers=owner).status_code == 204
    assert album(client, owner, created["id"])["writable"]
    # 남겼다가 빠진 사진은 다시 나간 사람의 개인 사용량이 된다 (그 기기가 정리한다).
    assert usage(client, member)["bytes_total"] == 6


def test_converting_a_safe_album_moves_its_usage(client):
    _, owner = subscriber(client)
    moment_ids = [push_moment(client, owner) for _ in range(2)]
    for moment_id in moment_ids:
        store(client, owner, moment_id, "display", b"12345")
    assert usage(client, owner)["bytes_total"] == 10
    # 할당이 바꿀 앨범의 사진보다 작으면 거절한다.
    small = create_album(client, owner, allocated=9, moment_ids=moment_ids)
    assert small.status_code == 413
    assert client.get("/shared-albums", headers=owner).json()["albums"] == []
    # 개인 사용량이 앨범으로 옮겨 가므로, 남은 용량 90을 넘어 떼어 줄 수 있다.
    created = new_album(client, owner, allocated=95, moment_ids=moment_ids)
    assert created["item_count"] == 2 and created["storage"]["bytes_total"] == 10
    assert usage(client, owner)["bytes_total"] == 0


def test_only_the_uploader_or_an_admin_can_remove_a_photo(client):
    _, owner = subscriber(client)
    created = new_album(client, owner)
    _, member_a = sign_in(client)
    _, member_b = sign_in(client)
    invite_and_join(client, owner, created["id"], member_a, "지민")
    invite_and_join(client, owner, created["id"], member_b, "서준")
    for headers in (member_a, member_b):
        add(client, headers, created["id"], push_moment(client, headers))
    by_author = {item["author_name"]: item for item in items(client, member_a, created["id"])}
    assert by_author["지민"]["can_delete"] is True and by_author["서준"]["can_delete"] is False

    path = f"/shared-albums/{created['id']}/items"
    assert client.delete(f"{path}/{by_author['서준']['id']}", headers=member_a).status_code == 403
    assert client.delete(f"{path}/{by_author['지민']['id']}", headers=member_a).status_code == 204
    assert client.delete(f"{path}/{by_author['서준']['id']}", headers=owner).status_code == 204
    assert items(client, owner, created["id"]) == []


def test_removing_several_photos_at_once_checks_every_one(client):
    _, owner = subscriber(client)
    created = new_album(client, owner)
    _, member = sign_in(client)
    invite_and_join(client, owner, created["id"], member, "지민")
    mine = [push_moment(client, member) for _ in range(2)]
    add(client, member, created["id"], *mine)
    add(client, owner, created["id"], push_moment(client, owner))
    by_author: dict[str, list[str]] = {}
    for item in items(client, member, created["id"]):
        by_author.setdefault(item["author_name"], []).append(item["id"])

    path = f"/shared-albums/{created['id']}/items/remove"
    # 남의 사진이 하나라도 섞이면 아무것도 빼지 않는다.
    mixed = {"item_ids": by_author["지민"] + by_author["엄마"]}
    assert client.post(path, headers=member, json=mixed).status_code == 403
    assert len(items(client, owner, created["id"])) == 3
    removed = client.post(path, headers=member, json={"item_ids": by_author["지민"]})
    assert removed.status_code == 204
    assert [item["author_name"] for item in items(client, owner, created["id"])] == ["엄마"]
    # 관리자는 누구의 사진이든 뺀다. 이미 빠진 항목은 건너뛴다.
    everything = {"item_ids": by_author["지민"] + by_author["엄마"]}
    assert client.post(path, headers=owner, json=everything).status_code == 204
    assert items(client, owner, created["id"]) == []


def test_admin_chooses_the_cover_and_it_falls_back_when_the_photo_leaves(client):
    _, owner = subscriber(client)
    created = new_album(client, owner)
    first, second = push_moment(client, owner), push_moment(client, owner)
    for moment_id in (first, second):
        store(client, owner, moment_id, "display", b"cover")
    add(client, owner, created["id"], first, second)
    item_ids = {item["moment_id"]: item["id"] for item in items(client, owner, created["id"])}
    path = f"/shared-albums/{created['id']}"
    assert album(client, owner, created["id"])["cover_mode"] == "latest"
    assert album(client, owner, created["id"])["cover_item_id"] == item_ids[second]

    chose = client.patch(
        path, headers=owner, json={"cover_mode": "photo", "cover_item_id": item_ids[first]}
    )
    assert chose.status_code == 200, chose.text
    assert chose.json()["cover_item_id"] == item_ids[first]
    _, someone = subscriber(client)
    other = new_album(client, someone)
    not_here = client.patch(
        f"/shared-albums/{other['id']}",
        headers=someone,
        json={"cover_mode": "photo", "cover_item_id": item_ids[first]},
    )
    assert not_here.status_code == 422

    # 고른 사진이 빠지면 가장 최근 사진으로 돌아간다.
    assert client.delete(f"{path}/items/{item_ids[first]}", headers=owner).status_code == 204
    after = album(client, owner, created["id"])
    assert after["cover_mode"] == "photo" and after["cover_item_id"] == item_ids[second]

    designed = client.patch(path, headers=owner, json={"cover_mode": "design", "cover_emoji": "🏡"})
    assert designed.json()["cover_mode"] == "design" and designed.json()["cover_emoji"] == "🏡"
    [listed] = client.get("/shared-albums", headers=owner).json()["albums"]
    assert listed["cover_emoji"] == "🏡"
    assert client.get("/shared-albums", headers=someone).json()["albums"][0]["cover_emoji"] is None

    _, member = sign_in(client)
    invite_and_join(client, owner, created["id"], member, "지민")
    blocked = client.patch(path, headers=member, json={"cover_mode": "latest"})
    assert blocked.status_code == 403


def test_several_admins_and_owner_transfer(client):
    _, owner = subscriber(client)
    created = new_album(client, owner, allocated=10)
    free_id, free = sign_in(client)
    paid_id, paid = subscriber(client)
    invite_and_join(client, owner, created["id"], free, "지민")
    invite_and_join(client, owner, created["id"], paid, "서준")
    members = f"/shared-albums/{created['id']}/members"

    # 관리자는 여럿일 수 있고, 새 관리자도 다른 사람을 관리자로 지정한다.
    promote = client.patch(f"{members}/{paid_id}", headers=owner, json={"role": "admin"})
    assert promote.status_code == 200
    promoted = client.patch(f"{members}/{free_id}", headers=paid, json={"role": "admin"}).json()
    assert [m["role"] for m in promoted["members"]] == ["admin", "admin", "admin"]
    owner_id = next(m["user_id"] for m in promoted["members"] if m["is_owner"])
    demote = client.patch(f"{members}/{owner_id}", headers=paid, json={"role": "member"})
    assert demote.status_code == 409
    # 넘겨받는 사람은 구독 중이고 공유 앨범을 더 가질 수 있어야 한다.
    transfer = f"/shared-albums/{created['id']}/owner"
    assert client.post(transfer, headers=owner, json={"user_id": free_id}).status_code == 409
    assert client.post(transfer, headers=paid, json={"user_id": paid_id}).status_code == 403
    moved = client.post(transfer, headers=owner, json={"user_id": paid_id}).json()
    assert next(m for m in moved["members"] if m["is_owner"])["user_id"] == paid_id


def test_owner_leaving_hands_the_album_to_someone_who_can_own_it(client):
    _, owner = subscriber(client)
    created = new_album(client, owner, allocated=10)
    free_id, free = sign_in(client)
    paid_id, paid = subscriber(client)
    invite_and_join(client, owner, created["id"], free, "지민")
    invite_and_join(client, owner, created["id"], paid, "서준")
    owner_id = next(
        m["user_id"] for m in album(client, owner, created["id"])["members"] if m["is_me"]
    )

    client.delete(f"/shared-albums/{created['id']}/members/{owner_id}", headers=owner)
    detail = album(client, free, created["id"])
    roles = {m["user_id"]: (m["role"], m["is_owner"]) for m in detail["members"]}
    # 먼저 참여한 지민이 관리자가 되고, 공유 앨범을 가질 수 있는 서준이 소유자가 된다.
    assert roles == {free_id: ("admin", False), paid_id: ("admin", True)}

    client.delete(f"/shared-albums/{created['id']}/members/{paid_id}", headers=paid)
    client.delete(f"/shared-albums/{created['id']}/members/{free_id}", headers=free)
    assert client.get("/shared-albums", headers=free).json()["albums"] == []


def test_lapsed_member_allocation_stops_counting_and_purge_keeps_album_files(client, db):
    owner_id, owner = subscriber(client)
    created = new_album(client, owner, allocated=10)
    member_id, member = subscriber(client)
    invite_and_join(client, owner, created["id"], member, "지민", allocated=10)
    moment_id = push_moment(client, member)
    add(client, member, created["id"], moment_id)
    store(client, member, moment_id, "display", b"12345")
    private = push_moment(client, member)
    store(client, member, private, "display", b"mine")

    webhook(client, member_id, "EXPIRATION")
    # 유예 중에는 할당이 남는다.
    assert album(client, owner, created["id"])["storage"]["capacity_bytes"] == 20
    # 유예가 끝나면 주기 작업이 파일을 정리하고 expired로 바꾼다 (jobs.expire_grace).
    purge_photos(db, member_id, datetime.now(UTC))
    db.get(Entitlement, member_id).status = "expired"
    db.commit()
    # 보관 기간이 끝나면 할당은 세지 않고, 앨범이 쓰는 파일은 남는다. 개인 파일만 지운다.
    detail = album(client, owner, created["id"])
    assert detail["storage"]["capacity_bytes"] == 10
    assert items(client, owner, created["id"])[0]["stored_variants"] == ["display"]
    assert usage(client, member)["object_count"] == 1


def test_account_deletion_hands_the_album_to_another_member(client, db):
    _, owner = subscriber(client)
    created = new_album(client, owner, allocated=10)
    member_id, member = subscriber(client)
    invite_and_join(client, owner, created["id"], member, "지민", allocated=10)
    add(client, owner, created["id"], push_moment(client, owner))

    assert client.delete("/account", headers=owner).status_code == 204
    detail = album(client, member, created["id"])
    assert [(m["user_id"], m["role"], m["is_owner"]) for m in detail["members"]] == [
        (member_id, "admin", True)
    ]
    assert detail["storage"]["capacity_bytes"] == 10
    assert items(client, member, created["id"]) == []  # 지운 계정의 사진은 남기지 않는다
    db.expire_all()
    assert db.get(SharedAlbum, created["id"]) is not None


def test_outsiders_cannot_see_the_album(client):
    _, owner = subscriber(client)
    created = new_album(client, owner)
    _, stranger = subscriber(client)
    assert client.get(f"/shared-albums/{created['id']}", headers=stranger).status_code == 404
    assert client.get(f"/shared-albums/{created['id']}/items", headers=stranger).status_code == 404
    assert client.get("/shared-albums", headers=stranger).json()["albums"] == []


def test_new_invite_replaces_the_old_code(client):
    _, owner = subscriber(client)
    created = new_album(client, owner)
    first = client.post(f"/shared-albums/{created['id']}/invite", headers=owner).json()["code"]
    second = client.post(f"/shared-albums/{created['id']}/invite", headers=owner).json()["code"]
    _, guest = sign_in(client)
    # 공백·하이픈과 소문자로 옮겨 적어도 같은 코드다.
    spaced = f"{second[:4].lower()} -{second[4:]}"
    assert client.get(f"/shared-albums/invites/{spaced}", headers=guest).status_code == 200
    assert client.get(f"/shared-albums/invites/{first}", headers=guest).status_code == 404
    assert client.get(f"/shared-albums/invites/{second}", headers=guest).status_code == 200
    client.delete(f"/shared-albums/{created['id']}/invite", headers=owner)
    assert client.get(f"/shared-albums/invites/{second}", headers=guest).status_code == 404


def lapse(client: TestClient, db, user_id: str) -> None:
    """구독 만료 → 30일 유예가 끝나 개인 파일을 정리한 상태 (jobs.expire_grace와 같다)."""
    webhook(client, user_id, "EXPIRATION")
    purge_photos(db, user_id, datetime.now(UTC))
    db.get(Entitlement, user_id).status = "expired"
    funding_changed_for_user(db, user_id)
    db.commit()


def object_statuses(db, user_id: str) -> list[str]:
    db.expire_all()
    return sorted(
        obj.status for obj in db.scalars(select(CloudObject).where(CloudObject.user_id == user_id))
    )


def test_when_nobody_funds_the_album_everyones_photos_are_released(client, db):
    a_id, a = subscriber(client)
    created = new_album(client, a, allocated=30)
    b_id, b = subscriber(client)
    c_id, c = sign_in(client)
    invite_and_join(client, a, created["id"], b, "B", allocated=20)
    invite_and_join(client, a, created["id"], c, "C")
    for headers in (a, b, c):
        moment_id = push_moment(client, headers)
        add(client, headers, created["id"], moment_id)
        store(client, headers, moment_id, "display", b"12345")

    # A가 사진을 남기고 먼저 나가고, 나중에 구독도 끝난다. 앨범이 쓰는 A의 파일은 남는다.
    client.delete(
        f"/shared-albums/{created['id']}/members/{a_id}", params={"photos": "keep"}, headers=a
    )
    lapse(client, db, a_id)
    assert object_statuses(db, a_id) == ["stored"]
    # B·C가 쓰다가 B의 구독도 끝나면 나눠 준 용량이 하나도 남지 않는다.
    lapse(client, db, b_id)
    detail = album(client, c, created["id"])
    assert detail["storage"]["capacity_bytes"] == 0 and detail["storage"]["bytes_total"] == 15

    sent: list[tuple[str, str]] = []
    notify = lambda _db, user_id, title, body: sent.append((user_id, body))  # noqa: E731
    now = datetime.now(UTC)
    jobs.expire_unfunded_albums(db, now, notify)
    # 먼저 남은 구성원에게 기한을 알리고, 그동안 사진은 그대로 볼 수 있다.
    assert sorted(user_id for user_id, _ in sent) == sorted([b_id, c_id])
    assert "30일 뒤" in sent[0][1]
    assert len(items(client, c, created["id"])) == 3

    jobs.expire_unfunded_albums(db, now + timedelta(days=31), notify)
    # 기한이 지나면 A(나간 사람)·B·C가 올린 사진 모두 앨범에서 빠지고 파일이 지워진다.
    assert items(client, c, created["id"]) == []
    assert album(client, c, created["id"])["member_count"] == 2  # 앨범과 구성원은 남는다
    for user_id in (a_id, b_id, c_id):
        assert object_statuses(db, user_id) == ["deleting"]
    assert usage(client, c)["bytes_total"] == 0


def test_subscribed_uploader_keeps_files_when_an_unfunded_album_is_released(client, db):
    a_id, a = subscriber(client)
    created = new_album(client, a, allocated=30)
    b_id, b = sign_in(client)
    invite_and_join(client, a, created["id"], b, "B")
    moment_id = push_moment(client, a)
    add(client, a, created["id"], moment_id)
    store(client, a, moment_id, "display", b"12345")
    assert usage(client, a)["bytes_total"] == 0
    # 소유자가 할당을 0으로 줄일 수는 없으니, 사진을 남기고 나간다 (A는 계속 구독 중).
    client.delete(
        f"/shared-albums/{created['id']}/members/{a_id}", params={"photos": "keep"}, headers=a
    )
    now = datetime.now(UTC)
    jobs.expire_unfunded_albums(db, now, lambda *args: None)
    jobs.expire_unfunded_albums(db, now + timedelta(days=31), lambda *args: None)
    # 아직 구독 중인 사람의 파일은 지우지 않고 그 사람의 개인 사용량으로 돌아간다.
    assert object_statuses(db, a_id) == ["stored"]
    assert usage(client, a)["bytes_total"] == 5


def test_funding_again_during_the_notice_keeps_the_album(client, db):
    a_id, a = subscriber(client)
    created = new_album(client, a, allocated=30)
    b_id, b = subscriber(client)
    invite_and_join(client, a, created["id"], b, "B")
    moment_id = push_moment(client, a)
    add(client, a, created["id"], moment_id)
    store(client, a, moment_id, "display", b"12345")
    lapse(client, db, a_id)
    now = datetime.now(UTC)
    jobs.expire_unfunded_albums(db, now, lambda *args: None)
    # B가 용량을 나눠 주면 정리하지 않는다.
    client.patch(
        f"/shared-albums/{created['id']}/members/{b_id}", headers=b, json={"allocated_bytes": 10}
    )
    jobs.expire_unfunded_albums(db, now + timedelta(days=31), lambda *args: None)
    assert len(items(client, b, created["id"])) == 1
    db.expire_all()
    assert db.get(SharedAlbum, created["id"]).unfunded_since is None


def test_removing_a_record_from_every_shared_album(client):
    _, owner = subscriber(client)
    created = new_album(client, owner, allocated=30)
    moment_id = push_moment(client, owner)
    add(client, owner, created["id"], moment_id)
    store(client, owner, moment_id, "display", b"12345")
    removed = client.post(
        "/shared-albums/my-items/remove", headers=owner, json={"moment_ids": [moment_id]}
    )
    assert removed.json() == {"removed": 1}
    assert items(client, owner, created["id"]) == []
    assert album(client, owner, created["id"])["storage"]["bytes_total"] == 0
    assert usage(client, owner)["bytes_total"] == 5


def test_cached_usage_matches_a_full_recount(client, db):
    _, a = subscriber(client)
    first = new_album(client, a, allocated=30, photo_quality="original")
    b_id, b = subscriber(client)
    invite_and_join(client, a, first["id"], b, "B", allocated=20)
    moments = [push_moment(client, a) for _ in range(3)]
    for moment_id in moments:
        store(client, a, moment_id, "display", b"123")
        store(client, a, moment_id, "original", b"1234567")
    add(client, a, first["id"], *moments)
    client.patch(f"/shared-albums/{first['id']}", headers=a, json={"photo_quality": "display"})
    [item, *_] = items(client, a, first["id"])
    client.delete(f"/shared-albums/{first['id']}/items/{item['id']}", headers=a)
    other = push_moment(client, b)
    add(client, b, first["id"], other)
    store(client, b, other, "display", b"bb")
    client.post(
        "/photos/delete",
        headers=a,
        json={"photos": [{"moment_id": moments[1], "variant": "original"}]},
    )

    def snapshot():
        db.expire_all()
        return (
            db.get(SharedAlbum, first["id"]).bytes_total,
            usage(client, a),
            usage(client, b),
        )

    before = snapshot()
    assert before[0] == 3 + 3 + 2  # 효율 보관이라 표시용만 센다
    jobs.reconcile_shared_usage(db)
    assert snapshot() == before


def test_album_is_flagged_when_funding_disappears_not_by_scanning(client, db):
    a_id, a = subscriber(client)
    created = new_album(client, a, allocated=30)
    b_id, b = sign_in(client)
    invite_and_join(client, a, created["id"], b, "B")
    moment_id = push_moment(client, a)
    add(client, a, created["id"], moment_id)
    store(client, a, moment_id, "display", b"12345")
    db.expire_all()
    assert db.get(SharedAlbum, created["id"]).unfunded_since is None
    # 나눠 준 사람이 사진을 남기고 나가는 순간 표시된다 (주기 작업을 기다리지 않는다).
    client.delete(
        f"/shared-albums/{created['id']}/members/{a_id}", params={"photos": "keep"}, headers=a
    )
    db.expire_all()
    assert db.get(SharedAlbum, created["id"]).unfunded_since is not None

    sent: list[str] = []
    now = datetime.now(UTC)
    jobs.expire_unfunded_albums(db, now, lambda _db, user_id, *_: sent.append(user_id))
    assert sent == [b_id]
    # 기한은 알린 때부터 센다. 그 전에는 다시 알리지도, 지우지도 않는다.
    jobs.expire_unfunded_albums(db, now + timedelta(days=29), lambda *_: sent.append("again"))
    assert sent == [b_id] and len(items(client, b, created["id"])) == 1
    jobs.expire_unfunded_albums(db, now + timedelta(days=31), lambda *_: None)
    assert items(client, b, created["id"]) == []


def test_account_deletion_tells_admins_how_many_photos_left(client, monkeypatch):
    _, owner = subscriber(client)
    created = new_album(client, owner, allocated=30)
    member_id, member = sign_in(client)
    invite_and_join(client, owner, created["id"], member, "지민")
    for _ in range(2):
        add(client, member, created["id"], push_moment(client, member))
    sent: list[tuple[str, str]] = []
    monkeypatch.setattr(
        jobs, "send_push", lambda _db, user_id, _t, body: sent.append((user_id, body))
    )
    owner_id = album(client, owner, created["id"])["members"][0]["user_id"]

    assert client.delete("/account", headers=member).status_code == 204
    assert sent == [
        (
            owner_id,
            "'우리 가족'에 사진을 담았던 구성원이 계정을 지워, 그 사람이 담은 사진 2장이 빠졌어요.",
        )
    ]
