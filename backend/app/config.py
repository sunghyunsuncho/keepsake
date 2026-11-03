from functools import lru_cache
from pathlib import Path
from typing import Self

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# 실행 위치(repo 루트, alembic, scripts)와 상관없이 backend/.env를 읽는다.
ENV_FILE = Path(__file__).resolve().parents[1] / ".env"

# 로컬 기본값을 그대로 쓰면 안 되는 설정. 운영 환경에서 빠뜨리면 시작 시 실패시킨다.
_REQUIRED_OUTSIDE_LOCAL = (
    "database_url",
    "r2_endpoint_url",
    "r2_access_key_id",
    "r2_secret_access_key",
    "r2_bucket",
    "apple_client_id",
    "google_client_id",
)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ENV_FILE, env_file_encoding="utf-8", extra="ignore")

    env: str = "local"
    database_url: str = "postgresql+psycopg://keepsake:keepsake@localhost:5433/keepsake"

    # Cloudflare R2 (로컬에서는 docker-compose의 RustFS). Phase 2에서 사용한다.
    r2_endpoint_url: str = "http://localhost:9010"
    r2_access_key_id: str = "keepsake"
    r2_secret_access_key: str = "keepsake-secret"
    r2_bucket: str = "keepsake-local"
    # API가 발급하는 짧은 수명의 Bearer 토큰. 운영에서는 반드시 무작위 값으로 교체한다.
    jwt_secret: str = "local-development-secret-change-me"
    jwt_issuer: str = "keepsake"
    jwt_ttl_minutes: int = 60 * 24 * 30
    # RevenueCat webhook 인증 헤더(Authorization: Bearer ...). 비어 있으면 webhook을 받지 않는다.
    revenuecat_webhook_secret: str | None = None
    # RevenueCat 비밀 API 키(sk_...). 있으면 webhook을 받을 때·삭제 직전에 구독 상태를 재조회한다.
    revenuecat_api_key: str | None = None
    revenuecat_entitlement_id: str = "cloud"
    # false면 결제 없이 로그인만 하면 Cloud를 쓴다 (스토어·RevenueCat 연결 전 개발용).
    # ENV=production에서는 반드시 true여야 한다.
    cloud_billing_enabled: bool = False
    cloud_max_bytes: int = 50 * 1024 * 1024 * 1024
    cloud_grace_days: int = 30
    # ID 토큰의 aud. Apple은 번들 ID, Google은 쉼표로 구분한 OAuth 클라이언트 ID(웹·iOS).
    apple_client_id: str | None = None
    google_client_id: str | None = None
    # Expo 푸시 서비스에서 '보안 푸시'를 켰을 때만 필요하다.
    expo_access_token: str | None = None
    # 없으면 Sentry로 보내지 않는다. 커밋 값은 Railway가 넣어 준다.
    sentry_dsn: str | None = None
    railway_git_commit_sha: str | None = None

    @field_validator("database_url")
    @classmethod
    def _use_psycopg_driver(cls, value: str) -> str:
        # Railway가 주는 postgresql:// 주소는 설치하지 않은 psycopg2를 찾는다.
        scheme, _, rest = value.partition("://")
        return f"postgresql+psycopg://{rest}" if scheme in ("postgres", "postgresql") else value

    @model_validator(mode="after")
    def _require_real_values_outside_local(self) -> Self:
        if self.env == "local":
            return self
        defaults = {name: field.default for name, field in type(self).model_fields.items()}
        missing = [
            n
            for n in _REQUIRED_OUTSIDE_LOCAL
            if not getattr(self, n) or getattr(self, n) == defaults[n]
        ]
        if self.jwt_secret == type(self).model_fields["jwt_secret"].default:
            missing.append("jwt_secret")
        if self.env == "production" and not self.cloud_billing_enabled:
            missing.append("cloud_billing_enabled=true")
        # 없으면 유예 만료 삭제 직전에 재구독 여부를 확인하지 못한다.
        if self.env == "production" and not self.revenuecat_api_key:
            missing.append("revenuecat_api_key")
        # 없으면 만료 webhook을 모두 거절해서 구독이 끝나도 알 수 없다.
        if self.env == "production" and not self.revenuecat_webhook_secret:
            missing.append("revenuecat_webhook_secret")
        if missing:
            raise ValueError(f"ENV={self.env} requires explicit settings: {', '.join(missing)}")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
