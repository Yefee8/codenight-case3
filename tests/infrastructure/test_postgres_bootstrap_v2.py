from __future__ import annotations

from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[2]


def test_scram_bootstrap_supplies_password_non_interactively() -> None:
    script = (
        ROOT / "infrastructure" / "postgres" / "bootstrap-service-db-v2.sh"
    ).read_text(encoding="utf-8")

    assert 'export PGPASSWORD="$POSTGRES_PASSWORD"' in script
    assert "NOBYPASSRLS" in script
    assert "NOSUPERUSER" in script
    assert "unset PGPASSWORD" in script


def test_every_database_uses_hardened_bootstrap_override() -> None:
    compose = yaml.safe_load(
        (ROOT / "docker-compose.database-bootstrap.override.yml").read_text(encoding="utf-8")
    )

    assert set(compose["services"]) == {
        "identity-db",
        "transaction-db",
        "ai-db",
        "gamification-db",
    }
    for database in compose["services"].values():
        assert any("bootstrap-service-db-v2.sh" in volume for volume in database["volumes"])
