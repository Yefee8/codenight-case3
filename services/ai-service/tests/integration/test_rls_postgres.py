from __future__ import annotations

import shutil
from pathlib import Path

import pytest
from alembic.config import Config
from sqlalchemy import create_engine, text
from sqlalchemy.exc import DBAPIError

from alembic import command
from app.config import get_settings
from app.database import AiRepository

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(shutil.which("docker") is None, reason="Docker CLI is required"),
]


def test_force_rls_runtime_role_and_transaction_local_context(monkeypatch) -> None:
    from testcontainers.postgres import PostgresContainer

    service_root = Path(__file__).resolve().parents[2]
    with PostgresContainer("postgres:17-alpine") as postgres:
        admin_url = postgres.get_connection_url().replace("+psycopg2", "+psycopg")
        admin_engine = create_engine(admin_url)
        with admin_engine.begin() as connection:
            connection.execute(text("CREATE EXTENSION IF NOT EXISTS pgcrypto"))
            connection.execute(text("CREATE ROLE ai_migrator LOGIN PASSWORD 'migration-test'"))
            connection.execute(
                text(
                    "CREATE ROLE ai_app LOGIN PASSWORD 'runtime-test' "
                    "NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS"
                )
            )
            connection.execute(text("GRANT CREATE, USAGE ON SCHEMA public TO ai_migrator"))

        migration_url = _role_url(admin_url, "ai_migrator", "migration-test")
        monkeypatch.setenv("AI_MIGRATION_DATABASE_URL", migration_url)
        get_settings.cache_clear()
        config = Config(str(service_root / "alembic.ini"))
        config.set_main_option("script_location", str(service_root / "alembic"))
        command.upgrade(config, "head")

        with admin_engine.begin() as connection:
            connection.execute(text("GRANT USAGE ON SCHEMA public TO ai_app"))
            connection.execute(
                text(
                    "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ai_app"
                )
            )
            connection.execute(
                text("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ai_app")
            )

        runtime_url = _role_url(admin_url, "ai_app", "runtime-test")
        repository = AiRepository(runtime_url)
        assert repository.check() is True

        runtime_engine = create_engine(runtime_url, pool_size=1, max_overflow=0)
        with runtime_engine.connect() as connection:
            transaction = connection.begin()
            with pytest.raises(DBAPIError):
                connection.execute(
                    text(
                        """
                        INSERT INTO model_versions
                            (model_version, feature_schema_version, artifact_sha256,
                             dataset_sha256, manifest, status)
                        VALUES ('denied', 'v1', :artifact, :dataset, '{}'::jsonb, 'ACTIVE')
                        """
                    ),
                    {"artifact": "a" * 64, "dataset": "b" * 64},
                )
            transaction.rollback()

        with runtime_engine.begin() as connection:
            connection.execute(
                text(
                    "SELECT set_config('app.actor_id', :id, true), "
                    "set_config('app.actor_role', 'SYSTEM', true)"
                ),
                {"id": "00000000-0000-0000-0000-000000000000"},
            )
            connection.execute(
                text(
                    """
                    INSERT INTO model_versions
                        (model_version, feature_schema_version, artifact_sha256,
                         dataset_sha256, manifest, status)
                    VALUES ('allowed', 'v1', :artifact, :dataset, '{}'::jsonb, 'ACTIVE')
                    """
                ),
                {"artifact": "c" * 64, "dataset": "d" * 64},
            )

        with runtime_engine.begin() as connection:
            assert connection.execute(text("SELECT count(*) FROM model_versions")).scalar_one() == 0
            connection.execute(
                text(
                    "SELECT set_config('app.actor_id', :id, true), "
                    "set_config('app.actor_role', 'ANALYST', true)"
                ),
                {"id": "00000000-0000-0000-0000-000000000001"},
            )
            assert connection.execute(text("SELECT count(*) FROM model_versions")).scalar_one() == 1

        with runtime_engine.begin() as connection:
            assert connection.execute(text("SELECT count(*) FROM model_versions")).scalar_one() == 0

        migrator_engine = create_engine(migration_url)
        with migrator_engine.begin() as connection:
            assert connection.execute(text("SELECT count(*) FROM model_versions")).scalar_one() == 0


def _role_url(url: str, username: str, password: str) -> str:
    scheme, remainder = url.split("://", 1)
    _, host_and_database = remainder.split("@", 1)
    return f"{scheme}://{username}:{password}@{host_and_database}"
