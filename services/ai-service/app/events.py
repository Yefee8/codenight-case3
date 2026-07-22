from __future__ import annotations

import hashlib
from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text

from app.database import AiRepository, _json


class EventEnvelope(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event_id: UUID
    event_type: str = Field(min_length=1, max_length=120)
    event_version: int = Field(ge=1)
    producer: str = Field(min_length=1, max_length=80)
    occurred_at: datetime
    aggregate_id: UUID
    aggregate_version: int = Field(ge=0)
    correlation_id: UUID
    causation_id: UUID | None
    payload: dict[str, Any]


KNOWN_NO_EFFECT = {
    "case.customer-verification-requested",
    "case.risk-level-overridden",
    "case.decision-recorded",
    "case.sla-breached",
    "case.closed",
    "case.feedback-submitted",
    "transaction.created",
    "transaction.risk-assessed",
    "transaction.analysis-unavailable",
}


class AiEventProcessor:
    def __init__(self, repository: AiRepository) -> None:
        self.repository = repository

    def process(self, body: bytes) -> bool:
        event = EventEnvelope.model_validate_json(body)
        canonical = _json(event.model_dump(mode="json")).encode()
        payload_hash = hashlib.sha256(canonical).hexdigest()
        with self.repository.engine.begin() as connection:
            self.repository._system_context(connection)
            inserted = connection.execute(
                text(
                    """
                    INSERT INTO inbox_events
                        (event_id, event_type, aggregate_id, aggregate_version, payload_hash)
                    VALUES (:id, :type, :aggregate, :version, :hash)
                    ON CONFLICT (event_id) DO NOTHING
                    """
                ),
                {
                    "id": event.event_id,
                    "type": event.event_type,
                    "aggregate": event.aggregate_id,
                    "version": event.aggregate_version,
                    "hash": payload_hash,
                },
            ).rowcount
            if inserted == 0:
                existing = connection.execute(
                    text("SELECT payload_hash FROM inbox_events WHERE event_id = :id"),
                    {"id": event.event_id},
                ).scalar_one()
                if existing != payload_hash:
                    raise ValueError("event id reused with different payload")
                return False
            self._dispatch(connection, event)
        return True

    def _dispatch(self, connection: Any, event: EventEnvelope) -> None:
        handlers = {
            "staff.created": self._staff_created,
            "staff.profile-updated": self._staff_updated,
            "staff.status-changed": self._staff_status,
            "case.created": self._case_created,
            "case.assigned": self._case_assigned,
            "case.status-changed": self._case_status,
            "case.fraud-type-overridden": self._feedback_or_pending,
            "case.customer-verification-responded": self._feedback_or_pending,
            "case.ground-truth-set": self._feedback_or_pending,
        }
        handler = handlers.get(event.event_type)
        if handler is not None:
            handler(connection, event)
        elif event.event_type not in KNOWN_NO_EFFECT:
            raise ValueError(f"unsupported routed event type: {event.event_type}")

    def _staff_created(self, connection: Any, event: EventEnvelope) -> None:
        payload = event.payload
        roles = payload.get("role", [])
        if isinstance(roles, str):
            roles = [roles]
        if "ANALYST" not in roles:
            return
        connection.execute(
            text(
                """
                INSERT INTO analyst_projection
                    (analyst_id, status, locked, specialties, regions, aggregate_version,
                     status_version, specialties_version, regions_version)
                VALUES (:id, :status, :locked, CAST(:specialties AS jsonb),
                        CAST(:regions AS jsonb), :version, :version, :version, :version)
                ON CONFLICT (analyst_id) DO UPDATE SET
                    status = CASE WHEN :version > analyst_projection.status_version
                                  THEN EXCLUDED.status ELSE analyst_projection.status END,
                    locked = CASE WHEN :version > analyst_projection.status_version
                                  THEN EXCLUDED.locked ELSE analyst_projection.locked END,
                    specialties = CASE WHEN :version > analyst_projection.specialties_version
                                       THEN EXCLUDED.specialties
                                       ELSE analyst_projection.specialties END,
                    regions = CASE WHEN :version > analyst_projection.regions_version
                                   THEN EXCLUDED.regions ELSE analyst_projection.regions END,
                    status_version = GREATEST(analyst_projection.status_version, :version),
                    specialties_version = GREATEST(
                        analyst_projection.specialties_version, :version
                    ),
                    regions_version = GREATEST(analyst_projection.regions_version, :version),
                    aggregate_version = GREATEST(
                        analyst_projection.aggregate_version, :version
                    ),
                    updated_at = now()
                """
            ),
            {
                "id": UUID(str(payload["staff_id"])),
                "status": str(payload["status"]),
                "locked": str(payload["status"]) != "ACTIVE",
                "specialties": _json(payload.get("specialties", [])),
                "regions": _json(payload.get("regions", [])),
                "version": event.aggregate_version,
            },
        )

    def _staff_updated(self, connection: Any, event: EventEnvelope) -> None:
        payload = event.payload
        changed = payload.get("changed_fields")
        if not isinstance(changed, dict):
            raise ValueError("staff.profile-updated changed_fields must be an object")
        has_specialties = "specialties" in changed
        has_regions = "regions" in changed
        if not has_specialties and not has_regions:
            return
        connection.execute(
            text(
                """
                INSERT INTO analyst_projection
                    (analyst_id, status, locked, specialties, regions, aggregate_version,
                     status_version, specialties_version, regions_version)
                VALUES (:id, 'UNKNOWN', true, CAST(:specialties AS jsonb),
                        CAST(:regions AS jsonb), :version, -1,
                        CASE WHEN :has_specialties THEN :version ELSE -1 END,
                        CASE WHEN :has_regions THEN :version ELSE -1 END)
                ON CONFLICT (analyst_id) DO UPDATE SET
                    specialties = CASE
                        WHEN :has_specialties
                         AND :version > analyst_projection.specialties_version
                        THEN EXCLUDED.specialties ELSE analyst_projection.specialties END,
                    regions = CASE
                        WHEN :has_regions AND :version > analyst_projection.regions_version
                        THEN EXCLUDED.regions ELSE analyst_projection.regions END,
                    specialties_version = CASE
                        WHEN :has_specialties
                        THEN GREATEST(analyst_projection.specialties_version, :version)
                        ELSE analyst_projection.specialties_version END,
                    regions_version = CASE
                        WHEN :has_regions
                        THEN GREATEST(analyst_projection.regions_version, :version)
                        ELSE analyst_projection.regions_version END,
                    aggregate_version = GREATEST(
                        analyst_projection.aggregate_version, :version
                    ),
                    updated_at = now()
                """
            ),
            {
                "id": UUID(str(payload["staff_id"])),
                "specialties": _json(changed.get("specialties", [])),
                "regions": _json(changed.get("regions", [])),
                "has_specialties": has_specialties,
                "has_regions": has_regions,
                "version": event.aggregate_version,
            },
        )

    def _staff_status(self, connection: Any, event: EventEnvelope) -> None:
        status = str(event.payload["status"])
        connection.execute(
            text(
                """
                INSERT INTO analyst_projection
                    (analyst_id, status, locked, specialties, regions, aggregate_version,
                     status_version, specialties_version, regions_version)
                VALUES (:id, :status, :locked, '[]'::jsonb, '[]'::jsonb,
                        :version, :version, -1, -1)
                ON CONFLICT (analyst_id) DO UPDATE SET
                    status = CASE WHEN :version > analyst_projection.status_version
                                  THEN EXCLUDED.status ELSE analyst_projection.status END,
                    locked = CASE WHEN :version > analyst_projection.status_version
                                  THEN EXCLUDED.locked ELSE analyst_projection.locked END,
                    status_version = GREATEST(analyst_projection.status_version, :version),
                    aggregate_version = GREATEST(
                        analyst_projection.aggregate_version, :version
                    ),
                    updated_at = now()
                """
            ),
            {
                "id": UUID(str(event.payload["staff_id"])),
                "status": status,
                "locked": status != "ACTIVE",
                "version": event.aggregate_version,
            },
        )

    def _case_created(self, connection: Any, event: EventEnvelope) -> None:
        case_id = UUID(str(event.payload["case_id"]))
        transaction_id = UUID(str(event.payload["transaction_id"]))
        prediction_id = connection.execute(
            text(
                """
                SELECT prediction_id FROM predictions WHERE transaction_id = :transaction_id
                 ORDER BY created_at DESC LIMIT 1
                """
            ),
            {"transaction_id": transaction_id},
        ).scalar_one_or_none()
        connection.execute(
            text(
                """
                INSERT INTO case_prediction_projection
                    (case_id, transaction_id, prediction_id, aggregate_version)
                VALUES (:case_id, :transaction_id, :prediction_id, :version)
                ON CONFLICT (case_id) DO UPDATE SET
                    transaction_id = EXCLUDED.transaction_id,
                    prediction_id = COALESCE(EXCLUDED.prediction_id,
                                             case_prediction_projection.prediction_id),
                    aggregate_version = EXCLUDED.aggregate_version, updated_at = now()
                WHERE EXCLUDED.aggregate_version > case_prediction_projection.aggregate_version
                """
            ),
            {
                "case_id": case_id,
                "transaction_id": transaction_id,
                "prediction_id": prediction_id,
                "version": event.aggregate_version,
            },
        )
        effective_prediction = connection.execute(
            text("SELECT prediction_id FROM case_prediction_projection WHERE case_id = :id"),
            {"id": case_id},
        ).scalar_one_or_none()
        if effective_prediction is not None:
            self._replay_pending(connection, case_id, effective_prediction)

    def _case_assigned(self, connection: Any, event: EventEnvelope) -> None:
        self._upsert_case_assignment(
            connection,
            UUID(str(event.payload["case_id"])),
            UUID(str(event.payload["analyst_id"])),
            "ATANDI",
            event.aggregate_version,
            event.occurred_at,
            update_assignment=True,
        )

    def _case_status(self, connection: Any, event: EventEnvelope) -> None:
        self._upsert_case_assignment(
            connection,
            UUID(str(event.payload["case_id"])),
            None,
            str(event.payload["to_status"]),
            event.aggregate_version,
            event.occurred_at,
            update_assignment=False,
        )

    def _upsert_case_assignment(
        self,
        connection: Any,
        case_id: UUID,
        analyst_id: UUID | None,
        status: str,
        version: int,
        occurred_at: datetime,
        *,
        update_assignment: bool,
    ) -> None:
        previous = connection.execute(
            text("SELECT analyst_id FROM case_assignment_projection WHERE case_id = :id"),
            {"id": case_id},
        ).scalar_one_or_none()
        connection.execute(
            text(
                """
                INSERT INTO case_assignment_projection
                    (case_id, analyst_id, status, aggregate_version,
                     assignment_version, status_version)
                VALUES (:case_id, :analyst_id, :status, :version,
                        CASE WHEN :update_assignment THEN :version ELSE -1 END, :version)
                ON CONFLICT (case_id) DO UPDATE SET
                    analyst_id = CASE
                        WHEN :update_assignment
                         AND :version > case_assignment_projection.assignment_version
                        THEN EXCLUDED.analyst_id
                        ELSE case_assignment_projection.analyst_id END,
                    status = CASE
                        WHEN :version > case_assignment_projection.status_version
                        THEN EXCLUDED.status ELSE case_assignment_projection.status END,
                    assignment_version = CASE
                        WHEN :update_assignment
                        THEN GREATEST(case_assignment_projection.assignment_version, :version)
                        ELSE case_assignment_projection.assignment_version END,
                    status_version = GREATEST(
                        case_assignment_projection.status_version, :version
                    ),
                    aggregate_version = GREATEST(
                        case_assignment_projection.aggregate_version, :version
                    ),
                    updated_at = now()
                """
            ),
            {
                "case_id": case_id,
                "analyst_id": analyst_id,
                "status": status,
                "version": version,
                "update_assignment": update_assignment,
            },
        )
        current = connection.execute(
            text("SELECT analyst_id FROM case_assignment_projection WHERE case_id = :id"),
            {"id": case_id},
        ).scalar_one_or_none()
        if update_assignment and current is not None and current != previous:
            connection.execute(
                text(
                    """
                    UPDATE analyst_projection
                       SET last_assigned_at = GREATEST(
                               COALESCE(last_assigned_at, :occurred), :occurred
                           ), updated_at = now()
                     WHERE analyst_id = :id
                    """
                ),
                {"id": current, "occurred": occurred_at},
            )
        for affected in {previous, current} - {None}:
            connection.execute(
                text(
                    """
                    UPDATE analyst_projection SET active_case_count = (
                        SELECT count(*) FROM case_assignment_projection
                         WHERE analyst_id = :id
                           AND status IN ('ATANDI','INCELENIYOR','MUSTERI_DOGRULAMA')
                    ), updated_at = now() WHERE analyst_id = :id
                    """
                ),
                {"id": affected},
            )

    def _feedback_or_pending(self, connection: Any, event: EventEnvelope) -> None:
        case_id = UUID(str(event.payload["case_id"]))
        prediction_id = connection.execute(
            text("SELECT prediction_id FROM case_prediction_projection WHERE case_id = :id"),
            {"id": case_id},
        ).scalar_one_or_none()
        if prediction_id is None:
            connection.execute(
                text(
                    """
                    INSERT INTO pending_feedback_events
                        (event_id, case_id, event_type, aggregate_version, payload, occurred_at)
                    VALUES (:id, :case_id, :type, :version, CAST(:payload AS jsonb), :occurred)
                    ON CONFLICT (event_id) DO NOTHING
                    """
                ),
                {
                    "id": event.event_id,
                    "case_id": case_id,
                    "type": event.event_type,
                    "version": event.aggregate_version,
                    "payload": _json(event.payload),
                    "occurred": event.occurred_at,
                },
            )
            return
        self._insert_feedback(connection, event, prediction_id)

    def _replay_pending(self, connection: Any, case_id: UUID, prediction_id: UUID) -> None:
        pending = connection.execute(
            text(
                """
                SELECT event_id, event_type, aggregate_version, payload, occurred_at
                  FROM pending_feedback_events WHERE case_id = :case_id
                 ORDER BY aggregate_version, occurred_at
                """
            ),
            {"case_id": case_id},
        ).mappings()
        for row in pending:
            event = EventEnvelope(
                event_id=row["event_id"],
                event_type=row["event_type"],
                event_version=1,
                producer="transaction-service",
                occurred_at=row["occurred_at"],
                aggregate_id=case_id,
                aggregate_version=row["aggregate_version"],
                correlation_id=row["event_id"],
                causation_id=None,
                payload=row["payload"],
            )
            self._insert_feedback(connection, event, prediction_id)
        connection.execute(
            text("DELETE FROM pending_feedback_events WHERE case_id = :case_id"),
            {"case_id": case_id},
        )

    def _insert_feedback(self, connection: Any, event: EventEnvelope, prediction_id: UUID) -> None:
        prediction = (
            connection.execute(
                text("SELECT risk_score, fraud_type FROM predictions WHERE prediction_id = :id"),
                {"id": prediction_id},
            )
            .mappings()
            .one()
        )
        source, truth, fraud_type = self._feedback_values(event)
        suspicious = float(prediction["risk_score"]) >= 0.40
        is_risk_correct = suspicious == (truth == "FRAUD")
        is_type_correct = (
            None
            if truth != "FRAUD" or fraud_type is None
            else prediction["fraud_type"] == fraud_type
        )
        connection.execute(
            text(
                """
                INSERT INTO classification_feedback
                    (prediction_id, source, ground_truth, fraud_type, is_risk_correct,
                     is_type_correct, source_event_id, aggregate_version, occurred_at)
                VALUES (:prediction, :source, :truth, :fraud_type, :risk_correct,
                        :type_correct, :event_id, :version, :occurred)
                ON CONFLICT (source_event_id) DO NOTHING
                """
            ),
            {
                "prediction": prediction_id,
                "source": source,
                "truth": truth,
                "fraud_type": fraud_type,
                "risk_correct": is_risk_correct,
                "type_correct": is_type_correct,
                "event_id": event.event_id,
                "version": event.aggregate_version,
                "occurred": event.occurred_at,
            },
        )

    @staticmethod
    def _feedback_values(event: EventEnvelope) -> tuple[str, str, str | None]:
        payload = event.payload
        if event.event_type == "case.fraud-type-overridden":
            return "ANALYST", "FRAUD", str(payload["effective_type"])
        if event.event_type == "case.customer-verification-responded":
            response = str(payload["response"])
            fraud = response in {"BEN_YAPMADIM", "NOT_MINE", "DENIED", "CUSTOMER_DENIED"}
            return "CUSTOMER", "FRAUD" if fraud else "LEGITIMATE", None
        if event.event_type == "case.ground-truth-set":
            source = str(payload.get("source", "SUPERVISOR_QA"))
            source = (
                source if source in {"ANALYST", "CUSTOMER", "SUPERVISOR_QA"} else "SUPERVISOR_QA"
            )
            fraud_type = payload.get("fraud_type")
            return source, str(payload["truth"]), None if fraud_type is None else str(fraud_type)
        raise ValueError("event cannot create classification feedback")
