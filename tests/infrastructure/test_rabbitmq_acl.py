from __future__ import annotations

from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[2]


def test_rabbitmq_bootstrap_creates_one_least_privilege_user_per_service() -> None:
    script = (ROOT / "infrastructure" / "rabbitmq" / "bootstrap-users.sh").read_text(
        encoding="utf-8"
    )

    for service in ("identity", "transaction", "ai", "gamification", "gateway"):
        expected = "declare_service_user \\\n  " + service
        assert expected in script
    assert "configure='^$'" in script
    assert "declare topic_permission" in script
    assert "exchange=fraudcell.events.v1" in script
    assert "exchange=fraudcell.retry.v1" in script
    assert "exchange=fraudcell.dlx.v1" in script


def test_acl_compose_uses_distinct_credentials() -> None:
    compose = yaml.safe_load(
        (ROOT / "docker-compose.rabbitmq-acl.yml").read_text(encoding="utf-8")
    )["services"]

    credential_keys = {
        "identity-service": "IDENTITY_RABBITMQ_USER",
        "transaction-service": "TRANSACTION_RABBITMQ_USER",
        "ai-service": "AI_RABBITMQ_USER",
        "gamification-service": "GAMIFICATION_RABBITMQ_USER",
        "gateway": "GATEWAY_RABBITMQ_USER",
    }
    for service, expected_key in credential_keys.items():
        rendered = str(compose[service]["environment"])
        assert expected_key in rendered
        assert "RABBITMQ_USER:-fraudcell_app" not in rendered
