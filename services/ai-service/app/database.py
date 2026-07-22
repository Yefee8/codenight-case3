from __future__ import annotations

import hashlib
import json
from typing import Any
from uuid import UUID

from sqlalchemy import Engine, create_engine, text
from sqlalchemy.exc import SQLAlchemyError

from app.ids import uuid7
from app.schemas import ScoreRequest, ScoreResponse

SYSTEM_ID = UUID(int=0)


class AiRepository:
    def __init__(self, database_url: str) -> None:
        self.engine: Engine = create_engine(
            database_url,
            pool_pre_ping=True,
            pool_size=5,
            max_overflow=5,
            pool_timeout=3,
        )
        self.last_error: str | None = "database has not been checked"

    @property
    def ready(self) -> bool:
        return self.last_error is None

    def check(self) -> bool:
        try:
            with self.engine.connect() as connection:
                safe_role = connection.execute(
                    text(
                        """
                        SELECT COALESCE((
                            SELECT NOT role.rolsuper
                               AND NOT role.rolbypassrls
                               AND NOT role.rolcreaterole
                               AND NOT EXISTS (
                                   SELECT 1
                                     FROM pg_class object
                                     JOIN pg_namespace namespace
                                       ON namespace.oid = object.relnamespace
                                    WHERE object.relowner = role.oid
                                      AND namespace.nspname = current_schema()
                                      AND object.relkind IN ('r', 'p', 'v', 'm', 'S')
                               )
                              FROM pg_roles role
                             WHERE role.rolname = current_user
                        ), false) AS runtime_role_is_safe
                        """
                    )
                ).scalar_one()
                if not safe_role:
                    raise SQLAlchemyError("unsafe runtime database role")
            self.last_error = None
            return True
        except SQLAlchemyError as error:
            self.last_error = error.__class__.__name__
            return False

    def register_model(self, manifest: dict[str, Any]) -> None:
        with self.engine.begin() as connection:
            self._system_context(connection)
            connection.execute(
                text(
                    """
                    UPDATE model_versions SET status = 'RETIRED'
                     WHERE status = 'ACTIVE' AND model_version <> :model_version
                    """
                ),
                {"model_version": manifest["model_version"]},
            )
            registered = connection.execute(
                text(
                    """
                    INSERT INTO model_versions
                        (model_version, feature_schema_version, artifact_sha256,
                         dataset_sha256, manifest, status, activated_at)
                    VALUES (:model_version, :feature_schema_version, :artifact_sha256,
                            :dataset_sha256, CAST(:manifest AS jsonb), 'ACTIVE', now())
                    ON CONFLICT (model_version) DO UPDATE
                       SET status = 'ACTIVE',
                           activated_at = COALESCE(model_versions.activated_at, now())
                     WHERE model_versions.feature_schema_version = EXCLUDED.feature_schema_version
                       AND model_versions.artifact_sha256 = EXCLUDED.artifact_sha256
                       AND model_versions.dataset_sha256 = EXCLUDED.dataset_sha256
                    RETURNING id
                    """
                ),
                {
                    "model_version": manifest["model_version"],
                    "feature_schema_version": manifest["feature_schema_version"],
                    "artifact_sha256": manifest["artifact_sha256"],
                    "dataset_sha256": manifest["dataset_sha256"],
                    "manifest": _json(manifest),
                },
            ).scalar_one_or_none()
            if registered is None:
                raise ValueError("model version already exists with different immutable metadata")
        self.last_error = None

    def persist_prediction(
        self,
        request: ScoreRequest,
        response: ScoreResponse,
        correlation_id: UUID,
    ) -> None:
        feature_json = _json(request.features.model_dump(mode="json"))
        feature_hash = hashlib.sha256(feature_json.encode()).hexdigest()
        response_json = response.model_dump(mode="json")
        recommendation_id = uuid7()
        prediction_event_id = uuid7()
        assignment_event_id = uuid7()
        with self.engine.begin() as connection:
            self._system_context(connection)
            model_id = connection.execute(
                text(
                    "SELECT id FROM model_versions WHERE model_version = :version AND status = 'ACTIVE'"
                ),
                {"version": response.model_version},
            ).scalar_one()
            connection.execute(
                text(
                    """
                    INSERT INTO predictions
                        (prediction_id, transaction_id, model_version_id, feature_schema_version,
                         feature_hash, risk_score, risk_level, decision, fraud_type, reason_codes)
                    VALUES (:prediction_id, :transaction_id, :model_id, :feature_schema_version,
                            :feature_hash, :risk_score, :risk_level, :decision, :fraud_type,
                            CAST(:reason_codes AS jsonb))
                    """
                ),
                {
                    "prediction_id": response.prediction_id,
                    "transaction_id": request.transaction_id,
                    "model_id": model_id,
                    "feature_schema_version": response.feature_schema_version,
                    "feature_hash": feature_hash,
                    "risk_score": response.risk_score,
                    "risk_level": response.risk_level,
                    "decision": response.decision,
                    "fraud_type": response.fraud_type,
                    "reason_codes": _json(response.reason_codes),
                },
            )
            connection.execute(
                text(
                    """
                    INSERT INTO assignment_recommendations
                        (recommendation_id, case_id, prediction_id, formula_version, ranked_candidates)
                    VALUES (:id, :case_id, :prediction_id, 'assignment-v1', CAST(:candidates AS jsonb))
                    """
                ),
                {
                    "id": recommendation_id,
                    "case_id": request.case_id,
                    "prediction_id": response.prediction_id,
                    "candidates": _json(response_json["ranked_candidates"]),
                },
            )
            self._outbox(
                connection,
                prediction_event_id,
                "ai.prediction-created",
                response.prediction_id,
                correlation_id,
                {
                    "prediction_id": str(response.prediction_id),
                    "transaction_id": str(request.transaction_id),
                    "model_version": response.model_version,
                    "risk_score": response.risk_score,
                    "fraud_type": response.fraud_type,
                    "reason_codes": response.reason_codes,
                },
            )
            self._outbox(
                connection,
                assignment_event_id,
                "ai.assignment-recommended",
                recommendation_id,
                correlation_id,
                {
                    "recommendation_id": str(recommendation_id),
                    "case_id": str(request.case_id),
                    "ranked_candidates": response_json["ranked_candidates"],
                    "formula_version": "assignment-v1",
                },
            )

    def online_metrics(self) -> dict[str, Any]:
        effective_cte = """
            WITH ranked AS (
                SELECT f.*,
                       row_number() OVER (
                           PARTITION BY f.prediction_id
                           ORDER BY CASE f.source
                                      WHEN 'SUPERVISOR_QA' THEN 3
                                      WHEN 'CUSTOMER' THEN 2
                                      ELSE 1
                                    END DESC,
                                    f.aggregate_version DESC,
                                    f.occurred_at DESC,
                                    f.source_event_id DESC
                       ) AS priority_rank
                  FROM classification_feedback f
            ), effective AS (
                SELECT * FROM ranked WHERE priority_rank = 1
            )
        """
        with self.engine.begin() as connection:
            self._system_context(connection)
            summary = (
                connection.execute(
                    text(
                        effective_cte  # noqa: S608 -- both fragments are compile-time constants
                        + """
                    SELECT count(*) AS sample_count,
                           COALESCE(avg(is_risk_correct::int), 0) AS risk_accuracy,
                           COALESCE(
                               count(*) FILTER (
                                   WHERE ground_truth = 'LEGITIMATE' AND NOT is_risk_correct
                               )::numeric
                               / NULLIF(count(*) FILTER (
                                   WHERE ground_truth = 'LEGITIMATE'
                               ), 0),
                               0
                           ) AS false_positive_rate,
                           COALESCE(avg(is_type_correct::int) FILTER (
                               WHERE ground_truth = 'FRAUD' AND fraud_type IS NOT NULL
                           ), 0) AS type_accuracy
                      FROM effective
                    """
                    )
                )
                .mappings()
                .one()
            )
            categories = (
                connection.execute(
                    text(
                        effective_cte  # noqa: S608 -- both fragments are compile-time constants
                        + """
                    , evaluated AS (
                        SELECT e.ground_truth, e.fraud_type AS actual_type,
                               p.fraud_type AS predicted_type, p.risk_score
                          FROM effective e
                          JOIN predictions p ON p.prediction_id = e.prediction_id
                    ), categories AS (
                        SELECT actual_type AS category FROM evaluated
                         WHERE ground_truth = 'FRAUD' AND actual_type IS NOT NULL
                        UNION
                        SELECT predicted_type AS category FROM evaluated
                         WHERE risk_score >= 0.40 AND predicted_type <> 'TEMIZ'
                    )
                    SELECT c.category,
                           count(*) FILTER (
                               WHERE e.ground_truth = 'FRAUD'
                                 AND e.actual_type = c.category
                           ) AS sample_count,
                           COALESCE(
                               count(*) FILTER (
                                   WHERE e.ground_truth = 'FRAUD'
                                     AND e.actual_type = c.category
                                     AND e.predicted_type = c.category
                                     AND e.risk_score >= 0.40
                               )::numeric
                               / NULLIF(count(*) FILTER (
                                   WHERE e.ground_truth = 'FRAUD'
                                     AND e.actual_type = c.category
                               ), 0),
                               0
                           ) AS recall,
                           COALESCE(
                               count(*) FILTER (
                                   WHERE e.ground_truth = 'FRAUD'
                                     AND e.actual_type = c.category
                                     AND e.predicted_type = c.category
                                     AND e.risk_score >= 0.40
                               )::numeric
                               / NULLIF(count(*) FILTER (
                                   WHERE e.predicted_type = c.category
                                     AND e.risk_score >= 0.40
                               ), 0),
                               0
                           ) AS precision
                      FROM categories c CROSS JOIN evaluated e
                     GROUP BY c.category ORDER BY c.category
                    """
                    )
                )
                .mappings()
                .all()
            )
        return {
            "sample_count": int(summary["sample_count"]),
            "risk_accuracy": float(summary["risk_accuracy"]),
            "false_positive_rate": float(summary["false_positive_rate"]),
            "type_accuracy": float(summary["type_accuracy"]),
            "categories": [
                {
                    "category": str(row["category"]),
                    "sample_count": int(row["sample_count"]),
                    "recall": float(row["recall"]),
                    "precision": float(row["precision"]),
                }
                for row in categories
            ],
        }

    @staticmethod
    def _system_context(connection: Any) -> None:
        connection.execute(
            text(
                "SELECT set_config('app.actor_id', :actor_id, true), "
                "set_config('app.actor_role', 'SYSTEM', true), "
                "set_config('app.service_name', 'ai-service', true)"
            ),
            {"actor_id": str(SYSTEM_ID)},
        )

    @staticmethod
    def _outbox(
        connection: Any,
        event_id: UUID,
        event_type: str,
        aggregate_id: UUID,
        correlation_id: UUID,
        payload: dict[str, Any],
    ) -> None:
        connection.execute(
            text(
                """
                INSERT INTO outbox_events
                    (event_id, event_type, aggregate_id, aggregate_version,
                     correlation_id, payload)
                VALUES (:event_id, :event_type, :aggregate_id, 1, :correlation_id,
                        CAST(:payload AS jsonb))
                """
            ),
            {
                "event_id": event_id,
                "event_type": event_type,
                "aggregate_id": aggregate_id,
                "correlation_id": correlation_id,
                "payload": _json(payload),
            },
        )


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True, default=str)
