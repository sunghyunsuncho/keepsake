"""Keepsake 법률 문서의 공개 원본 API.

공개 홈페이지(atelierlabs)는 이 응답을 같은 도메인 URL로 프록시한다. 따라서 문서 내용의
단일 원본은 이 백엔드이며, 수정·배포 후 홈페이지를 따로 배포할 필요가 없다.
"""

import secrets
from pathlib import Path

from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.responses import FileResponse

from app.config import get_settings


async def require_public_web_client(x_public_web_token: str | None = Header(None)) -> None:
    """홈페이지 프록시만 문서를 가져가도록 공유 토큰을 확인한다. 비워 두면(로컬) 열어 둔다."""
    expected = get_settings().public_web_api_token.strip()
    if expected and (
        not x_public_web_token or not secrets.compare_digest(x_public_web_token, expected)
    ):
        raise HTTPException(status_code=401, detail="Invalid public web token")


router = APIRouter(
    prefix="/public-web/legal",
    tags=["public-web"],
    dependencies=[Depends(require_public_web_client)],
)

_LEGAL_DIR = Path(__file__).resolve().parents[1] / "legal"
_DOCUMENTS = {"terms-of-service", "privacy-policy"}
_LANGUAGES = {"ko", "en"}


@router.get("/{language}/{document}", include_in_schema=False)
async def legal_document(language: str, document: str) -> FileResponse:
    """홈페이지가 표시할 최신 이용약관 또는 개인정보 처리방침 HTML을 돌려준다."""
    if language not in _LANGUAGES or document not in _DOCUMENTS:
        raise HTTPException(status_code=404, detail="Legal document not found")
    path = _LEGAL_DIR / language / f"{document}.html"
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Legal document not found")
    return FileResponse(
        path, media_type="text/html; charset=utf-8", headers={"Cache-Control": "no-store"}
    )
