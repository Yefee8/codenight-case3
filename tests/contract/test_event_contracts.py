from __future__ import annotations

import json
from pathlib import Path

import jsonschema


ROOT = Path(__file__).resolve().parents[2]
EVENT_ROOT = ROOT / "contracts" / "events" / "v1"

EXPECTED_EVENTS = {
    "staff.created",
    "staff.profile-updated",
    "staff.status-changed",
    "role.changed",
    "sessions.revoked",
    "transaction.created",
    "transaction.risk-assessed",
    "transaction.analysis-unavailable",
    "case.created",
    "case.assigned",
    "case.status-changed",
    "case.customer-verification-requested",
    "case.customer-verification-responded",
    "case.fraud-type-overridden",
    "case.risk-level-overridden",
    "case.decision-recorded",
    "case.sla-breached",
    "case.closed",
    "case.feedback-submitted",
    "case.ground-truth-set",
    "ai.prediction-created",
    "ai.classification-evaluated",
    "ai.model-activated",
    "ai.assignment-recommended",
    "points.changed",
    "badge.earned",
    "level.changed",
    "audit.record-requested",
}


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def test_event_catalog_is_complete_and_unique() -> None:
    catalog = load_json(EVENT_ROOT / "catalog.json")
    event_types = [event["type"] for event in catalog["events"]]

    assert len(event_types) == len(set(event_types))
    assert set(event_types) == EXPECTED_EVENTS
    assert catalog["delivery"] == "at-least-once"
    assert all(event["required_payload"] for event in catalog["events"])


def test_valid_fixture_matches_envelope_and_catalog_payload() -> None:
    schema = load_json(EVENT_ROOT / "event-envelope.schema.json")
    fixture = load_json(EVENT_ROOT / "fixtures" / "valid" / "case-decision-recorded.json")
    catalog = load_json(EVENT_ROOT / "catalog.json")

    jsonschema.Draft202012Validator(schema, format_checker=jsonschema.FormatChecker()).validate(fixture)
    definition = next(event for event in catalog["events"] if event["type"] == fixture["event_type"])

    assert definition["producer"] == fixture["producer"]
    assert set(definition["required_payload"]).issubset(fixture["payload"])


def test_envelope_rejects_unknown_top_level_data() -> None:
    schema = load_json(EVENT_ROOT / "event-envelope.schema.json")
    fixture = load_json(EVENT_ROOT / "fixtures" / "valid" / "case-decision-recorded.json")
    fixture["access_token"] = "must-never-be-published"

    errors = list(jsonschema.Draft202012Validator(schema).iter_errors(fixture))

    assert errors
    assert any("Additional properties" in error.message for error in errors)

