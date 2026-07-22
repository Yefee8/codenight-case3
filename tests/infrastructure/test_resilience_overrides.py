from __future__ import annotations

from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[2]


def test_non_source_of_truth_dependencies_do_not_block_application_startup() -> None:
    override = yaml.safe_load(
        (ROOT / "docker-compose.override.yml").read_text(encoding="utf-8")
    )["services"]

    assert override["transaction-service"]["depends_on"]["ai-service"]["condition"] == "service_started"
    for name in ("identity-service", "transaction-service", "ai-service", "gamification-service"):
        assert override[name]["depends_on"]["rabbitmq"]["condition"] == "service_started"


def test_gateway_waits_for_security_redis_but_not_every_domain_healthcheck() -> None:
    base = yaml.safe_load((ROOT / "docker-compose.yml").read_text(encoding="utf-8"))["services"]
    override = yaml.safe_load(
        (ROOT / "docker-compose.override.yml").read_text(encoding="utf-8")
    )["services"]

    assert base["gateway"]["depends_on"]["gateway-redis"]["condition"] == "service_healthy"
    for dependency in ("identity-service", "transaction-service", "gamification-service"):
        assert override["gateway"]["depends_on"][dependency]["condition"] == "service_started"
