from __future__ import annotations

from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[2]


def test_ci_has_all_quality_and_bonus_jobs() -> None:
    workflow = yaml.safe_load(
        (ROOT / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")
    )
    jobs = workflow["jobs"]

    assert {
        "contracts-and-infrastructure",
        "java-services",
        "ai-service",
        "frontend",
        "secret-scan",
        "container-build",
    }.issubset(jobs)
    assert set(jobs["java-services"]["strategy"]["matrix"]["service"]) == {
        "gateway",
        "identity-service",
        "transaction-service",
        "gamification-service",
    }


def test_container_job_scans_each_built_image() -> None:
    text = (ROOT / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")

    assert "aquasecurity/trivy-action" in text
    assert "gitleaks/gitleaks-action" in text
    assert "docker build" in text
    assert "docker compose" in text
