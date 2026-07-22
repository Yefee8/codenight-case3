from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.config import Settings


def test_local_defaults_are_available_for_isolated_unit_tests() -> None:
    settings = Settings(_env_file=None)
    assert settings.environment == "local"
    assert settings.rabbitmq_url.startswith("amqp://")


def test_production_rejects_placeholder_credentials() -> None:
    with pytest.raises(ValidationError, match="placeholder"):
        Settings(APP_ENV="production", _env_file=None)


def test_production_accepts_private_jwks_and_non_placeholder_credentials() -> None:
    settings = Settings(
        APP_ENV="production",
        AI_INTERNAL_TOKEN="strong-internal-token-at-least-32-bytes",
        AI_DATABASE_URL="postgresql+psycopg://ai_app:strong@ai-db/fraudcell_ai",
        RABBITMQ_URL="amqp://ai_service:strong@rabbitmq/%2F",
        JWKS_URI="http://identity-service:8081/.well-known/jwks.json",
        _env_file=None,
    )
    assert settings.environment == "production"


def test_production_rejects_external_jwks_uri() -> None:
    with pytest.raises(ValidationError, match="private identity-service"):
        Settings(
            APP_ENV="production",
            AI_INTERNAL_TOKEN="strong-internal-token-at-least-32-bytes",
            AI_DATABASE_URL="postgresql+psycopg://ai_app:strong@ai-db/fraudcell_ai",
            RABBITMQ_URL="amqp://ai_service:strong@rabbitmq/%2F",
            JWKS_URI="https://public.example/jwks.json",
            _env_file=None,
        )
