from datetime import UTC, datetime, timedelta
from functools import lru_cache
from typing import Literal

import jwt
from fastapi import APIRouter, HTTPException, status
from jwt import PyJWKClient
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.api.deps import DbSession
from app.config import get_settings
from app.models.cloud import AuthIdentity, Entitlement, Usage, User

router = APIRouter(prefix="/auth", tags=["auth"])

PROVIDERS = {
    "apple": ("https://appleid.apple.com/auth/keys", ("https://appleid.apple.com",)),
    "google": (
        "https://www.googleapis.com/oauth2/v3/certs",
        ("https://accounts.google.com", "accounts.google.com"),
    ),
}


class SignInRequest(BaseModel):
    provider: Literal["apple", "google"]
    identity_token: str = Field(max_length=8192)
    # Apple은 처음 승인할 때만 이메일을 알려준다. 이후 로그인에서는 비어 있다.
    email: str | None = Field(default=None, max_length=320)


class SessionResponse(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    user_id: str


@lru_cache
def _jwks(url: str) -> PyJWKClient:
    # 키 목록을 요청마다 받지 않도록 클라이언트(내부 캐시 포함)를 재사용한다.
    return PyJWKClient(url)


def _audiences(provider: str) -> list[str]:
    settings = get_settings()
    raw = settings.apple_client_id if provider == "apple" else settings.google_client_id
    return [value.strip() for value in (raw or "").split(",") if value.strip()]


def verify_identity_token(provider: str, token: str) -> dict[str, object]:
    audiences = _audiences(provider)
    if not audiences:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, f"{provider} sign-in is off")
    jwks_url, issuers = PROVIDERS[provider]
    try:
        key = _jwks(jwks_url).get_signing_key_from_jwt(token).key
        claims = jwt.decode(token, key, algorithms=["RS256"], audience=audiences)
    except jwt.PyJWTError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "identity token is invalid") from exc
    if claims.get("iss") not in issuers or not isinstance(claims.get("sub"), str):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "identity token is invalid")
    return claims


def issue_access_token(user_id: str) -> str:
    settings = get_settings()
    return jwt.encode(
        {
            "sub": user_id,
            "iss": settings.jwt_issuer,
            "exp": datetime.now(UTC) + timedelta(minutes=settings.jwt_ttl_minutes),
        },
        settings.jwt_secret,
        algorithm="HS256",
    )


@router.post("/sign-in", response_model=SessionResponse)
def sign_in(payload: SignInRequest, db: DbSession) -> SessionResponse:
    claims = verify_identity_token(payload.provider, payload.identity_token)
    subject = str(claims["sub"])
    user = _find_user(db, payload.provider, subject)
    if user is None:
        claim_email = claims.get("email")
        user = User(email=payload.email or (claim_email if isinstance(claim_email, str) else None))
        db.add(user)
        db.flush()
        db.add(AuthIdentity(user_id=user.id, provider=payload.provider, subject=subject))
        db.add(Entitlement(user_id=user.id))
        db.add(Usage(user_id=user.id))
        try:
            db.commit()
        except IntegrityError:
            # 같은 계정의 첫 로그인이 동시에 두 번 왔다. 먼저 만들어진 계정을 쓴다.
            db.rollback()
            user = _find_user(db, payload.provider, subject)
            if user is None:
                raise
    return SessionResponse(access_token=issue_access_token(user.id), user_id=user.id)


def _find_user(db: DbSession, provider: str, subject: str) -> User | None:
    identity = db.scalar(
        select(AuthIdentity).where(
            AuthIdentity.provider == provider, AuthIdentity.subject == subject
        )
    )
    user = db.get(User, identity.user_id) if identity is not None else None
    if user is not None and user.deleted_at is not None:
        # 삭제 중인 계정(R2 정리 대기). 같은 Apple/Google 계정으로 새로 시작할 수 없게 잠시 막는다.
        raise HTTPException(status.HTTP_409_CONFLICT, "account deletion is in progress")
    return user
