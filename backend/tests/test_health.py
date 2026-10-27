from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.db import get_db
from app.main import app


@pytest.fixture
def client() -> Iterator[TestClient]:
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def use_database(url: str) -> None:
    engine = create_engine(url)

    def override_get_db() -> Iterator[Session]:
        with Session(engine) as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db


def test_health(client: TestClient):
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_ready_when_database_is_reachable(client: TestClient):
    use_database("sqlite://")

    response = client.get("/health/ready")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_ready_when_database_is_unreachable(client: TestClient, tmp_path):
    # 존재하지 않는 디렉터리 안의 SQLite 파일은 연결 시 실패한다.
    use_database(f"sqlite:///{tmp_path}/missing/db.sqlite")

    response = client.get("/health/ready")

    assert response.status_code == 503
