# Cloud 통합 테스트의 fixture(로컬 Postgres·S3)를 다른 테스트 파일에서도 쓴다.
from tests.test_cloud import client, db, engine  # noqa: F401
