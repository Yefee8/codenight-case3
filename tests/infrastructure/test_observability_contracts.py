from __future__ import annotations

import json
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[2]


def test_prometheus_scrapes_every_backend_component() -> None:
    config = yaml.safe_load(
        (ROOT / "infrastructure" / "observability" / "prometheus.yml").read_text(encoding="utf-8")
    )
    jobs = {item["job_name"] for item in config["scrape_configs"]}

    assert jobs == {
        "gateway",
        "identity-service",
        "transaction-service",
        "ai-service",
        "gamification-service",
    }


def test_observability_ports_are_localhost_only_and_profile_gated() -> None:
    compose = yaml.safe_load(
        (ROOT / "docker-compose.observability.yml").read_text(encoding="utf-8")
    )

    for service in compose["services"].values():
        assert "observability" in service["profiles"]
        assert all(port.startswith("127.0.0.1:") for port in service.get("ports", []))


def test_grafana_dashboard_is_valid_json() -> None:
    dashboard = json.loads(
        (
            ROOT
            / "infrastructure"
            / "observability"
            / "grafana"
            / "dashboards"
            / "fraudcell-overview.json"
        ).read_text(encoding="utf-8")
    )

    assert dashboard["uid"] == "fraudcell-overview"
    assert len(dashboard["panels"]) >= 2
