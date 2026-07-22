from __future__ import annotations

from contextlib import nullcontext
from typing import Any
from uuid import UUID

import pytest
from sqlalchemy.exc import SQLAlchemyError

from app.database import AiRepository, _json
from app.schemas import ScoreRequest, ScoreResponse


class Result:
    def __init__(self, *, scalar: Any = None, rows: list[dict[str, Any]] | None = None) -> None:
        self.scalar = scalar
        self.rows = rows or []

    def scalar_one(self) -> Any:
        return self.scalar

    def scalar_one_or_none(self) -> Any:
        return self.scalar

    def mappings(self) -> Result:
        return self

    def one(self) -> dict[str, Any]:
        return self.rows[0]

    def all(self) -> list[dict[str, Any]]:
        return self.rows


class Connection:
    def __init__(
        self,
        *,
        registration_id: UUID | None = None,
        registration_ok: bool = True,
        safe_role: bool = True,
    ) -> None:
        self.registration_id = registration_id if registration_id is not None else UUID(int=9)
        if not registration_ok:
            self.registration_id = None
        self.safe_role = safe_role
        self.calls: list[tuple[str, dict[str, Any]]] = []

    def execute(self, statement: Any, parameters: dict[str, Any] | None = None) -> Result:
        sql = str(statement)
        values = parameters or {}
        self.calls.append((sql, values))
        if "RETURNING id" in sql:
            return Result(scalar=self.registration_id)
        if "runtime_role_is_safe" in sql:
            return Result(scalar=self.safe_role)
        if "SELECT id FROM model_versions" in sql:
            return Result(scalar=UUID(int=10))
        if "GROUP BY c.category" in sql:
            return Result(
                rows=[
                    {
                        "category": "PHISHING",
                        "sample_count": 4,
                        "recall": 0.75,
                        "precision": 0.6,
                    }
                ]
            )
        if "AS risk_accuracy" in sql:
            return Result(
                rows=[
                    {
                        "sample_count": 5,
                        "risk_accuracy": 0.8,
                        "false_positive_rate": 0.25,
                        "type_accuracy": 0.75,
                    }
                ]
            )
        return Result()


class Engine:
    def __init__(self, connection: Connection | None = None, *, fail_connect: bool = False) -> None:
        self.connection_value = connection or Connection()
        self.fail_connect = fail_connect

    def begin(self):
        return nullcontext(self.connection_value)

    def connect(self):
        if self.fail_connect:
            raise SQLAlchemyError("database unavailable")
        return nullcontext(self.connection_value)


def repository(engine: Engine) -> AiRepository:
    value = AiRepository.__new__(AiRepository)
    value.engine = engine  # type: ignore[assignment]
    value.last_error = "not checked"
    return value


def manifest() -> dict[str, Any]:
    return {
        "model_version": "model-v1",
        "feature_schema_version": "features-v1",
        "artifact_sha256": "a" * 64,
        "dataset_sha256": "b" * 64,
    }


def score_models() -> tuple[ScoreRequest, ScoreResponse]:
    request = ScoreRequest.model_validate(
        {
            "transaction_id": str(UUID(int=100)),
            "case_id": str(UUID(int=101)),
            "features": {
                "customer_id": str(UUID(int=102)),
                "city": "ISTANBUL",
                "region": "MARMARA",
                "country_code": "TR",
                "transaction_type": "TRANSFER",
                "amount": 1000,
                "hour": 12,
                "new_device": False,
                "new_recipient": False,
                "frequency_1h": 1,
                "frequency_24h": 2,
                "deviation_score": 0.5,
            },
            "candidates": [
                {
                    "analyst_id": str(UUID(int=index)),
                    "active_case_count": 0,
                    "performance": 0.8,
                    "status": "ACTIVE",
                }
                for index in range(1, 4)
            ],
        }
    )
    response = ScoreResponse.model_validate(
        {
            "prediction_id": str(UUID(int=103)),
            "model_version": "model-v1",
            "feature_schema_version": "features-v1",
            "risk_score": 0.9,
            "risk_level": "YUKSEK",
            "decision": "INCELEME",
            "fraud_type": "PHISHING",
            "reason_codes": ["HIGH_AMOUNT"],
            "ranked_candidates": [
                {
                    "analyst_id": str(UUID(int=index)),
                    "score": 0.8,
                    "expertise_match": 1,
                    "availability": 1,
                    "performance": 0.8,
                    "region_match": True,
                }
                for index in range(1, 4)
            ],
        }
    )
    return request, response


def test_readiness_recovers_and_fails_closed() -> None:
    healthy = repository(Engine())
    assert healthy.check() is True
    assert healthy.ready is True

    unavailable = repository(Engine(fail_connect=True))
    assert unavailable.check() is False
    assert unavailable.ready is False
    assert unavailable.last_error == "SQLAlchemyError"

    unsafe = repository(Engine(Connection(safe_role=False)))
    assert unsafe.check() is False
    assert unsafe.last_error == "SQLAlchemyError"


def test_model_registration_is_immutable_for_same_version() -> None:
    connection = Connection(registration_id=UUID(int=9))
    value = repository(Engine(connection))
    value.register_model(manifest())
    assert value.ready
    assert any("model_versions" in sql and "RETURNING id" in sql for sql, _ in connection.calls)

    mismatch = repository(Engine(Connection(registration_ok=False)))
    with pytest.raises(ValueError, match="different immutable"):
        mismatch.register_model(manifest())


def test_prediction_recommendation_and_two_events_share_one_transaction() -> None:
    connection = Connection()
    value = repository(Engine(connection))
    request, response = score_models()
    value.persist_prediction(request, response, UUID(int=104))

    recommendation = next(
        parameters
        for sql, parameters in connection.calls
        if "INSERT INTO assignment_recommendations" in sql
    )
    assert recommendation["case_id"] == request.case_id
    outbox_calls = [
        parameters for sql, parameters in connection.calls if "INSERT INTO outbox_events" in sql
    ]
    assert len(outbox_calls) == 2
    assert any(str(request.case_id) in parameters["payload"] for parameters in outbox_calls)
    context_sql = connection.calls[0][0]
    assert "app.actor_id" in context_sql
    assert "app.actor_role" in context_sql
    assert "'SYSTEM'" in context_sql


def test_online_metrics_apply_effective_truth_priority_query() -> None:
    connection = Connection()
    value = repository(Engine(connection))
    result = value.online_metrics()

    assert result == {
        "sample_count": 5,
        "risk_accuracy": 0.8,
        "false_positive_rate": 0.25,
        "type_accuracy": 0.75,
        "categories": [
            {"category": "PHISHING", "sample_count": 4, "recall": 0.75, "precision": 0.6}
        ],
    }
    sql = "\n".join(statement for statement, _ in connection.calls)
    assert "WHEN 'SUPERVISOR_QA' THEN 3" in sql
    assert "WHEN 'CUSTOMER' THEN 2" in sql


def test_json_serialization_is_stable_and_unicode_safe() -> None:
    assert _json({"z": "İstanbul", "a": 1}) == '{"a":1,"z":"İstanbul"}'
