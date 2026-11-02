from datetime import timedelta
from functools import lru_cache

import boto3
from botocore.client import Config

from app.config import get_settings

UPLOAD_URL_TTL = timedelta(minutes=10)


@lru_cache
def r2_client():
    settings = get_settings()
    return boto3.client(
        "s3",
        endpoint_url=settings.r2_endpoint_url,
        aws_access_key_id=settings.r2_access_key_id,
        aws_secret_access_key=settings.r2_secret_access_key,
        region_name="auto",
        config=Config(signature_version="s3v4"),
    )


# 객체 키: u/{user_id}/m/{moment_id}/{variant}.{ext} (docs/PLAN.md §3.1)
def user_prefix(user_id: str) -> str:
    return f"u/{user_id}/"


def object_key(user_id: str, moment_id: str, variant: str, ext: str) -> str:
    return f"{user_prefix(user_id)}m/{moment_id}/{variant}.{ext}"


def delete_object(key: str) -> None:
    r2_client().delete_object(Bucket=get_settings().r2_bucket, Key=key)


def delete_prefix(prefix: str) -> None:
    """prefix 아래 객체를 모두 지운다. DB에 없는 객체(완료 전 실패한 업로드)도 함께 지운다."""
    client = r2_client()
    bucket = get_settings().r2_bucket
    for page in client.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=prefix):
        keys = [{"Key": item["Key"]} for item in page.get("Contents", [])]
        if keys:
            result = client.delete_objects(Bucket=bucket, Delete={"Objects": keys, "Quiet": True})
            # 일부만 실패해도 HTTP 200이 온다. 예외를 내야 호출한 쪽이 기록을 남기고 다시 시도한다.
            if result.get("Errors"):
                raise RuntimeError(f"failed to delete {len(result['Errors'])} objects")
