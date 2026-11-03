from collections.abc import Collection
from datetime import datetime, timedelta
from functools import lru_cache

import boto3
from botocore.client import Config

from app.config import get_settings

UPLOAD_URL_TTL = timedelta(minutes=10)
# 서명은 PUT을 시작할 때만 확인해서 큰 파일은 URL이 끝난 뒤에 도착할 수 있다. 그만큼 기다려 지운다.
UPLOAD_SETTLE_AFTER = UPLOAD_URL_TTL + timedelta(hours=1)


@lru_cache
def r2_client():
    settings = get_settings()
    return boto3.client(
        "s3",
        endpoint_url=settings.r2_endpoint_url,
        aws_access_key_id=settings.r2_access_key_id,
        aws_secret_access_key=settings.r2_secret_access_key,
        region_name="auto",
        # 사용자 잠금을 쥔 채 부르는 곳이 있어, R2가 멈춰도 오래 기다리지 않는다.
        config=Config(
            signature_version="s3v4",
            connect_timeout=5,
            read_timeout=30,
            retries={"max_attempts": 2},
        ),
    )


# 객체 키: u/{user_id}/m/{moment_id}/{variant}-{token}.{ext}
# 업로드마다 키가 달라서, 늦게 도착한 옛 URL의 PUT이나 정리 작업이 저장된 사진에 닿지 않는다.
def user_prefix(user_id: str) -> str:
    return f"u/{user_id}/"


def object_key(user_id: str, moment_id: str, variant: str, token: str, ext: str) -> str:
    return f"{user_prefix(user_id)}m/{moment_id}/{variant}-{token}.{ext}"


def delete_object(key: str) -> None:
    r2_client().delete_object(Bucket=get_settings().r2_bucket, Key=key)


def delete_prefix(
    prefix: str, older_than: datetime | None = None, keep: Collection[str] = ()
) -> None:
    """prefix 아래 객체를 지운다. DB에 없는 객체(완료 전 실패한 업로드)도 함께 지운다.

    older_than·keep: 재구독한 계정의 새 사진은 남긴다. 그 시각 이후 객체와 keep에 있는 객체를 둔다.
    """
    client = r2_client()
    bucket = get_settings().r2_bucket
    for page in client.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=prefix):
        keys = [
            {"Key": item["Key"]}
            for item in page.get("Contents", [])
            if item["Key"] not in keep and (older_than is None or item["LastModified"] < older_than)
        ]
        if keys:
            result = client.delete_objects(Bucket=bucket, Delete={"Objects": keys, "Quiet": True})
            # 일부만 실패해도 HTTP 200이 온다. 예외를 내야 호출한 쪽이 기록을 남기고 다시 시도한다.
            if result.get("Errors"):
                raise RuntimeError(f"failed to delete {len(result['Errors'])} objects")
