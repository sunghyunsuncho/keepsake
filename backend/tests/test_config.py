import pytest
from pydantic import ValidationError

from app.config import Settings


def test_local_env_allows_defaults():
    assert Settings(_env_file=None, env="local").env == "local"


def test_non_local_env_rejects_local_defaults():
    with pytest.raises(ValidationError, match="database_url"):
        Settings(_env_file=None, env="production")


def test_non_local_env_rejects_missing_bucket_and_login():
    with pytest.raises(ValidationError, match="r2_bucket.*apple_client_id.*google_client_id"):
        Settings(_env_file=None, env="staging")


EXPLICIT = {
    "database_url": "postgresql+psycopg://u:p@db:5432/keepsake",
    "r2_endpoint_url": "https://account.r2.cloudflarestorage.com",
    "r2_access_key_id": "key",
    "r2_secret_access_key": "secret",
    "r2_bucket": "keepsake-test",
    "apple_client_id": "com.example.app",
    "google_client_id": "web.apps.googleusercontent.com",
    "jwt_secret": "a-production-secret",
}


def test_non_local_env_accepts_explicit_values():
    settings = Settings(
        _env_file=None,
        env="production",
        cloud_billing_enabled=True,
        revenuecat_api_key="sk_test",
        **EXPLICIT,
    )

    assert settings.env == "production"


def test_production_requires_billing():
    with pytest.raises(ValidationError, match="cloud_billing_enabled"):
        Settings(_env_file=None, env="production", **EXPLICIT)
    assert Settings(_env_file=None, env="staging", **EXPLICIT).cloud_billing_enabled is False


def test_production_requires_revenuecat_key():
    with pytest.raises(ValidationError, match="revenuecat_api_key"):
        Settings(_env_file=None, env="production", cloud_billing_enabled=True, **EXPLICIT)


def test_non_local_env_rejects_empty_values():
    with pytest.raises(ValidationError, match="google_client_id"):
        Settings(_env_file=None, env="staging", **{**EXPLICIT, "google_client_id": ""})


def test_database_url_uses_psycopg_driver():
    settings = Settings(_env_file=None, database_url="postgresql://u:p@db:5432/keepsake")

    assert settings.database_url == "postgresql+psycopg://u:p@db:5432/keepsake"
