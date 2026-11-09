"""사진·동영상 업로드·다운로드 (docs/PLAN.md §3.1). 파일은 서버를 거치지 않고 R2와 직접 오간다."""

import base64
import json
from datetime import UTC, datetime, timedelta
from typing import Literal
from uuid import uuid4

from botocore.exceptions import ClientError
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select, update

from app.api.deps import CurrentUser, DbSession, require_read, require_write
from app.cloud import lock_active_user
from app.config import get_settings
from app.models.cloud import (
    CloudObject,
    Moment,
    SharedAlbum,
    SharedAlbumItem,
    StorageCleanup,
    Usage,
    User,
)
from app.shared import (
    album_usage,
    capacity,
    lock_album_row,
    objects_changed,
    personal_free,
    shared_needs,
    wanted_variants,
)
from app.storage import (
    UPLOAD_SETTLE_AFTER,
    UPLOAD_URL_TTL,
    object_key,
    r2_client,
)

router = APIRouter(tags=["uploads"])

DOWNLOAD_URL_TTL = timedelta(minutes=10)
# 동영상은 재생하면서 구간마다 다시 요청하므로, 긴 영상을 보는 동안 URL이 끝나지 않게 한다.
VIDEO_DOWNLOAD_URL_TTL = timedelta(hours=3)
# R2는 한 번의 PUT으로 5GiB까지 받는다. 여유를 두고 4GiB까지만 받는다.
MAX_UPLOAD_BYTES = 4 * 1024 * 1024 * 1024

# display: 목록에 그리는 이미지 (동영상은 대표 장면) / original: 원본 파일
# compact: 효율 보관 동영상 (720p로 줄인 mp4)
Variant = Literal["display", "original", "compact"]

EXTENSIONS = {
    "image/jpeg": "jpg",
    "image/heic": "heic",
    "image/heif": "heif",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/x-adobe-dng": "dng",
    "image/tiff": "tiff",
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "video/x-m4v": "m4v",
    "video/3gpp": "3gp",
    "video/webm": "webm",
    "video/x-matroska": "mkv",
}


def validate_upload_kind(moment: Moment, variant: Variant, content_type: str) -> None:
    """변형별 MIME 형식을 고정해 목록/재생 경로가 깨지는 것을 막는다.

    presigned URL은 사용자가 지정한 Content-Type까지 서명한다. 따라서 여기서 제한하지
    않으면 display 자리에 동영상이, compact 자리에 이미지가 저장될 수 있고 다른 기기는
    이를 썸네일 또는 재생 파일로 해석하지 못한다.
    """
    if content_type not in EXTENSIONS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "unsupported file type")
    # 스키마 추가 전의 기록은 사진으로 해석한다. 손상된 과거 JSON도 업로드 경로를
    # 막지 않도록 같은 안전한 기본값을 쓴다.
    try:
        media_type = json.loads(moment.data).get("data", {}).get("media_type", "photo")
    except (TypeError, json.JSONDecodeError):
        media_type = "photo"
    if variant == "display":
        valid = content_type == "image/jpeg"
    elif variant == "compact":
        # compact는 동영상의 효율 보관본이다. 사진에 이를 허용하면 사용되지 않는
        # 객체가 저장되고, 다른 기기의 업로드 상태도 실제 보관 상태와 어긋난다.
        valid = media_type == "video" and content_type == "video/mp4"
    else:
        prefix = "video/" if media_type == "video" else "image/"
        valid = content_type.startswith(prefix)
    if not valid:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "file type does not match variant"
        )


class CreateUploadRequest(BaseModel):
    moment_id: str = Field(max_length=36)
    variant: Variant
    size: int = Field(gt=0, le=MAX_UPLOAD_BYTES)
    content_type: str = Field(pattern=r"^(image|video)/[a-zA-Z0-9.+-]+$")
    # 파일의 MD5(hex). 기기는 파일을 메모리에 올리지 않고 네이티브로 계산할 수 있다.
    # presigned URL에 Content-MD5로 서명해서, 내용이 다르면 저장소가 업로드를 거절한다.
    md5: str = Field(pattern=r"^[a-fA-F0-9]{32}$")


class UploadResponse(BaseModel):
    id: str
    upload_url: str
    # PUT에 그대로 붙여야 하는 헤더 (서명에 포함돼 있다)
    headers: dict[str, str]
    expires_at: datetime


class PhotoRef(BaseModel):
    moment_id: str = Field(max_length=36)
    variant: Variant


class DeletePhotosRequest(BaseModel):
    photos: list[PhotoRef] = Field(max_length=500)


class DownloadResponse(BaseModel):
    download_url: str
    content_type: str
    # 기기에 저장할 파일 확장자 (original.{ext})
    extension: str
    size: int
    expires_at: datetime


@router.post("/uploads", response_model=UploadResponse)
def create_upload(payload: CreateUploadRequest, user: CurrentUser, db: DbSession) -> UploadResponse:
    # 용량 확인과 사용량 변경이 같은 사용자의 다른 요청과 겹치지 않게 한다.
    lock_active_user(db, user.id)
    moment = db.get(Moment, (user.id, payload.moment_id))
    if moment is None or moment.deleted_at is not None:
        # 기기는 기록을 먼저 push한 뒤 사진을 올린다.
        raise HTTPException(status.HTTP_404_NOT_FOUND, "moment not found")
    usage = db.get(Usage, user.id)
    assert usage is not None
    current = db.scalar(
        select(CloudObject).where(
            CloudObject.user_id == user.id,
            CloudObject.moment_id == payload.moment_id,
            CloudObject.variant == payload.variant,
        )
    )
    if current is not None and current.status == "stored":
        # 기록의 사진은 바뀌지 않는다. 다른 기기가 이미 올렸으면 그 사진을 그대로 쓴다.
        raise HTTPException(status.HTTP_409_CONFLICT, "photo is already stored")
    _check_space(db, user, payload.moment_id, payload.variant, payload.size)

    content_type = payload.content_type.lower()
    validate_upload_kind(moment, payload.variant, content_type)
    ext = EXTENSIONS.get(content_type, "bin")
    key = object_key(user.id, payload.moment_id, payload.variant, uuid4().hex, ext)
    if current is None:
        current = CloudObject(
            id=str(uuid4()), user_id=user.id, moment_id=payload.moment_id, variant=payload.variant
        )
        db.add(current)
    else:
        # 앞선 업로드의 URL이 아직 살아 있어 지금 지워도 다시 생길 수 있다. 끝난 뒤에 지운다.
        db.merge(
            StorageCleanup(
                prefix=current.r2_key, not_before=datetime.now(UTC) + UPLOAD_SETTLE_AFTER
            )
        )
    current.r2_key, current.size_bytes, current.md5 = key, payload.size, payload.md5.lower()
    current.content_type, current.status = content_type, "pending"
    current.created_at = datetime.now(UTC)
    db.commit()

    content_md5 = base64.b64encode(bytes.fromhex(current.md5)).decode()
    url = r2_client().generate_presigned_url(
        "put_object",
        Params={
            "Bucket": get_settings().r2_bucket,
            "Key": key,
            "ContentType": content_type,
            "ContentMD5": content_md5,
        },
        ExpiresIn=int(UPLOAD_URL_TTL.total_seconds()),
        HttpMethod="PUT",
    )
    return UploadResponse(
        id=current.id,
        upload_url=url,
        headers={"Content-Type": content_type, "Content-MD5": content_md5},
        expires_at=datetime.now(UTC) + UPLOAD_URL_TTL,
    )


def _shared_albums_using(db: DbSession, user_id: str, moment_id: str, variant: str) -> list[str]:
    """새 파일이 완료된 뒤 해당 변형을 쓸 앨범.

    ``shared_needs``는 이미 *stored* 상태인 파일만 보고 계산한다. 따라서 효율 보관 동영상의
    첫 compact 업로드는 아직 stored가 아니어도 compact가 필요하지만, 그것만으로 계산하면
    원본만 필요한 것으로 나온다. 업로드하려는 변형을 미리 가진 것으로 보고 판정한다.
    """
    stored = set(
        db.scalars(
            select(CloudObject.variant).where(
                CloudObject.user_id == user_id,
                CloudObject.moment_id == moment_id,
                CloudObject.status == "stored",
            )
        )
    )
    stored.add(variant)
    return sorted(
        album_id
        for album_id, media_type, quality in db.execute(
            select(
                SharedAlbumItem.album_id,
                SharedAlbumItem.media_type,
                SharedAlbum.photo_quality,
            )
            .join(SharedAlbum, SharedAlbum.id == SharedAlbumItem.album_id)
            .where(
                SharedAlbumItem.author_id == user_id,
                SharedAlbumItem.moment_id == moment_id,
            )
        )
        if variant in wanted_variants(quality, media_type, stored)
    )


def _check_space(db: DbSession, user: User, moment_id: str, variant: str, size: int) -> None:
    """공유 앨범이 쓰는 파일은 그 앨범의 용량(구성원 할당의 합)에서 센다. 앨범 공간이 있으면
    구독하지 않은 구성원도 올린다. 나머지는 개인 용량(요금제 용량 − 공유 앨범 할당)에서 센다.
    용량 초과: 새 업로드만 막고 기존 백업은 그대로 둔다.
    """
    albums = _shared_albums_using(db, user.id, moment_id, variant)
    if not albums:
        require_write(db, user)
        if personal_free(db, user.id) < size:
            raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "Cloud storage limit reached")
        return
    for album_id in albums:
        album = lock_album_row(db, album_id)
        if album is not None and album_usage(album) + size > capacity(db, album):
            raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "shared album storage is full")


@router.post("/uploads/{upload_id}/complete", status_code=status.HTTP_204_NO_CONTENT)
def complete_upload(upload_id: str, user: CurrentUser, db: DbSession) -> None:
    # 잠근 뒤에 읽어야 같은 완료 요청이 두 번 와도 사용량을 한 번만 더한다.
    locked = lock_active_user(db, user.id)
    obj = db.get(CloudObject, upload_id)
    if obj is None or obj.user_id != user.id or obj.status == "deleting":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "upload not found")
    if obj.status == "stored":
        return  # 응답을 못 받은 기기가 다시 부른 경우
    if not _shared_albums_using(db, user.id, obj.moment_id, obj.variant):
        require_write(db, user)
    try:
        head = r2_client().head_object(Bucket=get_settings().r2_bucket, Key=obj.r2_key)
    except ClientError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, "uploaded object was not found") from exc
    # R2는 presigned PUT에 크기 제한을 걸 수 없어서 올라온 뒤에 확인한다. 내용은 Content-MD5로
    # 저장소가 이미 확인했고, 한 번에 올린 객체의 ETag는 MD5라서 한 번 더 맞춰 본다.
    etag = str(head.get("ETag", "")).strip('"').lower()
    md5_mismatch = len(etag) == 32 and etag != obj.md5
    if head["ContentLength"] != obj.size_bytes or md5_mismatch:
        # URL이 아직 살아 있어 지금 지워도 다시 올라올 수 있다.
        # 사용량에 잡히지 않는 객체가 남지 않게 URL이 끝난 뒤 지운다.
        db.merge(
            StorageCleanup(prefix=obj.r2_key, not_before=datetime.now(UTC) + UPLOAD_SETTLE_AFTER)
        )
        db.delete(obj)
        db.commit()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "uploaded file does not match")
    usage = db.get(Usage, user.id)
    assert usage is not None
    usage.bytes_total += obj.size_bytes
    usage.object_count += 1
    obj.status = "stored"
    # 다른 기기가 이 사진이 올라온 것을 다음 pull에서 알도록 기록의 변경 번호를 올린다.
    moment = db.get(Moment, (user.id, obj.moment_id))
    if moment is not None:
        locked.sync_seq += 1
        moment.seq = locked.sync_seq
    # 이 파일을 쓰는 공유 앨범의 사용량을 고친다.
    objects_changed(db, user.id, [obj.moment_id])
    db.commit()


@router.get("/moments/{moment_id}/photo", response_model=DownloadResponse)
def download_photo(
    moment_id: str, variant: Variant, user: CurrentUser, db: DbSession
) -> DownloadResponse:
    require_read(db, user)
    obj = db.scalar(
        select(CloudObject).where(
            CloudObject.user_id == user.id,
            CloudObject.moment_id == moment_id,
            CloudObject.variant == variant,
            CloudObject.status == "stored",
        )
    )
    if obj is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "photo not found")
    ttl = VIDEO_DOWNLOAD_URL_TTL if obj.content_type.startswith("video/") else DOWNLOAD_URL_TTL
    url = r2_client().generate_presigned_url(
        "get_object",
        Params={"Bucket": get_settings().r2_bucket, "Key": obj.r2_key},
        ExpiresIn=int(ttl.total_seconds()),
    )
    return DownloadResponse(
        download_url=url,
        content_type=obj.content_type,
        extension=EXTENSIONS.get(obj.content_type, "bin"),
        size=obj.size_bytes,
        expires_at=datetime.now(UTC) + ttl,
    )


@router.post("/photos/delete", status_code=status.HTTP_204_NO_CONTENT)
def delete_photos(payload: DeletePhotosRequest, user: CurrentUser, db: DbSession) -> None:
    """기록은 남기고 파일만 지운다 (안전 앨범에서 빼거나, 앨범을 효율 보관으로 바꿨을 때).

    지우는 것은 구독 상태와 관계없이 허용한다. 사용량은 바로 돌려주고, R2는 정리 작업이 지운다.
    없는 사진은 건너뛴다 (다른 기기가 먼저 지웠거나 응답을 못 받고 다시 보낸 경우).
    """
    locked = lock_active_user(db, user.id)
    wanted = {(photo.moment_id, photo.variant) for photo in payload.photos}
    if not wanted:
        return
    moment_ids = sorted({moment_id for moment_id, _ in wanted})
    found = db.scalars(
        select(CloudObject).where(
            CloudObject.user_id == user.id,
            CloudObject.moment_id.in_(moment_ids),
            CloudObject.status.in_(("stored", "pending")),
        )
    ).all()
    # 공유 앨범이 쓰는 파일은 남긴다. 다른 기기가 담은 것을 이 기기가 아직 모를 수 있다.
    shared = shared_needs(db, user.id, moment_ids)
    objects = [
        obj
        for obj in found
        if (obj.moment_id, obj.variant) in wanted
        and not any(obj.variant in v for v in shared.get(obj.moment_id, {}).values())
    ]
    usage = db.get(Usage, user.id)
    for obj in objects:
        if obj.status == "stored" and usage is not None:
            usage.bytes_total -= obj.size_bytes
            usage.object_count -= 1
    db.execute(
        update(CloudObject)
        .where(CloudObject.id.in_([obj.id for obj in objects]))
        .values(status="deleting")
    )
    # 다른 기기가 다음 pull에서 '올라감' 표시를 버리도록 기록의 변경 번호를 올린다.
    # 남긴 파일도 올려서, 지웠다고 여긴 기기가 pull에서 '올라감' 표시를 되찾는다.
    for moment_id in sorted(
        {obj.moment_id for obj in found if (obj.moment_id, obj.variant) in wanted}
    ):
        moment = db.get(Moment, (user.id, moment_id))
        if moment is not None:
            locked.sync_seq += 1
            moment.seq = locked.sync_seq
    objects_changed(db, user.id, [obj.moment_id for obj in objects])
    db.commit()
