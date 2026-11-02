"""사진 업로드·다운로드 (docs/PLAN.md §3.1). 사진 바이트는 서버를 거치지 않고 R2와 직접 오간다."""

import base64
from datetime import UTC, datetime, timedelta
from typing import Literal
from uuid import uuid4

from botocore.exceptions import ClientError
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.api.deps import CurrentUser, DbSession, require_read, require_write
from app.cloud import lock_user
from app.config import get_settings
from app.models.cloud import CloudObject, Moment, Usage
from app.storage import UPLOAD_URL_TTL, delete_object, object_key, r2_client

router = APIRouter(tags=["uploads"])

DOWNLOAD_URL_TTL = timedelta(minutes=10)

Variant = Literal["display", "original"]

EXTENSIONS = {
    "image/jpeg": "jpg",
    "image/heic": "heic",
    "image/heif": "heif",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/x-adobe-dng": "dng",
    "image/tiff": "tiff",
}


class CreateUploadRequest(BaseModel):
    moment_id: str = Field(max_length=36)
    variant: Variant
    size: int = Field(gt=0, le=1024 * 1024 * 1024)
    content_type: str = Field(pattern=r"^image/[a-zA-Z0-9.+-]+$")
    # 파일의 MD5(hex). 기기는 파일을 메모리에 올리지 않고 네이티브로 계산할 수 있다.
    # presigned URL에 Content-MD5로 서명해서, 내용이 다르면 저장소가 업로드를 거절한다.
    md5: str = Field(pattern=r"^[a-fA-F0-9]{32}$")


class UploadResponse(BaseModel):
    id: str
    upload_url: str
    # PUT에 그대로 붙여야 하는 헤더 (서명에 포함돼 있다)
    headers: dict[str, str]
    expires_at: datetime


class DownloadResponse(BaseModel):
    download_url: str
    content_type: str
    # 기기에 저장할 파일 확장자 (original.{ext})
    extension: str
    size: int
    expires_at: datetime


@router.post("/uploads", response_model=UploadResponse)
def create_upload(payload: CreateUploadRequest, user: CurrentUser, db: DbSession) -> UploadResponse:
    require_write(db, user)
    # 용량 확인과 사용량 변경이 같은 사용자의 다른 요청과 겹치지 않게 한다.
    if lock_user(db, user.id).deleted_at is not None:
        # 잠금을 기다리는 사이 계정 삭제가 시작됐다.
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "account unavailable")
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
        # 기록의 사진은 바뀌지 않는다. 다른 기기가 다시 올리려 해도 덮어쓰지 않아야, 그 업로드가
        # 끝나지 못했을 때 정리 작업이 같은 키의 백업을 지우지 않는다.
        raise HTTPException(status.HTTP_409_CONFLICT, "photo is already stored")
    if usage.bytes_total + payload.size > get_settings().cloud_max_bytes:
        # 용량 초과: 새 업로드만 막고 기존 백업은 그대로 둔다.
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "Cloud storage limit reached")

    content_type = payload.content_type.lower()
    ext = EXTENSIONS.get(content_type, "bin")
    key = object_key(user.id, payload.moment_id, payload.variant, ext)
    if current is None:
        current = CloudObject(
            id=str(uuid4()), user_id=user.id, moment_id=payload.moment_id, variant=payload.variant
        )
        db.add(current)
    elif current.r2_key != key:
        delete_object(current.r2_key)
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


@router.post("/uploads/{upload_id}/complete", status_code=status.HTTP_204_NO_CONTENT)
def complete_upload(upload_id: str, user: CurrentUser, db: DbSession) -> None:
    # 잠근 뒤에 읽어야 같은 완료 요청이 두 번 와도 사용량을 한 번만 더한다.
    locked = lock_user(db, user.id)
    obj = db.get(CloudObject, upload_id)
    if obj is None or obj.user_id != user.id or obj.status == "deleting":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "upload not found")
    if obj.status == "stored":
        return  # 응답을 못 받은 기기가 다시 부른 경우
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
        delete_object(obj.r2_key)
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
    url = r2_client().generate_presigned_url(
        "get_object",
        Params={"Bucket": get_settings().r2_bucket, "Key": obj.r2_key},
        ExpiresIn=int(DOWNLOAD_URL_TTL.total_seconds()),
    )
    return DownloadResponse(
        download_url=url,
        content_type=obj.content_type,
        extension=EXTENSIONS.get(obj.content_type, "bin"),
        size=obj.size_bytes,
        expires_at=datetime.now(UTC) + DOWNLOAD_URL_TTL,
    )
