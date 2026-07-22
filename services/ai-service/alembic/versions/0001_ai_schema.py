"""AI model registry, inference, feedback and event schema.

Revision ID: 0001
"""

from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")
    op.execute(
        """
        CREATE TABLE model_versions (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            model_version VARCHAR(80) NOT NULL UNIQUE,
            feature_schema_version VARCHAR(80) NOT NULL,
            artifact_sha256 CHAR(64) NOT NULL UNIQUE,
            dataset_sha256 CHAR(64) NOT NULL,
            manifest JSONB NOT NULL,
            status VARCHAR(20) NOT NULL CHECK (status IN ('STAGED','ACTIVE','RETIRED','REJECTED')),
            activated_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX uq_model_one_active ON model_versions (status) WHERE status = 'ACTIVE';

        CREATE TABLE training_runs (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            model_version_id UUID REFERENCES model_versions(id),
            seed INTEGER NOT NULL,
            dataset_sha256 CHAR(64) NOT NULL,
            metrics JSONB NOT NULL,
            dependency_versions JSONB NOT NULL,
            status VARCHAR(20) NOT NULL CHECK (status IN ('RUNNING','PASSED','FAILED')),
            failure_code VARCHAR(80),
            started_at TIMESTAMPTZ NOT NULL,
            finished_at TIMESTAMPTZ
        );

        CREATE TABLE predictions (
            prediction_id UUID PRIMARY KEY,
            transaction_id UUID NOT NULL,
            model_version_id UUID NOT NULL REFERENCES model_versions(id),
            feature_schema_version VARCHAR(80) NOT NULL,
            feature_hash CHAR(64) NOT NULL,
            risk_score NUMERIC(7,6) NOT NULL CHECK (risk_score BETWEEN 0 AND 1),
            risk_level VARCHAR(16) NOT NULL CHECK (risk_level IN ('DUSUK','ORTA','YUKSEK','KRITIK')),
            decision VARCHAR(16) NOT NULL CHECK (decision IN ('ONAY','INCELEME','BLOK')),
            fraud_type VARCHAR(50) NOT NULL,
            reason_codes JSONB NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE INDEX idx_predictions_transaction ON predictions (transaction_id, created_at DESC);

        CREATE TABLE classification_feedback (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            prediction_id UUID NOT NULL REFERENCES predictions(prediction_id),
            source VARCHAR(30) NOT NULL CHECK (source IN ('ANALYST','CUSTOMER','SUPERVISOR_QA')),
            ground_truth VARCHAR(20) NOT NULL CHECK (ground_truth IN ('FRAUD','LEGITIMATE')),
            fraud_type VARCHAR(50),
            is_risk_correct BOOLEAN NOT NULL,
            is_type_correct BOOLEAN,
            source_event_id UUID NOT NULL UNIQUE,
            aggregate_version BIGINT NOT NULL,
            occurred_at TIMESTAMPTZ NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE INDEX idx_feedback_prediction_priority ON classification_feedback (prediction_id, source, occurred_at DESC);

        CREATE TABLE analyst_projection (
            analyst_id UUID PRIMARY KEY,
            status VARCHAR(20) NOT NULL,
            locked BOOLEAN NOT NULL DEFAULT FALSE,
            specialties JSONB NOT NULL,
            regions JSONB NOT NULL,
            active_case_count INTEGER NOT NULL DEFAULT 0 CHECK (active_case_count >= 0),
            performance NUMERIC(6,5) CHECK (performance BETWEEN 0 AND 1),
            last_assigned_at TIMESTAMPTZ,
            aggregate_version BIGINT NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE TABLE assignment_recommendations (
            recommendation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            case_id UUID NOT NULL,
            prediction_id UUID NOT NULL REFERENCES predictions(prediction_id),
            formula_version VARCHAR(40) NOT NULL,
            ranked_candidates JSONB NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE (case_id, prediction_id)
        );

        CREATE TABLE accuracy_snapshots (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            period_start TIMESTAMPTZ NOT NULL,
            period_end TIMESTAMPTZ NOT NULL,
            sample_count INTEGER NOT NULL CHECK (sample_count >= 0),
            metrics JSONB NOT NULL,
            category_metrics JSONB NOT NULL,
            generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CHECK (period_end > period_start),
            UNIQUE (period_start, period_end)
        );

        CREATE TABLE inbox_events (
            event_id UUID PRIMARY KEY,
            event_type VARCHAR(120) NOT NULL,
            aggregate_id UUID NOT NULL,
            aggregate_version BIGINT NOT NULL,
            payload_hash CHAR(64) NOT NULL,
            processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE TABLE outbox_events (
            event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            event_type VARCHAR(120) NOT NULL,
            event_version INTEGER NOT NULL DEFAULT 1 CHECK (event_version > 0),
            aggregate_id UUID NOT NULL,
            aggregate_version BIGINT NOT NULL,
            correlation_id UUID NOT NULL,
            causation_id UUID,
            payload JSONB NOT NULL,
            occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            published_at TIMESTAMPTZ,
            attempt_count INTEGER NOT NULL DEFAULT 0,
            next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE INDEX idx_ai_outbox_pending ON outbox_events (next_attempt_at, occurred_at)
            WHERE published_at IS NULL;

        CREATE FUNCTION reject_ai_immutable_change() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '55000';
        END;
        $$;
        CREATE TRIGGER predictions_append_only BEFORE UPDATE OR DELETE ON predictions
            FOR EACH ROW EXECUTE FUNCTION reject_ai_immutable_change();
        CREATE TRIGGER feedback_append_only BEFORE UPDATE OR DELETE ON classification_feedback
            FOR EACH ROW EXECUTE FUNCTION reject_ai_immutable_change();
        """
    )


def downgrade() -> None:
    raise RuntimeError("Production migration downgrade is intentionally disabled")
