"""스토어 스크린샷용: 데모 공유 앨범에 가족 구성원을 참여시키고 그들이 담은 사진을 올린다.

사용법 (저장소 루트에서, API 서버가 떠 있을 때): make demo-family SOURCE=~/Desktop
목록: mobile/src/components/store-demo-photos.json의 sharedAlbums[].members

앱의 데모 구성(storeCapture=1&storeReset=1)이 만든 공유 앨범을 이름으로 찾는다. 구성원 계정은 'demo'
로그인 수단으로 만들고, 초대 코드 참여·기록 push·사진 담기·파일 업로드를 실제 API로 거쳐서 앱에서
다른 사람이 담은 사진처럼 보이게 한다. 다시 실행해도 같은 계정·기록을 쓰고, 올린 파일은 건너뛴다.

담은 사람이 구성원에게 쓴 글(sharedAlbums[].captions)과 구성원끼리 남긴 댓글(comments)도 넣는다.
API가 아니라 DB에 바로 넣는다: 댓글 시각을 '3시간 전'처럼 흩어 두고, 앨범 주인의 기기에 댓글 알림이
실제로 가지 않게 한다. 다시 실행하면 그 앨범의 댓글을 지우고 새로 넣는다. 글과 댓글만 다시 넣으려면
--text-only.
"""

import argparse
import hashlib
import io
import json
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
from PIL import Image, ImageOps
from sqlalchemy import delete, select

from app.api.auth import issue_access_token
from app.db import SessionLocal
from app.models.cloud import (
    AuthIdentity,
    Entitlement,
    SharedAlbum,
    SharedAlbumItem,
    SharedItemComment,
    Usage,
    User,
)

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "mobile/src/components/store-demo-photos.json"
PREFIX = "keepsake-demo-"
PROVIDER = "demo"
# 기록 id를 구성원·사진마다 고정해 다시 실행해도 같은 기록을 쓴다.
NAMESPACE = uuid.UUID("6b1f8a52-5f43-4c3e-9a57-0c8d6e2b7d11")
# 앱(mobile/src/lib/cloud/photos.ts)이 올리는 크기와 같다.
VARIANTS = {"display": (2048, 85), "thumb": (640, 75)}


def find_or_create_user(subject: str) -> str:
    with SessionLocal() as db:
        identity = db.scalar(
            select(AuthIdentity).where(
                AuthIdentity.provider == PROVIDER, AuthIdentity.subject == subject
            )
        )
        if identity is not None:
            return identity.user_id
        # auth.sign_in이 새 계정을 만들 때와 같은 행을 둔다.
        user = User(email=None)
        db.add(user)
        db.flush()
        db.add(AuthIdentity(user_id=user.id, provider=PROVIDER, subject=subject))
        db.add(Entitlement(user_id=user.id))
        db.add(Usage(user_id=user.id))
        db.commit()
        return user.id


def find_album(title: str) -> SharedAlbum:
    with SessionLocal() as db:
        album = db.scalar(
            select(SharedAlbum)
            .where(SharedAlbum.title == title, SharedAlbum.owner_id.is_not(None))
            .order_by(SharedAlbum.created_at.desc())
            .limit(1)
        )
    if album is None:
        raise SystemExit(f"'{title}' 공유 앨범이 없습니다. 앱에서 데모 구성을 먼저 실행하세요.")
    return album


def render(source: Path) -> dict[str, tuple[bytes, int, int]]:
    with Image.open(source) as image:
        image = ImageOps.exif_transpose(image).convert("RGB")
        out = {}
        for variant, (edge, quality) in VARIANTS.items():
            copy = image.copy()
            copy.thumbnail((edge, edge))
            buffer = io.BytesIO()
            copy.save(buffer, "JPEG", quality=quality)
            out[variant] = (buffer.getvalue(), *image.size)
        return out


def moment_row(moment_id: str, photo: dict, width: int, height: int) -> dict:
    taken = datetime.fromisoformat(photo["takenAt"])
    offset = taken.utcoffset()
    data = {
        "id": moment_id,
        "taken_at": taken.astimezone(UTC).isoformat().replace("+00:00", "Z"),
        "taken_tz_offset": int(offset.total_seconds() // 60) if offset else None,
        "media_type": "photo",
        "width": width,
        "height": height,
    }
    if "lat" in photo:
        data |= {"lat": photo["lat"], "lng": photo["lng"]}
    return {"id": moment_id, "updated_at": datetime.now(UTC).isoformat(), "data": data}


def upload(api: httpx.Client, moment_id: str, variant: str, body: bytes) -> None:
    md5 = hashlib.md5(body).hexdigest()
    response = api.post(
        "/uploads",
        json={
            "moment_id": moment_id,
            "variant": variant,
            "size": len(body),
            "content_type": "image/jpeg",
            "md5": md5,
        },
    )
    if response.status_code == 409:
        return  # 이전 실행에서 이미 올렸다
    response.raise_for_status()
    ticket = response.json()
    httpx.put(ticket["upload_url"], content=body, headers=ticket["headers"]).raise_for_status()
    api.post(f"/uploads/{ticket['id']}/complete").raise_for_status()


def subject_of(name: str) -> str:
    return f"store-demo-{name.lower()}"


def add_text(spec: dict, album: SharedAlbum, photos: dict[str, dict]) -> None:
    """목록의 글과 댓글을 넣는다. 사진은 담은 사람과 촬영 시각으로 찾는다 (앨범 주인의 기록 id는
    앱이 만든다)."""
    owner = spec["displayName"]
    people = {owner: album.owner_id} | {
        m["displayName"]: find_or_create_user(subject_of(m["displayName"]))
        for m in spec.get("members", [])
    }
    added_by = {key: owner for key in spec["photos"]} | {
        key: m["displayName"] for m in spec.get("members", []) for key in m["photos"]
    }
    now = datetime.now(UTC)
    with SessionLocal() as db:
        items = db.scalars(select(SharedAlbumItem).where(SharedAlbumItem.album_id == album.id))
        by_photo = {
            (item.author_id, datetime.fromisoformat(item.taken_at)): item
            for item in items
            if item.taken_at
        }

        def item_of(key: str) -> SharedAlbumItem:
            taken = datetime.fromisoformat(photos[key]["takenAt"])
            item = by_photo.get((people[added_by[key]], taken))
            if item is None:
                raise SystemExit(
                    f"'{spec['title']}'에 {key} 사진이 없습니다. 사진을 먼저 담으세요."
                )
            return item

        for item in by_photo.values():
            item.caption = None
        for key, caption in spec.get("captions", {}).items():
            item_of(key).caption = caption
        db.execute(delete(SharedItemComment).where(SharedItemComment.album_id == album.id))
        for comment in spec.get("comments", []):
            db.add(
                SharedItemComment(
                    album_id=album.id,
                    item_id=item_of(comment["photo"]).id,
                    author_id=people[comment["by"]],
                    body=comment["text"],
                    created_at=now - timedelta(minutes=comment["minutesAgo"]),
                )
            )
        db.commit()
    print(
        f"{spec['title']}: 글 {len(spec.get('captions', {}))}개, "
        f"댓글 {len(spec.get('comments', []))}개"
    )


def client(base_url: str, user_id: str) -> httpx.Client:
    token = issue_access_token(user_id)
    return httpx.Client(base_url=base_url, headers={"Authorization": f"Bearer {token}"}, timeout=60)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, help="목록의 'source' 경로가 시작하는 폴더")
    parser.add_argument("--api", default="http://localhost:18020")
    parser.add_argument(
        "--text-only", action="store_true", help="구성원·사진은 두고 글과 댓글만 다시 넣는다"
    )
    args = parser.parse_args()
    if args.source is None and not args.text_only:
        parser.error("--source가 필요합니다 (글과 댓글만 넣으려면 --text-only)")

    Image.MAX_IMAGE_PIXELS = None
    manifest = json.loads(MANIFEST.read_text())
    photos = {p["file"][len(PREFIX) : -len(".jpg")]: p for p in manifest["photos"]}
    for spec in manifest["sharedAlbums"]:
        members = spec.get("members", [])
        if not members:
            continue
        album = find_album(spec["title"])
        if args.text_only:
            add_text(spec, album, photos)
            continue
        with client(args.api, album.owner_id) as owner:
            code = owner.post(f"/shared-albums/{album.id}/invite").json()["code"]
            try:
                for member in members:
                    name = member["displayName"]
                    subject = subject_of(name)
                    with client(args.api, find_or_create_user(subject)) as api:
                        api.post(
                            "/shared-albums/join", json={"code": code, "display_name": name}
                        ).raise_for_status()
                        rows, files = [], {}
                        for key in member["photos"]:
                            moment_id = str(uuid.uuid5(NAMESPACE, f"{subject}:{key}"))
                            variants = render(args.source.expanduser() / photos[key]["source"])
                            _, width, height = variants["display"]
                            rows.append(moment_row(moment_id, photos[key], width, height))
                            files[moment_id] = variants
                        api.post("/sync/push", json={"moments": rows}).raise_for_status()
                        api.post(
                            f"/shared-albums/{album.id}/items", json={"moment_ids": list(files)}
                        ).raise_for_status()
                        for moment_id, variants in files.items():
                            for variant, (body, _, _) in variants.items():
                                upload(api, moment_id, variant, body)
                    print(f"{spec['title']}: {name} {len(files)}장")
            finally:
                # 데모용 초대 코드를 남겨 두지 않는다.
                owner.delete(f"/shared-albums/{album.id}/invite")
        if spec.get("captions") or spec.get("comments"):
            add_text(spec, album, photos)


if __name__ == "__main__":
    main()
