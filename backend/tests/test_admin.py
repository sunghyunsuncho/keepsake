from datetime import UTC, datetime, timedelta
from uuid import uuid4

from app import jobs
from app.config import get_settings
from app.models.cloud import Entitlement
from tests.test_cloud import moment, prefix_keys, sign_in, status_of, upload, webhook

ADMIN_TOKEN = "test-admin-token"
ADMIN = {"Authorization": f"Bearer {ADMIN_TOKEN}"}


def set_access(client, user_id: str, access: str):
    return client.put(f"/admin/api/users/{user_id}/access", headers=ADMIN, json={"access": access})


def test_admin_is_hidden_without_a_token(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "admin_token", None)
    assert client.get("/admin").status_code == 404
    assert client.get("/admin/api/users", headers=ADMIN).status_code == 404


def test_admin_api_requires_the_token(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "admin_token", ADMIN_TOKEN)
    assert client.get("/admin").status_code == 200
    assert client.get("/admin/api/users").status_code == 401
    wrong = {"Authorization": "Bearer nope"}
    assert client.get("/admin/api/users", headers=wrong).status_code == 401
    assert client.get("/admin/api/users", headers=ADMIN).status_code == 200


def test_admin_grants_and_returns_complimentary_access(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "admin_token", ADMIN_TOKEN)
    user_id, headers = sign_in(client)
    assert status_of(client, headers) == "none"

    assert set_access(client, user_id, "cloud").json()["effective_status"] == "active"
    assert client.get("/account", headers=headers).json()["subscription"]["can_upload"] is True
    listed = client.get("/admin/api/users", headers=ADMIN, params={"q": user_id}).json()
    assert [(u["id"], u["access"], u["effective_status"]) for u in listed["users"]] == [
        (user_id, "cloud", "active")
    ]

    # 되돌리면 결제 상태(무료 회원)를 따른다. 결제한 구독은 그대로 남는다.
    assert set_access(client, user_id, "default").json()["effective_status"] == "none"
    webhook(client, user_id, "INITIAL_PURCHASE")
    assert status_of(client, headers) == "active"


def test_complimentary_access_survives_an_expired_store_subscription(client, db, monkeypatch):
    monkeypatch.setattr(get_settings(), "admin_token", ADMIN_TOKEN)
    user_id, headers = sign_in(client)
    assert status_of(client, headers) == "none"
    set_access(client, user_id, "cloud")
    assert status_of(client, headers) == "active"

    moment_id = str(uuid4())
    client.post(
        "/sync/push",
        headers=headers,
        json={"moments": [moment(moment_id, "2026-10-01T00:00:00Z")]},
    )
    upload_id = upload(client, headers, moment_id, "display", b"photo")
    assert client.post(f"/uploads/{upload_id}/complete", headers=headers).status_code == 204

    # 스토어 구독이 끝나도 관리자가 정한 무상 제공이 이어지고, 사진을 지우지 않는다.
    webhook(client, user_id, "INITIAL_PURCHASE")
    expired_at = datetime.now(UTC)
    webhook(client, user_id, "EXPIRATION", expiration_at_ms=int(expired_at.timestamp() * 1000))
    assert status_of(client, headers) == "active"
    sent: list[str] = []
    for days in (0, 24, 29.5, 31):
        jobs.run(
            db,
            now=expired_at + timedelta(days=days),
            notify=lambda _db, target, title, _body, **_k: target == user_id and sent.append(title),
        )
    db.expire_all()
    assert sent == []
    assert db.get(Entitlement, user_id).status == "grace"
    assert len(prefix_keys(user_id)) == 1


def test_unknown_access_and_user_are_rejected(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "admin_token", ADMIN_TOKEN)
    user_id, _ = sign_in(client)
    assert set_access(client, user_id, "free").status_code == 422
    assert set_access(client, "missing-user", "cloud").status_code == 404
