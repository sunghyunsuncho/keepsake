from functools import lru_cache
from pathlib import Path
from typing import Self

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# 실행 위치(repo 루트, alembic, scripts)와 상관없이 backend/.env를 읽는다.
ENV_FILE = Path(__file__).resolve().parents[1] / ".env"

# 로컬 기본값을 그대로 쓰면 안 되는 설정. 운영 환경에서 빠뜨리면 시작 시 실패시킨다.
_REQUIRED_OUTSIDE_LOCAL = (
    "database_url",
    "r2_endpoint_url",
    "r2_access_key_id",
    "r2_secret_access_key",
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

    @model_validator(mode="after")
    def _require_real_values_outside_local(self) -> Self:
        if self.env == "local":
            return self
        defaults = {name: field.default for name, field in type(self).model_fields.items()}
        missing = [n for n in _REQUIRED_OUTSIDE_LOCAL if getattr(self, n) == defaults[n]]
        if missing:
            raise ValueError(f"ENV={self.env} requires explicit settings: {', '.join(missing)}")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
