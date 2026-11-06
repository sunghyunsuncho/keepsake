import re
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import app

LEGAL_DIR = Path(__file__).resolve().parents[1] / "app" / "legal"


@pytest.fixture
def client() -> Iterator[TestClient]:
    with TestClient(app) as test_client:
        yield test_client


@pytest.mark.parametrize("language", ["ko", "en"])
@pytest.mark.parametrize("document", ["terms-of-service", "privacy-policy"])
def test_legal_document_is_served(client: TestClient, language: str, document: str):
    response = client.get(f"/public-web/legal/{language}/{document}")

    assert response.status_code == 200
    assert response.headers["content-type"] == "text/html; charset=utf-8"
    assert response.headers["cache-control"] == "no-store"
    assert f'<html lang="{language}">' in response.text


@pytest.mark.parametrize(
    "path",
    [
        "/public-web/legal/ja/privacy-policy",
        "/public-web/legal/ko/account-deletion",
        "/public-web/legal/terms-of-service",
    ],
)
def test_unknown_legal_document_is_not_found(client: TestClient, path: str):
    assert client.get(path).status_code == 404


def test_legal_documents_require_the_public_web_token(client: TestClient, monkeypatch):
    monkeypatch.setattr(get_settings(), "public_web_api_token", "web-token")

    missing = client.get("/public-web/legal/ko/privacy-policy")
    wrong = client.get(
        "/public-web/legal/ko/privacy-policy", headers={"X-Public-Web-Token": "other"}
    )
    right = client.get(
        "/public-web/legal/ko/privacy-policy", headers={"X-Public-Web-Token": "web-token"}
    )

    assert missing.status_code == wrong.status_code == 401
    assert right.status_code == 200


@pytest.mark.parametrize("document", ["terms-of-service", "privacy-policy"])
def test_korean_and_english_versions_match(document: str):
    """영어판은 직역이 아니어도 조항 수와 시행일은 한국어판과 같아야 한다."""
    ko = (LEGAL_DIR / "ko" / f"{document}.html").read_text(encoding="utf-8")
    en = (LEGAL_DIR / "en" / f"{document}.html").read_text(encoding="utf-8")

    assert ko.count("<h2>") == en.count("<h2>")
    assert "2026년 11월 6일" in ko
    assert "November 6, 2026" in en
    assert re.findall(r"<table>", ko) == re.findall(r"<table>", en)
