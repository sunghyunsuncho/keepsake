import pytest
from pydantic import ValidationError

from app.config import Settings


def test_local_env_allows_defaults():
    assert Settings(_env_file=None, env="local").env == "local"


def test_non_local_env_rejects_local_defaults():
    with pytest.raises(ValidationError, match="database_url"):
        Settings(_env_file=None, env="production")


def test_non_local_env_accepts_explicit_values():
    settings = Settings(
        _env_file=None,
        env="production",
        database_url="postgresql+psycopg://u:p@db:5432/keepsake",
        r2_endpoint_url="https://account.r2.cloudflarestorage.com",
        r2_access_key_id="key",
        r2_secret_access_key="secret",
    )

    assert settings.env == "production"
