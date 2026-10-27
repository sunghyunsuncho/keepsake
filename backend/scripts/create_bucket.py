"""로컬 S3 호환 스토리지에 개발용 버킷을 만든다. 이미 있으면 아무것도 하지 않는다.

사용법: uv run python -m scripts.create_bucket
"""

import time

import boto3
from botocore.exceptions import ClientError
from botocore.exceptions import ConnectionError as BotoConnectionError

from app.config import get_settings

ATTEMPTS = 30


def main() -> None:
    settings = get_settings()
    s3 = boto3.client(
        "s3",
        endpoint_url=settings.r2_endpoint_url,
        aws_access_key_id=settings.r2_access_key_id,
        aws_secret_access_key=settings.r2_secret_access_key,
        region_name="auto",
    )

    # 컨테이너가 막 뜬 직후에는 연결 거부나 5xx가 올 수 있어 잠시 재시도한다.
    for _ in range(ATTEMPTS):
        try:
            s3.head_bucket(Bucket=settings.r2_bucket)
            print(f"bucket exists: {settings.r2_bucket}")
            return
        except BotoConnectionError:
            pass
        except ClientError as exc:
            code = exc.response["Error"]["Code"]
            if code in ("404", "NoSuchBucket"):
                s3.create_bucket(Bucket=settings.r2_bucket)
                print(f"bucket created: {settings.r2_bucket}")
                return
            if not code.startswith("5"):
                raise
        time.sleep(1)

    raise SystemExit("S3 storage did not become reachable")


if __name__ == "__main__":
    main()
