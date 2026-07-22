from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="", case_sensitive=True, extra="ignore")

    port: int = Field(default=8000, alias="PORT")
    environment: Literal["local", "test", "production"] = Field(default="local", alias="APP_ENV")
    database_url: str = Field(
        default="postgresql+psycopg://ai_app:change-me@localhost:5435/fraudcell_ai",
        alias="AI_DATABASE_URL",
    )
    internal_token: SecretStr = Field(default=SecretStr("change-me"), alias="AI_INTERNAL_TOKEN")
    rabbitmq_url: str = Field(
        default="amqp://fraudcell_app:change-me@localhost:5672/%2F", alias="RABBITMQ_URL"
    )
    model_artifact_path: Path = Field(
        default=Path("../../data/model-artifacts/model.joblib"), alias="MODEL_ARTIFACT_PATH"
    )
    model_manifest_path: Path = Field(
        default=Path("../../data/model-artifacts/manifest.json"), alias="MODEL_MANIFEST_PATH"
    )
    synthetic_data_path: Path = Field(
        default=Path("../../data/synthetic/fraudcell.csv"), alias="SYNTHETIC_DATA_PATH"
    )
    model_seed: int = Field(default=2026, alias="MODEL_SEED")
    jwt_issuer: str = Field(default="https://identity.fraudcell.local", alias="JWT_ISSUER")
    jwt_audience: str = Field(default="fraudcell-api", alias="JWT_AUDIENCE")
    jwks_uri: str = Field(
        default="http://identity-service:8081/.well-known/jwks.json", alias="JWKS_URI"
    )

    @model_validator(mode="after")
    def reject_production_placeholders(self) -> Settings:
        if self.environment != "production":
            return self
        sensitive_values = (
            self.internal_token.get_secret_value(),
            self.database_url,
            self.rabbitmq_url,
        )
        placeholders = ("change-me", "change_me", "password", "secret-here")
        if any(any(marker in value.lower() for marker in placeholders) for value in sensitive_values):
            raise ValueError("production credentials must not use placeholder values")
        if len(self.internal_token.get_secret_value()) < 32:
            raise ValueError("production internal token must contain at least 32 characters")
        if not self.jwks_uri.startswith("http://identity-service:"):
            raise ValueError("production JWKS must use the private identity-service network")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
