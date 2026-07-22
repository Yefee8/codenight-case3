from __future__ import annotations

from contextlib import nullcontext
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

import pytest

from app.events import AiEventProcessor, EventEnvelope


class Result:
    def __init__(
        self,
        *,
        scalar: Any = None,
        rows: list[dict[str, Any]] | None = None,
        rowcount: int = 1,
    ) -> None:
        self.scalar = scalar
        self.rows = rows or []
        self.rowcount = rowcount

    def scalar_one(self) -> Any:
        return self.scalar

    def scalar_one_or_none(self) -> Any:
        return self.scalar

    def mappings(self) -> Result:
        return self

    def all(self) -> list[dict[str, Any]]:
        return self.rows

    def one(self) -> dict[str, Any]:
        return self.rows[0]

    def __iter__(self):
        return iter(self.rows)


class ScriptedConnection:
    def __init__(self, results: list[Result] | None = None) -> None:
        self.results = list(results or [])
        self.calls: list[tuple[str, dict[str, Any]]] = []

    def execute(self, statement: Any, parameters: dict[str, Any] | None = None) -> Result:
        self.calls.append((str(statement), parameters or {}))
        return self.results.pop(0) if self.results else Result()


class InboxConnection:
    def __init__(self) -> None:
        self.hashes: dict[UUID, str] = {}

    def execute(self, statement: Any, parameters: dict[str, Any] | None = None) -> Result:
        sql = str(statement)
        values = parameters or {}
        if "INSERT INTO inbox_events" in sql:
            event_id = values["id"]
            if event_id in self.hashes:
                return Result(rowcount=0)
            self.hashes[event_id] = values["hash"]
            return Result(rowcount=1)
        if "SELECT payload_hash" in sql:
            return Result(scalar=self.hashes[values["id"]])
        return Result()


class Repository:
    def __init__(self, connection: Any | None = None) -> None:
        self.connection = connection or ScriptedConnection()
        self.engine = self
        self.context_count = 0

    def begin(self):
        return nullcontext(self.connection)

    def _system_context(self, _: Any) -> None:
        self.context_count += 1


def event(
    event_type: str,
    payload: dict[str, Any],
    *,
    version: int = 1,
    event_id: UUID | None = None,
) -> EventEnvelope:
    return EventEnvelope(
        event_id=event_id or UUID(int=1),
        event_type=event_type,
        event_version=1,
        producer="test-service",
        occurred_at=datetime(2026, 7, 22, tzinfo=UTC),
        aggregate_id=UUID(int=2),
        aggregate_version=version,
        correlation_id=UUID(int=3),
        causation_id=None,
        payload=payload,
    )


def test_process_is_idempotent_and_rejects_event_id_reuse(monkeypatch) -> None:
    connection = InboxConnection()
    repository = Repository(connection)
    processor = AiEventProcessor(repository)  # type: ignore[arg-type]
    dispatched: list[str] = []
    monkeypatch.setattr(processor, "_dispatch", lambda _, item: dispatched.append(item.event_type))
    original = event("transaction.created", {"value": 1})

    assert processor.process(original.model_dump_json().encode()) is True
    assert processor.process(original.model_dump_json(indent=2).encode()) is False
    assert dispatched == ["transaction.created"]
    assert repository.context_count == 2

    changed = event("transaction.created", {"value": 2})
    with pytest.raises(ValueError, match="reused"):
        processor.process(changed.model_dump_json().encode())


def test_dispatch_handles_catalog_noop_and_rejects_unknown(monkeypatch) -> None:
    processor = AiEventProcessor(Repository())  # type: ignore[arg-type]
    called: list[str] = []
    monkeypatch.setattr(processor, "_staff_created", lambda *_: called.append("created"))

    processor._dispatch(ScriptedConnection(), event("staff.created", {}))
    processor._dispatch(ScriptedConnection(), event("transaction.created", {}))
    assert called == ["created"]

    with pytest.raises(ValueError, match="unsupported routed"):
        processor._dispatch(ScriptedConnection(), event("unknown.event", {}))


def test_staff_projection_handlers_are_partial_and_version_aware() -> None:
    processor = AiEventProcessor(Repository())  # type: ignore[arg-type]
    connection = ScriptedConnection()
    processor._staff_created(
        connection,
        event(
            "staff.created",
            {
                "staff_id": str(UUID(int=10)),
                "role": "ADMIN",
                "status": "ACTIVE",
                "specialties": [],
                "regions": [],
            },
        ),
    )
    assert connection.calls == []

    processor._staff_created(
        connection,
        event(
            "staff.created",
            {
                "staff_id": str(UUID(int=10)),
                "role": ["ANALYST"],
                "status": "ACTIVE",
                "specialties": ["CALINTI_KART"],
                "regions": ["MARMARA"],
            },
            version=4,
        ),
    )
    assert connection.calls[-1][1]["locked"] is False
    assert "specialties_version" in connection.calls[-1][0]

    with pytest.raises(ValueError, match="changed_fields"):
        processor._staff_updated(
            connection,
            event("staff.profile-updated", {"staff_id": str(UUID(int=10)), "changed_fields": []}),
        )
    before = len(connection.calls)
    processor._staff_updated(
        connection,
        event(
            "staff.profile-updated",
            {"staff_id": str(UUID(int=10)), "changed_fields": {"display_name": "Ada"}},
        ),
    )
    assert len(connection.calls) == before
    processor._staff_updated(
        connection,
        event(
            "staff.profile-updated",
            {
                "staff_id": str(UUID(int=10)),
                "changed_fields": {"specialties": ["PHISHING"], "regions": ["EGE"]},
            },
            version=5,
        ),
    )
    assert connection.calls[-1][1]["has_specialties"] is True
    assert connection.calls[-1][1]["has_regions"] is True

    processor._staff_status(
        connection,
        event(
            "staff.status-changed",
            {"staff_id": str(UUID(int=10)), "status": "SUSPENDED"},
            version=6,
        ),
    )
    assert connection.calls[-1][1]["locked"] is True


def test_case_created_links_latest_prediction_and_replays_pending(monkeypatch) -> None:
    prediction_id = UUID(int=20)
    connection = ScriptedConnection(
        [Result(scalar=prediction_id), Result(), Result(scalar=prediction_id)]
    )
    processor = AiEventProcessor(Repository())  # type: ignore[arg-type]
    replayed: list[tuple[UUID, UUID]] = []
    monkeypatch.setattr(
        processor,
        "_replay_pending",
        lambda _, case_id, found_prediction: replayed.append((case_id, found_prediction)),
    )
    processor._case_created(
        connection,
        event(
            "case.created",
            {"case_id": str(UUID(int=21)), "transaction_id": str(UUID(int=22))},
            version=3,
        ),
    )
    assert replayed == [(UUID(int=21), prediction_id)]

    no_prediction = ScriptedConnection([Result(), Result(), Result()])
    processor._case_created(
        no_prediction,
        event(
            "case.created",
            {"case_id": str(UUID(int=23)), "transaction_id": str(UUID(int=24))},
        ),
    )
    assert len(replayed) == 1


def test_assignment_and_status_route_with_field_versions(monkeypatch) -> None:
    processor = AiEventProcessor(Repository())  # type: ignore[arg-type]
    calls: list[dict[str, Any]] = []

    def capture(*args: Any, **kwargs: Any) -> None:
        calls.append({"args": args, **kwargs})

    monkeypatch.setattr(processor, "_upsert_case_assignment", capture)
    processor._case_assigned(
        ScriptedConnection(),
        event(
            "case.assigned",
            {"case_id": str(UUID(int=30)), "analyst_id": str(UUID(int=31))},
            version=2,
        ),
    )
    processor._case_status(
        ScriptedConnection(),
        event("case.status-changed", {"case_id": str(UUID(int=30)), "to_status": "KAPALI"}),
    )
    assert calls[0]["update_assignment"] is True
    assert calls[1]["update_assignment"] is False


def test_assignment_upsert_recalculates_previous_and_current_workload() -> None:
    previous = UUID(int=40)
    current = UUID(int=41)
    connection = ScriptedConnection(
        [Result(scalar=previous), Result(), Result(scalar=current), Result(), Result(), Result()]
    )
    processor = AiEventProcessor(Repository())  # type: ignore[arg-type]
    processor._upsert_case_assignment(
        connection,
        UUID(int=42),
        current,
        "ATANDI",
        7,
        datetime(2026, 7, 22, tzinfo=UTC),
        update_assignment=True,
    )
    assert len(connection.calls) == 6
    assert sum("active_case_count" in sql for sql, _ in connection.calls) == 2

    unchanged = ScriptedConnection(
        [Result(scalar=current), Result(), Result(scalar=current), Result()]
    )
    processor._upsert_case_assignment(
        unchanged,
        UUID(int=42),
        None,
        "INCELENIYOR",
        8,
        datetime(2026, 7, 22, tzinfo=UTC),
        update_assignment=False,
    )
    assert len(unchanged.calls) == 4


def test_feedback_is_buffered_then_replayed(monkeypatch) -> None:
    processor = AiEventProcessor(Repository())  # type: ignore[arg-type]
    feedback_event = event(
        "case.ground-truth-set",
        {
            "case_id": str(UUID(int=50)),
            "truth": "FRAUD",
            "fraud_type": "PHISHING",
            "source": "SUPERVISOR_QA",
        },
    )
    pending = ScriptedConnection([Result(), Result()])
    processor._feedback_or_pending(pending, feedback_event)
    assert "pending_feedback_events" in pending.calls[-1][0]

    prediction_id = UUID(int=51)
    inserted: list[UUID] = []
    monkeypatch.setattr(
        processor,
        "_insert_feedback",
        lambda _, __, found_prediction: inserted.append(found_prediction),
    )
    found = ScriptedConnection([Result(scalar=prediction_id)])
    processor._feedback_or_pending(found, feedback_event)
    assert inserted == [prediction_id]

    replay = ScriptedConnection(
        [
            Result(
                rows=[
                    {
                        "event_id": UUID(int=52),
                        "event_type": "case.ground-truth-set",
                        "aggregate_version": 3,
                        "payload": feedback_event.payload,
                        "occurred_at": feedback_event.occurred_at,
                    }
                ]
            ),
            Result(),
        ]
    )
    processor._replay_pending(replay, UUID(int=50), prediction_id)
    assert inserted == [prediction_id, prediction_id]
    assert "DELETE FROM pending_feedback_events" in replay.calls[-1][0]


def test_feedback_values_and_correctness_are_explicit() -> None:
    processor = AiEventProcessor(Repository())  # type: ignore[arg-type]
    prediction_id = UUID(int=60)
    customer = event(
        "case.customer-verification-responded",
        {"case_id": str(UUID(int=61)), "response": "BEN_YAPMADIM"},
    )
    connection = ScriptedConnection(
        [Result(rows=[{"risk_score": 0.9, "fraud_type": "PHISHING"}]), Result()]
    )
    processor._insert_feedback(connection, customer, prediction_id)
    assert connection.calls[-1][1]["risk_correct"] is True
    assert connection.calls[-1][1]["type_correct"] is None

    override = event(
        "case.fraud-type-overridden",
        {"case_id": str(UUID(int=61)), "effective_type": "PHISHING"},
    )
    assert processor._feedback_values(override) == ("ANALYST", "FRAUD", "PHISHING")
    assert processor._feedback_values(customer) == ("CUSTOMER", "FRAUD", None)
    legitimate = event(
        "case.customer-verification-responded",
        {"case_id": str(UUID(int=61)), "response": "BEN_YAPTIM"},
    )
    assert processor._feedback_values(legitimate) == ("CUSTOMER", "LEGITIMATE", None)
    qa = event(
        "case.ground-truth-set",
        {
            "case_id": str(UUID(int=61)),
            "truth": "FRAUD",
            "fraud_type": "PHISHING",
            "source": "UNTRUSTED",
        },
    )
    assert processor._feedback_values(qa) == ("SUPERVISOR_QA", "FRAUD", "PHISHING")
    with pytest.raises(ValueError, match="cannot create"):
        processor._feedback_values(event("transaction.created", {}))
