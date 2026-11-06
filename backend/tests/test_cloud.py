"""Cloud 흐름 통합 테스트. 로컬 Postgres와 S3 호환 스토리지(`make up`)가 필요하고, 없으면 건너뛴다.

docs/PLAN.md Phase 2 완료 기준을 서버 쪽에서 확인한다:
구독 → 백업 → 다른 기기 복원 → 해지(읽기 전용) → 재구독 즉시 복구, 해지 → 30일 경과 → 삭제.
"""

import hashlib
import json
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import httpx
import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session, sessionmaker

from app import jobs
from app.api import auth, sync
from app.cloud import delete_revenuecat_customer, lock_user, refresh_from_revenuecat
from app.config import get_settings
from app.db import get_db
from app.main import app
from app.models import Base
from app.models.cloud import CloudObject, Entitlement, StorageCleanup, User
from app.storage import UPLOAD_SETTLE_AFTER, delete_prefix, r2_client, user_prefix

WEBHOOK_SECRET = "test-webhook-secret"


def _test_database_url() -> str:
    url = make_url(get_settings().database_url)
    admin = create_engine(url, isolation_level="AUTOCOMMIT", connect_args={"connect_timeout": 2})
    with admin.connect() as conn:
        exists = conn.scalar(text("SELECT 1 FROM pg_database WHERE datname = 'keepsake_test'"))
        if not exists:
            conn.execute(text("CREATE DATABASE keepsake_test"))
    admin.dispose()
    return url.set(database="keepsake_test").render_as_string(hide_password=False)


@pytest.fixture(scope="module")
def engine():
    try:
        engine = create_engine(_test_database_url())
        r2_client().head_bucket(Bucket=get_settings().r2_bucket)
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"local Postgres/S3 not available (make up): {exc}")
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    yield engine
    engine.dispose()


@pytest.fixture
def db(engine) -> Iterator[Session]:
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

    def override() -> Iterator[Session]:
        with factory() as session:
            yield session

    app.dependency_overrides[get_db] = override
    with factory() as session:
        yield session
    app.dependency_overrides.clear()


@pytest.fixture
def client(db, monkeypatch) -> Iterator[TestClient]:
    settings = get_settings()
    monkeypatch.setattr(settings, "revenuecat_webhook_secret", WEBHOOK_SECRET)
    monkeypatch.setattr(settings, "revenuecat_api_key", None)
    monkeypatch.setattr(settings, "cloud_billing_enabled", True)
    # Apple/Google 서명 검증 대신 토큰 문자열을 subject로 쓴다.
    monkeypatch.setattr(
        auth, "verify_identity_token", lambda provider, token: {"sub": token, "iss": provider}
    )
    with TestClient(app) as test_client:
        yield test_client


def sign_in(client: TestClient, subject: str | None = None) -> tuple[str, dict[str, str]]:
    response = client.post(
        "/auth/sign-in", json={"provider": "apple", "identity_token": subject or str(uuid4())}
    )
    assert response.status_code == 200
    body = response.json()
    return body["user_id"], {"Authorization": f"Bearer {body['access_token']}"}


def webhook(client: TestClient, user_id: str, event_type: str, **extra) -> None:
    now = datetime.now(UTC)
    event = {
        "id": str(uuid4()),
        "type": event_type,
        "app_user_id": user_id,
        "entitlement_ids": ["cloud"],
        "event_timestamp_ms": int(now.timestamp() * 1000),
        "expiration_at_ms": int((now + timedelta(days=30)).timestamp() * 1000),
        **extra,
    }
    response = client.post(
        "/billing/revenuecat",
        json={"event": event},
        headers={"Authorization": f"Bearer {WEBHOOK_SECRET}"},
    )
    assert response.status_code == 204


def moment(moment_id: str, updated_at: str, **data) -> dict:
    return {
        "id": moment_id,
        "updated_at": updated_at,
        "deleted_at": None,
        "data": {
            "id": moment_id,
            "memo": "",
            "local_display_path": f"photos/{moment_id}/display.jpg",
            "source_asset_id": "ABC/L0/001",
            "sync_state": "pending",
            **data,
        },
    }


def create_upload(
    client: TestClient, headers: dict, moment_id: str, variant: str, size: int, md5_of: bytes
) -> dict:
    created = client.post(
        "/uploads",
        headers=headers,
        json={
            "moment_id": moment_id,
            "variant": variant,
            "size": size,
            "content_type": "image/jpeg",
            "md5": hashlib.md5(md5_of).hexdigest(),
        },
    )
    assert created.status_code == 200, created.text
    return created.json()


def upload(client: TestClient, headers: dict, moment_id: str, variant: str, body: bytes) -> str:
    info = create_upload(client, headers, moment_id, variant, len(body), body)
    put = httpx.put(info["upload_url"], content=body, headers=info["headers"])
    assert put.status_code == 200, put.text
    return info["id"]


def prefix_keys(user_id: str) -> list[str]:
    listed = r2_client().list_objects_v2(
        Bucket=get_settings().r2_bucket, Prefix=user_prefix(user_id)
    )
    return [item["Key"] for item in listed.get("Contents", [])]


def status_of(client: TestClient, headers: dict) -> str:
    return client.get("/account", headers=headers).json()["subscription"]["status"]


def test_signed_in_users_back_up_records_but_need_subscription_for_photos(client):
    _, headers = sign_in(client)
    moment_id = str(uuid4())

    assert status_of(client, headers) == "none"
    assert client.get("/account", headers=headers).json()["has_records"] is False
    pushed = client.post(
        "/sync/push", headers=headers, json={"moments": [moment(moment_id, "2026-10-01T00:00:00Z")]}
    )
    assert pushed.status_code == 200
    assert [m["id"] for m in client.get("/sync/pull", headers=headers).json()["moments"]] == [
        moment_id
    ]
    # 무료 기록 백업 계정은 사진이 없어도 빈 계정이 아니다. 기기는 이 값으로 Local 기록의
    # 자동 선택 여부를 결정해 다른 계정의 기록을 섞지 않는다.
    account = client.get("/account", headers=headers).json()
    assert account["has_records"] is True
    assert account["usage"]["object_count"] == 0
    created = client.post(
        "/uploads",
        headers=headers,
        json={
            "moment_id": moment_id,
            "variant": "display",
            "size": 5,
            "content_type": "image/jpeg",
            "md5": hashlib.md5(b"photo").hexdigest(),
        },
    )
    assert created.status_code == 403
    assert client.get("/account").status_code == 401


def test_account_with_only_sync_records_is_not_empty(client):
    """빈 앨범도 사용자가 만든 기록이라 Local 기록을 자동 선택하면 안 된다."""
    _, headers = sign_in(client)
    assert (
        client.post(
            "/sync/push",
            headers=headers,
            json={
                "records": [
                    {
                        "kind": "albums",
                        "id": "album-1",
                        "updated_at": "2026-10-01T00:00:00Z",
                        "data": {"id": "album-1", "kind": "custom", "title": "빈 앨범"},
                    }
                ]
            },
        ).status_code
        == 200
    )
    assert client.get("/account", headers=headers).json()["has_records"] is True


def test_billing_off_lets_signed_in_users_back_up(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "cloud_billing_enabled", False)
    _, headers = sign_in(client)

    assert status_of(client, headers) == "active"
    assert client.post("/sync/push", headers=headers, json={"moments": []}).status_code == 200

    # 결제를 켜면 저장된 상태(none) 그대로 원래 규칙을 따른다. 기록 백업은 계속된다.
    monkeypatch.setattr(get_settings(), "cloud_billing_enabled", True)
    assert status_of(client, headers) == "none"
    assert client.post("/sync/push", headers=headers, json={"moments": []}).status_code == 200


def test_same_device_can_back_up_to_two_accounts(client):
    # 한 기기에서 계정을 바꿔 로그인하면 같은 moment id를 두 계정이 올린다.
    moment_id = str(uuid4())
    for _ in range(2):
        user_id, headers = sign_in(client)
        webhook(client, user_id, "INITIAL_PURCHASE")
        pushed = client.post(
            "/sync/push",
            headers=headers,
            json={"moments": [moment(moment_id, "2026-10-01T00:00:00Z", memo=user_id)]},
        )
        assert pushed.json()["stale_moment_ids"] == []
        upload(client, headers, moment_id, "display", b"photo")

        pulled = client.get("/sync/pull", headers=headers).json()
        assert [m["data"]["memo"] for m in pulled["moments"]] == [user_id]


def test_push_ignores_repeated_rows_in_one_request(client):
    user_id, headers = sign_in(client)
    webhook(client, user_id, "INITIAL_PURCHASE")
    moment_id = str(uuid4())
    record = {"kind": "review_sessions", "id": "2026-10-01", "updated_at": "2026-10-01T00:00:00Z"}
    response = client.post(
        "/sync/push",
        headers=headers,
        json={
            "moments": [moment(moment_id, "2026-10-01T00:00:00Z")] * 2,
            "records": [record, record],
        },
    )
    assert response.status_code == 200, response.text
    pulled = client.get("/sync/pull", headers=headers).json()
    assert len(pulled["moments"]) == 1 and len(pulled["records"]) == 1


def test_backup_and_restore_on_another_device(client):
    user_id, headers = sign_in(client, "apple-backup")
    webhook(client, user_id, "INITIAL_PURCHASE")
    assert status_of(client, headers) == "active"

    # 기기 A: 기록과 리뷰 기록을 올리고 사진을 올린다.
    moment_id = str(uuid4())
    pushed = client.post(
        "/sync/push",
        headers=headers,
        json={
            "moments": [moment(moment_id, "2026-10-01T00:00:00Z", memo="첫 기록")],
            "records": [
                {
                    "kind": "review_sessions",
                    "id": "r1",
                    "updated_at": "2026-10-01T00:00:00Z",
                    "data": {"date": "2026-10-01", "selected_count": 1},
                }
            ],
        },
    )
    assert pushed.status_code == 200
    photo = b"\xff\xd8 fake jpeg bytes"
    upload_id = upload(client, headers, moment_id, "display", photo)
    assert client.post(f"/uploads/{upload_id}/complete", headers=headers).status_code == 204
    # 응답을 못 받은 기기가 다시 완료를 불러도 사용량이 두 번 더해지지 않는다.
    assert client.post(f"/uploads/{upload_id}/complete", headers=headers).status_code == 204
    usage = client.get("/account", headers=headers).json()["usage"]
    assert usage["bytes_total"] == len(photo)
    assert usage["object_count"] == 1

    # 기기 B: 같은 계정으로 로그인해서 처음부터 받는다.
    _, headers_b = sign_in(client, "apple-backup")
    pulled = client.get("/sync/pull", headers=headers_b).json()
    assert [m["id"] for m in pulled["moments"]] == [moment_id]
    restored = pulled["moments"][0]
    assert restored["data"]["memo"] == "첫 기록"
    assert restored["stored_variants"] == ["display"]
    # 기기마다 다른 값은 서버에 남기지 않는다.
    assert "local_display_path" not in restored["data"]
    assert "source_asset_id" not in restored["data"]
    assert "sync_state" not in restored["data"]
    assert pulled["records"][0]["kind"] == "review_sessions"
    assert pulled["has_more"] is False

    download = client.get(
        f"/moments/{moment_id}/photo", params={"variant": "display"}, headers=headers_b
    ).json()
    assert download["extension"] == "jpg"
    assert httpx.get(download["download_url"]).content == photo

    # 커서 이후에는 새 변경만 온다.
    again = client.get("/sync/pull", params={"cursor": pulled["cursor"]}, headers=headers_b)
    assert again.json()["moments"] == []


def test_last_write_wins_and_stale_rows_are_reported(client):
    user_id, headers = sign_in(client)
    webhook(client, user_id, "INITIAL_PURCHASE")
    moment_id = str(uuid4())
    newer = moment(moment_id, "2026-10-02T00:00:00Z", memo="새 메모")
    older = moment(moment_id, "2026-10-01T00:00:00Z", memo="옛 메모")

    client.post("/sync/push", headers=headers, json={"moments": [newer]})
    response = client.post("/sync/push", headers=headers, json={"moments": [older]})

    assert response.json()["stale_moment_ids"] == [moment_id]
    pulled = client.get("/sync/pull", headers=headers).json()
    assert pulled["moments"][0]["data"]["memo"] == "새 메모"


def test_pull_pages_through_changes(client, monkeypatch):
    monkeypatch.setattr(sync, "PULL_LIMIT", 2)
    user_id, headers = sign_in(client)
    webhook(client, user_id, "INITIAL_PURCHASE")
    ids = [str(uuid4()) for _ in range(5)]
    client.post(
        "/sync/push",
        headers=headers,
        json={"moments": [moment(i, "2026-10-01T00:00:00Z") for i in ids]},
    )

    received, cursor, has_more = [], 0, True
    while has_more:
        page = client.get("/sync/pull", params={"cursor": cursor}, headers=headers).json()
        received += [m["id"] for m in page["moments"]]
        cursor, has_more = page["cursor"], page["has_more"]

    assert received == ids


def test_device_links_stay_with_their_device_and_account(client):
    _, one = sign_in(client)
    _, two = sign_in(client)
    device_a, device_b = "a" * 64, "b" * 64
    for headers in (one, two):
        webhook_user = client.get("/account", headers=headers).json()["user_id"]
        webhook(client, webhook_user, "INITIAL_PURCHASE")
    moment_id = str(uuid4())
    client.post(
        "/sync/push",
        headers=one,
        json={"moments": [moment(moment_id, "2026-10-01T00:00:00+00:00")]},
    ).raise_for_status()

    links = [
        {"moment_id": moment_id, "asset_id": "asset-1"},
        {"moment_id": str(uuid4()), "asset_id": "unknown-moment"},
    ]
    client.put(
        "/sync/device-links", headers=one, json={"device_id": device_a, "links": links}
    ).raise_for_status()

    def links_of(headers: dict, device_id: str) -> list[dict]:
        response = client.get(
            "/sync/device-links", headers=headers, params={"device_id": device_id}
        )
        response.raise_for_status()
        return response.json()["links"]

    assert links_of(one, device_a) == [{"moment_id": moment_id, "asset_id": "asset-1"}]
    assert links_of(one, device_b) == []
    assert links_of(two, device_a) == []

    # 기록을 지우면 연결도 지운다.
    client.post(
        "/sync/push",
        headers=one,
        json={
            "moments": [
                {
                    **moment(moment_id, "2026-10-02T00:00:00+00:00"),
                    "deleted_at": "2026-10-02T00:00:00+00:00",
                }
            ]
        },
    ).raise_for_status()
    assert links_of(one, device_a) == []


def test_upload_rejects_size_mismatch(client, db):
    user_id, headers = sign_in(client)
    webhook(client, user_id, "INITIAL_PURCHASE")
    moment_id = str(uuid4())
    client.post(
        "/sync/push", headers=headers, json={"moments": [moment(moment_id, "2026-10-01T00:00:00Z")]}
    )
    created = create_upload(client, headers, moment_id, "original", 100, b"short")
    httpx.put(created["upload_url"], content=b"short", headers=created["headers"])

    response = client.post(f"/uploads/{created['id']}/complete", headers=headers)

    assert response.status_code == 400
    key = prefix_keys(user_id)[0]
    db.expire_all()
    assert db.get(StorageCleanup, key) is not None  # URL이 끝난 뒤 지운다
    jobs.sweep_storage_cleanups(db, datetime.now(UTC) + UPLOAD_SETTLE_AFTER + timedelta(seconds=1))
    assert prefix_keys(user_id) == []


def test_upload_rejects_different_content(client):
    # 서버에 알린 MD5와 다른 내용은 저장소가(Content-MD5) 또는 완료 확인이(ETag) 거절한다.
    user_id, headers = sign_in(client)
    webhook(client, user_id, "INITIAL_PURCHASE")
    moment_id = str(uuid4())
    client.post(
        "/sync/push", headers=headers, json={"moments": [moment(moment_id, "2026-10-01T00:00:00Z")]}
    )
    created = create_upload(client, headers, moment_id, "display", 5, b"photo")
    put = httpx.put(created["upload_url"], content=b"other", headers=created["headers"])

    response = client.post(f"/uploads/{created['id']}/complete", headers=headers)

    assert put.status_code >= 400 or response.status_code == 400
    assert response.status_code != 204
    photo = client.get(f"/moments/{moment_id}/photo?variant=display", headers=headers)
    assert photo.status_code == 404


def test_deleting_a_moment_releases_its_photos(client, db):
    user_id, headers = sign_in(client)
    webhook(client, user_id, "INITIAL_PURCHASE")
    moment_id = str(uuid4())
    client.post(
        "/sync/push", headers=headers, json={"moments": [moment(moment_id, "2026-10-01T00:00:00Z")]}
    )
    upload_id = upload(client, headers, moment_id, "display", b"photo")
    client.post(f"/uploads/{upload_id}/complete", headers=headers)

    deleted = moment(moment_id, "2026-10-02T00:00:00Z")
    deleted["deleted_at"] = "2026-10-02T00:00:00Z"
    client.post("/sync/push", headers=headers, json={"moments": [deleted]})

    assert client.get("/account", headers=headers).json()["usage"]["bytes_total"] == 0
    jobs.clean_objects(db, datetime.now(UTC))
    jobs.sweep_storage_cleanups(db, datetime.now(UTC))
    assert prefix_keys(user_id) != []  # 업로드 URL이 끝날 때까지 기다린다
    later = datetime.now(UTC) + UPLOAD_SETTLE_AFTER + timedelta(seconds=1)
    jobs.clean_objects(db, later)
    jobs.sweep_storage_cleanups(db, later)
    assert prefix_keys(user_id) == []


def test_deleting_photos_keeps_the_record(client, db):
    user_id, headers = sign_in(client)
    webhook(client, user_id, "INITIAL_PURCHASE")
    moment_id = str(uuid4())
    client.post(
        "/sync/push", headers=headers, json={"moments": [moment(moment_id, "2026-10-01T00:00:00Z")]}
    )
    for variant, body in (("display", b"small"), ("original", b"original")):
        upload_id = upload(client, headers, moment_id, variant, body)
        client.post(f"/uploads/{upload_id}/complete", headers=headers)
    cursor = client.get("/sync/pull", headers=headers).json()["cursor"]

    deleted = client.post(
        "/photos/delete",
        headers=headers,
        json={"photos": [{"moment_id": moment_id, "variant": "original"}]},
    )

    assert deleted.status_code == 204
    usage = client.get("/account", headers=headers).json()["usage"]
    assert usage["object_count"] == 1 and usage["bytes_total"] == len(b"small")
    # 다른 기기가 원본이 지워진 것을 받는다.
    changed = client.get("/sync/pull", params={"cursor": cursor}, headers=headers).json()
    assert [(m["id"], m["stored_variants"]) for m in changed["moments"]] == [
        (moment_id, ["display"])
    ]
    original = client.get(
        f"/moments/{moment_id}/photo", params={"variant": "original"}, headers=headers
    )
    assert original.status_code == 404
    # 다시 보내도 문제없고, 다시 올릴 수 있다.
    again = client.post(
        "/photos/delete",
        headers=headers,
        json={"photos": [{"moment_id": moment_id, "variant": "original"}]},
    )
    assert again.status_code == 204
    upload_id = upload(client, headers, moment_id, "original", b"original")
    assert client.post(f"/uploads/{upload_id}/complete", headers=headers).status_code == 204
    later = datetime.now(UTC) + UPLOAD_SETTLE_AFTER + timedelta(seconds=1)
    jobs.clean_objects(db, later)
    jobs.sweep_storage_cleanups(db, later)
    assert len(prefix_keys(user_id)) == 2


def test_store_billing_retry_and_cancellation_keep_access(client):
    user_id, headers = sign_in(client)
    webhook(client, user_id, "INITIAL_PURCHASE")

    webhook(client, user_id, "CANCELLATION")
    webhook(client, user_id, "BILLING_ISSUE")

    assert status_of(client, headers) == "active"


def test_out_of_order_events_do_not_override_newer_state(client):
    user_id, headers = sign_in(client)
    webhook(client, user_id, "INITIAL_PURCHASE")
    webhook(client, user_id, "EXPIRATION")
    an_hour_ago = int((datetime.now(UTC) - timedelta(hours=1)).timestamp() * 1000)

    webhook(client, user_id, "RENEWAL", event_timestamp_ms=an_hour_ago)

    assert status_of(client, headers) == "grace"


def test_expiry_is_read_only_and_resubscribe_restores_immediately(client):
    user_id, headers = sign_in(client)
    webhook(client, user_id, "INITIAL_PURCHASE")
    moment_id = str(uuid4())
    client.post(
        "/sync/push", headers=headers, json={"moments": [moment(moment_id, "2026-10-01T00:00:00Z")]}
    )
    upload_id = upload(client, headers, moment_id, "original", b"original")
    client.post(f"/uploads/{upload_id}/complete", headers=headers)

    webhook(
        client, user_id, "EXPIRATION", expiration_at_ms=int(datetime.now(UTC).timestamp() * 1000)
    )

    account = client.get("/account", headers=headers).json()["subscription"]
    assert account["status"] == "grace"
    assert account["can_upload"] is False and account["can_download"] is True
    # 기록 백업은 로그인 기능이라 계속된다. 새 사진은 올릴 수 없다.
    assert client.post("/sync/push", headers=headers, json={"moments": []}).status_code == 200
    blocked = client.post(
        "/uploads",
        headers=headers,
        json={
            "moment_id": moment_id,
            "variant": "display",
            "size": 5,
            "content_type": "image/jpeg",
            "md5": hashlib.md5(b"photo").hexdigest(),
        },
    )
    assert blocked.status_code == 403
    assert client.get("/sync/pull", headers=headers).status_code == 200
    photo = client.get(
        f"/moments/{moment_id}/photo", params={"variant": "original"}, headers=headers
    )
    assert photo.status_code == 200

    webhook(client, user_id, "INITIAL_PURCHASE")

    assert status_of(client, headers) == "active"
    assert client.get("/account", headers=headers).json()["usage"]["object_count"] == 1
    assert len(prefix_keys(user_id)) == 1


def test_grace_notifications_then_deletion_after_30_days(client, db):
    user_id, headers = sign_in(client)
    webhook(client, user_id, "INITIAL_PURCHASE")
    moment_id = str(uuid4())
    client.post(
        "/sync/push", headers=headers, json={"moments": [moment(moment_id, "2026-10-01T00:00:00Z")]}
    )
    upload_id = upload(client, headers, moment_id, "display", b"photo")
    client.post(f"/uploads/{upload_id}/complete", headers=headers)
    expired_at = datetime.now(UTC)
    webhook(client, user_id, "EXPIRATION", expiration_at_ms=int(expired_at.timestamp() * 1000))

    sent: list[str] = []

    def notify(_db, target, title, _body):
        if target == user_id:
            sent.append(title)

    for days in (0, 1, 23.5, 24, 29.5):
        jobs.run(db, now=expired_at + timedelta(days=days), notify=notify)
    assert len(sent) == 3  # 만료 즉시, 7일 전, 1일 전
    assert status_of(client, headers) == "grace"

    jobs.run(db, now=expired_at + timedelta(days=30, minutes=1), notify=notify)

    db.expire_all()
    assert db.get(Entitlement, user_id).status == "expired"
    assert prefix_keys(user_id) == []
    account = client.get("/account", headers=headers).json()
    assert account["usage"]["object_count"] == 0
    # 사진만 지운다. 기록 백업은 로그인 기능이라 남고, 기기는 '올라감' 표시를 버린다.
    assert account["data_generation"] == 0
    pulled = client.get("/sync/pull", headers=headers).json()["moments"]
    assert [(m["id"], m["stored_variants"]) for m in pulled] == [(moment_id, [])]

    webhook(client, user_id, "INITIAL_PURCHASE")
    assert (
        client.get(
            f"/moments/{moment_id}/photo", params={"variant": "display"}, headers=headers
        ).status_code
        == 404
    )


def test_account_deletion_removes_server_and_r2_data(client, db):
    user_id, headers = sign_in(client, "apple-delete")
    webhook(client, user_id, "INITIAL_PURCHASE")
    moment_id = str(uuid4())
    client.post(
        "/sync/push", headers=headers, json={"moments": [moment(moment_id, "2026-10-01T00:00:00Z")]}
    )
    upload(client, headers, moment_id, "display", b"photo")  # 완료 전 객체도 지워져야 한다

    assert client.delete("/account", headers=headers).status_code == 204

    db.expire_all()
    assert db.get(User, user_id) is None
    assert prefix_keys(user_id) == []
    assert client.get("/account", headers=headers).status_code == 401
    # 같은 Apple 계정으로 다시 로그인하면 새 계정이 된다.
    new_user_id, _ = sign_in(client, "apple-delete")
    assert new_user_id != user_id


def test_webhook_rejects_wrong_secret(client):
    response = client.post(
        "/billing/revenuecat",
        content=json.dumps({"event": {"id": "x", "type": "TEST", "app_user_id": "u"}}),
        headers={"Authorization": "Bearer wrong"},
    )
    assert response.status_code == 401


def test_upload_does_not_replace_stored_photo(client, db):
    user_id, headers = sign_in(client)
    webhook(client, user_id, "INITIAL_PURCHASE")
    moment_id = str(uuid4())
    client.post(
        "/sync/push", headers=headers, json={"moments": [moment(moment_id, "2026-10-01T00:00:00Z")]}
    )
    upload_id = upload(client, headers, moment_id, "display", b"photo")
    client.post(f"/uploads/{upload_id}/complete", headers=headers)

    response = client.post(
        "/uploads",
        headers=headers,
        json={
            "moment_id": moment_id,
            "variant": "display",
            "size": 5,
            "content_type": "image/jpeg",
            "md5": hashlib.md5(b"photo").hexdigest(),
        },
    )

    assert response.status_code == 409
    jobs.clean_objects(db, datetime.now(UTC) + timedelta(hours=1))
    assert len(prefix_keys(user_id)) == 1
    assert (
        client.get(
            f"/moments/{moment_id}/photo", headers=headers, params={"variant": "display"}
        ).status_code
        == 200
    )


def test_late_expiration_still_gets_full_grace(client, db):
    user_id, _headers = sign_in(client)
    webhook(client, user_id, "INITIAL_PURCHASE")
    expired_at = datetime.now(UTC) - timedelta(days=40)
    webhook(client, user_id, "EXPIRATION", expiration_at_ms=int(expired_at.timestamp() * 1000))

    db.expire_all()
    grace_until = db.get(Entitlement, user_id).grace_until
    assert grace_until > datetime.now(UTC) + timedelta(days=29)


def test_account_deletion_sweeps_late_uploads(client, db):
    user_id, headers = sign_in(client)

    assert client.delete("/account", headers=headers).status_code == 204

    db.expire_all()
    assert db.get(User, user_id) is None
    r2_client().put_object(
        Bucket=get_settings().r2_bucket, Key=f"{user_prefix(user_id)}m/late/display.jpg", Body=b"x"
    )
    jobs.sweep_storage_cleanups(db, datetime.now(UTC))
    assert prefix_keys(user_id) != []
    jobs.sweep_storage_cleanups(db, datetime.now(UTC) + UPLOAD_SETTLE_AFTER + timedelta(seconds=1))
    assert prefix_keys(user_id) == []
    assert db.get(StorageCleanup, user_prefix(user_id)) is None


def test_account_deletion_is_retried_when_storage_fails(client, db, monkeypatch):
    user_id, headers = sign_in(client)
    with monkeypatch.context() as broken:
        broken.setattr(
            "app.cloud.delete_prefix", lambda _prefix: (_ for _ in ()).throw(RuntimeError("R2"))
        )
        assert client.delete("/account", headers=headers).status_code == 204

    db.expire_all()
    assert db.get(User, user_id).deleted_at is not None
    assert client.get("/account", headers=headers).status_code == 401

    jobs.finish_account_deletions(db)

    db.expire_all()
    assert db.get(User, user_id) is None


def test_account_deletion_reports_failure_when_mark_fails(client, monkeypatch):
    _user_id, headers = sign_in(client)
    monkeypatch.setattr(
        "app.api.account.mark_account_deleted",
        lambda _db, _user: (_ for _ in ()).throw(RuntimeError("DB")),
    )

    with pytest.raises(RuntimeError):
        client.delete("/account", headers=headers)


def test_lock_user_returns_values_committed_by_other_requests(client, db, engine):
    user_id, _headers = sign_in(client)
    user = db.get(User, user_id)
    seq = user.sync_seq
    db.rollback()
    with Session(engine) as other:
        other.get(User, user_id).sync_seq = seq + 5
        other.commit()

    assert lock_user(db, user_id).sync_seq == seq + 5
    db.rollback()


def test_upload_stops_when_account_deletion_started_after_auth(client, engine, monkeypatch):
    user_id, headers = sign_in(client)
    webhook(client, user_id, "INITIAL_PURCHASE")
    moment_id = str(uuid4())
    client.post(
        "/sync/push", headers=headers, json={"moments": [moment(moment_id, "2026-10-01T00:00:00Z")]}
    )
    real_lock = lock_user

    def lock_after_deletion(session, target):
        with Session(engine) as other:
            other.get(User, target).deleted_at = datetime.now(UTC)
            other.commit()
        return real_lock(session, target)

    monkeypatch.setattr("app.cloud.lock_user", lock_after_deletion)
    response = client.post(
        "/uploads",
        headers=headers,
        json={
            "moment_id": moment_id,
            "variant": "display",
            "size": 5,
            "content_type": "image/jpeg",
            "md5": hashlib.md5(b"photo").hexdigest(),
        },
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "account unavailable"


@pytest.mark.parametrize(
    ("status_code", "raises"), [(200, False), (404, False), (403, False), (429, True), (500, True)]
)
def test_revenuecat_customer_deletion(monkeypatch, status_code, raises):
    monkeypatch.setattr(get_settings(), "revenuecat_api_key", "sk_test")
    request = httpx.Request("DELETE", "https://api.revenuecat.com/v1/subscribers/u")
    monkeypatch.setattr(
        httpx, "delete", lambda *_a, **_k: httpx.Response(status_code, request=request)
    )

    if raises:
        with pytest.raises(httpx.HTTPStatusError):
            delete_revenuecat_customer("u")
    else:
        delete_revenuecat_customer("u")


def expired_user_with_photo(client):
    user_id, headers = sign_in(client)
    webhook(client, user_id, "INITIAL_PURCHASE")
    moment_id = str(uuid4())
    client.post(
        "/sync/push", headers=headers, json={"moments": [moment(moment_id, "2026-10-01T00:00:00Z")]}
    )
    client.post(
        f"/uploads/{upload(client, headers, moment_id, 'display', b'photo')}/complete",
        headers=headers,
    )
    expired_at = datetime.now(UTC)
    webhook(client, user_id, "EXPIRATION", expiration_at_ms=int(expired_at.timestamp() * 1000))
    return user_id, expired_at


def give_final_notice(db, user_id, at):
    entitlement = db.get(Entitlement, user_id)
    entitlement.notified_stage = "d1"
    entitlement.notified_at = at
    db.commit()


def test_failed_subscription_lookup_does_not_purge(client, db, monkeypatch):
    user_id, expired_at = expired_user_with_photo(client)
    monkeypatch.setattr(get_settings(), "revenuecat_api_key", "sk_test")
    monkeypatch.setattr(jobs, "refresh_from_revenuecat", lambda _db, _entitlement: False)
    give_final_notice(db, user_id, expired_at)

    jobs.expire_grace(db, expired_at + timedelta(days=31))

    db.expire_all()
    assert db.get(Entitlement, user_id).status == "grace"
    assert prefix_keys(user_id) != []


def test_resubscribe_during_lookup_is_not_purged(client, db, engine, monkeypatch):
    user_id, expired_at = expired_user_with_photo(client)

    def resubscribed_meanwhile(_db, _entitlement):
        with Session(engine) as other:
            other.get(Entitlement, user_id).status = "active"
            other.commit()
        return True

    monkeypatch.setattr(jobs, "refresh_from_revenuecat", resubscribed_meanwhile)
    give_final_notice(db, user_id, expired_at)

    jobs.expire_grace(db, expired_at + timedelta(days=31))

    db.expire_all()
    assert db.get(Entitlement, user_id).status == "active"
    assert prefix_keys(user_id) != []


def test_lapsed_subscription_recheck_moves_to_grace_after_margin(client, db, monkeypatch):
    user_id, _headers = sign_in(client)
    webhook(client, user_id, "INITIAL_PURCHASE")
    entitlement = db.get(Entitlement, user_id)
    now = datetime.now(UTC)
    entitlement.expires_at = now - timedelta(hours=1)
    db.commit()
    monkeypatch.setattr(get_settings(), "revenuecat_api_key", "sk_test")
    request = httpx.Request("GET", "https://api.revenuecat.com/v1/subscribers/u")
    monkeypatch.setattr(
        httpx,
        "get",
        lambda *_a, **_k: httpx.Response(
            200, request=request, json={"subscriber": {"entitlements": {}}}
        ),
    )

    jobs.recheck_lapsed_subscriptions(db, now)
    db.expire_all()
    assert db.get(Entitlement, user_id).status == "active"  # 갱신이 늦을 수 있어 기다린다

    jobs.recheck_lapsed_subscriptions(db, now + timedelta(days=2))
    db.expire_all()
    entitlement = db.get(Entitlement, user_id)
    assert entitlement.status == "grace"
    assert entitlement.grace_until > now + timedelta(days=29)


def test_lapsed_recheck_stops_when_revenuecat_is_down(client, db, monkeypatch):
    now = datetime.now(UTC)
    for _ in range(jobs.MAX_LOOKUP_FAILURES + 2):
        user_id, _headers = sign_in(client)
        webhook(client, user_id, "INITIAL_PURCHASE")
        db.get(Entitlement, user_id).expires_at = now - timedelta(days=30)
    db.commit()
    monkeypatch.setattr(get_settings(), "revenuecat_api_key", "sk_test")
    calls: list[str] = []

    def down(_db, entitlement):
        calls.append(entitlement.user_id)
        return False

    monkeypatch.setattr(jobs, "refresh_from_revenuecat", down)

    jobs.recheck_lapsed_subscriptions(db, now)

    assert len(calls) == jobs.MAX_LOOKUP_FAILURES


def test_sweep_continues_after_a_failed_prefix(db, monkeypatch):
    due = datetime.now(UTC) - timedelta(minutes=1)
    db.add(StorageCleanup(prefix="u/broken/", not_before=due))
    db.add(StorageCleanup(prefix="u/fine/", not_before=due))
    db.commit()

    def fake_delete(prefix):
        if prefix == "u/broken/":
            raise RuntimeError("R2")

    monkeypatch.setattr(jobs, "delete_prefix", fake_delete)

    jobs.sweep_storage_cleanups(db, datetime.now(UTC))

    db.expire_all()
    assert db.get(StorageCleanup, "u/broken/") is not None
    assert db.get(StorageCleanup, "u/fine/") is None


def test_retrying_pending_upload_uses_new_key_and_cleans_old_later(client, db):
    user_id, headers = sign_in(client)
    webhook(client, user_id, "INITIAL_PURCHASE")
    moment_id = str(uuid4())
    client.post(
        "/sync/push", headers=headers, json={"moments": [moment(moment_id, "2026-10-01T00:00:00Z")]}
    )
    body = {
        "moment_id": moment_id,
        "variant": "display",
        "size": 5,
        "content_type": "image/jpeg",
        "md5": hashlib.md5(b"photo").hexdigest(),
    }
    first = client.post("/uploads", headers=headers, json=body).json()
    old_key = db.get(CloudObject, first["id"]).r2_key
    db.rollback()

    client.post("/uploads", headers=headers, json=body)

    db.expire_all()
    assert db.get(CloudObject, first["id"]).r2_key != old_key
    assert db.get(StorageCleanup, old_key) is not None


def test_clean_objects_rechecks_after_locking(client, db, engine, monkeypatch):
    user_id, headers = sign_in(client)
    webhook(client, user_id, "INITIAL_PURCHASE")
    moment_id = str(uuid4())
    client.post(
        "/sync/push", headers=headers, json={"moments": [moment(moment_id, "2026-10-01T00:00:00Z")]}
    )
    upload_id = upload(client, headers, moment_id, "display", b"photo")
    real_lock = jobs.lock_user

    def completed_meanwhile(session, target):
        with Session(engine) as other:
            other.get(CloudObject, upload_id).status = "stored"
            other.commit()
        return real_lock(session, target)

    monkeypatch.setattr(jobs, "lock_user", completed_meanwhile)

    jobs.clean_objects(db, datetime.now(UTC) + UPLOAD_SETTLE_AFTER + timedelta(seconds=1))

    db.expire_all()
    assert db.get(CloudObject, upload_id) is not None
    assert prefix_keys(user_id) != []


def test_delete_prefix_reports_partial_failure(monkeypatch):
    class Client:
        def get_paginator(self, _name):
            return self

        def paginate(self, **_kwargs):
            return [{"Contents": [{"Key": "u/x/a"}]}]

        def delete_objects(self, **_kwargs):
            return {"Errors": [{"Key": "u/x/a"}]}

    monkeypatch.setattr("app.storage.r2_client", lambda: Client())

    with pytest.raises(RuntimeError):
        delete_prefix("u/x/")


def test_lookup_rejects_empty_entitlement(client, db, monkeypatch):
    user_id, _expired_at = expired_user_with_photo(client)
    monkeypatch.setattr(get_settings(), "revenuecat_api_key", "sk_test")
    request = httpx.Request("GET", "https://api.revenuecat.com/v1/subscribers/u")
    monkeypatch.setattr(
        httpx,
        "get",
        lambda *_a, **_k: httpx.Response(
            200, request=request, json={"subscriber": {"entitlements": {"cloud": {}}}}
        ),
    )

    assert refresh_from_revenuecat(db, db.get(Entitlement, user_id)) is False
    assert db.get(Entitlement, user_id).status == "grace"


def test_jobs_skip_accounts_being_deleted(client, db, monkeypatch):
    user_id, expired_at = expired_user_with_photo(client)
    db.get(User, user_id).deleted_at = datetime.now(UTC)
    db.commit()
    give_final_notice(db, user_id, expired_at)
    sent: list[str] = []

    jobs.notify_grace(db, expired_at, lambda _db, target, _title, _body: sent.append(target))
    jobs.expire_grace(db, expired_at + timedelta(days=31))

    assert user_id not in sent
    db.expire_all()
    assert db.get(Entitlement, user_id).status == "grace"
    assert prefix_keys(user_id) != []


def test_purge_waits_after_final_notice_when_jobs_were_stopped(client, db):
    user_id, expired_at = expired_user_with_photo(client)
    stopped_until = expired_at + timedelta(days=31)

    sent: list[str] = []

    def notify(_db, target, title, _body):
        if target == user_id:
            sent.append(title)

    jobs.run(db, now=stopped_until, notify=notify)

    assert sent == [jobs.GRACE_MESSAGES["d1"][0]]
    assert prefix_keys(user_id) != []  # 경고를 보낸 실행에서는 지우지 않는다

    jobs.run(db, now=stopped_until + jobs.FINAL_NOTICE_WAIT, notify=lambda *_a: None)

    assert prefix_keys(user_id) == []


def test_failed_push_is_sent_again_and_delays_purge(client, db):
    user_id, expired_at = expired_user_with_photo(client)

    def down(*_args):
        raise jobs.PushFailed("expo")

    jobs.notify_grace(db, expired_at + timedelta(days=29, hours=12), down)

    db.expire_all()
    assert db.get(Entitlement, user_id).notified_stage is None
    jobs.expire_grace(db, expired_at + timedelta(days=31))
    assert prefix_keys(user_id) != []

    purge_at = expired_at + timedelta(days=30, minutes=1) + jobs.MAX_PURGE_DELAY
    jobs.expire_grace(db, purge_at)
    jobs.sweep_storage_cleanups(db, purge_at)
    assert prefix_keys(user_id) == []


def test_expired_token_of_deleted_account_reports_account_gone(client, db):
    user_id, _headers = sign_in(client)
    settings = get_settings()
    now = datetime.now(UTC)
    token = jwt.encode(
        {
            "sub": user_id,
            "iss": settings.jwt_issuer,
            "iat": now - timedelta(days=60),
            "exp": now - timedelta(days=30),
        },
        settings.jwt_secret,
        algorithm="HS256",
    )
    headers = {"Authorization": f"Bearer {token}"}

    assert client.get("/account", headers=headers).json()["detail"] == "invalid access token"

    db.delete(db.get(User, user_id))
    db.commit()

    assert client.get("/account", headers=headers).json()["detail"] == "account unavailable"


@pytest.mark.parametrize(
    ("tickets", "fails"),
    [
        ([{"status": "ok"}], False),
        ([{"status": "error", "details": {"error": "InvalidCredentials"}}], True),
        ([{"status": "error", "details": {"error": "DeviceNotRegistered"}}], False),
        ([], True),
    ],
)
def test_send_push_reports_undelivered_tickets(client, db, monkeypatch, tickets, fails):
    user_id, headers = sign_in(client)
    client.put(
        "/account/devices",
        headers=headers,
        json={"expo_push_token": f"ExponentPushToken[{uuid4()}]", "platform": "ios"},
    )
    request = httpx.Request("POST", jobs.EXPO_PUSH_URL)
    monkeypatch.setattr(
        httpx,
        "post",
        lambda *_a, **_k: httpx.Response(200, request=request, json={"data": tickets}),
    )

    if fails:
        with pytest.raises(jobs.PushFailed):
            jobs.send_push(db, user_id, "title", "body")
    else:
        jobs.send_push(db, user_id, "title", "body")
    db.rollback()


def test_expired_token_with_other_issuer_is_unauthorized(client):
    user_id, _headers = sign_in(client)
    settings = get_settings()
    now = datetime.now(UTC)
    token = jwt.encode(
        {"sub": user_id, "iss": "other", "exp": now - timedelta(days=1)},
        settings.jwt_secret,
        algorithm="HS256",
    )

    response = client.get("/account", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 401


def test_final_notice_wait_applies_even_long_after_grace(client, db):
    user_id, expired_at = expired_user_with_photo(client)
    resumed = expired_at + timedelta(days=40)

    jobs.run(db, now=resumed, notify=lambda *_a: None)
    assert prefix_keys(user_id) != []

    jobs.run(db, now=resumed + jobs.FINAL_NOTICE_WAIT, notify=lambda *_a: None)
    assert prefix_keys(user_id) == []


def test_purge_commits_rows_before_touching_storage(client, db, monkeypatch):
    user_id, expired_at = expired_user_with_photo(client)
    give_final_notice(db, user_id, expired_at)
    purge_at = expired_at + timedelta(days=31)

    jobs.expire_grace(db, purge_at)

    db.expire_all()
    assert db.get(Entitlement, user_id).status == "expired"
    assert db.scalar(select(CloudObject).where(CloudObject.user_id == user_id)) is None
    assert prefix_keys(user_id) != []  # R2 장애가 나도 없는 사진이 저장된 것으로 남지 않는다

    with monkeypatch.context() as broken:
        broken.setattr(
            jobs, "delete_prefix", lambda *_a, **_k: (_ for _ in ()).throw(RuntimeError())
        )
        jobs.sweep_storage_cleanups(db, purge_at)
    assert db.get(StorageCleanup, user_prefix(user_id)) is not None

    jobs.sweep_storage_cleanups(db, purge_at)
    assert prefix_keys(user_id) == []


def test_purge_runs_in_one_job_with_real_clock_and_removes_orphans(client, db):
    user_id, expired_at = expired_user_with_photo(client)
    entitlement = db.get(Entitlement, user_id)
    entitlement.grace_until = datetime.now(UTC) - timedelta(minutes=1)
    entitlement.notified_stage = "d1"
    entitlement.notified_at = datetime.now(UTC) - timedelta(days=1)
    db.commit()
    r2_client().put_object(
        Bucket=get_settings().r2_bucket,
        Key=f"{user_prefix(user_id)}m/orphan/display.jpg",
        Body=b"x",
    )

    jobs.run(db, notify=lambda *_a: None)

    # 고른 실행의 시각보다 먼저 올라온 객체만 지우므로, 시계가 앞선 객체는 다음 실행에서 지워진다.
    jobs.sweep_storage_cleanups(db, datetime.now(UTC) + timedelta(minutes=5))
    assert db.get(StorageCleanup, user_prefix(user_id)) is None
    assert prefix_keys(user_id) == []


def test_sweep_keeps_photos_uploaded_after_resubscribe(client, db):
    user_id, expired_at = expired_user_with_photo(client)
    give_final_notice(db, user_id, expired_at)
    purge_at = datetime.now(UTC) + timedelta(days=31)
    db.get(Entitlement, user_id).grace_until = purge_at - timedelta(minutes=1)
    db.commit()
    jobs.expire_grace(db, purge_at)
    old_key_cutoff = datetime.now(UTC) - timedelta(days=1)
    db.get(StorageCleanup, user_prefix(user_id)).not_before = old_key_cutoff
    db.commit()
    before = set(prefix_keys(user_id))

    jobs.sweep_storage_cleanups(db, purge_at)

    # 정리 시점 이후에 올라온 것으로 보이는 객체는 남긴다.
    assert set(prefix_keys(user_id)) == before


def test_sweep_skips_cleanup_postponed_after_selection(db, engine, monkeypatch):
    prefix = "u/postponed/"
    db.add(StorageCleanup(prefix=prefix, not_before=datetime.now(UTC) - timedelta(minutes=1)))
    db.commit()
    real_get = db.get
    deleted: list[str] = []

    def postpone_then_get(model, key, **kwargs):
        if model is StorageCleanup:
            with Session(engine) as other:
                other.get(StorageCleanup, key).not_before = datetime.now(UTC) + timedelta(hours=1)
                other.commit()
        return real_get(model, key, **kwargs)

    monkeypatch.setattr(db, "get", postpone_then_get)
    monkeypatch.setattr(jobs, "delete_prefix", lambda p, **_k: deleted.append(p))

    jobs.sweep_storage_cleanups(db, datetime.now(UTC))

    monkeypatch.undo()
    db.expire_all()
    assert deleted == []
    assert db.get(StorageCleanup, prefix) is not None
